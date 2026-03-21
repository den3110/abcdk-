// socket/index.js
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import IORedis from "ioredis";
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
  assignSpecificMatchToCourt,
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
import { canManageTournament } from "../utils/tournamentAuth.js";
import {
  ensureAdmin,
  ensureAdminAndSuperUser,
  ensureReferee,
} from "../utils/socketAuth.js";
import UserMatch from "../models/userMatchModel.js";
import { computeStageInfoForMatchDoc } from "../controllers/refereeController.js";
import { buildFbPageMonitorSnapshot } from "../services/fbPageMonitor.service.js";
import {
  registerFbPageMonitorPublisher,
  setFbPageMonitorMeta,
} from "../services/fbPageMonitorEvents.service.js";
import { buildTournamentCourtLivePresenceSnapshot } from "../services/courtLivePresence.service.js";
import { registerCourtLivePresencePublisher } from "../services/courtLivePresenceEvents.service.js";
import { buildLiveRecordingMonitorSnapshot } from "../services/liveRecordingMonitor.service.js";
import {
  getLiveRecordingMonitorEventsChannel,
  registerLiveRecordingMonitorPublisher,
  setLiveRecordingMonitorMeta,
} from "../services/liveRecordingMonitorEvents.service.js";

/* 👇 THÊM BIẾN TOÀN CỤC LƯU IO */
let ioInstance = null;
let sweeperStarted = false;
let fbPageMonitorTickerStarted = false;
let fbPageMonitorPublishTimer = null;
let fbPageMonitorPendingReasons = new Set();
let fbPageMonitorPendingPageIds = new Set();
let fbPageMonitorPendingHasEvent = false;
let courtLiveTickerStarted = false;
const courtLivePendingByTournamentId = new Map();
let liveRecordingMonitorTickerStarted = false;
let liveRecordingMonitorPublishTimer = null;
let liveRecordingMonitorPendingReasons = new Set();
let liveRecordingMonitorPendingRecordingIds = new Set();
let liveRecordingMonitorPendingHasEvent = false;
let liveRecordingMonitorRedisSubscriber = null;
let liveRecordingMonitorRedisSubscriberStarted = false;

const FB_PAGE_MONITOR_ROOM = "fb-pages:watchers";
const FB_PAGE_MONITOR_TICK_MS = 15000;
const FB_PAGE_MONITOR_DEBOUNCE_MS = 300;
const COURT_LIVE_ROOM_PREFIX = "court-live:watch:";
const COURT_LIVE_RECONCILE_TICK_MS = 15000;
const COURT_LIVE_DEBOUNCE_MS = 300;
const LIVE_RECORDING_MONITOR_ROOM = "recordings-v2:watchers";
const PUSH_MONITOR_ROOM = "push-monitor:watchers";
const LIVE_RECORDING_MONITOR_TICK_MS = 15000;
const LIVE_RECORDING_MONITOR_DEBOUNCE_MS = 300;
const LIVE_RECORDING_MONITOR_REDIS_URL =
  process.env.REDIS_URL || "redis://127.0.0.1:6379";
const MATCH_SNAPSHOT_DEDUPE_MS = 750;

async function emitFbPageMonitorSnapshot(io, options = {}) {
  const { socketId = null } =
    typeof options === "string" ? { socketId: options } : options;
  try {
    const snapshot = await buildFbPageMonitorSnapshot();
    if (socketId) {
      io.to(socketId).emit("fb-pages:update", snapshot);
      return;
    }
    io.to(FB_PAGE_MONITOR_ROOM).emit("fb-pages:update", snapshot);
  } catch (error) {
    console.error(
      "[socket] fb-pages:update error:",
      error?.message || error
    );
  }
}

function resetFbPageMonitorPendingState() {
  fbPageMonitorPendingReasons = new Set();
  fbPageMonitorPendingPageIds = new Set();
  fbPageMonitorPendingHasEvent = false;
}

async function flushFbPageMonitorPublish(io) {
  const reasons = Array.from(fbPageMonitorPendingReasons);
  const pageIds = Array.from(fbPageMonitorPendingPageIds);
  const mode = fbPageMonitorPendingHasEvent ? "event" : "reconcile";
  resetFbPageMonitorPendingState();
  fbPageMonitorPublishTimer = null;

  setFbPageMonitorMeta({
    reason: reasons.length ? reasons.join(", ") : "unknown_event",
    pageIds,
    mode,
    at: new Date(),
  });

  const watchers = io.sockets.adapter.rooms.get(FB_PAGE_MONITOR_ROOM)?.size || 0;
  if (!watchers) return;
  await emitFbPageMonitorSnapshot(io);
}

function scheduleFbPageMonitorPublish(io, payload = {}) {
  const reason =
    String(payload.reason || "unknown_event").trim() || "unknown_event";
  const pageIds = Array.isArray(payload.pageIds) ? payload.pageIds : [];
  const mode = payload.mode === "reconcile" ? "reconcile" : "event";

  fbPageMonitorPendingReasons.add(reason);
  for (const pageId of pageIds) {
    if (pageId) fbPageMonitorPendingPageIds.add(String(pageId));
  }
  if (mode === "event") fbPageMonitorPendingHasEvent = true;

  const flushNow = async () => {
    try {
      await flushFbPageMonitorPublish(io);
    } catch (error) {
      console.error("[socket] fb-pages flush error:", error);
    }
  };

  if (mode === "reconcile") {
    if (fbPageMonitorPublishTimer) {
      clearTimeout(fbPageMonitorPublishTimer);
      fbPageMonitorPublishTimer = null;
    }
    void flushNow();
    return;
  }

  if (fbPageMonitorPublishTimer) return;
  fbPageMonitorPublishTimer = setTimeout(() => {
    void flushNow();
  }, FB_PAGE_MONITOR_DEBOUNCE_MS);
}

function courtLiveRoom(tournamentId) {
  return `${COURT_LIVE_ROOM_PREFIX}${String(tournamentId || "").trim()}`;
}

async function emitCourtLivePresenceSnapshot(io, tournamentId, socketId = null) {
  const normalizedTournamentId = String(tournamentId || "").trim();
  if (!normalizedTournamentId) return;
  try {
    const snapshot = await buildTournamentCourtLivePresenceSnapshot(
      normalizedTournamentId
    );
    if (socketId) {
      io.to(socketId).emit("court-live:update", snapshot);
      return;
    }
    io.to(courtLiveRoom(normalizedTournamentId)).emit(
      "court-live:update",
      snapshot
    );
  } catch (error) {
    console.error(
      "[socket] court-live:update error:",
      error?.message || error
    );
  }
}

function getCourtLivePendingEntry(tournamentId) {
  const key = String(tournamentId || "").trim();
  if (!key) return null;
  const current =
    courtLivePendingByTournamentId.get(key) || {
      timer: null,
      reasons: new Set(),
      courtIds: new Set(),
      hasEvent: false,
    };
  courtLivePendingByTournamentId.set(key, current);
  return current;
}

async function flushCourtLivePresencePublish(io, tournamentId) {
  const key = String(tournamentId || "").trim();
  if (!key) return;
  const entry = courtLivePendingByTournamentId.get(key);
  if (!entry) return;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  courtLivePendingByTournamentId.delete(key);
  const watchers = io.sockets.adapter.rooms.get(courtLiveRoom(key))?.size || 0;
  if (!watchers) return;
  await emitCourtLivePresenceSnapshot(io, key);
}

function scheduleCourtLivePresencePublish(io, payload = {}) {
  const tournamentId = String(payload.tournamentId || "").trim();
  if (!tournamentId) return;
  const mode = payload.mode === "reconcile" ? "reconcile" : "event";
  const entry = getCourtLivePendingEntry(tournamentId);
  if (!entry) return;
  entry.reasons.add(
    String(payload.reason || "unknown_event").trim() || "unknown_event"
  );
  for (const courtId of Array.isArray(payload.courtIds) ? payload.courtIds : []) {
    if (courtId) entry.courtIds.add(String(courtId));
  }
  if (mode === "event") entry.hasEvent = true;

  const flushNow = async () => {
    try {
      await flushCourtLivePresencePublish(io, tournamentId);
    } catch (error) {
      console.error("[socket] court-live flush error:", error);
    }
  };

  if (mode === "reconcile") {
    void flushNow();
    return;
  }

  if (entry.timer) return;
  entry.timer = setTimeout(() => {
    void flushNow();
  }, COURT_LIVE_DEBOUNCE_MS);
}

async function emitLiveRecordingMonitorSnapshot(io, options = {}) {
  const { socketId = null } =
    typeof options === "string" ? { socketId: options } : options;
  try {
    const snapshot = await buildLiveRecordingMonitorSnapshot();
    if (socketId) {
      io.to(socketId).emit("recordings-v2:update", snapshot);
      return;
    }
    io.to(LIVE_RECORDING_MONITOR_ROOM).emit("recordings-v2:update", snapshot);
  } catch (error) {
    console.error(
      "[socket] recordings-v2:update error:",
      error?.message || error
    );
  }
}

function resetLiveRecordingMonitorPendingState() {
  liveRecordingMonitorPendingReasons = new Set();
  liveRecordingMonitorPendingRecordingIds = new Set();
  liveRecordingMonitorPendingHasEvent = false;
}

async function flushLiveRecordingMonitorPublish(io) {
  const reasons = Array.from(liveRecordingMonitorPendingReasons);
  const recordingIds = Array.from(liveRecordingMonitorPendingRecordingIds);
  const mode = liveRecordingMonitorPendingHasEvent ? "event" : "reconcile";
  resetLiveRecordingMonitorPendingState();
  liveRecordingMonitorPublishTimer = null;

  setLiveRecordingMonitorMeta({
    reason: reasons.length ? reasons.join(", ") : "unknown_event",
    recordingIds,
    mode,
    at: new Date(),
  });

  const watchers =
    io.sockets.adapter.rooms.get(LIVE_RECORDING_MONITOR_ROOM)?.size || 0;
  if (!watchers) return;
  await emitLiveRecordingMonitorSnapshot(io);
}

function scheduleLiveRecordingMonitorPublish(io, payload = {}) {
  const reason =
    String(payload.reason || "unknown_event").trim() || "unknown_event";
  const recordingIds = Array.isArray(payload.recordingIds)
    ? payload.recordingIds
    : [];
  const mode = payload.mode === "reconcile" ? "reconcile" : "event";

  liveRecordingMonitorPendingReasons.add(reason);
  for (const recordingId of recordingIds) {
    if (recordingId) {
      liveRecordingMonitorPendingRecordingIds.add(String(recordingId));
    }
  }
  if (mode === "event") liveRecordingMonitorPendingHasEvent = true;

  const flushNow = async () => {
    try {
      await flushLiveRecordingMonitorPublish(io);
    } catch (error) {
      console.error("[socket] recordings-v2 flush error:", error);
    }
  };

  if (mode === "reconcile") {
    if (liveRecordingMonitorPublishTimer) {
      clearTimeout(liveRecordingMonitorPublishTimer);
      liveRecordingMonitorPublishTimer = null;
    }
    void flushNow();
    return;
  }

  if (liveRecordingMonitorPublishTimer) return;
  liveRecordingMonitorPublishTimer = setTimeout(() => {
    void flushNow();
  }, LIVE_RECORDING_MONITOR_DEBOUNCE_MS);
}

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
const loadMatchForSnapshot = async (matchId, userMatch = false) => {
  // Convert userMatch sang boolean nếu truyền vào string "true"
  const isUserMatch = String(userMatch) === "true";

  if (isUserMatch) {
    // ==========================================
    // 🏠 LOGIC CHO USER MATCH (TRẬN TỰ TẠO)
    // ==========================================
    const m = await UserMatch.findById(matchId)
      .populate({
        path: "court",
        select: "name number code label zone area venue building floor",
      })
      .populate({ path: "referee", select: "name fullName nickname nickName" })
      .populate({ path: "liveBy", select: "name fullName nickname nickName" })
      .populate({
        path: "createdBy",
        select: "name fullName nickname nickName avatar",
      })
      // Populate thông tin user trong participants để hiển thị danh sách
      .populate({
        path: "participants.user",
        select: "name fullName nickname nickName avatar phone",
      })
      // Populate user trong pairA/pairB (nếu schema đã build sẵn pair)
      .populate({
        path: "pairA.player1.user",
        select: "name fullName nickname nickName avatar",
      })
      .populate({
        path: "pairA.player2.user",
        select: "name fullName nickname nickName avatar",
      })
      .populate({
        path: "pairB.player1.user",
        select: "name fullName nickname nickName avatar",
      })
      .populate({
        path: "pairB.player2.user",
        select: "name fullName nickname nickName avatar",
      })
      .lean();

    if (m) {
      m.isUserMatch = true; // Đánh dấu flag để các hàm xử lý sau biết
    }
    return m;
  }

  // ==========================================
  // 🏆 LOGIC CHO MATCH (GIẢI ĐẤU) - CŨ
  // ==========================================
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
      .populate({
        path: "tournament",
        select: "name image eventType overlay nameDisplayMode",
      })
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

const buildMatchSnapshotDto = async (matchId, userMatch) => {
  const normalizedMatchId = String(matchId || "").trim();
  if (!normalizedMatchId) return null;

  const tryLoad = async (preferredUserMatch) => {
    try {
      return await loadMatchForSnapshot(normalizedMatchId, preferredUserMatch);
    } catch (error) {
      console.error(
        "[socket snapshot] load error:",
        error?.message || error
      );
      return null;
    }
  };

  let m = null;
  const explicitUserMatch =
    typeof userMatch === "boolean"
      ? userMatch
      : typeof userMatch === "string"
      ? userMatch === "true"
      : null;

  if (explicitUserMatch === true) {
    m = await tryLoad(true);
  } else if (explicitUserMatch === false) {
    m = await tryLoad(false);
  } else {
    m = await tryLoad(true);
    if (!m) m = await tryLoad(false);
  }

  if (!m) return null;

  await postprocessSnapshotLikeJoin(m);

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

  if (!m.isUserMatch && typeof computeStageInfoForMatchDoc === "function") {
    try {
      const s = computeStageInfoForMatchDoc(m) || {};
      if (s.stageType != null) m.stageType = s.stageType;
      if (s.stageName != null) m.stageName = s.stageName;
    } catch (error) {
      console.error(
        "[socket snapshot] computeStageInfo error:",
        error?.message || error
      );
    }
  }

  return toDTO(decorateServeAndSlots(m));
};

const getSocketMatchSnapshotTracker = (socket) => {
  if (!(socket.data.matchSnapshotTracker instanceof Map)) {
    socket.data.matchSnapshotTracker = new Map();
  }
  return socket.data.matchSnapshotTracker;
};

const getSocketMatchRoomRefs = (socket) => {
  if (!(socket.data.matchRoomRefs instanceof Map)) {
    socket.data.matchRoomRefs = new Map();
  }
  return socket.data.matchRoomRefs;
};

const emitMatchSnapshotToSocket = async (
  socket,
  matchId,
  userMatch,
  { force = false } = {}
) => {
  const normalizedMatchId = String(matchId || "").trim();
  if (!normalizedMatchId) return null;

  const tracker = getSocketMatchSnapshotTracker(socket);
  const prev = tracker.get(normalizedMatchId) || {
    lastEmittedAt: 0,
    promise: null,
  };

  if (prev.promise) return prev.promise;

  if (
    !force &&
    prev.lastEmittedAt > 0 &&
    Date.now() - prev.lastEmittedAt < MATCH_SNAPSHOT_DEDUPE_MS
  ) {
    return null;
  }

  const task = (async () => {
    const dto = await buildMatchSnapshotDto(normalizedMatchId, userMatch);
    if (dto) {
      socket.emit("match:snapshot", dto);
    }
    return dto;
  })();

  tracker.set(normalizedMatchId, {
    lastEmittedAt: prev.lastEmittedAt || 0,
    promise: task,
  });

  try {
    const dto = await task;
    tracker.set(normalizedMatchId, {
      lastEmittedAt: dto ? Date.now() : prev.lastEmittedAt || 0,
      promise: null,
    });
    return dto;
  } catch (error) {
    tracker.set(normalizedMatchId, {
      lastEmittedAt: prev.lastEmittedAt || 0,
      promise: null,
    });
    throw error;
  }
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
  registerFbPageMonitorPublisher((payload) => {
    scheduleFbPageMonitorPublish(io, payload);
  });
  registerCourtLivePresencePublisher((payload) => {
    scheduleCourtLivePresencePublish(io, payload);
  });
  registerLiveRecordingMonitorPublisher((payload) => {
    scheduleLiveRecordingMonitorPublish(io, payload);
  });

  if (!liveRecordingMonitorRedisSubscriberStarted) {
    liveRecordingMonitorRedisSubscriberStarted = true;
    liveRecordingMonitorRedisSubscriber = new IORedis(
      LIVE_RECORDING_MONITOR_REDIS_URL,
      {
        maxRetriesPerRequest: null,
      }
    );
    liveRecordingMonitorRedisSubscriber.on("error", (error) => {
      console.error(
        "[socket] recordings-v2 redis subscriber error:",
        error?.message || error
      );
    });
    liveRecordingMonitorRedisSubscriber.subscribe(
      getLiveRecordingMonitorEventsChannel(),
      (error) => {
        if (error) {
          console.error(
            "[socket] recordings-v2 subscribe failed:",
            error?.message || error
          );
        }
      }
    );
    liveRecordingMonitorRedisSubscriber.on("message", (channel, message) => {
      if (channel !== getLiveRecordingMonitorEventsChannel()) return;
      try {
        const payload = JSON.parse(message || "{}");
        if (payload?.at) payload.at = new Date(payload.at);
        scheduleLiveRecordingMonitorPublish(io, payload);
      } catch (error) {
        console.error(
          "[socket] recordings-v2 redis message parse failed:",
          error?.message || error
        );
      }
    });
  }

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

    socket.on("fb-pages:watch", async () => {
      try {
        if (!(await ensureAdmin(socket))) return;
        socket.join(FB_PAGE_MONITOR_ROOM);
        await emitFbPageMonitorSnapshot(io, socket.id);
      } catch (e) {
        console.error("[socket] fb-pages:watch error:", e);
      }
    });

    socket.on("fb-pages:unwatch", () => {
      try {
        socket.leave(FB_PAGE_MONITOR_ROOM);
      } catch (e) {
        console.error("[socket] fb-pages:unwatch error:", e);
      }
    });

    socket.on("court-live:watch", async ({ tournamentId } = {}) => {
      try {
        const tid = String(tournamentId || "").trim();
        if (!tid) return;
        const allowed = await canManageTournament(
          { _id: socket.data.userId, role: socket.data.role },
          tid
        );
        if (!allowed) return;
        socket.join(courtLiveRoom(tid));
        await emitCourtLivePresenceSnapshot(io, tid, socket.id);
      } catch (e) {
        console.error("[socket] court-live:watch error:", e);
      }
    });

    socket.on("court-live:unwatch", ({ tournamentId } = {}) => {
      try {
        const tid = String(tournamentId || "").trim();
        if (!tid) return;
        socket.leave(courtLiveRoom(tid));
      } catch (e) {
        console.error("[socket] court-live:unwatch error:", e);
      }
    });

    socket.on("recordings-v2:watch", async () => {
      try {
        if (!(await ensureAdmin(socket))) return;
        socket.join(LIVE_RECORDING_MONITOR_ROOM);
        await emitLiveRecordingMonitorSnapshot(io, socket.id);
      } catch (e) {
        console.error("[socket] recordings-v2:watch error:", e);
      }
    });

    socket.on("recordings-v2:unwatch", () => {
      try {
        socket.leave(LIVE_RECORDING_MONITOR_ROOM);
      } catch (e) {
        console.error("[socket] recordings-v2:unwatch error:", e);
      }
    });

    socket.on("push-monitor:watch", async () => {
      try {
        if (!(await ensureAdminAndSuperUser(socket))) return;
        socket.join(PUSH_MONITOR_ROOM);
      } catch (e) {
        console.error("[socket] push-monitor:watch error:", e);
      }
    });

    socket.on("push-monitor:unwatch", () => {
      try {
        socket.leave(PUSH_MONITOR_ROOM);
      } catch (e) {
        console.error("[socket] push-monitor:unwatch error:", e);
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
    socket.on("match:join", async ({ matchId, userMatch } = {}) => {
      try {
        const normalizedMatchId = String(matchId || "").trim();
        if (!normalizedMatchId) return;

        // vẫn join room match:... cho cả 2 loại
        const roomRefs = getSocketMatchRoomRefs(socket);
        const nextRefCount = (roomRefs.get(normalizedMatchId) || 0) + 1;
        roomRefs.set(normalizedMatchId, nextRefCount);
        if (nextRefCount === 1) {
          await socket.join(`match:${normalizedMatchId}`);
        }
        socket.emit("match:joined", {
          matchId: normalizedMatchId,
          joinedAt: new Date().toISOString(),
          refs: nextRefCount,
        });

        await emitMatchSnapshotToSocket(
          socket,
          normalizedMatchId,
          userMatch
        );
        return;

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
              select: "name image eventType overlay nameDisplayMode",
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

        // 🆕 Stage: tính stageType / stageName cho MATCH tournament (UserMatch bỏ qua)
        if (!isUserMatch && typeof computeStageInfoForMatchDoc === "function") {
          try {
            const s = computeStageInfoForMatchDoc(m) || {};
            if (s.stageType != null) m.stageType = s.stageType;
            if (s.stageName != null) m.stageName = s.stageName;
          } catch (e) {
            console.error(
              "[socket match:join] computeStageInfo error:",
              e?.message || e
            );
          }
        }

        // giữ nguyên emit cũ
        socket.emit("match:snapshot", toDTO(decorateServeAndSlots(m)));
      } catch (e) {
        console.error("[socket match:join] fatal error:", e?.message || e);
      }
    });

    socket.on("match:snapshot:request", async ({ matchId, userMatch } = {}) => {
      try {
        await emitMatchSnapshotToSocket(socket, matchId, userMatch);
        return;
      } catch (e) {
        console.error(
          "[socket match:snapshot:request] fatal error:",
          e?.message || e
        );
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

          // Helper lấy ID (User ID hoặc Name cho Guest)
          // Ưu tiên User ID thực, fallback về Name nếu là Guest UserMatch
          const toId = (u) =>
            String(
              u?.user?._id ||
                u?.user ||
                u?._id ||
                u?.id ||
                u?.fullName ||
                u?.displayName ||
                u?.name ||
                ""
            );

          // ================== USER MATCH BRANCH ==================
          if (userMatch) {
            if (!socket.user?._id) {
              return ack?.({ ok: false, message: "Forbidden 1" });
            }

            const m = await UserMatch.findById(matchId);
            if (!m) {
              return ack?.({ ok: false, message: "Match not found 1" });
            }

            // chỉ cho creator trận tự do đổi serve
            // if (String(m.createdBy) !== String(socket.user._id)) {
            //   return ack?.({ ok: false, message: "Forbidden 2" });
            // }

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

            // validate serverId thuộc team tương ứng
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

            // 🔥 FIX: Set đầy đủ vào serve object (QUAN TRỌNG: lưu serverId vào root)
            m.serve = {
              side: wantSide,
              server: wantServer,
              serverId: validServerId, // <-- Fix lỗi ở đây
            };

            // Sync vào slots (để tương thích ngược nếu cần)
            if (validServerId) {
              m.set("slots.serverId", validServerId, { strict: false });
              m.set("slots.updatedAt", new Date(), { strict: false });
              const ver = Number(m?.slots?.version || 0);
              m.set("slots.version", ver + 1, { strict: false });
              m.markModified("slots");
            }

            // log
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

            await m.save(); // pre('save') sẽ chạy và sync mọi thứ chuẩn chỉ

            // broadcast
            io.to(`match:${matchId}`).emit("match:patched", {
              matchId: String(matchId),
              payload: {
                serve: m.serve, // Gửi về FE object serve đã có serverId
                slots: m.slots,
              },
            });

            return ack?.({ ok: true });
          }

          // ================== TOURNAMENT MATCH BRANCH ==================
          // if (!ensureReferee(socket)) {
          //   return ack?.({ ok: false, message: "Forbidden" });
          // }

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

          // validate serverId
          // Với Match giải đấu, toId chỉ lấy _id thật
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

          // 🔥 FIX: Set đầy đủ vào serve object (QUAN TRỌNG: lưu serverId vào root)
          m.serve = {
            side: wantSide,
            server: wantServer,
            serverId: validServerId, // <-- Fix lỗi ở đây
          };

          // lưu serverId động vào slots
          if (validServerId) {
            m.set("slots.serverId", validServerId, { strict: false });
            m.set("slots.updatedAt", new Date(), { strict: false });
            const ver = Number(m?.slots?.version || 0);
            m.set("slots.version", ver + 1, { strict: false });
            m.markModified("slots");
          }

          // live log
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

          // ==== tải lại snapshot ====
          let snap = await loadMatchForSnapshot(m._id, userMatch);
          if (!snap) {
            return ack?.({ ok: true });
          }

          snap = await postprocessSnapshotLikeJoin(snap);
          const dto = toDTO(decorateServeAndSlots(snap));

          // broadcast
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
          .populate({ path: "tournament", select: "eventType nameDisplayMode" });

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
          select: "name image eventType overlay nameDisplayMode",
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
      // bổ sung streams từ meta nếu có
      if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

      // giữ nguyên DTO của bạn
      const dto = toDTO(decorateServeAndSlots(m));

      // 👉 Lấy stageName chuẩn từ helper
      const stageInfo = computeStageInfoForMatchDoc(m);
      if (stageInfo?.stageName) {
        dto.stageName = stageInfo.stageName; // dùng luôn stageName, không map gì thêm
      }

      // unified channel để FE bắt được và hiển thị ngay
      io.to(`match:${matchId}`).emit("score:updated", dto);
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
          select: "name image eventType overlay nameDisplayMode",
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
      ({ tournamentId, bracket, cluster = "Main" }) => {
        if (!tournamentId) return;
        broadcastState(io, tournamentId, { bracket, cluster });
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
            const activeMatches = await Match.find({
              tournament: tournamentId,
              ...(bracket ? { bracket } : { courtCluster: clusterKey }),
              court: { $ne: null },
              status: { $nin: ["finished", "cancelled", "canceled"] },
            })
              .select("_id queueOrder courtCluster")
              .session(session)
              .lean();

            for (const match of activeMatches) {
              await Match.updateOne(
                { _id: match._id },
                {
                  $set: {
                    status:
                      match.queueOrder != null || match.courtCluster
                        ? "queued"
                        : "scheduled",
                    court: null,
                    courtLabel: "",
                    assignedAt: null,
                  },
                },
                { session }
              );
            }

            const courtsFilter = {
              tournament: tournamentId,
              cluster: clusterKey,
            };

            const clearedCourtsRes = await Court.updateMany(
              courtsFilter,
              {
                $set: {
                  status: "idle",
                  currentMatch: null,
                  "manualAssignment.enabled": false,
                  "manualAssignment.bracketId": null,
                  "manualAssignment.fallbackToAuto": true,
                  "manualAssignment.items": [],
                  "manualAssignment.updatedAt": new Date(),
                },
              },
              { session }
            );

            await session.commitTransaction();
            session.endSession();

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

            await broadcastState(io, tournamentId, {
              bracket,
              cluster: clusterKey,
            });

            ack?.({
              ok: true,
              unassignedMatches: activeMatches.length,
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
        const normalizedMatchId = String(matchId || "").trim();
        if (!normalizedMatchId) return;

        // rời room match cho cả match thường & userMatch
        const roomRefs = getSocketMatchRoomRefs(socket);
        const nextRefCount = Math.max(
          0,
          (roomRefs.get(normalizedMatchId) || 0) - 1
        );
        if (nextRefCount === 0) {
          roomRefs.delete(normalizedMatchId);
          getSocketMatchSnapshotTracker(socket).delete(normalizedMatchId);
          socket.leave(`match:${normalizedMatchId}`);
        } else {
          roomRefs.set(normalizedMatchId, nextRefCount);
        }

        console.log(
          "[socket] match:leave",
          normalizedMatchId,
          userMatch ? "(userMatch)" : "",
          `refs=${nextRefCount}`
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
          select: "name image eventType overlay nameDisplayMode",
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
          const result = await assignSpecificMatchToCourt({
            tournamentId,
            bracket,
            courtId,
            matchId,
            replace,
            cluster: resolveClusterKey(bracket, cluster),
          });

          const clusterKey = result.clusterKey;
          const mDoc = result.match;

          await broadcastState(io, String(tournamentId), {
            bracket: bracket || mDoc.bracket,
            cluster: clusterKey,
          });

          try {
            const mNew = await populateMatchForEmit(mDoc._id);
            if (mNew) {
              io.to(`match:${String(mNew._id)}`).emit(
                "match:snapshot",
                toDTO(decorateServeAndSlots(mNew))
              );
              io.to(`match:${String(mNew._id)}`).emit(
                "match:update",
                toDTO(decorateServeAndSlots(mNew))
              );
            }
          } catch (e) {
            console.error("[emit] new match snapshot error:", e?.message);
          }

          if (result.replacedMatchId) {
            try {
              const mOld = await populateMatchForEmit(result.replacedMatchId);
              if (mOld) {
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
            courtId: String(result.court._id),
            matchId: String(mDoc._id),
            status: mDoc.status,
            courtLabel: mDoc.courtLabel,
            cluster: clusterKey,
            replaced: Boolean(replace),
          });
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
      const cleaned = await sweepStaleSockets({ batch: 500 });
      if (cleaned > 0) {
        console.log(`[socket] sweep cleaned ${cleaned} stale socket(s)`);
        await emitSummary(io);
      }
    } catch (e) {
      console.error("[socket] sweepStaleSockets timer error:", e);
    }
  }, SWEEP_EVERY_MS);

  if (!fbPageMonitorTickerStarted) {
    fbPageMonitorTickerStarted = true;
    setInterval(async () => {
      try {
        scheduleFbPageMonitorPublish(io, {
          reason: "fallback_reconcile",
          mode: "reconcile",
        });
      } catch (e) {
        console.error("[socket] fb-pages ticker error:", e);
      }
    }, FB_PAGE_MONITOR_TICK_MS);
  }

  if (!courtLiveTickerStarted) {
    courtLiveTickerStarted = true;
    setInterval(async () => {
      try {
        const rooms = Array.from(io.sockets.adapter.rooms.keys()).filter(
          (room) => room.startsWith(COURT_LIVE_ROOM_PREFIX)
        );
        for (const room of rooms) {
          const tournamentId = room.slice(COURT_LIVE_ROOM_PREFIX.length);
          if (!tournamentId) continue;
          scheduleCourtLivePresencePublish(io, {
            tournamentId,
            reason: "fallback_reconcile",
            mode: "reconcile",
          });
        }
      } catch (e) {
        console.error("[socket] court-live ticker error:", e);
      }
    }, COURT_LIVE_RECONCILE_TICK_MS);
  }

  if (!liveRecordingMonitorTickerStarted) {
    liveRecordingMonitorTickerStarted = true;
    setInterval(async () => {
      try {
        scheduleLiveRecordingMonitorPublish(io, {
          reason: "fallback_reconcile",
          mode: "reconcile",
        });
      } catch (e) {
        console.error("[socket] recordings-v2 ticker error:", e);
      }
    }, LIVE_RECORDING_MONITOR_TICK_MS);
  }

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
