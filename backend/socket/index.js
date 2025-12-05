// socket/index.js
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import {
  startMatch,
  addPoint,
  undoLast,
  finishMatch,
  forfeitMatch,
  toDTO,
  setServe,
} from "./liveHandlers.js";

import Match from "../models/matchModel.js";
import Court from "../models/courtModel.js";
import Bracket from "../models/bracketModel.js";
import {
  assignNextToCourt,
  onMatchFinished,
  buildGroupsRotationQueue,
  fillIdleCourtsForCluster,
} from "../services/courtQueueService.js";
import { broadcastState } from "../services/broadcastState.js";
import { decorateServeAndSlots } from "../utils/liveServeUtils.js";
import {
  addConnection,
  emitSummary,
  refreshHeartbeat,
  removeConnection,
  sweepStaleSockets,
} from "../services/presenceService.js";
import { ensureAdmin, ensureReferee } from "../utils/socketAuth.js";
import UserMatch from "../models/userMatchModel.js";

/* 👇 THÊM BIẾN TOÀN CỤC LƯU IO */
let ioInstance = null;
let sweeperStarted = false;

function guessClientType(socket) {
  try {
    const raw = socket.handshake.query?.client || "";
    if (raw) return String(raw).toLowerCase();
    const ua = String(
      socket.handshake.headers["user-agent"] || ""
    ).toLowerCase();
    if (ua.includes("android") || ua.includes("iphone")) return "app";
    return "web";
  } catch (e) {
    console.error("[socket] guessClientType error:", e);
    return "web";
  }
}

// ===== helpers tái dùng từ match:join =====
const loadMatchForSnapshot = async (matchId) => {
  return (
    Match.findById(matchId)
      .populate({
        path: "pairA",
        select: "player1 player2 seed label teamName",
        populate: [
          {
            path: "player1",
            select: "fullName name shortName nickname nickName user",
            populate: { path: "user", select: "nickname nickName" },
          },
          {
            path: "player2",
            select: "fullName name shortName nickname nickName user",
            populate: { path: "user", select: "nickname nickName" },
          },
        ],
      })
      .populate({
        path: "pairB",
        select: "player1 player2 seed label teamName",
        populate: [
          {
            path: "player1",
            select: "fullName name shortName nickname nickName user",
            populate: { path: "user", select: "nickname nickName" },
          },
          {
            path: "player2",
            select: "fullName name shortName nickname nickName user",
            populate: { path: "user", select: "nickname nickName" },
          },
        ],
      })
      // referee là mảng
      .populate({ path: "referee", select: "name fullName nickname nickName" })
      // người đang điều khiển live
      .populate({ path: "liveBy", select: "name fullName nickname nickName" })
      .populate({ path: "previousA", select: "round order" })
      .populate({ path: "previousB", select: "round order" })
      .populate({ path: "nextMatch", select: "_id" })
      .populate({ path: "tournament", select: "name image eventType overlay" })
      // BRACKET: groups + meta + config như mẫu bạn đưa
      .populate({
        path: "bracket",
        select: [
          "noRankDelta",
          "name",
          "type",
          "stage",
          "order",
          "drawRounds",
          "drawStatus",
          "scheduler",
          "drawSettings",
          "meta.drawSize",
          "meta.maxRounds",
          "meta.expectedFirstRoundMatches",
          "groups._id",
          "groups.name",
          "groups.expectedSize",
          "config.rules",
          "config.doubleElim",
          "config.roundRobin",
          "config.swiss",
          "config.gsl",
          "config.roundElim",
          "overlay",
        ].join(" "),
      })
      // court để FE auto-next theo sân
      .populate({
        path: "court",
        select: "name number code label zone area venue building floor",
      })
      .lean()
  );
};

// giữ nguyên cách fill nickname của bạn
const fillNick = (p) => {
  if (!p) return p;
  const pick = (v) => (v && String(v).trim()) || "";
  const primary = pick(p.nickname) || pick(p.nickName);
  const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
  const n = primary || fromUser || "";
  if (n) {
    p.nickname = n;
    p.nickName = n;
  }
  return p;
};

// chuẩn hoá snapshot như match:join (fallbacks + prevBracket)
const postprocessSnapshotLikeJoin = async (m) => {
  if (m?.pairA) {
    m.pairA.player1 = fillNick(m.pairA.player1);
    m.pairA.player2 = fillNick(m.pairA.player2);
  }
  if (m?.pairB) {
    m.pairB.player1 = fillNick(m.pairB.player1);
    m.pairB.player2 = fillNick(m.pairB.player2);
  }

  // streams từ meta nếu thiếu
  if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

  // rules fallback
  m.rules = {
    bestOf: Number(m?.rules?.bestOf ?? 3),
    pointsToWin: Number(m?.rules?.pointsToWin ?? 11),
    winByTwo: Boolean(m?.rules?.winByTwo ?? true),
    ...(m.rules?.cap ? { cap: m.rules.cap } : {}),
  };

  // serve fallback/normalize
  if (!m?.serve || (!m.serve.side && !m.serve.server && !m.serve.playerIndex)) {
    m.serve = { side: "A", server: 1, playerIndex: 1 };
  } else {
    m.serve.side = (m.serve.side || "A").toUpperCase() === "B" ? "B" : "A";
    m.serve.server = Number(m.serve.server ?? m.serve.playerIndex ?? 1) || 1;
    m.serve.playerIndex =
      Number(m.serve.playerIndex ?? m.serve.server ?? 1) || 1;
  }

  // gameScores tối thiểu
  if (!Array.isArray(m.gameScores) || !m.gameScores.length) {
    m.gameScores = [{ a: 0, b: 0 }];
  }

  // overlay fallback
  if (!m.overlay) {
    m.overlay =
      m?.overlay || m?.tournament?.overlay || m?.bracket?.overlay || undefined;
  }

  // roundCode fallback
  if (!m.roundCode) {
    const drawSize =
      Number(m?.bracket?.meta?.drawSize) ||
      (Number.isInteger(m?.bracket?.drawRounds)
        ? 1 << m.bracket.drawRounds
        : 0);
    if (drawSize && Number.isInteger(m?.round) && m.round >= 1) {
      const roundSize = Math.max(
        2,
        Math.floor(drawSize / Math.pow(2, m.round - 1))
      );
      m.roundCode = `R${roundSize}`;
    }
  }

  // court fallback fields
  const courtId = m?.court?._id || m?.courtId || null;
  const courtNumber = m?.court?.number ?? m?.courtNo ?? undefined;
  const courtName =
    m?.court?.name ??
    m?.courtName ??
    (courtNumber != null ? `Sân ${courtNumber}` : "");
  m.courtId = courtId || undefined;
  m.courtName = courtName || undefined;
  m.courtNo = courtNumber ?? undefined;

  // bracketType fallback
  if (!m.bracketType) {
    m.bracketType = m?.bracket?.type || m?.format || m?.bracketType || "";
  }

  // prevBracket (neighbor) — như code bạn đưa
  try {
    const toNum = (v, d = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };
    const toTime = (x) =>
      (x?.createdAt && new Date(x.createdAt).getTime()) ||
      (x?._id?.getTimestamp?.() && x._id.getTimestamp().getTime()) ||
      0;

    const normalizeBracketShape = (b) => {
      if (!b) return b;
      const bb = { ...b };
      if (!Array.isArray(bb.groups)) bb.groups = [];
      bb.meta = bb.meta || {};
      if (typeof bb.meta.drawSize !== "number") bb.meta.drawSize = 0;
      if (typeof bb.meta.maxRounds !== "number") bb.meta.maxRounds = 0;
      if (typeof bb.meta.expectedFirstRoundMatches !== "number")
        bb.meta.expectedFirstRoundMatches = 0;
      bb.config = bb.config || {};
      bb.config.rules = bb.config.rules || {};
      bb.config.roundRobin = bb.config.roundRobin || {};
      bb.config.doubleElim = bb.config.doubleElim || {};
      bb.config.swiss = bb.config.swiss || {};
      bb.config.gsl = bb.config.gsl || {};
      bb.config.roundElim = bb.config.roundElim || {};
      if (typeof bb.noRankDelta !== "boolean") bb.noRankDelta = false;
      bb.scheduler = bb.scheduler || {};
      bb.drawSettings = bb.drawSettings || {};
      return bb;
    };

    const curBracketId = m?.bracket?._id;
    const tourId = m?.tournament?._id || m?.tournament;
    m.prevBracket = null;
    m.prevBrackets = [];

    if (curBracketId && tourId) {
      const prevSelect = [
        "name",
        "type",
        "stage",
        "order",
        "drawRounds",
        "drawStatus",
        "scheduler",
        "drawSettings",
        "meta.drawSize",
        "meta.maxRounds",
        "meta.expectedFirstRoundMatches",
        "groups._id",
        "groups.name",
        "groups.expectedSize",
        "config.rules",
        "config.doubleElim",
        "config.roundRobin",
        "config.swiss",
        "config.gsl",
        "config.roundElim",
        "overlay",
        "createdAt",
      ].join(" ");

      const allBr = await Bracket.find({ tournament: tourId })
        .select(prevSelect)
        .lean();

      const list = (allBr || [])
        .map((b) => ({
          ...b,
          __k: [toNum(b.order, 0), toTime(b), String(b._id)],
        }))
        .sort((a, b) => {
          for (let i = 0; i < a.__k.length; i++) {
            if (a.__k[i] < b.__k[i]) return -1;
            if (a.__k[i] > b.__k[i]) return 1;
          }
          return 0;
        });

      const curIdx = list.findIndex(
        (x) => String(x._id) === String(curBracketId)
      );
      if (curIdx > 0) {
        const { __k, ...prevRaw } = list[curIdx - 1];
        const prev = normalizeBracketShape(prevRaw);
        m.prevBracket = prev;
        m.prevBrackets = [prev];
      }
    }
  } catch (e) {
    console.error("[serve:set] prevBracket error:", e?.message || e);
  }

  return m;
};

/**
 * Khởi tạo Socket.IO server
 * @param {import('http').Server} httpServer
 * @param {{ whitelist?: string[], path?: string }} opts
 * @returns {Server}
 */
export function initSocket(
  httpServer,
  { whitelist = [], path = "/socket.io" } = {}
) {
  // Nếu đã init rồi thì dùng lại (tránh đúp handler)
  if (ioInstance) {
    console.warn(
      "[socket] initSocket called again -> reuse existing io instance"
    );
    return ioInstance;
  }

  const io = new Server(httpServer, {
    path,
    cors: { origin: whitelist, credentials: true },
    transports: ["websocket", "polling"],
  });

  ioInstance = io; // 👈 LƯU LẠI ĐỂ FILE KHÁC LẤY

  // Optional Redis adapter (clustered scale-out)
  (async () => {
    if (!process.env.REDIS_URL) return;
    try {
      const pub = createClient({ url: process.env.REDIS_URL });
      const sub = pub.duplicate();
      await pub.connect();
      await sub.connect();
      io.adapter(createAdapter(pub, sub));
      console.log("✅ Redis adapter connected:", process.env.REDIS_URL);
    } catch (err) {
      console.error("❌ Redis connection failed:", err);
    }
  })();

  // Lightweight auth: put user info on socket if token is valid
  // Auth middleware: set BOTH socket.data.* and socket.user (compat)
  function extractUserId(p) {
    return (
      p?.id ||
      p?._id ||
      p?.userId ||
      p?.user?.id ||
      p?.user?._id ||
      p?.data?.id ||
      p?.data?._id ||
      p?.sub ||
      p?.uid ||
      null
    );
  }
  io.use((socket, next) => {
    try {
      const rawAuth = socket.handshake.auth?.token || "";
      const rawHeader = socket.handshake.headers?.authorization || "";
      const headerToken = rawHeader.startsWith("Bearer ")
        ? rawHeader.slice(7)
        : null;
      const token = rawAuth.startsWith("Bearer ")
        ? rawAuth.slice(7)
        : rawAuth || headerToken;
      if (!token) {
        socket.user = null;
        socket.data.userId = null;
        socket.data.role = null;
        socket.data.client = guessClientType(socket);
        return next();
      }
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const uid = extractUserId(payload);
      if (!uid) {
        console.warn(
          "[socket] JWT ok nhưng không tìm thấy userId trong payload:",
          payload
        );
        socket.user = null;
        socket.data.userId = null;
        socket.data.role = null;
        socket.data.client = guessClientType(socket);
        return next();
      }
      socket.data.userId = String(uid);
      socket.data.role = payload?.role || null;
      socket.data.client = guessClientType(socket);
      // giữ tương thích cho các đoạn code đang dùng socket.user
      socket.user = { _id: socket.data.userId, role: socket.data.role };
      return next();
    } catch (e) {
      console.error("[socket] auth error:", e?.message || e);
      socket.user = null;
      socket.data.userId = null;
      socket.data.role = null;
      socket.data.client = guessClientType(socket);
      return next();
    }
  });

  // Helpers

  const isObjectIdString = (s) => /^[a-f\d]{24}$/i.test(String(s || ""));

  // const ensureReferee = (socket) =>
  //   socket.user?.role === "referee" || socket.user?.role === "admin";
  // const ensureAdmin = (socket) => socket.user?.role === "admin";

  // Resolve cluster-key: ưu tiên bracketId, fallback cluster string
  const resolveClusterKey = (bracket, cluster = "Main") =>
    bracket ? String(bracket) : cluster ?? "Main";

  // Scheduler state broadcaster (ưu tiên bracket)
  // ---------------- Broadcaster (ĐÃ SỬA) ----------------

  io.on("connection", async (socket) => {
    const userId = String(socket?.data?.userId || socket?.user?._id || "");
    const client = socket?.data?.client || guessClientType(socket);
    if (!userId) {
      console.warn(
        "[socket] connected nhưng không có userId -> presence sẽ không tăng"
      );
    } else {
      console.log(
        "[socket] connected:",
        socket.id,
        "uid=",
        userId,
        "client=",
        client
      );
    }

    try {
      if (userId) {
        await addConnection({ userId, socketId: socket.id, client });
        await emitSummary(io);
      }
    } catch (e) {
      console.error("[socket] on connect addConnection error:", e);
    }

    // nhận subscribe realtime từ admin tab
    socket.on("presence:watch", async () => {
      try {
        socket.join("presence:watchers");
        await emitSummary(io, socket.id); // gửi riêng cho socket này
      } catch (e) {
        console.error("[socket] presence:watch error:", e);
      }
    });

    // heartbeat từ client (app/web gửi mỗi 10s)
    socket.on("presence:ping", async () => {
      try {
        await refreshHeartbeat(socket.id);
      } catch (e) {
        console.error("[socket] presence:ping error:", e);
      }
    });

    // ========= MATCH ROOMS =========
    socket.on("match:join", async ({ matchId }) => {
      try {
        if (!matchId) return;

        // vẫn join room match:... cho cả 2 loại
        socket.join(`match:${matchId}`);

        let m = null;
        let isUserMatch = false;

        // ===== 1) THỬ LOAD USERMATCH TRƯỚC =====
        try {
          m = await UserMatch.findById(matchId)
            .populate(
              "participants.user",
              "name fullName avatar nickname nickName phone"
            )
            .populate({
              path: "referee",
              select: "name fullName nickname nickName",
            })
            .populate({
              path: "liveBy",
              select: "name fullName nickname nickName",
            })
            .populate({
              path: "serve.serverId",
              model: "User",
              select: "name fullName nickname nickName",
            })
            .populate({
              path: "court",
              select: "name number code label zone area venue building floor",
            })
            .lean();

          if (m) {
            isUserMatch = true;
          }
        } catch (e) {
          console.error(
            "[socket match:join] load UserMatch error:",
            e?.message || e
          );
        }

        // ===== 2) KHÔNG CÓ USERMATCH → FALLBACK MATCH CŨ =====
        if (!m) {
          m = await Match.findById(matchId)
            .populate({
              path: "pairA",
              select: "player1 player2 seed label teamName",
              populate: [
                {
                  path: "player1",
                  // có đủ các tên + user.nickname để FE fallback
                  select: "fullName name shortName nickname nickName user",
                  populate: { path: "user", select: "nickname nickName" },
                },
                {
                  path: "player2",
                  select: "fullName name shortName nickname nickName user",
                  populate: { path: "user", select: "nickname nickName" },
                },
              ],
            })
            .populate({
              path: "pairB",
              select: "player1 player2 seed label teamName",
              populate: [
                {
                  path: "player1",
                  select: "fullName name shortName nickname nickName user",
                  populate: { path: "user", select: "nickname nickName" },
                },
                {
                  path: "player2",
                  select: "fullName name shortName nickname nickName user",
                  populate: { path: "user", select: "nickname nickName" },
                },
              ],
            })
            // referee là mảng
            .populate({
              path: "referee",
              select: "name fullName nickname nickName",
            })
            // người đang điều khiển live
            .populate({
              path: "liveBy",
              select: "name fullName nickname nickName",
            })
            .populate({ path: "previousA", select: "round order" })
            .populate({ path: "previousB", select: "round order" })
            .populate({ path: "nextMatch", select: "_id" })
            .populate({
              path: "tournament",
              select: "name image eventType overlay",
            })
            // BRACKET: gửi đủ groups + meta + config như mẫu JSON bạn đưa
            .populate({
              path: "bracket",
              select: [
                "noRankDelta",
                "name",
                "type",
                "stage",
                "order",
                "drawRounds",
                "drawStatus",
                "scheduler",
                "drawSettings",
                // meta.*
                "meta.drawSize",
                "meta.maxRounds",
                "meta.expectedFirstRoundMatches",
                // groups[]
                "groups._id",
                "groups.name",
                "groups.expectedSize",
                // rules + các config khác để FE tham chiếu
                "config.rules",
                "config.doubleElim",
                "config.roundRobin",
                "config.swiss",
                "config.gsl",
                "config.roundElim",
                // nếu bạn có overlay ở bracket thì giữ lại
                "overlay",
              ].join(" "),
            })
            // court để FE auto-next theo sân
            .populate({
              path: "court",
              select: "name number code label zone area venue building floor",
            })
            .lean();
        }

        if (!m) return;

        // ====== GIỮ NGUYÊN CODE DECORATE Ở DƯỚI (ÁP DỤNG CHUNG CHO CẢ HAI) ======

        // Helper: lấy nickname ưu tiên player.nickname/nickName;
        // nếu thiếu HOẶC chuỗi rỗng => fallback sang user.nickname/user.nickName.
        const fillNick = (p) => {
          if (!p) return p;
          const pick = (v) => (v && String(v).trim()) || "";
          const primary = pick(p.nickname) || pick(p.nickName);
          const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
          const n = primary || fromUser || "";
          if (n) {
            p.nickname = n;
            p.nickName = n;
          }
          return p;
        };

        if (m.pairA) {
          m.pairA.player1 = fillNick(m.pairA.player1);
          m.pairA.player2 = fillNick(m.pairA.player2);
        }
        if (m.pairB) {
          m.pairB.player1 = fillNick(m.pairB.player1);
          m.pairB.player2 = fillNick(m.pairB.player2);
        }

        // bổ sung streams từ meta nếu có
        if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

        // fallback rules để DTO/FE luôn có giá trị an toàn
        m.rules = {
          bestOf: Number(m?.rules?.bestOf ?? 3),
          pointsToWin: Number(m?.rules?.pointsToWin ?? 11),
          winByTwo: Boolean(m?.rules?.winByTwo ?? true),
          ...(m.rules?.cap ? { cap: m.rules.cap } : {}),
        };

        // fallback serve
        if (
          !m?.serve ||
          (!m.serve.side && !m.serve.server && !m.serve.playerIndex)
        ) {
          m.serve = { side: "A", server: 1, playerIndex: 1 };
        } else {
          m.serve.side =
            (m.serve.side || "A").toUpperCase() === "B" ? "B" : "A";
          m.serve.server =
            Number(m.serve.server ?? m.serve.playerIndex ?? 1) || 1;
          m.serve.playerIndex =
            Number(m.serve.playerIndex ?? m.serve.server ?? 1) || 1;
        }

        // gameScores tối thiểu 1 phần tử
        if (!Array.isArray(m.gameScores) || !m.gameScores.length) {
          m.gameScores = [{ a: 0, b: 0 }];
        }

        // overlay root (ưu tiên match.overlay)
        if (!m.overlay) {
          m.overlay =
            m?.overlay ||
            m?.tournament?.overlay ||
            m?.bracket?.overlay ||
            undefined;
        }

        // roundCode fallback (không ảnh hưởng userMatch vì không có bracket)
        if (!m.roundCode && m.bracket) {
          const drawSize =
            Number(m?.bracket?.meta?.drawSize) ||
            (Number.isInteger(m?.bracket?.drawRounds)
              ? 1 << m.bracket.drawRounds
              : 0);
          if (drawSize && Number.isInteger(m?.round) && m.round >= 1) {
            const roundSize = Math.max(
              2,
              Math.floor(drawSize / Math.pow(2, m.round - 1))
            );
            m.roundCode = `R${roundSize}`;
          }
        }

        // court fallback field (courtId/courtName/courtNo) để FE cũ/auto-next dùng được
        const courtId = m?.court?._id || m?.courtId || null;
        const courtNumber = m?.court?.number ?? m?.courtNo ?? undefined;
        const courtName =
          m?.court?.name ??
          m?.courtName ??
          (courtNumber != null ? `Sân ${courtNumber}` : "");
        m.courtId = courtId || undefined;
        m.courtName = courtName || undefined;
        m.courtNo = courtNumber ?? undefined;

        // bracketType (userMatch không có bracket → chuỗi rỗng)
        if (!m.bracketType) {
          m.bracketType = m?.bracket?.type || m?.format || m?.bracketType || "";
        }

        // prevBracket chỉ chạy khi có tournament + bracket (userMatch sẽ tự skip)
        try {
          const toNum = (v, d = 0) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : d;
          };
          const toTime = (x) =>
            (x?.createdAt && new Date(x.createdAt).getTime()) ||
            (x?._id?.getTimestamp?.() && x._id.getTimestamp().getTime()) ||
            0;

          const normalizeBracketShape = (b) => {
            if (!b) return b;
            const bb = { ...b };
            if (!Array.isArray(bb.groups)) bb.groups = [];
            bb.meta = bb.meta || {};
            if (typeof bb.meta.drawSize !== "number") bb.meta.drawSize = 0;
            if (typeof bb.meta.maxRounds !== "number") bb.meta.maxRounds = 0;
            if (typeof bb.meta.expectedFirstRoundMatches !== "number")
              bb.meta.expectedFirstRoundMatches = 0;
            bb.config = bb.config || {};
            bb.config.rules = bb.config.rules || {};
            bb.config.roundRobin = bb.config.roundRobin || {};
            bb.config.doubleElim = bb.config.doubleElim || {};
            bb.config.swiss = bb.config.swiss || {};
            bb.config.gsl = bb.config.gsl || {};
            bb.config.roundElim = bb.config.roundElim || {};
            if (typeof bb.noRankDelta !== "boolean") bb.noRankDelta = false;
            bb.scheduler = bb.scheduler || {};
            bb.drawSettings = bb.drawSettings || {};
            return bb;
          };

          const curBracketId = m?.bracket?._id;
          const tourId = m?.tournament?._id || m?.tournament;
          m.prevBracket = null;
          m.prevBrackets = [];

          if (curBracketId && tourId) {
            const prevSelect = [
              "name",
              "type",
              "stage",
              "order",
              "drawRounds",
              "drawStatus",
              "scheduler",
              "drawSettings",
              "meta.drawSize",
              "meta.maxRounds",
              "meta.expectedFirstRoundMatches",
              "groups._id",
              "groups.name",
              "groups.expectedSize",
              "config.rules",
              "config.doubleElim",
              "config.roundRobin",
              "config.swiss",
              "config.gsl",
              "config.roundElim",
              "overlay",
              "createdAt",
            ].join(" ");

            const allBr = await Bracket.find({ tournament: tourId })
              .select(prevSelect)
              .lean();

            const list = (allBr || [])
              .map((b) => ({
                ...b,
                __k: [toNum(b.order, 0), toTime(b), String(b._id)],
              }))
              .sort((a, b) => {
                for (let i = 0; i < a.__k.length; i++) {
                  if (a.__k[i] < b.__k[i]) return -1;
                  if (a.__k[i] > b.__k[i]) return 1;
                }
                return 0;
              });

            const curIdx = list.findIndex(
              (x) => String(x._id) === String(curBracketId)
            );
            if (curIdx > 0) {
              const { __k, ...prevRaw } = list[curIdx - 1];
              const prev = normalizeBracketShape(prevRaw);
              m.prevBracket = prev;
              m.prevBrackets = [prev];
            }
          }
        } catch (e) {
          console.error(
            "[socket match:join] prevBracket error:",
            e?.message || e
          );
        }

        // ép có m.video (dùng chung cho cả Match & UserMatch nếu có facebookLive)
        if (!m.video) {
          m.video =
            m.videoUrl ||
            m?.meta?.video ||
            m?.facebookLive?.permalinkUrl ||
            m?.facebookLive?.liveUrl ||
            m?.facebookLive?.hls ||
            m?.facebookLive?.m3u8 ||
            null;
        }

        // giữ nguyên emit cũ
        socket.emit("match:snapshot", toDTO(decorateServeAndSlots(m)));
      } catch (e) {
        console.error("[socket match:join] fatal error:", e?.message || e);
      }
    });

    socket.on("overlay:join", ({ matchId }) => {
      if (!matchId) return;
      socket.join(`match:${String(matchId)}`);
    });

    // ========= LIVE CONTROLS (referee/admin) =========
    socket.on("match:start", async ({ matchId }) => {
      if (!ensureReferee(socket)) return;
      await startMatch(matchId, socket.user?._id, io);
    });

    socket.on("match:point", async ({ matchId, team, step = 1 }) => {
      if (!ensureReferee(socket)) return;
      await addPoint(matchId, team, step, socket.user?._id, io);
    });

    socket.on("match:undo", async ({ matchId }) => {
      if (!ensureReferee(socket)) return;
      await undoLast(matchId, socket.user?._id, io);
    });

    socket.on("match:finish", async ({ matchId, winner, reason }) => {
      if (!ensureReferee(socket)) return;
      await finishMatch(matchId, winner, reason, socket.user?._id, io);
      try {
        await onMatchFinished({ matchId });
      } catch (e) {
        console.error("[scheduler] onMatchFinished error:", e?.message);
      }
      // 👇 phát lại state cho cụm/bracket chứa trận
      try {
        const m = await Match.findById(matchId)
          .select("tournament bracket courtCluster")
          .lean();
        if (m)
          await broadcastState(io, String(m.tournament), {
            bracket: m.bracket,
            cluster: m.courtCluster,
          });
      } catch (e) {
        console.error("[scheduler] broadcast after finish error:", e?.message);
      }
    });

    socket.on(
      "match:forfeit",
      async ({ matchId, winner, reason = "forfeit" }) => {
        if (!ensureReferee(socket)) return;
        await forfeitMatch(matchId, winner, reason, socket.user?._id, io);
        try {
          await onMatchFinished({ matchId });
        } catch (e) {
          console.error(
            "[scheduler] onMatchFinished (forfeit) error:",
            e?.message
          );
        }
      }
    );

    // Payload: { matchId, side?: "A"|"B", server?: 1|2, serverId?: "<userId>" }
    socket.on(
      "serve:set",
      async ({ matchId, side, server, serverId, userMatch }, ack) => {
        try {
          if (!isObjectIdString(matchId)) {
            return ack?.({ ok: false, message: "Invalid matchId" });
          }

          const hasAny =
            side !== undefined ||
            server !== undefined ||
            serverId !== undefined;
          if (!hasAny) {
            return ack?.({ ok: false, message: "Empty payload" });
          }

          const toId = (u) =>
            String(u?.user?._id || u?.user || u?._id || u?.id || "");
          // ================== USER MATCH BRANCH ==================
          if (userMatch) {
            if (!socket.user?._id) {
              return ack?.({ ok: false, message: "Forbidden" });
            }

            const m = await UserMatch.findById(matchId);
            if (!m) {
              return ack?.({ ok: false, message: "Match not found 1" });
            }

            // chỉ cho creator trận tự do đổi serve
            if (String(m.createdBy) !== String(socket.user._id)) {
              return ack?.({ ok: false, message: "Forbidden" });
            }

            // chuẩn hoá input
            const sideU =
              typeof side === "string" ? String(side).toUpperCase() : undefined;
            const wantSide =
              sideU === "A" || sideU === "B" ? sideU : m.serve?.side || "A";
            const wantServer =
              Number(server) === 1 || Number(server) === 2
                ? Number(server)
                : Number(m.serve?.server) === 1
                ? 1
                : 2;

            // validate serverId thuộc team tương ứng theo participants.side
            let validServerId = null;
            if (serverId) {
              const parts = Array.isArray(m.participants) ? m.participants : [];

              const aSet = new Set(
                parts
                  .filter((p) => String(p.side || "").toUpperCase() === "A")
                  .map(toId)
                  .filter(Boolean)
              );
              const bSet = new Set(
                parts
                  .filter((p) => String(p.side || "").toUpperCase() === "B")
                  .map(toId)
                  .filter(Boolean)
              );

              const sid = String(serverId);
              const okOnSide =
                (wantSide === "A" && aSet.has(sid)) ||
                (wantSide === "B" && bSet.has(sid));
              validServerId = okOnSide ? sid : null;
            }

            const prevServe = m.serve || { side: "A", server: 2 };
            m.serve = { side: wantSide, server: wantServer };

            if (validServerId) {
              m.set("slots.serverId", validServerId, { strict: false });
              m.set("slots.updatedAt", new Date(), { strict: false });
              const ver = Number(m?.slots?.version || 0);
              m.set("slots.version", ver + 1, { strict: false });
              m.markModified("slots");
            }

            // log nhẹ cho userMatch (reuse liveLog nếu schema có)
            m.liveLog = m.liveLog || [];
            m.liveLog.push({
              type: "serve",
              by: socket.user?._id || null,
              payload: {
                prevServe,
                next: m.serve,
                serverId: validServerId || null,
              },
              at: new Date(),
            });
            m.liveVersion = (m.liveVersion || 0) + 1;

            await m.save();

            // broadcast y như các chỗ khác đang nghe match:patched (FE refetch)
            io.to(`match:${matchId}`).emit("match:patched", {
              matchId: String(matchId),
              payload: {
                serve: m.serve,
                slots: validServerId ? { serverId: validServerId } : undefined,
              },
            });

            return ack?.({ ok: true });
          }

          // ================== TOURNAMENT MATCH BRANCH ==================
          // if (!ensureReferee(socket)) {
          //   return ack?.({ ok: false, message: "Forbidden" });
          // }

          // load match để validate serverId theo side
          const m = await Match.findById(matchId)
            .populate({
              path: "pairA",
              select: "player1 player2",
              populate: [
                { path: "player1", select: "user" },
                { path: "player2", select: "user" },
              ],
            })
            .populate({
              path: "pairB",
              select: "player1 player2",
              populate: [
                { path: "player1", select: "user" },
                { path: "player2", select: "user" },
              ],
            });

          if (!m) return ack?.({ ok: false, message: "Match not found 6" });

          // chuẩn hoá input
          const sideU =
            typeof side === "string" ? String(side).toUpperCase() : undefined;
          const wantSide =
            sideU === "A" || sideU === "B" ? sideU : m.serve?.side || "A";
          const wantServer =
            Number(server) === 1 || Number(server) === 2
              ? Number(server)
              : Number(m.serve?.server) === 1
              ? 1
              : 2;

          // validate serverId thuộc side tương ứng
          const toIdMatch = (u) =>
            String(u?.user?._id || u?.user || u?._id || u?.id || "");
          let validServerId = null;
          if (serverId) {
            const aSet = new Set(
              [m?.pairA?.player1, m?.pairA?.player2]
                .filter(Boolean)
                .map(toIdMatch)
                .filter(Boolean)
            );
            const bSet = new Set(
              [m?.pairB?.player1, m?.pairB?.player2]
                .filter(Boolean)
                .map(toIdMatch)
                .filter(Boolean)
            );
            const sid = String(serverId);
            const okOnSide =
              (wantSide === "A" && aSet.has(sid)) ||
              (wantSide === "B" && bSet.has(sid));
            validServerId = okOnSide ? sid : null;
          }

          const prevServe = m.serve || { side: "A", server: 2 };
          m.serve = { side: wantSide, server: wantServer };

          // lưu serverId động vào slots (không đụng schema)
          if (validServerId) {
            m.set("slots.serverId", validServerId, { strict: false });
            m.set("slots.updatedAt", new Date(), { strict: false });
            const ver = Number(m?.slots?.version || 0);
            m.set("slots.version", ver + 1, { strict: false });
            m.markModified("slots");
          }

          // live log + version
          m.liveLog = m.liveLog || [];
          m.liveLog.push({
            type: "serve",
            by: socket.user?._id || null,
            payload: {
              prevServe,
              next: m.serve,
              serverId: validServerId || null,
            },
            at: new Date(),
          });
          m.liveVersion = (m.liveVersion || 0) + 1;

          await m.save();

          // ==== tải lại theo chuỗi populate của match:join ====
          let snap = await loadMatchForSnapshot(m._id);
          if (!snap) {
            // vẫn ok vì đã lưu; chỉ không có snapshot trả về
            return ack?.({ ok: true });
          }

          // chuẩn hoá snapshot y như match:join
          snap = await postprocessSnapshotLikeJoin(snap);

          // decorate + DTO giống hệt điểm phát trong match:join
          const dto = toDTO(decorateServeAndSlots(snap));

          // 📣 broadcast tới các room liên quan (bắn hết)
          io.to(`match:${matchId}`).emit("match:snapshot", dto);
          if (dto?.bracket?._id) {
            io.to(`bracket:${dto.bracket._id}`).emit("match:snapshot", dto);
          }
          if (dto?.tournament?._id) {
            io.to(`tournament:${dto.tournament._id}`).emit(
              "match:snapshot",
              dto
            );
          }

          // 👉 trả snapshot trong ack cho caller
          ack?.({ ok: true, data: dto });
        } catch (e) {
          console.error("[serve:set] error:", e?.message || e);
          ack?.({ ok: false, message: e?.message || "Internal error" });
        }
      }
    );

    // ======== SLOTS: setBase (referee/admin) ========
    // Payload: { matchId, base: { A: { [userId]: 1|2 }, B: { [userId]: 1|2 } } }
    socket.on("slots:setBase", async ({ matchId, base, userMatch }, ack) => {
      try {
        if (!isObjectIdString(matchId) || !base || typeof base !== "object") {
          return ack?.({ ok: false, message: "Invalid payload" });
        }

        // ========== HELPER CHUNG ==========
        const in01 = (v) => v === 1 || v === 2;

        // ========== NHÁNH USER MATCH ==========
        if (userMatch) {
          const m = await UserMatch.findById(matchId).populate(
            "participants.user",
            "name fullName avatar nickname nickName"
          );

          if (!m) return ack?.({ ok: false, message: "UserMatch not found" });

          // quyền: chủ trận hoặc referee của userMatch
          const socketUserId = socket.user?._id && String(socket.user._id);
          const isOwner =
            socketUserId &&
            m.createdBy &&
            String(m.createdBy) === String(socketUserId);

          const isReferee =
            socketUserId &&
            Array.isArray(m.referee) &&
            m.referee.some((r) => String(r) === String(socketUserId));

          if (!isOwner && !isReferee) {
            return ack?.({ ok: false, message: "Forbidden" });
          }

          // helper lấy userId từ participant
          const uidP = (p) =>
            String(
              p?.user?._id ||
                p?.user || // ObjectId
                ""
            );

          const listA = Array.isArray(m.participants)
            ? m.participants.filter((p) => p.side === "A")
            : [];
          const listB = Array.isArray(m.participants)
            ? m.participants.filter((p) => p.side === "B")
            : [];

          const validA = new Set(listA.map(uidP).filter(Boolean));
          const validB = new Set(listB.map(uidP).filter(Boolean));

          const inputA = base?.A && typeof base.A === "object" ? base.A : {};
          const inputB = base?.B && typeof base.B === "object" ? base.B : {};

          const filteredA = {};
          for (const [k, v] of Object.entries(inputA)) {
            const kid = String(k);
            if (validA.has(kid) && in01(Number(v))) filteredA[kid] = Number(v);
          }

          const filteredB = {};
          for (const [k, v] of Object.entries(inputB)) {
            const kid = String(k);
            if (validB.has(kid) && in01(Number(v))) filteredB[kid] = Number(v);
          }

          const needDoubleCheck = (setValid, filtered) => {
            if (setValid.size < 2) return true; // chưa đủ người → nới lỏng
            const vals = Object.values(filtered);
            const c1 = vals.filter((x) => x === 1).length;
            const c2 = vals.filter((x) => x === 2).length;
            return c1 === 1 && c2 === 1;
          };
          if (!needDoubleCheck(validA, filteredA)) {
            return ack?.({
              ok: false,
              message: "Team A must have one #1 and one #2",
            });
          }
          if (!needDoubleCheck(validB, filteredB)) {
            return ack?.({
              ok: false,
              message: "Team B must have one #1 and one #2",
            });
          }

          const nowBase = { A: filteredA, B: filteredB };

          // 🔹 CẬP NHẬT slots
          m.set("slots.base", nowBase, { strict: false });
          m.set("slots.updatedAt", new Date(), { strict: false });
          const prevVer = Number(m?.slots?.version || 0);
          m.set("slots.version", prevVer + 1, { strict: false });
          m.markModified("slots");

          // 🔹 CẬP NHẬT LUÔN participants.order THEO base (dùng userId chuẩn)
          const applyOrderByBase = (list, filtered) => {
            if (!list.length) return;
            const map = new Map(
              Object.entries(filtered).map(([id, slot]) => [String(id), slot])
            );

            for (const p of list) {
              const sid = uidP(p); // ⬅️ dùng userId chứ không phải String(p.user)
              const slot = map.get(sid);
              if (slot === 1 || slot === 2) {
                p.order = slot;
              }
            }
          };

          applyOrderByBase(listA, filteredA);
          applyOrderByBase(listB, filteredB);
          m.markModified("participants");

          await m.save();

          // 🔔 vẫn bắn event y như match thường để FE không cần đổi
          io.to(`match:${matchId}`).emit("match:patched", {
            matchId: String(matchId),
            payload: { slots: { base: nowBase } },
          });

          return ack?.({ ok: true });
        }

        // ========== NHÁNH MATCH BÌNH THƯỜNG ==========
        if (!ensureReferee(socket)) {
          return ack?.({ ok: false, message: "Forbidden" });
        }

        const m = await Match.findById(matchId)
          .populate({
            path: "pairA",
            select: "player1 player2",
            populate: [
              { path: "player1", select: "user" },
              { path: "player2", select: "user" },
            ],
          })
          .populate({
            path: "pairB",
            select: "player1 player2",
            populate: [
              { path: "player1", select: "user" },
              { path: "player2", select: "user" },
            ],
          })
          .populate({ path: "tournament", select: "eventType" });

        if (!m) return ack?.({ ok: false, message: "Match not found" });

        const uid = (u) =>
          String(u?.user?._id || u?.user || u?._id || u?.id || "");

        const validA = new Set(
          [m?.pairA?.player1, m?.pairA?.player2]
            .filter(Boolean)
            .map(uid)
            .filter(Boolean)
        );
        const validB = new Set(
          [m?.pairB?.player1, m?.pairB?.player2]
            .filter(Boolean)
            .map(uid)
            .filter(Boolean)
        );

        const inputA = base?.A && typeof base.A === "object" ? base.A : {};
        const inputB = base?.B && typeof base.B === "object" ? base.B : {};

        const filteredA = {};
        for (const [k, v] of Object.entries(inputA)) {
          const kid = String(k);
          if (validA.has(kid) && in01(Number(v))) filteredA[kid] = Number(v);
        }
        const filteredB = {};
        for (const [k, v] of Object.entries(inputB)) {
          const kid = String(k);
          if (validB.has(kid) && in01(Number(v))) filteredB[kid] = Number(v);
        }

        const needDoubleCheck = (setValid, filtered) => {
          if (setValid.size < 2) return true;
          const vals = Object.values(filtered);
          const c1 = vals.filter((x) => x === 1).length;
          const c2 = vals.filter((x) => x === 2).length;
          return c1 === 1 && c2 === 1;
        };
        if (!needDoubleCheck(validA, filteredA))
          return ack?.({
            ok: false,
            message: "Team A must have one #1 and one #2",
          });
        if (!needDoubleCheck(validB, filteredB))
          return ack?.({
            ok: false,
            message: "Team B must have one #1 and one #2",
          });

        const nowBase = { A: filteredA, B: filteredB };
        m.set("slots.base", nowBase, { strict: false });
        m.set("slots.updatedAt", new Date(), { strict: false });
        const prevVer = Number(m?.slots?.version || 0);
        m.set("slots.version", prevVer + 1, { strict: false });
        m.markModified("slots");
        await m.save();

        io.to(`match:${matchId}`).emit("match:patched", {
          matchId: String(matchId),
          payload: { slots: { base: nowBase } },
        });

        ack?.({ ok: true });
      } catch (e) {
        console.error("[slots:setBase] error:", e?.message || e);
        ack?.({ ok: false, message: e?.message || "Internal error" });
      }
    });
    // ======== RULES: setPointsToWin (referee/admin) ========
    // Payload: { matchId, pointsToWin }
    socket.on("rules:setPointsToWin", async (payload, ack) => {
      try {
        const { matchId } = payload || {};
        if (!isObjectIdString(matchId)) {
          return ack?.({ ok: false, message: "Invalid matchId" });
        }

        const m = await Match.findById(matchId);
        if (!m) return ack?.({ ok: false, message: "Match not found 4" });
        if (String(m.status) === "finished") {
          return ack?.({ ok: false, message: "Match already finished" });
        }

        // Giá trị hiện tại
        const prevPTW = Number(m?.rules?.pointsToWin ?? 11);

        // Cách hiểu input "thoáng":
        // - op: "inc" | "dec"
        // - delta: số nguyên (vd: +1, -1, +2)
        // - pointsToWin: nếu là số nguyên dương → set tuyệt đối; nếu là chuỗi bắt đầu bằng +/− → hiểu như delta
        let nextPTW = prevPTW;

        const { op, delta, pointsToWin } = payload || {};

        const parseIntOrNull = (v) => {
          const n = Number(v);
          return Number.isInteger(n) ? n : null;
        };

        let d = 0;

        if (op === "inc" || op === "+") d = 1;
        else if (op === "dec" || op === "-") d = -1;
        else if (delta != null && parseIntOrNull(delta) !== null)
          d = parseIntOrNull(delta);
        else if (typeof pointsToWin !== "undefined") {
          // Nếu chuỗi có dấu +/- ở đầu → xem như delta
          if (
            typeof pointsToWin === "string" &&
            /^[+-]\d+$/.test(pointsToWin.trim())
          ) {
            d = parseInt(pointsToWin.trim(), 10);
          } else {
            // cố gắng set tuyệt đối
            const abs = parseIntOrNull(pointsToWin);
            if (abs != null) {
              nextPTW = abs;
            } else {
              // fallback: không hiểu -> coi như +1
              d = 1;
            }
          }
        } else {
          // Không truyền gì → mặc định +1
          d = 1;
        }

        if (d !== 0) nextPTW = prevPTW + d;

        // Ràng buộc mềm: tối thiểu 1 (tránh 0 hoặc âm)
        if (!Number.isInteger(nextPTW) || nextPTW < 1) {
          nextPTW = 1;
        }

        // Cập nhật
        m.rules = m.rules || {};
        m.rules.pointsToWin = nextPTW;
        m.markModified?.("rules");

        // Log thay đổi
        m.liveLog = m.liveLog || [];
        m.liveLog.push({
          type: "rules",
          subtype: "pointsToWin",
          by: socket.user?._id || null,
          payload: { from: prevPTW, to: nextPTW, delta: nextPTW - prevPTW },
          at: new Date(),
        });

        m.meta = m.meta || {};
        m.meta.ptwHistory = m.meta.ptwHistory || [];
        m.meta.ptwHistory.push({
          at: new Date(),
          by: socket.user?._id || null,
          from: prevPTW,
          to: nextPTW,
        });

        m.liveVersion = (m.liveVersion || 0) + 1;

        await m.save();

        // ACK
        ack?.({
          ok: true,
          pointsToWin: nextPTW,
          prev: prevPTW,
          delta: nextPTW - prevPTW,
        });

        // Broadcast patch
        io.to(`match:${matchId}`).emit("match:patched", {
          matchId: String(matchId),
          payload: { rules: { ...m.rules } },
        });

        // Event chuyên biệt
        io.to(`match:${matchId}`).emit("rules:pointsToWinUpdated", {
          matchId: String(matchId),
          pointsToWin: nextPTW,
          prev: prevPTW,
        });

        // (tuỳ chọn nâng cao) phát snapshot nếu cần
        // ...
      } catch (e) {
        console.error("[rules:setPointsToWin] error:", e?.message || e);
        ack?.({ ok: false, message: e?.message || "Internal error" });
      }
    });

    socket.on("match:started", async ({ matchId }) => {
      if (!matchId) return;

      const m = await Match.findById(matchId)
        .populate({
          path: "pairA",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              // thêm name/fullName/shortName để fallback, vẫn giữ user->nickname
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        .populate({
          path: "pairB",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        // referee là mảng
        .populate({
          path: "referee",
          select: "name fullName nickname nickName",
        })
        // người đang điều khiển live
        .populate({ path: "liveBy", select: "name fullName nickname nickName" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "nextMatch", select: "_id" })
        .populate({
          path: "tournament",
          select: "name image eventType overlay",
        })
        // 🆕 BRACKET: bổ sung đủ groups + meta + config (giữ cái cũ, chỉ add thêm)
        .populate({
          path: "bracket",
          select: [
            "noRankDelta",
            "name",
            "type",
            "stage",
            "order",
            "drawRounds",
            "drawStatus",
            "scheduler",
            "drawSettings",
            // meta.*
            "meta.drawSize",
            "meta.maxRounds",
            "meta.expectedFirstRoundMatches",
            // groups[]
            "groups._id",
            "groups.name",
            "groups.expectedSize",
            // rules + các config khác để FE tham chiếu
            "config.rules",
            "config.doubleElim",
            "config.roundRobin",
            "config.swiss",
            "config.gsl",
            "config.roundElim",
            // nếu có overlay ở bracket thì giữ
            "overlay",
          ].join(" "),
        })
        // 🆕 lấy thêm court để FE auto-next theo sân
        .populate({
          path: "court",
          select: "name number code label zone area venue building floor",
        })
        // 🆕 mở rộng select để DTO có đủ dữ liệu (GIỮ field cũ, chỉ thêm mới)
        .select(
          "label managers court courtLabel courtCluster " +
            "scheduledAt startAt startedAt finishedAt status " +
            "tournament bracket rules currentGame gameScores " +
            "round order code roundCode roundName " + // ← thêm round identifiers
            "seedA seedB previousA previousB nextMatch winner serve overlay " +
            "video videoUrl stream streams meta " + // meta để fallback streams
            "format rrRound pool " + // ← thêm format/pool/rrRound
            "liveBy liveVersion"
        )
        .lean();

      if (!m) return;

      // Helper: ưu tiên player.nickname/nickName; nếu thiếu HOẶC rỗng -> fallback user.nickname/user.nickName
      const fillNick = (p) => {
        if (!p) return p;
        const pick = (v) => (v && String(v).trim()) || "";
        const primary = pick(p.nickname) || pick(p.nickName);
        const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
        const n = primary || fromUser || "";
        if (n) {
          p.nickname = n;
          p.nickName = n;
        }
        // Tuỳ chọn: không cần mang user về FE
        // if (p.user) delete p.user;
        return p;
      };

      if (m.pairA) {
        m.pairA.player1 = fillNick(m.pairA.player1);
        m.pairA.player2 = fillNick(m.pairA.player2);
      }
      if (m.pairB) {
        m.pairB.player1 = fillNick(m.pairB.player1);
        m.pairB.player2 = fillNick(m.pairB.player2);
      }

      // bổ sung streams từ meta nếu có
      if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

      io.to(`match:${matchId}`).emit(
        "match:snapshot",
        toDTO(decorateServeAndSlots(m))
      );
    });

    // (Giữ compatibility nếu FE còn dùng)
    socket.on("score:inc", async ({ matchId /*, side, delta*/ }) => {
      if (!matchId) return;

      const m = await Match.findById(matchId)
        .populate({
          path: "pairA",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              // đủ các tên + user.nickname để FE fallback
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        .populate({
          path: "pairB",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        // referee là mảng
        .populate({
          path: "referee",
          select: "name fullName nickname nickName",
        })
        // người đang điều khiển live
        .populate({ path: "liveBy", select: "name fullName nickname nickName" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "nextMatch", select: "_id" })
        // tournament kèm overlay (để pickOverlay)
        .populate({
          path: "tournament",
          select: "name image eventType overlay",
        })
        // 🔼 BỔ SUNG: BRACKET đầy đủ cho toDTO (meta, groups, config, overlay...)
        .populate({
          path: "bracket",
          select: [
            "noRankDelta",
            "name",
            "type",
            "stage",
            "order",
            "drawRounds",
            "drawStatus",
            "scheduler",
            "drawSettings",
            // meta.*
            "meta.drawSize",
            "meta.maxRounds",
            "meta.expectedFirstRoundMatches",
            // groups[]
            "groups._id",
            "groups.name",
            "groups.expectedSize",
            // config.*
            "config.rules",
            "config.doubleElim",
            "config.roundRobin",
            "config.swiss",
            "config.gsl",
            "config.roundElim",
            // overlay (nếu có)
            "overlay",
          ].join(" "),
        })
        // court để FE auto-next theo sân
        .populate({
          path: "court",
          select: "name number code label zone area venue building floor",
        })
        .lean();

      if (!m) return;

      // Ưu tiên player.nickname/nickName; thiếu/empty -> fallback user.nickname/nickName
      const fillNick = (p) => {
        if (!p) return p;
        const pick = (v) => (v && String(v).trim()) || "";
        const primary = pick(p.nickname) || pick(p.nickName);
        const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
        const n = primary || fromUser || "";
        if (n) {
          p.nickname = n;
          p.nickName = n;
        }
        return p;
      };
      if (m.pairA) {
        m.pairA.player1 = fillNick(m.pairA.player1);
        m.pairA.player2 = fillNick(m.pairA.player2);
      }
      if (m.pairB) {
        m.pairB.player1 = fillNick(m.pairB.player1);
        m.pairB.player2 = fillNick(m.pairB.player2);
      }

      // bổ sung streams từ meta nếu có
      if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

      // giữ nguyên DTO của bạn
      const dto = toDTO(decorateServeAndSlots(m));

      // unified channel để FE bắt được và hiển thị ngay
      // io.to(`match:${matchId}`).emit("match:update", {
      //   type: "score",
      //   data: dto,
      // });
      // (tuỳ chọn giữ tương thích cũ)
      io.to(`match:${matchId}`).emit("score:updated", dto);
    });
    // ========= SCHEDULER (Tournament + Bracket/Cluster) =========
    socket.on(
      "scheduler:join",
      ({ tournamentId, bracket, cluster = "Main" }) => {
        if (!tournamentId) return;
        const clusterKey = resolveClusterKey(bracket, cluster);
        socket.join(`tour:${tournamentId}:${clusterKey}`);
        broadcastState(io, tournamentId, { bracket, cluster });
      }
    );

    socket.on(
      "scheduler:leave",
      ({ tournamentId, bracket, cluster = "Main" }) => {
        if (!tournamentId) return;
        const clusterKey = resolveClusterKey(bracket, cluster);
        socket.leave(`tour:${tournamentId}:${clusterKey}`);
      }
    );

    // ===== socket handler (request current state) =====
    socket.on(
      "scheduler:requestState",
      ({ tournamentId, cluster = "Main" }) => {
        if (!tournamentId) return;
        // Courts giờ theo GIẢI (không phụ thuộc bracket)
        broadcastState(io, tournamentId, { cluster });
      }
    );

    socket.on(
      "scheduler:assignNext",
      async ({ tournamentId, courtId, bracket, cluster = "Main" }) => {
        if (!ensureAdmin(socket)) return;
        if (!tournamentId || !courtId) return;
        const clusterKey = resolveClusterKey(bracket, cluster);
        try {
          await assignNextToCourt({
            tournamentId,
            courtId,
            cluster: clusterKey,
          });
        } catch (e) {
          console.error("[scheduler] assignNext error:", e?.message);
        }
        await broadcastState(io, tournamentId, { bracket, cluster });
      }
    );

    // Cho phép build queue qua socket (admin)
    socket.on(
      "scheduler:buildQueue",
      async ({ tournamentId, bracket, cluster = "Main" }) => {
        if (!ensureAdmin(socket)) return;
        if (!tournamentId) return;
        const clusterKey = resolveClusterKey(bracket, cluster);
        try {
          await buildGroupsRotationQueue({
            tournamentId,
            bracket,
            cluster: clusterKey,
          });
          await fillIdleCourtsForCluster({ tournamentId, cluster: clusterKey });
        } catch (e) {
          console.error("[scheduler] buildQueue error:", e?.message);
        }
        broadcastState(io, tournamentId, { bracket, cluster });
      }
    );

    // ========= SCHEDULER RESET (admin) =========
    // Payload:
    // {
    //   tournamentId: "68b16713ba906623ce8709f4",
    //   bracket:      "68b16756ba906623ce870a57",
    //   // optional:
    //   // rebuild: true  -> build lại queue xoay vòng sau khi reset
    //   // cluster: "Main" (fallback nếu không có bracket)
    // }
    socket.on(
      "scheduler:resetAll",
      async (
        { tournamentId, bracket, cluster = "Main", rebuild = true },
        ack
      ) => {
        try {
          if (!ensureAdmin(socket)) {
            ack?.({ ok: false, message: "Forbidden" });
            return;
          }
          if (!tournamentId || !isObjectIdString(tournamentId)) {
            ack?.({ ok: false, message: "Invalid tournamentId" });
            return;
          }
          if (bracket && !isObjectIdString(bracket)) {
            ack?.({ ok: false, message: "Invalid bracket id" });
            return;
          }

          const clusterKey = resolveClusterKey(bracket, cluster);

          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            // (A) Xoá hết các trận ĐANG ĐƯỢC GÁN VÀO SÂN trong phạm vi bracket/cluster
            // - Chỉ xoá những trận còn "sống" (không xoá finished/canceled)
            // - Lọc theo bracket (nếu có) hoặc theo cluster
            const deleteFilter = {
              tournament: tournamentId,
              ...(bracket ? { bracket } : { courtCluster: clusterKey }),
              court: { $ne: null }, // đang có sân gán
              status: { $nin: ["finished", "cancelled", "canceled"] },
            };

            const deleteAssignedRes = await Match.deleteMany(deleteFilter, {
              session,
            });

            // (B) Clear currentMatch ở các sân trong phạm vi
            const courtsFilter = bracket
              ? { tournament: tournamentId, bracket }
              : { tournament: tournamentId, cluster: clusterKey };

            const clearedCourtsRes = await Court.updateMany(
              courtsFilter,
              { $unset: { currentMatch: "" } },
              { session }
            );

            // (C) Commit transaction
            await session.commitTransaction();
            session.endSession();

            // (D) Tuỳ chọn: build lại queue & lấp sân trống
            if (rebuild) {
              try {
                await buildGroupsRotationQueue({
                  tournamentId,
                  bracket,
                  cluster: clusterKey,
                });
                await fillIdleCourtsForCluster({
                  tournamentId,
                  cluster: clusterKey,
                });
              } catch (e) {
                console.error(
                  "[scheduler] rebuild after reset error:",
                  e?.message
                );
              }
            }

            // (E) Phát lại state cho room đang xem cụm/bracket đó
            await broadcastState(io, tournamentId, {
              bracket,
              cluster: clusterKey,
            });

            ack?.({
              ok: true,
              deletedAssignedMatches: deleteAssignedRes?.deletedCount ?? 0,
              clearedCourts: clearedCourtsRes?.modifiedCount ?? 0,
              rebuilt: Boolean(rebuild),
            });
          } catch (e) {
            await session.abortTransaction().catch(() => {});
            session.endSession();
            console.error("[scheduler] resetAll error:", e?.message);
            ack?.({ ok: false, message: e?.message || "Reset failed" });
          }
        } catch (e) {
          console.error("[scheduler] resetAll outer error:", e?.message);
          ack?.({ ok: false, message: e?.message || "Reset failed" });
        }
      }
    );

    socket.on("match:leave", ({ matchId, userMatch }) => {
      try {
        if (!matchId) return;

        // rời room match cho cả match thường & userMatch
        socket.leave(`match:${matchId}`);

        console.log(
          "[socket] match:leave",
          matchId,
          userMatch ? "(userMatch)" : ""
        );
      } catch (e) {
        console.error("[socket match:leave] error:", e?.message || e);
      }
    });

    async function populateMatchForEmit(matchId) {
      const m = await Match.findById(matchId)
        .populate({
          path: "pairA",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              // có đủ các tên + user.nickname để FE fallback
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        .populate({
          path: "pairB",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        // referee là mảng (nếu schema của bạn là 'referees' thì đổi path tương ứng)
        .populate({
          path: "referee",
          select: "name fullName nickname nickName",
        })
        // người đang điều khiển live
        .populate({ path: "liveBy", select: "name fullName nickname nickName" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "nextMatch", select: "_id" })
        .populate({
          path: "tournament",
          select: "name image eventType overlay",
        })
        .populate({
          // gửi đủ groups + meta + config như mẫu JSON
          path: "bracket",
          select: [
            "noRankDelta",
            "name",
            "type",
            "stage",
            "order",
            "drawRounds",
            "drawStatus",
            "scheduler",
            "drawSettings",
            "meta.drawSize",
            "meta.maxRounds",
            "meta.expectedFirstRoundMatches",
            "groups._id",
            "groups.name",
            "groups.expectedSize",
            "config.rules",
            "config.doubleElim",
            "config.roundRobin",
            "config.swiss",
            "config.gsl",
            "config.roundElim",
            "overlay",
          ].join(" "),
        })
        .populate({
          path: "court",
          select: "name number code label zone area venue building floor order",
        })
        .lean();

      if (!m) return null;

      // Helper: set nickname ưu tiên từ user nếu thiếu
      const fillNick = (p) => {
        if (!p) return p;
        const pick = (v) => (v && String(v).trim()) || "";
        const primary = pick(p.nickname) || pick(p.nickName);
        const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
        const n = primary || fromUser || "";
        if (n) {
          p.nickname = n;
          p.nickName = n;
        }
        return p;
      };

      if (m.pairA) {
        m.pairA.player1 = fillNick(m.pairA.player1);
        m.pairA.player2 = fillNick(m.pairA.player2);
      }
      if (m.pairB) {
        m.pairB.player1 = fillNick(m.pairB.player1);
        m.pairB.player2 = fillNick(m.pairB.player2);
      }

      // bổ sung streams từ meta nếu có
      if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

      return m;
    }

    socket.on(
      "scheduler:assignSpecific",
      async (
        {
          tournamentId,
          bracket,
          courtId,
          matchId,
          replace = false,
          cluster = "Main",
        },
        ack
      ) => {
        try {
          if (!ensureAdmin(socket)) {
            ack?.({ ok: false, message: "Forbidden" });
            return;
          }
          if (
            !isObjectIdString(tournamentId) ||
            !isObjectIdString(courtId) ||
            !isObjectIdString(matchId)
          ) {
            ack?.({ ok: false, message: "Invalid ids" });
            return;
          }
          if (bracket && !isObjectIdString(bracket)) {
            ack?.({ ok: false, message: "Invalid bracket id" });
            return;
          }

          // Load court + match
          const [court, match] = await Promise.all([
            Court.findById(courtId).lean(),
            Match.findById(matchId).lean(),
          ]);

          if (!court) return ack?.({ ok: false, message: "Court not found" });
          if (!match) return ack?.({ ok: false, message: "Match not found 5" });

          if (
            String(court.tournament) !== String(tournamentId) ||
            String(match.tournament) !== String(tournamentId)
          ) {
            return ack?.({ ok: false, message: "Tournament mismatch" });
          }

          // Nếu client truyền bracket thì kiểm tra khớp
          if (bracket && String(match.bracket) !== String(bracket)) {
            return ack?.({ ok: false, message: "Match not in bracket" });
          }
          // Nếu sân có bracket ràng buộc thì bắt buộc khớp với match
          if (
            court.bracket &&
            String(court.bracket) !== String(match.bracket)
          ) {
            return ack?.({
              ok: false,
              message: "Court belongs to another bracket",
            });
          }

          if (["live", "finished"].includes(match.status)) {
            return ack?.({
              ok: false,
              message: `Cannot assign a ${match.status} match`,
            });
          }

          const clusterKey =
            court.cluster || resolveClusterKey(bracket, cluster);

          const session = await mongoose.startSession();
          session.startTransaction();
          // ghi nhận để emit sau khi commit
          let replacedMatchId = null; // trận đang chiếm sân, bị đẩy ra (nếu có)
          let prevCourtIdOfMoving = null; // sân cũ của match được chuyển (nếu có)
          try {
            // 0) Nếu sân đang bận và không replace
            if (
              court.currentMatch &&
              String(court.currentMatch) !== String(match._id) &&
              !replace
            ) {
              throw new Error("Court is busy. Pass replace=true to override.");
            }

            // 1) Nếu sân đang có trận khác -> đẩy về queued & gỡ gán
            if (
              court.currentMatch &&
              String(court.currentMatch) !== String(match._id)
            ) {
              const prev = await Match.findById(court.currentMatch).session(
                session
              );
              if (prev && prev.status !== "finished") {
                prev.status = "queued";
                prev.set("court", undefined, { strict: false });
                prev.set("courtLabel", undefined, { strict: false });
                prev.set("queueOrder", undefined, { strict: false });
                await prev.save({ session });
                replacedMatchId = String(prev._id); // <— ghi nhớ để emit sau commit
              }
            }

            // 2) Nếu trận đang nằm ở sân khác -> gỡ currentMatch ở sân cũ
            if (match.court && String(match.court) !== String(court._id)) {
              prevCourtIdOfMoving = String(match.court);
              const prevCourt = await Court.findById(match.court).session(
                session
              );
              if (
                prevCourt &&
                String(prevCourt.currentMatch) === String(match._id)
              ) {
                prevCourt.set("currentMatch", undefined, { strict: false });
                await prevCourt.save({ session });
              }
            }

            // 3) Cập nhật match -> assigned vào court
            const courtLabelGuess =
              court.name ||
              court.label ||
              (Number.isInteger(court.order) ? `Sân ${court.order}` : "Sân");
            const mDoc = await Match.findById(match._id).session(session);
            mDoc.status = "assigned";
            mDoc.court = court._id;
            mDoc.courtLabel = courtLabelGuess;
            mDoc.courtCluster = clusterKey;
            mDoc.set("queueOrder", undefined, { strict: false }); // bỏ thứ tự hàng đợi
            await mDoc.save({ session });

            // 4) Cập nhật court.currentMatch
            const cDoc = await Court.findById(court._id).session(session);
            cDoc.currentMatch = mDoc._id;
            await cDoc.save({ session });

            await session.commitTransaction();
            session.endSession();

            // 5) Phát lại state cho phòng xem cụm/bracket
            await broadcastState(io, String(tournamentId), {
              bracket: mDoc.bracket,
              cluster: clusterKey,
            });

            // 6) Emit snapshot full object cho TRẬN MỚI (đã được gán sân)
            try {
              const mNew = await populateMatchForEmit(mDoc._id);
              if (mNew) {
                // Phát cho tất cả client đang join match:<id>
                io.to(`match:${String(mNew._id)}`).emit(
                  "match:snapshot",
                  toDTO(decorateServeAndSlots(mNew))
                );
                // (tuỳ chọn) thêm "match:update" nếu FE cũng lắng event này
                io.to(`match:${String(mNew._id)}`).emit(
                  "match:update",
                  toDTO(decorateServeAndSlots(mNew))
                );
              }
            } catch (e) {
              console.error("[emit] new match snapshot error:", e?.message);
            }

            // 7) Emit snapshot full object cho TRẬN CŨ (bị đẩy khỏi sân)
            if (replacedMatchId) {
              try {
                const mOld = await populateMatchForEmit(replacedMatchId);
                if (mOld) {
                  // đảm bảo trạng thái & court đã clear (phòng khi populate mang theo cache)
                  mOld.status = "queued";
                  mOld.court = null;
                  mOld.courtLabel = undefined;

                  io.to(`match:${String(mOld._id)}`).emit(
                    "match:snapshot",
                    toDTO(decorateServeAndSlots(mOld))
                  );
                  io.to(`match:${String(mOld._id)}`).emit(
                    "match:update",
                    toDTO(decorateServeAndSlots(mOld))
                  );
                }
              } catch (e) {
                console.error("[emit] old match snapshot error:", e?.message);
              }
            }

            ack?.({
              ok: true,
              courtId: String(court._id),
              matchId: String(mDoc._id),
              status: mDoc.status,
              courtLabel: mDoc.courtLabel,
              cluster: clusterKey,
              replaced: Boolean(replace),
            });
          } catch (err) {
            await session.abortTransaction().catch(() => {});
            session.endSession();
            console.error("[scheduler] assignSpecific error:", err?.message);
            ack?.({ ok: false, message: err?.message || "Assign failed" });
          }
        } catch (e) {
          console.error("[scheduler] assignSpecific outer error:", e?.message);
          ack?.({ ok: false, message: e?.message || "Assign failed" });
        }
      }
    );

    // ========= DRAW rooms (giữ tương thích cũ) =========
    socket.on("draw:join", ({ bracketId }) => {
      if (bracketId) socket.join(`draw:${String(bracketId)}`);
    });
    socket.on("draw:leave", ({ bracketId }) => {
      if (bracketId) socket.leave(`draw:${String(bracketId)}`);
    });
    socket.on("draw:subscribe", ({ bracketId }) => {
      if (bracketId) socket.join(`draw:${String(bracketId)}`);
    });
    socket.on("draw:unsubscribe", ({ bracketId }) => {
      if (bracketId) socket.leave(`draw:${String(bracketId)}`);
    });

    socket.on("disconnect", async () => {
      try {
        if (userId) {
          await removeConnection({ userId, socketId: socket.id, client });
          await emitSummary(io);
        }
      } catch (e) {
        console.error("[socket] disconnect removeConnection error:", e);
      }
    });
  });

  // ===== Sweeper định kỳ cho socket “chết” không kịp disconnect =====
  const SWEEP_EVERY_MS = +(process.env.PRESENCE_SWEEP_MS || 30000);
  setInterval(async () => {
    try {
      await sweepStaleSockets({ batch: 500 });
    } catch (e) {
      console.error("[socket] sweepStaleSockets timer error:", e);
    }
  }, SWEEP_EVERY_MS);

  return ioInstance;
}

/* 👇 EXPORT HÀM LẤY IO ĐỂ DÙNG Ở CONTROLLER / SERVICE */
export function getIO() {
  if (!ioInstance) {
    throw new Error(
      "[socket] IO not initialized. Hãy gọi initSocket(httpServer) trong server trước."
    );
  }
  return ioInstance;
}
