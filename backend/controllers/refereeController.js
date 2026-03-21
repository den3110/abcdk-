// controllers/refereeController.js
import asyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";
import Bracket from "../models/bracketModel.js";
import {
  addPoint /* optional: nextGame helper nếu bạn tách riêng */,
  toDTO,
} from "../socket/liveHandlers.js";
import mongoose from "mongoose";
import { applyRatingForFinishedMatch } from "../utils/applyRatingForFinishedMatch.js";
import {
  CATEGORY,
  EVENTS,
  publishNotification,
} from "../services/notifications/notificationHub.js";
import Court from "../models/courtModel.js";
import { decorateServeAndSlots } from "../utils/liveServeUtils.js";
import { broadcastState } from "../services/broadcastState.js";
import UserMatch from "../models/userMatchModel.js";
/* ───────── helpers ───────── */
function isGameWin(a = 0, b = 0, rules) {
  const { pointsToWin = 11, winByTwo = true } = rules || {};
  const max = Math.max(a, b);
  const min = Math.min(a, b);
  if (max < pointsToWin) return false;
  const diff = max - min;
  return winByTwo ? diff >= 2 : diff >= 1;
}
function winsCount(gameScores = [], rules) {
  let aWins = 0,
    bWins = 0;
  for (const g of gameScores) {
    if (!Number.isFinite(g?.a) || !Number.isFinite(g?.b)) continue;
    if (!isGameWin(g.a, g.b, rules)) continue;
    if (g.a > g.b) aWins += 1;
    if (g.b > g.a) bWins += 1;
  }
  return { aWins, bWins };
}

/* 
  GET /api/referee/matches/assigned-to-me
  → trả về các trận có referee == req.user._id (đã populate)
*/

const { Types } = mongoose;
const isValidId = (v) => Types.ObjectId.isValid(String(v || ""));
const asBool = (v) => v === true || v === "true" || v === "1" || v === 1;
const esc = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/matches/assigned?page=1&pageSize=10
export const getAssignedMatches = asyncHandler(async (req, res) => {
  const me = req.user?._id;
  const roles = new Set(
    [
      ...(Array.isArray(req.user?.roles) ? req.user.roles : []),
      ...(req.user?.role ? [req.user.role] : []),
      req.user?.isAdmin ? "admin" : null,
    ]
      .filter(Boolean)
      .map((r) => String(r).toLowerCase())
  );
  const isAdmin = roles.has("admin");

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(
    Math.max(parseInt(req.query.pageSize || req.query.limit) || 10, 1),
    50
  );
  const skip = (page - 1) * pageSize;

  const q = (req.query.q || "").trim();
  const matchId = (req.query.matchId || "").trim();
  const status = (req.query.status || "").trim().toLowerCase();
  const tournament = req.query.tournament;
  const bracket = req.query.bracket;
  const refQuery = req.query.referee;
  const hasRefereeFlag =
    asBool(req.query.hasReferee) || asBool(req.query.assigned);

  // ===== Base $match theo role =====
  const pipeline = [];

  if (isAdmin) {
    if (refQuery && isValidId(refQuery)) {
      pipeline.push({ $match: { referee: new Types.ObjectId(refQuery) } });
    } else {
      // Mặc định admin xem toàn bộ "đã gán trọng tài"
      // (hoặc khi ?hasReferee=true / ?assigned=1)
      if (hasRefereeFlag || !refQuery) {
        pipeline.push({
          $match: { $expr: { $eq: [{ $type: "$referee" }, "objectId"] } }, // tránh cast lỗi
        });
      }
    }
  } else {
    if (!isValidId(me))
      return res.status(400).json({ message: "Invalid user" });
    pipeline.push({ $match: { referee: new Types.ObjectId(me) } });
  }

  // ===== Lọc theo tournament/bracket/status =====
  if (tournament && isValidId(tournament)) {
    pipeline.push({ $match: { tournament: new Types.ObjectId(tournament) } });
  }
  if (bracket && isValidId(bracket)) {
    pipeline.push({ $match: { bracket: new Types.ObjectId(bracket) } });
  }
  if (["scheduled", "live", "finished"].includes(status)) {
    pipeline.push({ $match: { status } });
  }

  // ===== Ưu tiên matchId (exact _id) nếu hợp lệ =====
  if (isValidId(matchId)) {
    pipeline.push({ $match: { _id: new Types.ObjectId(matchId) } });
  }

  // ===== Lookup để filter theo tên giải/nhánh và để sort theo stage =====
  pipeline.push(
    {
      $lookup: {
        from: "brackets",
        localField: "bracket",
        foreignField: "_id",
        as: "bracket",
      },
    },
    { $unwind: { path: "$bracket", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "tournaments",
        localField: "tournament",
        foreignField: "_id",
        as: "tournament",
      },
    },
    { $unwind: { path: "$tournament", preserveNullAndEmptyArrays: true } }
  );

  // ===== Tìm kiếm "q" (code, tên giải, tên nhánh) nếu không dùng matchId =====
  if (!isValidId(matchId) && q) {
    const rx = new RegExp(esc(q), "i");
    pipeline.push({
      $match: {
        $or: [
          { code: { $regex: rx } },
          { "tournament.name": { $regex: rx } },
          { "bracket.name": { $regex: rx } },
        ],
      },
    });
  }

  // ===== Sort phức hợp =====
  pipeline.push(
    {
      $addFields: {
        _statusOrder: {
          $indexOfArray: [["scheduled", "live", "finished"], "$status"],
        },
      },
    },
    {
      $sort: {
        _statusOrder: 1,
        "bracket.stage": 1,
        round: 1,
        order: 1,
        createdAt: 1,
      },
    },
    {
      $facet: {
        pageIds: [
          { $project: { _id: 1 } },
          { $skip: skip },
          { $limit: pageSize },
        ],
        total: [{ $count: "count" }],
      },
    }
  );

  const agg = await Match.aggregate(pipeline);
  const ids = (agg?.[0]?.pageIds || []).map((d) => d._id);
  const total = agg?.[0]?.total?.[0]?.count || 0;

  // ===== Fetch đầy đủ doc + populate, giữ đúng thứ tự =====
  let items = [];
  if (ids.length) {
    items = await Match.find({ _id: { $in: ids } })
      .populate({ path: "tournament", select: "name eventType nameDisplayMode" })
      .populate({ path: "bracket", select: "name type stage" })
      .populate({
        path: "pairA",
        populate: [
          { path: "player1", select: "fullName name phone avatar score" },
          { path: "player2", select: "fullName name phone avatar score" },
        ],
      })
      .populate({
        path: "pairB",
        populate: [
          { path: "player1", select: "fullName name phone avatar score" },
          { path: "player2", select: "fullName name phone avatar score" },
        ],
      })
      .populate({ path: "referee", select: "name email nickname" }) // ⬅️ để admin hiển thị TT
      .lean();

    const order = new Map(ids.map((id, i) => [String(id), i]));
    items.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
  }

  res.json({
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

/*
  PATCH /api/referee/matches/:id/score
  body:
    - op: "inc" | "setGame" | "nextGame"
    - inc:   { op:"inc", side:"A"|"B", delta: 1|-1 }
    - setGame: { op:"setGame", gameIndex: number, a: number, b: number }
    - nextGame: { op:"nextGame" }
*/

// helpers cục bộ phòng khi chưa tách utils
const gameWon = (x, y, pts, byTwo) =>
  x >= pts && (byTwo ? x - y >= 2 : x - y >= 1);

// ===== Stage helpers (group / playoff / round label) =====
export function computeStageInfoForMatchDoc(m) {
  if (!m) return { stageType: null, stageName: "" };

  const bracketType = (
    (m.bracket && m.bracket.type) ||
    m.format ||
    ""
  ).toString();

  const phase = m.phase || null;
  const branch = m.branch || "main";

  const meta = (m.bracket && m.bracket.meta) || {};

  const isThirdPlace =
    m.isThirdPlace === true ||
    (m.meta && m.meta.thirdPlace === true) ||
    (m.meta &&
      typeof m.meta.stageLabel === "string" &&
      /3/.test(m.meta.stageLabel) &&
      /4/.test(m.meta.stageLabel));

  // ===== Group-like (vòng bảng) =====
  if (
    ["group", "round_robin", "gsl", "swiss"].includes(bracketType) ||
    phase === "group"
  ) {
    // swiss
    if (bracketType === "swiss") {
      const r = Number.isFinite(Number(m.swissRound))
        ? Number(m.swissRound)
        : null;
      return {
        stageType: "group",
        stageName: r ? `Vòng Swiss ${r}` : "Vòng bảng",
      };
    }

    // GSL
    if (bracketType === "gsl") {
      let name = "Vòng bảng (GSL)";
      if (phase === "winners") name = "GSL – Nhánh thắng";
      else if (phase === "losers") name = "GSL – Nhánh thua";
      else if (phase === "decider") name = "GSL – Trận quyết định";
      else if (phase === "grand_final") name = "GSL – Chung kết";

      return {
        stageType: "group",
        stageName: name,
      };
    }

    // group / round_robin mặc định
    return {
      stageType: "group",
      stageName: "Vòng bảng",
    };
  }

  // ===== KO / playoff =====
  const drawSize =
    Number.isFinite(Number(meta.drawSize)) && Number(meta.drawSize) > 0
      ? Number(meta.drawSize)
      : m.bracket && Number.isInteger(Number(m.bracket.drawRounds))
      ? 1 << Number(m.bracket.drawRounds)
      : 0;

  const roundNo = Number.isFinite(Number(m.round)) ? Number(m.round) : 1;

  let roundSize = null;
  if (drawSize) {
    roundSize = Math.max(2, drawSize >> (roundNo - 1));
  }

  const koLabel = () => {
    if (isThirdPlace) return "Tranh hạng 3/4";

    // Không rõ drawSize → fallback
    if (!roundSize || roundSize <= 2) {
      const maxRounds =
        Number.isFinite(Number(meta.maxRounds)) && Number(meta.maxRounds) > 0
          ? Number(meta.maxRounds)
          : null;
      if (maxRounds && roundNo === maxRounds) return "Chung kết";
      return "Playoff";
    }

    if (roundSize >= 64) return "Vòng 64 đội";
    if (roundSize === 32) return "Vòng 32 đội";
    if (roundSize === 16) return "Vòng 16 đội";
    if (roundSize === 8) return "Tứ kết";
    if (roundSize === 4) return "Bán kết";
    if (roundSize === 2) return "Chung kết";

    // các case như 128 đội, 256 đội...
    return `Vòng ${roundSize} đội`;
  };

  // stageType high-level: group / playoff
  let stageType = "playoff";
  let stageName = koLabel();

  if (bracketType === "double_elim") {
    const base = koLabel();
    if (branch === "wb") {
      stageName = `Nhánh thắng – ${base}`;
    } else if (branch === "lb") {
      stageName = `Nhánh thua – ${base}`;
    } else if (branch === "gf") {
      stageName = "Chung kết tổng";
    } else if (branch === "consol") {
      stageName = isThirdPlace ? "Tranh hạng 3/4" : base;
    } else {
      stageName = base;
    }
  }

  return { stageType, stageName };
}

// ===== Helpers for broadcast with nickname fallback =====
async function loadMatchWithNickForEmit(matchId) {
  const m = await Match.findById(matchId)
    .populate({
      path: "pairA",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          // bổ sung fullName/name/shortName + user.nickname để FE fallback
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
    // 🆕 người đang điều khiển live (đồng bộ với chỗ khác)
    .populate({ path: "liveBy", select: "name fullName nickname nickName" })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({ path: "nextMatch", select: "_id" })
    // tournament kèm overlay để FE pickOverlay
    .populate({
      path: "tournament",
      select: "name image eventType overlay nameDisplayMode",
    })
    // 🆕 BRACKET: mở rộng như các handler khác (meta, groups, config, overlay...)
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
    // 🆕 court để FE auto-next theo sân
    .populate({
      path: "court",
      select: "name number code label zone area venue building floor",
    })
    .lean();

  if (!m) return null;

  const pick = (v) => (v && String(v).trim()) || "";
  const fillNick = (p) => {
    if (!p) return p;
    const primary = pick(p.nickname) || pick(p.nickName);
    const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
    const n = primary || fromUser || "";
    if (n) {
      p.nickname = n;
      p.nickName = n;
    }
    // nếu muốn gọn payload có thể bỏ user:
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

  // fallback streams từ meta nếu chưa có
  if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;
  // 🆕 TÍNH STAGE
  const { stageType, stageName } = computeStageInfoForMatchDoc(m);
  if (stageType) m.stageType = stageType;
  if (stageName) m.stageName = stageName;

  return m;
}

async function broadcastScoreUpdated(io, matchId) {
  const snap = await loadMatchWithNickForEmit(matchId);
  if (!snap) return;

  const baseDto = toDTO(snap);
  const { stageType, stageName } = computeStageInfoForMatchDoc(snap);

  const payload =
    stageType || stageName
      ? {
          ...baseDto,
          ...(stageType ? { stageType } : {}),
          ...(stageName ? { stageName } : {}),
        }
      : baseDto;

  io?.to(`match:${matchId}`)?.emit("score:updated", payload);
}

async function broadcastUserMatchScoreUpdated(io, matchId) {
  const snap = await UserMatch.findById(matchId).lean();
  if (!snap) return null;

  const gameScores = Array.isArray(snap.gameScores) ? snap.gameScores : [];
  const currentGame = Number.isInteger(snap.currentGame)
    ? snap.currentGame
    : gameScores.length - 1;
  const activeScore =
    gameScores[currentGame] ||
    gameScores[gameScores.length - 1] || { a: 0, b: 0 };

  const payload = {
    ...snap,
    _id: String(snap._id),
    matchId: String(snap._id),
    type: "userMatch",
    stageType: "userMatch",
    stageName: snap.stageName || "Trận đấu PickleTour",
    scoreA: Number(activeScore?.a || 0),
    scoreB: Number(activeScore?.b || 0),
    liveVersion:
      Number.isFinite(snap.liveVersion) && snap.liveVersion > 0
        ? snap.liveVersion
        : snap.updatedAt
        ? new Date(snap.updatedAt).getTime()
        : Date.now(),
  };

  io?.to(`match:${String(snap._id)}`)?.emit("score:updated", payload);
  return payload;
}

export const patchScore = asyncHandler(async (req, res) => {
  // ================== Helpers (CAP-aware) ==================
  const isFinitePos = (n) => Number.isFinite(n) && n > 0;

  /**
   * Kết luận 1 ván theo rules (pointsToWin, winByTwo, cap)
   * return { finished: boolean, winner: 'A'|'B'|null, capped: boolean }
   */
  function evaluateGameFinish(aRaw, bRaw, rules) {
    const a = Number(aRaw) || 0;
    const b = Number(bRaw) || 0;

    const base = Number(rules?.pointsToWin ?? 11);
    const byTwo = rules?.winByTwo !== false; // default true
    const mode = String(rules?.cap?.mode ?? "none"); // 'none' | 'hard' | 'soft'
    const capPoints =
      rules?.cap?.points != null ? Number(rules.cap.points) : null;

    // HARD CAP: chạm cap là kết thúc ngay, không cần chênh 2
    if (mode === "hard" && isFinitePos(capPoints)) {
      if (a >= capPoints || b >= capPoints) {
        if (a === b) return { finished: false, winner: null, capped: false }; // edge-case nhập tay
        return { finished: true, winner: a > b ? "A" : "B", capped: true };
      }
    }

    // SOFT CAP: đạt cap → bỏ luật chênh 2, ai dẫn là thắng
    if (mode === "soft" && isFinitePos(capPoints)) {
      if (a >= capPoints || b >= capPoints) {
        if (a === b) return { finished: false, winner: null, capped: false };
        return { finished: true, winner: a > b ? "A" : "B", capped: true };
      }
    }

    // Không cap (hoặc chưa tới cap)
    if (byTwo) {
      if ((a >= base || b >= base) && Math.abs(a - b) >= 2) {
        return { finished: true, winner: a > b ? "A" : "B", capped: false };
      }
    } else {
      if ((a >= base || b >= base) && a !== b) {
        return { finished: true, winner: a > b ? "A" : "B", capped: false };
      }
    }
    return { finished: false, winner: null, capped: false };
  }

  function countWins(gs = [], rules) {
    let aWins = 0,
      bWins = 0;
    for (const g of gs) {
      const ev = evaluateGameFinish(g?.a ?? 0, g?.b ?? 0, rules);
      if (!ev.finished) continue;
      if (ev.winner === "A") aWins++;
      else if (ev.winner === "B") bWins++;
    }
    return { aWins, bWins };
  }

  async function finalizeMatchIfDone(match, rules) {
    const { aWins, bWins } = countWins(match.gameScores || [], rules);
    const need = Math.floor(Number(rules.bestOf) / 2) + 1;
    if (aWins >= need || bWins >= need) {
      match.winner = aWins > bWins ? "A" : "B";
      match.status = "finished";
      if (!match.finishedAt) match.finishedAt = new Date();
      await match.save();
      return true;
    }
    return false;
  }

  const getRulesFromDoc = (doc, fallback) => ({
    bestOf: Number(doc?.rules?.bestOf ?? fallback?.bestOf ?? 3),
    pointsToWin: Number(doc?.rules?.pointsToWin ?? fallback?.pointsToWin ?? 11),
    winByTwo:
      doc?.rules?.winByTwo === undefined
        ? fallback?.winByTwo ?? true
        : Boolean(doc.rules.winByTwo),
    cap: {
      mode: String(doc?.rules?.cap?.mode ?? fallback?.cap?.mode ?? "none"),
      points:
        doc?.rules?.cap?.points === undefined
          ? fallback?.cap?.points ?? null
          : Number(doc.rules.cap.points),
    },
  });

  const lastGame = (m) => {
    if (!Array.isArray(m?.gameScores) || m.gameScores.length === 0) return null;
    return m.gameScores[m.gameScores.length - 1] || null;
  };

  // ============== Common vars ==============
  const io = req.app.get("io");
  const { id } = req.params;
  const { op } = req.body || {};
  const autoNext = req.body?.autoNext === true; // chỉ true mới tính là bật

  const matchKind =
    req.header("x-pkt-match-kind") || req.headers["x-pkt-match-kind"];

  /* =========================================================
   * NHÁNH USER MATCH (có header x-pkt-match-kind)
   * ========================================================= */
  if (matchKind) {
    const match = await UserMatch.findById(id);
    if (!match) {
      return res.status(404).json({ message: "UserMatch not found" });
    }

    const rules0 = {
      bestOf: Number(match.rules?.bestOf ?? 3),
      pointsToWin: Number(match.rules?.pointsToWin ?? 11),
      winByTwo:
        match.rules?.winByTwo === undefined
          ? true
          : Boolean(match.rules?.winByTwo),
      cap: {
        mode: String(match.rules?.cap?.mode ?? "none"),
        points:
          match.rules?.cap?.points === undefined
            ? null
            : Number(match.rules.cap.points),
      },
    };

    // =============== 1) INC/DEC điểm (UserMatch) ===============
    if (op === "inc") {
      const side = req.body?.side;
      const d = Number(req.body?.delta);

      if (!["A", "B"].includes(side)) {
        return res.status(400).json({ message: "Invalid side" });
      }
      if (!Number.isFinite(d) || d === 0) {
        return res.status(400).json({ message: "Invalid delta" });
      }

      if (!Array.isArray(match.gameScores)) match.gameScores = [];
      if (match.gameScores.length === 0) {
        match.gameScores.push({ a: 0, b: 0 });
        match.currentGame = 0;
      }

      const len = match.gameScores.length;
      let idx = Number.isInteger(match.currentGame)
        ? match.currentGame
        : len - 1;
      if (idx < 0 || idx >= len) idx = len - 1;

      const g = match.gameScores[idx] || { a: 0, b: 0 };
      if (side === "A") {
        g.a = Math.max(0, (Number(g.a) || 0) + d);
      } else {
        g.b = Math.max(0, (Number(g.b) || 0) + d);
      }
      match.gameScores[idx] = g;

      await match.save();

      const freshDoc = await UserMatch.findById(id);
      if (!freshDoc) {
        return res.status(404).json({ message: "UserMatch not found" });
      }

      const rulesNow = getRulesFromDoc(freshDoc, rules0);

      if (freshDoc.status === "finished") {
        if (!freshDoc.finishedAt) {
          freshDoc.finishedAt = new Date();
          await freshDoc.save();
        }
      } else if (autoNext) {
        await finalizeMatchIfDone(freshDoc, rulesNow);
      }

      if (autoNext && freshDoc.status !== "finished") {
        const lg = lastGame(freshDoc);
        if (lg) {
          const ev = evaluateGameFinish(lg.a ?? 0, lg.b ?? 0, rulesNow);
          if (ev.finished) {
            const { aWins, bWins } = countWins(
              freshDoc.gameScores || [],
              rulesNow
            );
            const need = Math.floor(Number(rulesNow.bestOf) / 2) + 1;
            const matchDone = aWins >= need || bWins >= need;
            if (!matchDone) {
              freshDoc.gameScores.push({ a: 0, b: 0 });
              freshDoc.currentGame = freshDoc.gameScores.length - 1;

              // reset giao bóng đầu ván
              freshDoc.serve = freshDoc.serve || { side: "A", server: 2 };
              freshDoc.serve.side = freshDoc.serve.side || "A";
              freshDoc.serve.server = 2;

              freshDoc.liveLog = freshDoc.liveLog || [];
              freshDoc.liveLog.push({
                type: "serve",
                by: req.user?._id || null,
                payload: { side: freshDoc.serve.side, server: 2 },
                at: new Date(),
              });

              await freshDoc.save();
            }
          }
        }
      }

      const fresh = await UserMatch.findById(id).lean();
      await broadcastUserMatchScoreUpdated(io, id);

      return res.json({
        message: "Score updated",
        gameScores: fresh?.gameScores ?? [],
        status: fresh?.status,
        winner: fresh?.winner,
      });
    }

    // =============== 2) SET GAME tại index cụ thể (UserMatch) ===============
    if (op === "setGame") {
      let { gameIndex, a = 0, b = 0 } = req.body;

      if (!Number.isInteger(gameIndex) || gameIndex < 0) {
        return res.status(400).json({ message: "Invalid gameIndex" });
      }
      if (!Array.isArray(match.gameScores)) match.gameScores = [];
      if (gameIndex > match.gameScores.length) {
        return res.status(400).json({ message: "gameIndex out of range" });
      }

      a = Number(a) || 0;
      b = Number(b) || 0;

      const rulesNow = getRulesFromDoc(match, rules0);

      // evaluate để tham khảo (giống nhánh Match), không auto gì nếu không tick
      evaluateGameFinish(a, b, rulesNow);

      const nextScore = { a, b };
      if (gameIndex === match.gameScores.length) {
        match.gameScores.push(nextScore);
      } else {
        match.gameScores[gameIndex] = nextScore;
      }

      match.currentGame = gameIndex;

      if (autoNext) {
        await finalizeMatchIfDone(match, rulesNow);
      }

      await match.save();
      await broadcastUserMatchScoreUpdated(io, id);

      return res.json({
        message: "Game set",
        gameScores: match.gameScores,
        currentGame: match.currentGame,
        status: match.status,
        winner: match.winner,
      });
    }

    // =============== 3) MỞ VÁN MỚI (UserMatch) ===============
    if (op === "nextGame") {
      const rulesNow = getRulesFromDoc(match, rules0);

      if (!Array.isArray(match.gameScores) || match.gameScores.length === 0) {
        return res
          .status(400)
          .json({ message: "Chưa có ván hiện tại để kiểm tra" });
      }

      const eva = (g) =>
        evaluateGameFinish(Number(g?.a || 0), Number(g?.b || 0), rulesNow);

      const len = match.gameScores.length;
      const cg = Number.isInteger(match.currentGame)
        ? match.currentGame
        : len - 1;
      const idx = Math.min(Math.max(cg, 0), len - 1);

      const cur = match.gameScores[idx];
      const curEv = eva(cur);

      const hasTrailingZero =
        len >= 2 &&
        Number(match.gameScores[len - 1]?.a || 0) === 0 &&
        Number(match.gameScores[len - 1]?.b || 0) === 0 &&
        !eva(match.gameScores[len - 1]).finished;

      if (!curEv.finished) {
        if (
          hasTrailingZero &&
          idx > 0 &&
          eva(match.gameScores[idx - 1]).finished
        ) {
          match.currentGame = len - 1;
          await match.save();
          await broadcastUserMatchScoreUpdated(io, id);
          return res.json({
            message: "Đã ở ván mới rồi",
            gameScores: match.gameScores,
            currentGame: match.currentGame,
            status: match.status,
            winner: match.winner,
          });
        }

        return res
          .status(400)
          .json({ message: "Ván hiện tại chưa đủ điều kiện kết thúc" });
      }

      const { aWins, bWins } = countWins(match.gameScores || [], rulesNow);
      const need = Math.floor(Number(rulesNow.bestOf) / 2) + 1;
      const matchDone = aWins >= need || bWins >= need;

      if (matchDone) {
        if (autoNext === true) {
          await finalizeMatchIfDone(match, rulesNow);
          await broadcastUserMatchScoreUpdated(io, id);
          return res.json({
            message: "Trận đã đủ số ván thắng, đã kết thúc",
            gameScores: match.gameScores,
            currentGame: match.currentGame,
            status: match.status,
            winner: match.winner,
          });
        } else {
          await broadcastUserMatchScoreUpdated(io, id);
          return res.status(409).json({
            message:
              "Trận đã đủ số ván thắng. Hãy bấm 'Kết thúc trận' để kết thúc.",
            gameScores: match.gameScores,
            currentGame: match.currentGame,
            status: match.status,
            winner: match.winner || null,
          });
        }
      }

      if (hasTrailingZero) {
        match.currentGame = len - 1;
        await match.save();
        await broadcastUserMatchScoreUpdated(io, id);
        return res.json({
          message: "Đã có ván tiếp theo sẵn",
          gameScores: match.gameScores,
          currentGame: match.currentGame,
          status: match.status,
          winner: match.winner,
        });
      }

      // Mở ván mới chuẩn
      match.gameScores.push({ a: 0, b: 0 });
      match.currentGame = match.gameScores.length - 1;

      match.serve = match.serve || { side: "A", server: 2 };
      match.serve.side = match.serve.side || "A";
      match.serve.server = 2;

      match.liveLog = match.liveLog || [];
      match.liveLog.push({
        type: "serve",
        by: req.user?._id || null,
        payload: { side: match.serve.side, server: 2 },
        at: new Date(),
      });

      await match.save();
      await broadcastUserMatchScoreUpdated(io, id);
      return res.json({
        message: "Đã tạo ván tiếp theo",
        gameScores: match.gameScores,
        currentGame: match.currentGame,
        status: match.status,
        winner: match.winner,
      });
    }

    return res.status(400).json({ message: "Unsupported op" });
  }

  /* =========================================================
   * NHÁNH MATCH BÌNH THƯỜNG (KHÔNG CÓ HEADER) – LOGIC CŨ
   * ========================================================= */
  const match = await Match.findById(id);
  if (!match) return res.status(404).json({ message: "Match not found" });

  const rules0 = {
    bestOf: Number(match.rules?.bestOf ?? 3),
    pointsToWin: Number(match.rules?.pointsToWin ?? 11),
    winByTwo:
      match.rules?.winByTwo === undefined
        ? true
        : Boolean(match.rules?.winByTwo),
    cap: {
      mode: String(match.rules?.cap?.mode ?? "none"),
      points:
        match.rules?.cap?.points === undefined
          ? null
          : Number(match.rules.cap.points),
    },
  };

  // =============== 1) INC/DEC điểm ===============
  if (op === "inc") {
    const side = req.body?.side;
    const d = Number(req.body?.delta);

    if (!["A", "B"].includes(side)) {
      return res.status(400).json({ message: "Invalid side" });
    }
    if (!Number.isFinite(d) || d === 0) {
      return res.status(400).json({ message: "Invalid delta" });
    }

    await addPoint(id, side, d, req.user?._id, io, { autoNext });

    // Lấy bản mới để tính lại
    const freshDoc = await Match.findById(id);
    if (!freshDoc) return res.status(404).json({ message: "Match not found" });
    const rulesNow = getRulesFromDoc(freshDoc, rules0);

    // Nếu trận đã 'finished' mà thiếu finishedAt → đóng dấu
    if (freshDoc.status === "finished") {
      if (!freshDoc.finishedAt) {
        freshDoc.finishedAt = new Date();
        await freshDoc.save();
      }
    } else if (autoNext) {
      // ✅ CHỈ khi tick: mới auto kết thúc TRẬN nếu đã đủ set
      await finalizeMatchIfDone(freshDoc, rulesNow);
    }

    // ✅ CHỈ khi tick: mới auto mở ván mới (nếu ván vừa xong & trận chưa đủ set)
    if (autoNext && freshDoc.status !== "finished") {
      const lg = lastGame(freshDoc);
      if (lg) {
        const ev = evaluateGameFinish(lg.a ?? 0, lg.b ?? 0, rulesNow);
        if (ev.finished) {
          const { aWins, bWins } = countWins(
            freshDoc.gameScores || [],
            rulesNow
          );
          const need = Math.floor(Number(rulesNow.bestOf) / 2) + 1;
          const matchDone = aWins >= need || bWins >= need;
          if (!matchDone) {
            freshDoc.gameScores.push({ a: 0, b: 0 });
            freshDoc.currentGame = freshDoc.gameScores.length - 1;
            // reset giao bóng đầu ván
            freshDoc.serve = freshDoc.serve || { side: "A", server: 2 };
            freshDoc.serve.side = freshDoc.serve.side || "A";
            freshDoc.serve.server = 2;
            // log (tuỳ dùng)
            freshDoc.liveLog = freshDoc.liveLog || [];
            freshDoc.liveLog.push({
              type: "serve",
              by: req.user?._id || null,
              payload: { side: freshDoc.serve.side, server: 2 },
              at: new Date(),
            });
            await freshDoc.save();
          }
        }
      }
    }

    const fresh = await Match.findById(id).lean();
    await broadcastScoreUpdated(io, id);
    return res.json({
      message: "Score updated",
      gameScores: fresh?.gameScores ?? [],
      status: fresh?.status,
      winner: fresh?.winner,
      ratingApplied: fresh?.ratingApplied,
    });
  }

  // =============== 2) SET GAME tại index cụ thể ===============
  if (op === "setGame") {
    let { gameIndex, a = 0, b = 0 } = req.body;

    if (!Number.isInteger(gameIndex) || gameIndex < 0) {
      return res.status(400).json({ message: "Invalid gameIndex" });
    }
    if (!Array.isArray(match.gameScores)) match.gameScores = [];
    if (gameIndex > match.gameScores.length) {
      return res.status(400).json({ message: "gameIndex out of range" });
    }

    a = Number(a) || 0;
    b = Number(b) || 0;

    // lấy rules mới nhất từ doc (phòng rule đổi khi live)
    const rulesNow = getRulesFromDoc(match, rules0);

    // Chấp nhận set tay (evaluate để tham khảo, không auto gì nếu không tick)
    evaluateGameFinish(a, b, rulesNow);

    const nextScore = { a, b };
    if (gameIndex === match.gameScores.length) match.gameScores.push(nextScore);
    else match.gameScores[gameIndex] = nextScore;

    match.currentGame = gameIndex;

    // ✅ CHỈ khi tick: mới auto kết thúc TRẬN nếu đã đủ set
    if (autoNext) {
      await finalizeMatchIfDone(match, rulesNow);
    }

    await match.save();
    await broadcastScoreUpdated(io, id);
    return res.json({
      message: "Game set",
      gameScores: match.gameScores,
      currentGame: match.currentGame,
      status: match.status,
      winner: match.winner,
    });
  }

  // =============== 3) MỞ VÁN MỚI (thủ công) ===============
  if (op === "nextGame") {
    // ❗ KHÔNG re-declare autoNext ở đây; dùng biến đã chuẩn hoá ở trên
    const rulesNow = getRulesFromDoc(match, rules0);

    if (!Array.isArray(match.gameScores) || match.gameScores.length === 0) {
      return res
        .status(400)
        .json({ message: "Chưa có ván hiện tại để kiểm tra" });
    }

    // helper dùng rulesNow (không phải rules)
    const eva = (g) =>
      evaluateGameFinish(Number(g?.a || 0), Number(g?.b || 0), rulesNow);

    const len = match.gameScores.length;
    const cg = Number.isInteger(match.currentGame)
      ? match.currentGame
      : len - 1;
    const idx = Math.min(Math.max(cg, 0), len - 1);

    const cur = match.gameScores[idx];
    const curEv = eva(cur);

    // Trường hợp đã lỡ mở ván mới (đuôi 0-0) => ván vừa kết thúc là idx-1
    const hasTrailingZero =
      len >= 2 &&
      Number(match.gameScores[len - 1]?.a || 0) === 0 &&
      Number(match.gameScores[len - 1]?.b || 0) === 0 &&
      !eva(match.gameScores[len - 1]).finished;

    if (!curEv.finished) {
      if (
        hasTrailingZero &&
        idx > 0 &&
        eva(match.gameScores[idx - 1]).finished
      ) {
        // Đã ở ván mới rồi, không cần tạo thêm
        match.currentGame = len - 1; // trỏ về ván 0-0 hiện tại
        await match.save();
        await broadcastScoreUpdated(io, id);
        return res.json({
          message: "Đã ở ván mới rồi",
          gameScores: match.gameScores,
          currentGame: match.currentGame,
          status: match.status,
          winner: match.winner,
        });
      }

      return res
        .status(400)
        .json({ message: "Ván hiện tại chưa đủ điều kiện kết thúc" });
    }

    // Ván hiện tại đã kết thúc → kiểm tra đủ set để kết thúc trận chưa
    const { aWins, bWins } = countWins(match.gameScores || [], rulesNow);
    const need = Math.floor(Number(rulesNow.bestOf) / 2) + 1;
    const matchDone = aWins >= need || bWins >= need;

    if (matchDone) {
      if (autoNext === true) {
        await finalizeMatchIfDone(match, rulesNow);
        await broadcastScoreUpdated(io, id);
        return res.json({
          message: "Trận đã đủ số ván thắng, đã kết thúc",
          gameScores: match.gameScores,
          currentGame: match.currentGame,
          status: match.status,
          winner: match.winner,
        });
      } else {
        // không tick → không tự kết thúc trận
        await broadcastScoreUpdated(io, id);
        return res.status(409).json({
          message:
            "Trận đã đủ số ván thắng. Hãy bấm 'Kết thúc trận' để kết thúc.",
          gameScores: match.gameScores,
          currentGame: match.currentGame,
          status: match.status, // giữ 'live'
          winner: match.winner || null,
        });
      }
    }

    // Nếu đã có ván 0-0 (do trước đó lỡ mở), đừng mở thêm
    if (hasTrailingZero) {
      match.currentGame = len - 1;
      await match.save();
      await broadcastScoreUpdated(io, id);
      return res.json({
        message: "Đã có ván tiếp theo sẵn",
        gameScores: match.gameScores,
        currentGame: match.currentGame,
        status: match.status,
        winner: match.winner,
      });
    }

    // Mở ván mới chuẩn
    match.gameScores.push({ a: 0, b: 0 });
    match.currentGame = match.gameScores.length - 1;

    // reset giao bóng đầu ván
    match.serve = match.serve || { side: "A", server: 2 };
    match.serve.side = match.serve.side || "A";
    match.serve.server = 2;

    match.liveLog = match.liveLog || [];
    match.liveLog.push({
      type: "serve",
      by: req.user?._id || null,
      payload: { side: match.serve.side, server: 2 },
      at: new Date(),
    });

    await match.save();
    await broadcastScoreUpdated(io, id);
    return res.json({
      message: "Đã tạo ván tiếp theo",
      gameScores: match.gameScores,
      currentGame: match.currentGame,
      status: match.status,
      winner: match.winner,
    });
  }

  return res.status(400).json({ message: "Unsupported op" });
});

/*
  PATCH /api/referee/matches/:id/status
  body: { status: "scheduled" | "live" | "finished" }
*/
export const patchStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!["scheduled", "live", "finished"].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  // 🔹 Nếu có header => xử lý trên UserMatch
  const matchKind =
    req.header("x-pkt-match-kind") || req.headers["x-pkt-match-kind"];

  if (matchKind) {
    // ===== USER MATCH BRANCH =====
    const match = await UserMatch.findById(id)
      .populate("createdBy", "name fullName avatar nickname nickName")
      .populate(
        "participants.user",
        "name fullName avatar nickname nickName phone"
      )
      .populate("referee", "name fullName nickname nickName")
      .populate("liveBy", "name fullName nickname nickName");

    if (!match) {
      return res.status(404).json({ message: "UserMatch not found" });
    }

    const prevStatus = match.status;
    match.status = status;

    const justWentLive = status === "live" && prevStatus !== "live";
    if (justWentLive) {
      if (!match.startedAt) match.startedAt = new Date();
      if (req.user?._id) match.liveBy = req.user._id;
    }

    await match.save();

    const io = req.app.get("io");

    // Emit status tối giản (giống post-save trong model nhưng thêm type)
    io?.to(String(match._id)).emit("status:updated", {
      matchId: match._id,
      status: match.status,
      type: "userMatch",
    });

    // Emit snapshot cho scoreboard (dùng chung channel match:...)
    const snap = match.toObject ? match.toObject() : match;
    // 🆕 thêm 2 field stage cho userMatch
    snap.stageType = "userMatch";
    snap.stageName = "Trận đấu PickleTour";

    io?.to(`match:${String(match._id)}`).emit("match:snapshot", snap);

    return res.json({
      message: "Status updated",
      status: match.status,
      type: "userMatch",
    });
  }

  // ===== MATCH BÌNH THƯỜNG (LOGIC CŨ) =====
  // Tìm trận
  const match = await Match.findById(id);
  if (!match) return res.status(404).json({ message: "Match not found" });

  const prevStatus = match.status;
  match.status = status;

  // Nếu chuyển sang live lần đầu → đóng dấu bắt đầu & lưu người bật (optional)
  const justWentLive = status === "live" && prevStatus !== "live";
  if (justWentLive) {
    if (!match.startedAt) match.startedAt = new Date();
    if (req.user?._id) match.liveBy = req.user._id;
  }

  await match.save();

  // Emit socket thay đổi trạng thái tối giản
  const io = req.app.get("io");
  io?.to(String(match._id)).emit("status:updated", {
    matchId: match._id,
    status: match.status,
  });

  // Lấy snapshot đầy đủ cho client
  const m = await Match.findById(match._id)
    .populate({
      path: "pairA",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          // bổ sung fullName/name/shortName + user.nickname để FE fallback
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
    .populate({ path: "referee", select: "name fullName nickname nickName" })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({ path: "nextMatch", select: "_id" })
    .populate({
      path: "tournament",
      select: "name image eventType overlay nameDisplayMode",
    })
    // 🆕 BRACKET: mở rộng meta/groups/config/overlay như các handler khác
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
        // overlay
        "overlay",
      ].join(" "),
    })
    // 🆕 court để FE auto-next theo sân
    .populate({
      path: "court",
      select: "name number code label zone area venue building floor",
    })
    // 🆕 ai đang điều khiển bảng điểm
    .populate({ path: "liveBy", select: "name fullName nickname nickName" })
    // 🆕 mở rộng select để DTO có đủ dữ liệu (GIỮ cái cũ + thêm mới)
    .select(
      "label managers court courtLabel courtCluster " +
        "scheduledAt startAt startedAt finishedAt status " +
        "tournament bracket rules currentGame gameScores " +
        "round order code roundCode roundName " + // ⬅️ THÊM MỚI ở đây
        "seedA seedB previousA previousB nextMatch winner serve overlay " +
        "video videoUrl stream streams meta " +
        "format rrRound pool " +
        "liveBy liveVersion"
    )
    .lean();

  if (m) {
    // 🧩 Nickname fallback từ user.nickname nếu player.nickname trống
    const pick = (v) => (v && String(v).trim()) || "";
    const fillNick = (p) => {
      if (!p) return p;
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

    // 🧩 Fallback streams từ meta nếu chưa có
    if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

    const baseDto = toDTO(m);
    const { stageType, stageName } = computeStageInfoForMatchDoc(m);

    const payload =
      stageType || stageName
        ? {
            ...baseDto,
            ...(stageType ? { stageType } : {}),
            ...(stageName ? { stageName } : {}),
          }
        : baseDto;

    io?.to(`match:${String(match._id)}`).emit("match:snapshot", payload);
  }

  // ★★★ Gửi thông báo cho người chơi khi TRẬN BẮT ĐẦU (chỉ lần đầu vào live) ★★★
  if (justWentLive) {
    try {
      publishNotification(EVENTS.MATCH_WENT_LIVE, {
        matchId: String(match._id),
        topicType: "match", // để filter theo Subscription nếu bạn dùng
        topicId: String(match._id),
        category: CATEGORY.STATUS, // cho phép user mute theo category
        label: m?.label || "", // render title/body đẹp hơn trong payload
      });
    } catch (err) {
      console.error("[notify] MATCH_WENT_LIVE error:", err?.message);
    }
  }

  return res.json({ message: "Status updated", status: match.status });
});
/*
  PATCH /api/referee/matches/:id/winner
  body: { winner: "" | "A" | "B" }
*/
export const patchWinner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { winner = "" } = req.body || {};
  if (!["", "A", "B"].includes(winner)) {
    return res.status(400).json({ message: "Invalid winner" });
  }

  const io = req.app.get("io");

  // 🔹 Nếu có header x-pkt-match-kind => xử lý cho UserMatch
  const kindHeader = (req.header("x-pkt-match-kind") || "")
    .toString()
    .toLowerCase();
  const isUserMatchKind = !!kindHeader; // chỉ cần có header là coi là userMatch

  if (isUserMatchKind) {
    const match = await UserMatch.findById(id);
    if (!match) {
      return res.status(404).json({ message: "UserMatch not found" });
    }

    const clearing = winner === "";
    if (clearing) {
      match.winner = "";
      match.status = "live";
      match.finishedAt = null;
    } else {
      match.winner = winner;
      match.status = "finished";
      if (!match.finishedAt) match.finishedAt = new Date();
    }

    await match.save();

    // 🔔 Bắn payload đầy đủ để client live không phải đoán score/serve/name
    await broadcastUserMatchScoreUpdated(io, id);
    io?.to(`match:${id}`).emit("winner:updated", { matchId: id, winner });
    io?.to(`match:${id}`).emit("match:patched", { matchId: id });

    return res.json({
      message: "Winner updated",
      winner: match.winner,
      status: match.status,
      finishedAt: match.finishedAt,
    });
  }

  // 🔹 Logic cũ cho Match tournament
  const match = await Match.findById(id);
  if (!match) return res.status(404).json({ message: "Match not found" });

  // cập nhật trạng thái
  const clearing = winner === "";
  if (clearing) {
    match.winner = "";
    match.status = "live";
    match.finishedAt = null;
  } else {
    match.winner = winner;
    match.status = "finished";
    if (!match.finishedAt) match.finishedAt = new Date();
  }

  await match.save();
  const mFull = await populateMatchForEmit(id);
  if (!mFull) return;
  const dto = toDTO(decorateServeAndSlots(mFull));

  // === EMIT ra room trận (client xem live) ===
  io?.to(`match:${id}`).emit("score:updated", dto);
  io?.to(`match:${id}`).emit("match:update", dto);
  io?.to(`match:${id}`).emit("winner:updated", { matchId: id, winner });
  io?.to(`match:${id}`).emit("match:patched", { matchId: id });
  if (match?.bracket) {
    io?.to(`draw:${String(match.bracket)}`).emit("draw:match:update", {
      type: clearing ? "winner:clear" : "winner:update",
      bracketId: String(match.bracket),
      matchId: String(match._id),
      data: dto,
    });
  }

  // === EMIT ra room scheduler (trang điều phối sân đang join) ===
  const schedRoom = `scheduler:${String(match.tournament)}:${String(
    match.bracket
  )}`;

  io?.to(schedRoom).emit("match:update", {
    matchId: String(match._id),
    tournamentId: String(match.tournament),
    bracket: String(match.bracket),
    status: match.status,
  });

  if (!clearing && match.status === "finished") {
    io?.to(schedRoom).emit("match:finish", {
      matchId: String(match._id),
      winner: match.winner,
      tournamentId: String(match.tournament),
      bracket: String(match.bracket),
      finishedAt: match.finishedAt,
    });
  }

  // chỉ chạy rating khi đã có winner
  if (!clearing && !match.ratingApplied) {
    try {
      await applyRatingForFinishedMatch(match._id);
    } catch (error) {
      console.error("[patchWinner] applyRatingForFinishedMatch error:", error);
    }
  }

  return res.json({
    message: "Winner updated",
    winner: match.winner,
    status: match.status,
    finishedAt: match.finishedAt,
  });
});

// ===== helpers =====
const toObjectId = (id) => {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
};

const escapeRegex = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // an toàn cho $regex

// Định nghĩa tập trạng thái "đang chờ/đang diễn ra" để tính pendingCount
const PENDING_STATES = ["queued", "assigned", "live"];

/**
 * 1) GET /referee/tournaments
 * Trả về danh sách giải mà trọng tài (req.user._id) có trận,
 * kèm pendingCount (số trận ở trạng thái queued/assigned/live).
 */
export async function listRefereeTournaments(req, res, next) {
  try {
    const userId = toObjectId(req.user?._id);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // Nếu model của bạn dùng 'referees: [ObjectId]' hoặc 'referee: ObjectId'
    // thì query theo cả hai trường với $or cho an toàn:
    const agg = await Match.aggregate([
      {
        $match: {
          $or: [{ referees: userId }, { referee: userId }],
        },
      },
      {
        $group: {
          _id: "$tournament",
          pendingCount: {
            $sum: { $cond: [{ $in: ["$status", PENDING_STATES] }, 1, 0] },
          },
        },
      },
      {
        $lookup: {
          from: "tournaments",
          localField: "_id",
          foreignField: "_id",
          as: "t",
        },
      },
      { $unwind: "$t" },
      {
        $project: {
          _id: "$t._id",
          name: "$t.name",
          location: "$t.location",
          startDate: "$t.startDate",
          endDate: "$t.endDate",
          pendingCount: 1,
        },
      },
      { $sort: { startDate: -1, _id: 1 } },
    ]);

    return res.json({ items: agg });
  } catch (err) {
    next(err);
  }
}

/**
 * 2) GET /referee/tournaments/:tid/brackets
 * Trả về danh sách bracket của 1 giải
 */
export async function listRefereeBrackets(req, res, next) {
  try {
    const tid = toObjectId(req.params.tid);
    console.log(tid);
    if (!tid) return res.status(400).json({ message: "Invalid tournament id" });

    const items = await Bracket.find({ tournament: tid })
      .select("_id name type stage order")
      .sort({ order: 1, stage: 1, name: 1 })
      .lean();

    return res.json({ items });
  } catch (err) {
    next(err);
  }
}

/**
 * 3) GET /referee/tournaments/:tid/matches
 * Query params:
 *  - status: scheduled|queued|assigned|live|finished
 *  - bracketId: ObjectId
 *  - q: tìm theo mã trận (code) hoặc tên/biệt danh VĐV
 *  - page (default 1), pageSize (default 10)
 *
 * Response:
 *  { items, total, page, pageSize, totalPages }
 */

export async function listRefereeMatchesByTournament(req, res, next) {
  try {
    const tid = toObjectId(req.params.tid);
    if (!tid) return res.status(400).json({ message: "Invalid tournament id" });

    const userId = toObjectId(req.user?._id);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    let { status, bracketId, q, page = 1, pageSize = 10 } = req.query;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 10));

    // ---------- $match ----------
    const andClauses = [
      { tournament: tid },
      { $or: [{ referee: userId }, { referees: userId }] },
    ];

    if (bracketId) {
      const bid = toObjectId(bracketId);
      if (!bid) return res.status(400).json({ message: "Invalid bracket id" });
      andClauses.push({ bracket: bid });
    }

    if (status && status !== "all") {
      const s = String(status).trim().toLowerCase();
      if (
        !["scheduled", "queued", "assigned", "live", "finished"].includes(s)
      ) {
        return res.status(400).json({ message: "Invalid status" });
      }
      andClauses.push({
        $expr: {
          $eq: [
            { $trim: { input: { $toLower: { $ifNull: ["$status", ""] } } } },
            s,
          ],
        },
      });
    }

    if (q && String(q).trim()) {
      const rx = new RegExp(escapeRegex(String(q).trim()), "i");
      andClauses.push({
        $or: [{ code: rx }, { labelKey: rx }, { courtLabel: rx }],
      });
    }

    const pipeline = [
      { $match: { $and: andClauses } },

      // Chuẩn hoá & bucket theo status
      {
        $addFields: {
          normalizedStatus: {
            $trim: { input: { $toLower: { $ifNull: ["$status", ""] } } },
          },
        },
      },
      {
        $addFields: {
          _bucketPrio: {
            $switch: {
              branches: [
                { case: { $eq: ["$normalizedStatus", "live"] }, then: 0 },
                { case: { $eq: ["$normalizedStatus", "assigned"] }, then: 1 },
                { case: { $eq: ["$normalizedStatus", "queued"] }, then: 2 },
                { case: { $eq: ["$normalizedStatus", "scheduled"] }, then: 3 },
                { case: { $eq: ["$normalizedStatus", "finished"] }, then: 4 },
              ],
              default: 9,
            },
          },
          _bucketLabel: {
            $switch: {
              branches: [
                { case: { $eq: ["$normalizedStatus", "live"] }, then: "live" },
                {
                  case: { $eq: ["$normalizedStatus", "assigned"] },
                  then: "assigned",
                },
                {
                  case: { $eq: ["$normalizedStatus", "queued"] },
                  then: "queued",
                },
                {
                  case: { $eq: ["$normalizedStatus", "scheduled"] },
                  then: "scheduled",
                },
                {
                  case: { $eq: ["$normalizedStatus", "finished"] },
                  then: "finished",
                },
              ],
              default: "other",
            },
          },
        },
      },

      // Lấy stage/type (và order) để sort theo bracket
      {
        $lookup: {
          from: "brackets",
          localField: "bracket",
          foreignField: "_id",
          // CHANGED: thêm 'order' để sort ổn định giữa các bracket cùng stage
          pipeline: [{ $project: { _id: 1, type: 1, stage: 1, order: 1 } }],
          as: "__br4sort",
        },
      },
      { $unwind: { path: "$__br4sort", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          _brType: "$__br4sort.type",
          _brStageOrder: { $ifNull: ["$__br4sort.stage", 1] },
          _brOrder: { $ifNull: ["$__br4sort.order", 9999] }, // CHANGED: mới thêm
        },
      },

      // === TÍNH groupIndex sớm để SORT đúng theo bảng ===
      {
        $lookup: {
          from: "brackets",
          localField: "bracket",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                _id: 1,
                type: 1,
                stage: 1,
                groups: {
                  $map: {
                    input: { $ifNull: ["$groups", []] },
                    as: "g",
                    in: {
                      _id: "$$g._id",
                      regIds: { $ifNull: ["$$g.regIds", []] },
                    },
                  },
                },
              },
            },
          ],
          as: "__brForGroupIdx",
        },
      },
      {
        $unwind: { path: "$__brForGroupIdx", preserveNullAndEmptyArrays: true },
      },
      {
        $addFields: {
          __groupsWithIdx: {
            $map: {
              input: {
                $range: [
                  0,
                  { $size: { $ifNull: ["$__brForGroupIdx.groups", []] } },
                ],
              },
              as: "i",
              in: {
                idx: "$$i",
                regs: {
                  $ifNull: [
                    {
                      $getField: {
                        field: "regIds",
                        input: {
                          $arrayElemAt: ["$__brForGroupIdx.groups", "$$i"],
                        },
                      },
                    },
                    [],
                  ],
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          __matchedGroup: {
            $first: {
              $filter: {
                input: "$__groupsWithIdx",
                as: "g",
                cond: {
                  $and: [
                    { $in: ["$pairA", "$$g.regs"] },
                    { $in: ["$pairB", "$$g.regs"] },
                  ],
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          groupIndex: {
            $cond: [
              { $ifNull: ["$__matchedGroup", false] },
              { $add: ["$__matchedGroup.idx", 1] },
              null,
            ],
          },
          _orderSafe: { $ifNull: ["$order", 99999] },
          _roundSafe: { $ifNull: ["$round", { $ifNull: ["$rrRound", 99999] }] },
        },
      },

      // Khóa sort theo "mã trận"
      {
        $addFields: {
          // CHANGED: với bracket 'group' => ưu tiên order (trận số) trước, rồi tới groupIndex
          _codeK1: {
            $cond: [
              { $eq: ["$_brType", "group"] },
              "$_orderSafe", // trận 1,2,3,... trước
              "$_roundSafe", // KO/PO giữ nguyên
            ],
          },
          _codeK2: {
            $cond: [
              { $eq: ["$_brType", "group"] },
              { $ifNull: ["$groupIndex", 99999] }, // rồi mới đến bảng 1,2,3,...
              "$_orderSafe", // KO/PO giữ nguyên
            ],
          },
        },
      },

      // SORT: status → stage → bracket.order → (interleave key) → _id
      {
        $sort: {
          _bucketPrio: 1,
          _brStageOrder: 1,
          _brOrder: 1, // CHANGED: ổn định giữa các bracket cùng stage
          _codeK1: 1,
          _codeK2: 1,
          _id: 1,
        },
      },

      // facet + paging
      {
        $facet: {
          meta: [{ $count: "count" }],
          items: [{ $skip: (p - 1) * ps }, { $limit: ps }],
        },
      },
      {
        $addFields: {
          _total: { $ifNull: [{ $arrayElemAt: ["$meta.count", 0] }, 0] },
        },
      },
      { $project: { meta: 0 } },
      { $unwind: { path: "$items", preserveNullAndEmptyArrays: true } },
      {
        $replaceRoot: {
          newRoot: { $mergeObjects: ["$items", { _total: "$_total" }] },
        },
      },

      /* ---------- Lookups (đầy đủ) ---------- */
      {
        $lookup: {
          from: "tournaments",
          localField: "tournament",
          foreignField: "_id",
          pipeline: [{ $project: { _id: 1, name: 1, eventType: 1 } }],
          as: "tournament",
        },
      },
      { $unwind: { path: "$tournament", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "brackets",
          localField: "bracket",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                _id: 1,
                name: 1,
                type: 1,
                stage: 1,
                groups: {
                  $map: {
                    input: { $ifNull: ["$groups", []] },
                    as: "g",
                    in: {
                      _id: "$$g._id",
                      name: "$$g.name",
                      code: "$$g.code",
                      regIds: { $ifNull: ["$$g.regIds", []] },
                    },
                  },
                },
              },
            },
          ],
          as: "bracket",
        },
      },
      { $unwind: { path: "$bracket", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "courts",
          localField: "court",
          foreignField: "_id",
          pipeline: [{ $project: { _id: 1, name: 1, label: "$name" } }],
          as: "court",
        },
      },
      { $unwind: { path: "$court", preserveNullAndEmptyArrays: true } },

      {
        $addFields: {
          _orderDisplay: { $add: [{ $ifNull: ["$order", 0] }, 1] },
        },
      },

      // groupCtx cho bảng
      {
        $addFields: {
          _groupCtx: {
            $cond: [
              {
                $and: [
                  { $eq: ["$bracket.type", "group"] },
                  { $isArray: "$bracket.groups" },
                ],
              },
              {
                $let: {
                  vars: {
                    gs: "$bracket.groups",
                    n: { $size: { $ifNull: ["$bracket.groups", []] } },
                  },
                  in: {
                    $let: {
                      vars: {
                        withIdx: {
                          $map: {
                            input: { $range: [0, "$$n"] },
                            as: "i",
                            in: {
                              idx: "$$i",
                              g: { $arrayElemAt: ["$$gs", "$$i"] },
                            },
                          },
                        },
                      },
                      in: {
                        $let: {
                          vars: {
                            matched: {
                              $filter: {
                                input: "$$withIdx",
                                as: "it",
                                cond: {
                                  $and: [
                                    {
                                      $in: [
                                        "$pairA",
                                        { $ifNull: ["$$it.g.regIds", []] },
                                      ],
                                    },
                                    {
                                      $in: [
                                        "$pairB",
                                        { $ifNull: ["$$it.g.regIds", []] },
                                      ],
                                    },
                                  ],
                                },
                              },
                            },
                          },
                          in: {
                            $let: {
                              vars: {
                                first: { $arrayElemAt: ["$$matched", 0] },
                              },
                              in: {
                                $cond: [
                                  { $gt: [{ $size: "$$matched" }, 0] },
                                  {
                                    idx: "$$first.idx",
                                    key: {
                                      $let: {
                                        vars: { gg: "$$first.g" },
                                        in: {
                                          $ifNull: [
                                            "$$gg.name",
                                            {
                                              $ifNull: [
                                                "$$gg.code",
                                                { $toString: "$$gg._id" },
                                              ],
                                            },
                                          ],
                                        },
                                      },
                                    },
                                  },
                                  null,
                                ],
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              null,
            ],
          },
        },
      },
      {
        $addFields: {
          groupKey: "$_groupCtx.key",
          groupIndex: {
            $cond: [
              { $ifNull: ["$_groupCtx", false] },
              { $add: ["$_groupCtx.idx", 1] },
              null,
            ],
          },
          codeGroup: {
            $cond: [
              { $ifNull: ["$_groupCtx", false] },
              {
                $concat: [
                  "V",
                  { $toString: { $ifNull: ["$bracket.stage", 1] } },
                  "-B",
                  { $toString: { $add: ["$_groupCtx.idx", 1] } },
                  "-T",
                  { $toString: "$_orderDisplay" }, // FE có thể render thành T1/T2 nếu muốn
                ],
              },
              null,
            ],
          },
        },
      },

      // populate Registration A/B
      {
        $lookup: {
          from: "registrations",
          localField: "pairA",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                _id: 1,
                teamName: 1,
                seed: 1,
                "player1.user": 1,
                "player1.name": 1,
                "player1.fullName": 1,
                "player1.nickname": 1,
                "player2.user": 1,
                "player2.name": 1,
                "player2.fullName": 1,
                "player2.nickname": 1,
              },
            },
          ],
          as: "pairAReg",
        },
      },
      { $unwind: { path: "$pairAReg", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "registrations",
          localField: "pairB",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                _id: 1,
                teamName: 1,
                seed: 1,
                "player1.user": 1,
                "player1.name": 1,
                "player1.fullName": 1,
                "player1.nickname": 1,
                "player2.user": 1,
                "player2.name": 1,
                "player2.fullName": 1,
                "player2.nickname": 1,
              },
            },
          ],
          as: "pairBReg",
        },
      },
      { $unwind: { path: "$pairBReg", preserveNullAndEmptyArrays: true } },

      // lookup User để fallback nickname
      {
        $lookup: {
          from: "users",
          let: { uid: "$pairAReg.player1.user" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
            { $project: { _id: 1, nickname: 1 } },
          ],
          as: "_pairA_p1User",
        },
      },
      { $unwind: { path: "$_pairA_p1User", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          let: { uid: "$pairAReg.player2.user" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
            { $project: { _id: 1, nickname: 1 } },
          ],
          as: "_pairA_p2User",
        },
      },
      { $unwind: { path: "$_pairA_p2User", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          let: { uid: "$pairBReg.player1.user" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
            { $project: { _id: 1, nickname: 1 } },
          ],
          as: "_pairB_p1User",
        },
      },
      { $unwind: { path: "$_pairB_p1User", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          let: { uid: "$pairBReg.player2.user" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
            { $project: { _id: 1, nickname: 1 } },
          ],
          as: "_pairB_p2User",
        },
      },
      { $unwind: { path: "$_pairB_p2User", preserveNullAndEmptyArrays: true } },

      // Gom lại
      {
        $group: {
          _id: null,
          items: { $push: "$$ROOT" },
          total: { $first: "$_total" },
        },
      },

      // Project kết quả cơ bản
      {
        $project: {
          _id: 0,
          total: 1,
          items: {
            $map: {
              input: "$items",
              as: "it",
              in: {
                _id: "$$it._id",
                code: "$$it.code",
                codeGroup: "$$it.codeGroup",
                codeResolved: { $ifNull: ["$$it.codeGroup", "$$it.code"] },
                labelKey: "$$it.labelKey",
                status: "$$it.status",
                sortBucket: "$$it._bucketLabel",
                round: "$$it.round",
                rrRound: "$$it.rrRound",
                order: "$$it.order",
                queueOrder: "$$it.queueOrder",
                winner: "$$it.winner",
                court: "$$it.court",
                courtLabel: "$$it.courtLabel",
                startedAt: "$$it.startedAt",
                finishedAt: "$$it.finishedAt",
                updatedAt: "$$it.updatedAt",
                tournament: "$$it.tournament",
                bracket: "$$it.bracket",
                groupKey: "$$it.groupKey",
                groupIndex: "$$it.groupIndex",

                pairA: {
                  _id: "$$it.pairAReg._id",
                  teamName: "$$it.pairAReg.teamName",
                  seed: "$$it.pairAReg.seed",
                  player1: {
                    user: "$$it.pairAReg.player1.user",
                    name: "$$it.pairAReg.player1.name",
                    fullName: "$$it.pairAReg.player1.fullName",
                    nickname: {
                      $ifNull: [
                        "$$it.pairAReg.player1.nickname",
                        "$$it._pairA_p1User.nickname",
                      ],
                    },
                  },
                  player2: {
                    user: "$$it.pairAReg.player2.user",
                    name: "$$it.pairAReg.player2.name",
                    fullName: "$$it.pairAReg.player2.fullName",
                    nickname: {
                      $ifNull: [
                        "$$it.pairAReg.player2.nickname",
                        "$$it._pairA_p2User.nickname",
                      ],
                    },
                  },
                },

                pairB: {
                  _id: "$$it.pairBReg._id",
                  teamName: "$$it.pairBReg.teamName",
                  seed: "$$it.pairBReg.seed",
                  player1: {
                    user: "$$it.pairBReg.player1.user",
                    name: "$$it.pairBReg.player1.name",
                    fullName: "$$it.pairBReg.player1.fullName",
                    nickname: {
                      $ifNull: [
                        "$$it.pairBReg.player1.nickname",
                        "$$it._pairB_p1User.nickname",
                      ],
                    },
                  },
                  player2: {
                    user: "$$it.pairBReg.player2.user",
                    name: "$$it.pairBReg.player2.name",
                    fullName: "$$it.pairBReg.player2.fullName",
                    nickname: {
                      $ifNull: [
                        "$$it.pairBReg.player2.nickname",
                        "$$it._pairB_p2User.nickname",
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    ];

    const result = await Match.aggregate(pipeline).allowDiskUse(true);
    const items = result[0]?.items || [];
    const total = result[0]?.total || 0;

    // =======================
    // TÍNH VÒNG CHUẨN (globalRound/globalCode) CHO KO/PO
    // =======================
    const allBrackets = await Bracket.find({ tournament: tid })
      .select(
        "_id tournament type stage order prefill ko meta config drawRounds"
      )
      .lean();

    const maxRoundByBracket = new Map();
    await Promise.all(
      allBrackets.map(async (b) => {
        const doc = await Match.findOne({ bracket: b._id })
          .sort({ round: -1 })
          .select("round")
          .lean();
        maxRoundByBracket.set(String(b._id), Number(doc?.round) || 0);
      })
    );

    const teamsFromRoundKey = (k) => {
      if (!k) return 0;
      const up = String(k).toUpperCase();
      if (up === "F") return 2;
      if (up === "SF") return 4;
      if (up === "QF") return 8;
      const m = /^R(\d+)$/i.exec(up);
      return m ? parseInt(m[1], 10) : 0;
    };
    const ceilPow2 = (n) =>
      Math.pow(2, Math.ceil(Math.log2(Math.max(1, n || 1))));
    const readBracketScale = (br) => {
      const fromKey =
        teamsFromRoundKey(br?.ko?.startKey) ||
        teamsFromRoundKey(br?.prefill?.roundKey);
      const fromPrefillPairs = Array.isArray(br?.prefill?.pairs)
        ? br.prefill.pairs.length * 2
        : 0;
      const fromPrefillSeeds = Array.isArray(br?.prefill?.seeds)
        ? br.prefill.seeds.length * 2
        : 0;
      const cands = [
        br?.drawScale,
        br?.targetScale,
        br?.maxSlots,
        br?.capacity,
        br?.size,
        br?.scale,
        br?.meta?.drawSize,
        br?.meta?.scale,
        fromKey,
        fromPrefillPairs,
        fromPrefillSeeds,
      ]
        .map(Number)
        .filter((x) => Number.isFinite(x) && x >= 2);
      if (!cands.length) return 0;
      return ceilPow2(Math.max(...cands));
    };

    const roundsCountForBracket = (br) => {
      const type = String(br?.type || "").toLowerCase();
      const bid = String(br?._id || "");
      if (!bid) return 1;

      if (type === "group" || type === "roundrobin") return 1;

      if (type === "roundelim" || type === "po") {
        let k =
          Number(br?.meta?.maxRounds) ||
          Number(br?.config?.roundElim?.maxRounds) ||
          0;
        if (!k) {
          const rFromMatches = maxRoundByBracket.get(bid) || 0;
          k = rFromMatches || 1;
        }
        return Math.max(1, k);
      }

      // knockout / ko
      const rFromMatches = maxRoundByBracket.get(bid) || 0;
      if (rFromMatches) return Math.max(1, rFromMatches);

      const firstPairs =
        (Array.isArray(br?.prefill?.seeds) && br.prefill.seeds.length) ||
        (Array.isArray(br?.prefill?.pairs) && br.prefill.pairs.length) ||
        0;
      if (firstPairs > 0) return Math.ceil(Math.log2(firstPairs * 2));

      const scale = readBracketScale(br);
      if (scale) return Math.ceil(Math.log2(scale));

      const drawRounds = Number(br?.drawRounds || 0);
      if (drawRounds) return Math.max(1, drawRounds);

      return 1;
    };

    // Sắp xếp bracket theo order ↑, stage ↑ rồi cộng dồn
    const sortedBrs = allBrackets.slice().sort((a, b) => {
      const ao = Number.isFinite(a?.order) ? a.order : 9999;
      const bo = Number.isFinite(b?.order) ? b.order : 9999;
      if (ao !== bo) return ao - bo;
      const as = Number.isFinite(a?.stage) ? a.stage : 9999;
      const bs = Number.isFinite(b?.stage) ? b.stage : 9999;
      if (as !== bs) return as - bs;
      return String(a._id).localeCompare(String(b._id));
    });

    const offsetByBracket = new Map();
    let acc = 0;
    for (const b of sortedBrs) {
      offsetByBracket.set(String(b._id), acc);
      acc += roundsCountForBracket(b);
    }

    // Map kết quả: group giữ nguyên codeGroup; KO/PO dùng global V…
    const mapped = items.map((it) => {
      const br = it.bracket || {};
      const bid = String(br?._id || "");
      const t = String(br?.type || "").toLowerCase();

      if (t === "group" || t === "roundrobin") {
        const base = (offsetByBracket.get(bid) || 0) + 1;
        return {
          ...it,
          globalRound: base,
          globalCode: null,
          codeResolved: it.codeGroup || it.code || null,
          code: it.codeGroup || it.code || null,
        };
      }

      const base = offsetByBracket.get(bid) || 0;
      const local = Number.isFinite(Number(it?.round)) ? Number(it.round) : 1;
      const globalRound = base + local;
      const tIdx = Number.isFinite(Number(it?.order))
        ? Number(it.order) + 1
        : null;
      const globalCode = `V${globalRound}${tIdx ? `-T${tIdx}` : ""}`;

      return {
        ...it,
        globalRound,
        globalCode,
        codeResolved: globalCode,
        code: globalCode,
      };
    });

    res.json({
      items: mapped,
      total,
      page: p,
      pageSize: ps,
      totalPages: Math.max(1, Math.ceil(total / ps)),
    });
  } catch (err) {
    next(err);
  }
}

// -------------------------------------------------------------------------------------------------------------------------

const isTrue = (v, d = false) => {
  if (v == null) return d;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
};

const COURT_BLOCKED = new Set(["maintenance"]);
const COURT_BUSY = new Set(["assigned", "live"]);

/** Map trạng thái court theo trạng thái match */
const courtStatusFor = (matchStatus) =>
  matchStatus === "live" ? "live" : "assigned";

/** Đảm bảo court & match cùng tournament + bracket */
function assertSameTB(matchDoc, courtDoc) {
  if (!matchDoc || !courtDoc) return false;
  const tOk = String(matchDoc.tournament) === String(courtDoc.tournament);
  const bOk = String(matchDoc.bracket) === String(courtDoc.bracket);
  return tOk && bOk;
}

/* ===================== LISTING ===================== */

/**
 * GET /referee/tournaments/:tId/brackets/:bId/courts
 * Query:
 *  - cluster   (optional)
 *  - status    (optional: idle|assigned|live|maintenance)
 *  - active    (optional, default true)
 */
export async function listCourtsByTournamentBracket(req, res, next) {
  try {
    const { tId, bId } = req.params;
    const { cluster, status, active = "1" } = req.query;

    const q = { tournament: tId, bracket: bId };
    if (isTrue(active, true)) q.isActive = true;
    if (cluster) q.cluster = cluster;
    if (status) q.status = status;

    const items = await Court.find(q).sort({ order: 1, name: 1 }).lean();

    res.json({ items });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /referee/matches/:matchId/courts
 * Liệt kê court *cùng tournament + bracket* của match.
 * Query:
 *  - includeBusy=0/1 (mặc định 0 → chỉ trả court idle)
 *  - cluster         (optional)
 *  - status          (optional; nếu truyền thì override includeBusy)
 */
export async function listCourtsForMatch(req, res, next) {
  try {
    const { matchId } = req.params;
    const { includeBusy = "0", cluster, status } = req.query;

    const m = await Match.findById(matchId).select("tournament bracket").lean();
    if (!m) return res.status(404).json({ message: "Không tìm thấy trận" });

    const q = {
      tournament: m.tournament,
      bracket: m.bracket,
      isActive: true,
    };
    if (cluster) q.cluster = cluster;

    const wantAvailable =
      String(status || "").toLowerCase() === "available" ||
      (!status && !isTrue(includeBusy, false));

    // Trường hợp cần "available": idle hoặc currentMatch đã finished (hay null)
    if (wantAvailable) {
      const items = await Court.aggregate([
        { $match: q },
        {
          $lookup: {
            from: "matches",
            localField: "currentMatch",
            foreignField: "_id",
            as: "cm",
            pipeline: [{ $project: { status: 1 } }],
          },
        },
        {
          $addFields: {
            currentMatchStatus: {
              $ifNull: [{ $arrayElemAt: ["$cm.status", 0] }, null],
            },
          },
        },
        {
          $match: {
            $or: [
              { status: "idle" },
              { currentMatch: null },
              { currentMatchStatus: "finished" },
            ],
          },
        },
        { $project: { cm: 0 } },
        { $sort: { order: 1, name: 1 } },
      ]);

      return res.json({ items });
    }

    // Các trường hợp khác: lọc theo status cụ thể hoặc includeBusy=true (không lọc bận)
    if (status && String(status).toLowerCase() !== "available") {
      q.status = status; // "idle" | "assigned" | "live" | "maintenance"
    }
    const items = await Court.find(q).sort({ order: 1, name: 1 }).lean();
    res.json({ items });
  } catch (e) {
    next(e);
  }
}

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

/* ===================== ASSIGN / UNASSIGN ===================== */

/**
 * POST /referee/matches/:matchId/assign-court
 * body: { courtId: string, force?: boolean, allowReassignLive?: boolean }
 *
 * Luồng:
 * - Kiểm tra court & match cùng tournament + bracket
 * - Chặn court maintenance (trừ khi force)
 * - Nếu court đang bận (assigned/live) và khác match này → 409 (trừ khi force)
 * - Nếu match đang ở court khác → trả court cũ về idle (an toàn theo session)
 * - Set match.court = courtId, courtLabel/cluster/assignedAt, update status:
 *     + nếu match.finished → không cho gán (400)
 *     + nếu match.live → cho gán khi allowReassignLive (hoặc force)
 *     + còn lại → đặt match.status = "assigned"
 * - Set court.currentMatch = matchId và court.status = assigned/live tương ứng
 */
export async function assignCourtToMatch(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();

  const io = req.app?.get?.("io"); // socket.io instance

  const emitMatchSnapshot = async (matchId) => {
    if (!io) return;
    try {
      const mFull = await populateMatchForEmit(matchId);
      if (!mFull) return;
      const dto = toDTO(decorateServeAndSlots(mFull));
      io.to(`match:${String(mFull._id)}`).emit("match:snapshot", dto);
      // io.to(`match:${String(mFull._id)}`).emit("match:update", dto);
    } catch (e) {
      console.error("[emit] match snapshot error:", e?.message);
    }
  };

  try {
    const { matchId } = req.params;
    const {
      courtId, // null/undefined => UNASSIGN
      force = false,
      allowReassignLive = false,
    } = req.body || {};

    if (!mongoose.isValidObjectId(matchId)) {
      return res.status(400).json({ message: "matchId không hợp lệ" });
    }

    // ===== Load match =====
    const m = await Match.findById(matchId).session(session);
    if (!m) return res.status(404).json({ message: "Không tìm thấy trận" });

    /* =========================
     * UNASSIGN (courtId null)
     * ========================= */
    if (!courtId) {
      if (m.status === "live" && !(allowReassignLive || force)) {
        return res.status(409).json({
          message: "Trận đang live, không thể bỏ gán sân",
        });
      }

      let oldClusterKey = "Main";
      // Trả sân cũ nếu đang cột với match
      if (m.court) {
        const old = await Court.findById(m.court).session(session);
        if (old) {
          oldClusterKey = old.cluster || "Main";
          if (String(old.currentMatch) === String(m._id)) {
            old.currentMatch = null;
            old.status = "idle";
            await old.save({ session });
          }
        }
      }

      // Cập nhật match
      m.court = null;
      m.courtLabel = "";
      m.courtCluster = "Main";
      m.assignedAt = null;
      if (m.status !== "live" && m.status !== "finished") {
        m.status = "queued"; // hoặc "scheduled" tùy workflow
      }
      await m.save({ session });

      await session.commitTransaction();
      session.endSession();

      // Socket emit
      await emitMatchSnapshot(m._id);
      if (io) {
        await broadcastState(io, String(m.tournament), {
          bracket: m.bracket,
          cluster: oldClusterKey,
        });
      }

      const matchFresh = await Match.findById(m._id)
        .populate("court", "name cluster status")
        .lean();
      return res.json({ ok: true, match: matchFresh, court: null });
    }

    /* =========================
     * ASSIGN (courtId provided)
     * ========================= */
    if (!mongoose.isValidObjectId(courtId)) {
      return res.status(400).json({ message: "courtId không hợp lệ" });
    }

    const c = await Court.findById(courtId).session(session);
    if (!c) return res.status(404).json({ message: "Không tìm thấy sân" });

    if (!assertSameTB(m, c)) {
      return res.status(400).json({
        message: "Court không thuộc cùng tournament/bracket với trận",
      });
    }

    if (m.status === "finished") {
      return res
        .status(400)
        .json({ message: "Trận đã kết thúc, không thể gán sân" });
    }

    if (COURT_BLOCKED.has(c.status) && !force) {
      return res
        .status(409)
        .json({ message: "Sân đang bảo trì/không sẵn sàng" });
    }

    if (m.status === "live" && !(allowReassignLive || force)) {
      return res.status(409).json({
        message: "Trận đang live, không thể đổi sân",
      });
    }

    // Xử lý sân đang bận
    // - Nếu currentMatch đã finished => dọn sân
    // - Nếu chưa finished:
    //     + !force => 409
    //     + force  => đẩy trận đang chiếm sân về queued (sẽ emit sau commit)
    let replacedMatchId = null;
    if (
      c.currentMatch &&
      String(c.currentMatch) !== String(m._id) &&
      COURT_BUSY.has(c.status)
    ) {
      const cm = await Match.findById(c.currentMatch).session(session);
      if (cm && cm.status === "finished") {
        c.currentMatch = null;
        c.status = "idle";
        await c.save({ session });
      } else if (cm && cm.status !== "finished") {
        if (!force) {
          return res.status(409).json({
            message: "Sân đang bận với trận khác",
            currentMatch: c.currentMatch,
          });
        }
        // replace: đẩy trận đang chiếm sân về queued & clear court
        cm.status = "queued";
        cm.set("court", undefined, { strict: false });
        cm.set("courtLabel", undefined, { strict: false });
        cm.set("courtCluster", undefined, { strict: false });
        cm.set("assignedAt", undefined, { strict: false });
        await cm.save({ session });
        replacedMatchId = String(cm._id);
      }
    }

    // Nếu đang chuyển từ sân khác → trả sân cũ
    let prevClusterKey = null;
    if (m.court && String(m.court) !== String(c._id)) {
      const old = await Court.findById(m.court).session(session);
      if (old) {
        prevClusterKey = old.cluster || "Main";
        if (String(old.currentMatch) === String(m._id)) {
          old.currentMatch = null;
          old.status = "idle";
          await old.save({ session });
        }
      }
    }

    // Cập nhật match
    const courtLabelGuess =
      c.name ||
      c.label ||
      (Number.isInteger(c.order) ? `Sân ${c.order}` : "Sân");
    m.court = c._id;
    m.courtLabel = courtLabelGuess;
    m.courtCluster = c.cluster || "Main";
    m.assignedAt = new Date();
    if (m.status !== "live") m.status = "assigned";
    await m.save({ session });

    // Cập nhật court
    c.currentMatch = m._id;
    c.status = courtStatusFor(m.status); // "assigned" | "live" ...
    await c.save({ session });

    await session.commitTransaction();
    session.endSession();

    // ===== SOCKET EMIT =====
    await emitMatchSnapshot(m._id); // match mới gán sân
    if (replacedMatchId) {
      await emitMatchSnapshot(replacedMatchId); // match bị đẩy khỏi sân (force)
    }
    if (io) {
      // broadcast cluster mới
      await broadcastState(io, String(m.tournament), {
        bracket: m.bracket,
        cluster: c.cluster || "Main",
      });
      // broadcast cluster cũ (nếu có) để dọn UI
      if (prevClusterKey && prevClusterKey !== (c.cluster || "Main")) {
        await broadcastState(io, String(m.tournament), {
          bracket: m.bracket,
          cluster: prevClusterKey,
        });
      }
    }

    const [matchFresh, courtFresh] = await Promise.all([
      Match.findById(m._id).populate("court", "name cluster status").lean(),
      Court.findById(c._id).lean(),
    ]);

    return res.json({ ok: true, match: matchFresh, court: courtFresh });
  } catch (e) {
    try {
      await session.abortTransaction();
    } catch {}
    next(e);
  } finally {
    session.endSession();
  }
}

/**
 * POST /referee/matches/:matchId/unassign-court
 * body: { toStatus?: "queued"|"scheduled" } // mặc định "queued" nếu đang assigned
 *
 * - Xoá link 2 chiều: match.court=null, court.currentMatch=null
 * - court.status → idle
 * - match.status:
 *     + nếu match.live → 409 (không cho unassign khi đang live)
 *     + nếu match.assigned → chuyển về toStatus (mặc định queued)
 */
// Controller: bỏ gán sân + emit socket realtime

export async function unassignCourtFromMatch(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();

  const io = req.app?.get?.("io"); // socket.io instance

  // helper emit snapshot cho 1 match
  const emitMatchSnapshot = async (matchId) => {
    if (!io) return;
    try {
      const mFull = await populateMatchForEmit(matchId);
      if (!mFull) return;
      const dto = toDTO(decorateServeAndSlots(mFull));
      io.to(`match:${String(mFull._id)}`).emit("match:snapshot", dto);
      io.to(`match:${String(mFull._id)}`).emit("match:update", dto);
    } catch (e) {
      console.error("[emit] match snapshot error:", e?.message);
    }
  };

  try {
    const { matchId } = req.params;
    const { toStatus } = req.body || {};

    if (!mongoose.isValidObjectId(matchId)) {
      return res.status(400).json({ message: "matchId không hợp lệ" });
    }

    const m = await Match.findById(matchId).session(session);
    if (!m) return res.status(404).json({ message: "Không tìm thấy trận" });

    if (m.status === "live") {
      return res
        .status(409)
        .json({ message: "Trận đang live, không thể bỏ gán sân" });
    }
    if (m.status === "finished") {
      return res.status(409).json({ message: "Trận đã kết thúc" });
    }

    let courtFresh = null;
    let oldClusterKey = "Main";

    if (m.court) {
      const c = await Court.findById(m.court).session(session);
      if (c) {
        oldClusterKey = c.cluster || "Main";
        if (String(c.currentMatch) === String(m._id)) {
          c.currentMatch = null;
          c.status = "idle";
          await c.save({ session });
          courtFresh = c.toObject();
        }
      }
    }

    // clear court on match
    m.court = null;
    m.courtLabel = "";
    m.courtCluster = "Main";
    // chỉ đưa về queued/scheduled nếu đang assigned
    if (m.status === "assigned") {
      m.status = ["queued", "scheduled"].includes(toStatus)
        ? toStatus
        : "queued";
    }
    await m.save({ session });

    await session.commitTransaction();
    session.endSession();

    // ===== SOCKET EMIT =====
    await emitMatchSnapshot(m._id);
    if (io) {
      await broadcastState(io, String(m.tournament), {
        bracket: m.bracket,
        cluster: oldClusterKey, // cụm vừa giải phóng sân
      });
    }

    const matchFresh = await Match.findById(m._id).lean();
    return res.json({ ok: true, match: matchFresh, court: courtFresh });
  } catch (e) {
    try {
      await session.abortTransaction();
    } catch {}
    next(e);
  } finally {
    session.endSession();
  }
}

/* ============== Court maintenance / status ============== */

/**
 * PATCH /referee/courts/:courtId/status
 * body: { status: "idle"|"assigned"|"live"|"maintenance" }
 * Lưu ý: không cho chuyển sang assigned/live nếu không có currentMatch.
 */
export async function patchCourtStatus(req, res, next) {
  try {
    const { courtId } = req.params;
    const { status } = req.body || {};
    if (!mongoose.isValidObjectId(courtId)) {
      return res.status(400).json({ message: "courtId không hợp lệ" });
    }
    if (!["idle", "assigned", "live", "maintenance"].includes(status)) {
      return res.status(400).json({ message: "status không hợp lệ" });
    }

    const c = await Court.findById(courtId);
    if (!c) return res.status(404).json({ message: "Không tìm thấy sân" });

    if ((status === "assigned" || status === "live") && !c.currentMatch) {
      return res.status(409).json({
        message: "Không thể đặt sân sang trạng thái bận khi không có trận",
      });
    }

    c.status = status;
    await c.save();

    res.json({ ok: true, court: c.toObject() });
  } catch (e) {
    next(e);
  }
}

export const refereeSetBreak = async (req, res) => {
  try {
    const { id } = req.params; // matchId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid match id" });
    }

    const { active, note, afterGame, expectedResumeAt } = req.body || {};

    // build object chuẩn
    const nextBreak = active
      ? {
          active: true,
          note: note || "",
          afterGame: typeof afterGame === "number" ? afterGame : null,
          startedAt: new Date(),
          expectedResumeAt: expectedResumeAt
            ? new Date(expectedResumeAt)
            : null,
        }
      : {
          active: false,
          note: note || "",
          afterGame: typeof afterGame === "number" ? afterGame : null,
          startedAt: null,
          expectedResumeAt: null,
        };

    // 🔹 check header để quyết định dùng UserMatch hay Match
    const matchKind =
      req.header("x-pkt-match-kind") || req.headers["x-pkt-match-kind"];

    if (matchKind) {
      // ========== NHÁNH USER MATCH ==========
      const m = await UserMatch.findByIdAndUpdate(
        id,
        {
          $set: {
            // luôn overwrite nguyên object
            isBreak: nextBreak,
          },
        },
        { new: true }
      ).lean();

      if (!m) {
        return res.status(404).json({ message: "UserMatch not found" });
      }

      return res.json({
        ok: true,
        isBreak: nextBreak,
        type: "userMatch",
      });
    }

    // ========== NHÁNH MATCH BÌNH THƯỜNG (LOGIC CŨ) ==========
    const m = await Match.findByIdAndUpdate(
      id,
      {
        $set: {
          // 🔒 luôn overwrite nguyên object
          isBreak: nextBreak,
        },
      },
      { new: true }
    ).lean();

    if (!m) {
      return res.status(404).json({ message: "Match not found" });
    }

    return res.json({
      ok: true,
      isBreak: nextBreak,
    });
  } catch (err) {
    console.error("refereeSetBreak error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
