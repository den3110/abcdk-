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
      .populate({ path: "tournament", select: "name eventType" })
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

// ===== Helpers for broadcast with nickname fallback =====
async function loadMatchWithNickForEmit(matchId) {
  const m = await Match.findById(matchId)
    .populate({
      path: "pairA",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          select: "nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
        {
          path: "player2",
          select: "nickname nickName user",
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
          select: "nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
        {
          path: "player2",
          select: "nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
      ],
    })
    .populate({ path: "referee", select: "name fullName nickname nickName" })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({ path: "nextMatch", select: "_id" })
    // tuỳ ý giữ/loại các populate dưới nếu muốn payload gọn hơn
    .populate({ path: "tournament", select: "name image eventType overlay" })
    .populate({ path: "bracket", select: "type name order overlay" })
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
    // nếu muốn gọn payload:
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

  if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

  return m;
}

async function broadcastScoreUpdated(io, matchId) {
  const snap = await loadMatchWithNickForEmit(matchId);
  if (snap) io?.to(`match:${matchId}`)?.emit("score:updated", toDTO(snap));
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

  // ============== Controller main ==============
  const io = req.app.get("io");
  const { id } = req.params;
  const { op } = req.body || {};
  const autoNext = req.body?.autoNext === true; // ✅ chuẩn hoá: chỉ true mới tính là bật

  const match = await Match.findById(id);
  if (!match) return res.status(404).json({ message: "Match not found" });

  // snapshot rule ban đầu (phòng rule đổi trong lúc live)
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
    io?.to(`match:${id}`).emit("score:updated", { matchId: id });
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
        io?.to(`match:${id}`).emit("score:updated", { matchId: id });
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
        io?.to(`match:${id}`).emit("score:updated", { matchId: id });
        return res.json({
          message: "Trận đã đủ số ván thắng, đã kết thúc",
          gameScores: match.gameScores,
          currentGame: match.currentGame,
          status: match.status,
          winner: match.winner,
        });
      } else {
        // không tick → không tự kết thúc trận
        io?.to(`match:${id}`).emit("score:updated", { matchId: id });
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
      io?.to(`match:${id}`).emit("score:updated", { matchId: id });
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
    io?.to(`match:${id}`).emit("score:updated", { matchId: id });
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

  const match = await Match.findById(id);
  if (!match) return res.status(404).json({ message: "Match not found" });

  const prevStatus = match.status;
  match.status = status;

  // ★ NEW: nếu chuyển sang live lần đầu → đóng dấu thời gian bắt đầu
  if (status === "live" && prevStatus !== "live") {
    if (!match.startedAt) match.startedAt = new Date();
    if (req.user?._id) match.liveBy = req.user._id; // optional: lưu ai bật live
  }

  await match.save();

  const io = req.app.get("io");
  io?.to(String(match._id)).emit("status:updated", {
    matchId: match._id,
    status,
  });

  if (match._id) {
    const m = await Match.findById(match._id)
      .populate({ path: "pairA", select: "player1 player2" })
      .populate({ path: "pairB", select: "player1 player2" })
      .populate({ path: "referee", select: "name fullName nickname" })
      .populate({ path: "previousA", select: "round order" })
      .populate({ path: "previousB", select: "round order" })
      .populate({ path: "nextMatch", select: "_id" })
      .populate({
        path: "tournament",
        select: "name image eventType overlay",
      })
      .populate({ path: "bracket", select: "type name order overlay" })
      .lean();

    if (m)
      io?.to(`match:${String(match._id)}`).emit("match:snapshot", toDTO(m));
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
  const match = await Match.findById(id);
  if (!match) return res.status(404).json({ message: "Match not found" });

  match.winner = winner;
  await match.save();

  const io = req.app.get("io");
  io?.to(String(match._id)).emit("winner:updated", {
    matchId: match._id,
    winner,
  });
  // phát “match:patched” cho các client đang lắng nghe tổng quát
  io?.to(String(match._id)).emit("match:patched", { matchId: match._id });
  try {
    await applyRatingForFinishedMatch(match._id);
  } catch (error) {
    console.error("[adminUpdateMatch] applyRatingForFinishedMatch error:", e);
  }
  return res.json({ message: "Winner updated", winner: match.winner });
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
                { case: { $eq: ["$normalizedStatus", "scheduled"] }, then: 1 },
                { case: { $eq: ["$normalizedStatus", "assigned"] }, then: 2 },
                { case: { $eq: ["$normalizedStatus", "queued"] }, then: 3 },
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
                  case: { $eq: ["$normalizedStatus", "scheduled"] },
                  then: "scheduled",
                },
                {
                  case: { $eq: ["$normalizedStatus", "assigned"] },
                  then: "assigned",
                },
                {
                  case: { $eq: ["$normalizedStatus", "queued"] },
                  then: "queued",
                },
                {
                  case: { $eq: ["$normalizedStatus", "finished"] },
                  then: "finished",
                },
              ],
              default: "other",
            },
          },
          _updatedAtSafe: { $ifNull: ["$updatedAt", "$createdAt"] },
          _finishedAtSafe: { $ifNull: ["$finishedAt", new Date(0)] },
          _queueOrderSafe: {
            $cond: [{ $ifNull: ["$queueOrder", false] }, "$queueOrder", 999999],
          },
        },
      },
      {
        $addFields: {
          _updatedAtLong: { $toLong: "$_updatedAtSafe" },
          _finishedAtLong: { $toLong: "$_finishedAtSafe" },
          _k1: {
            $switch: {
              branches: [
                {
                  case: { $eq: ["$_bucketPrio", 0] },
                  then: { $multiply: ["$_updatedAtLong", -1] },
                }, // LIVE: mới cập nhật lên trước
                {
                  case: { $in: ["$_bucketPrio", [1, 2]] },
                  then: { $ifNull: ["$round", 99999] },
                }, // scheduled/assigned: theo round
                {
                  case: { $eq: ["$_bucketPrio", 3] },
                  then: "$_queueOrderSafe",
                }, // queued: theo queueOrder
                {
                  case: { $eq: ["$_bucketPrio", 4] },
                  then: { $multiply: ["$_finishedAtLong", -1] },
                }, // finished: mới xong lên trước
              ],
              default: 0,
            },
          },
          _k2: {
            $switch: {
              branches: [
                {
                  case: { $in: ["$_bucketPrio", [1, 2]] },
                  then: { $ifNull: ["$order", 99999] },
                },
                { case: { $in: ["$_bucketPrio", [0, 3, 4]] }, then: 0 },
              ],
              default: 0,
            },
          },
        },
      },

      // <<< NEW for bracket-order sorting (nhẹ, chỉ để sắp xếp theo vòng) >>>
      {
        $lookup: {
          from: "brackets",
          localField: "bracket",
          foreignField: "_id",
          pipeline: [{ $project: { _id: 1, type: 1, stage: 1 } }],
          as: "__br4sort",
        },
      },
      { $unwind: { path: "$__br4sort", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          _brTypePrio: {
            $switch: {
              branches: [
                { case: { $eq: ["$__br4sort.type", "group"] }, then: 1 },
                { case: { $eq: ["$__br4sort.type", "po"] }, then: 2 }, // PO trước KO
                { case: { $eq: ["$__br4sort.type", "ko"] }, then: 3 },
                { case: { $eq: ["$__br4sort.type", "double"] }, then: 4 },
              ],
              default: 99,
            },
          },
          _brStageOrder: { $ifNull: ["$__br4sort.stage", "$_brTypePrio"] },
        },
      },
      // <<< END NEW >>>

      // SẮP XẾP: Ưu tiên theo BRACKET (vòng trước → vòng sau), rồi mới theo bucket/status như cũ
      { $sort: { _brStageOrder: 1, _bucketPrio: 1, _k1: 1, _k2: 1, _id: 1 } },

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

      // groupCtx cho bảng (như cũ)
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
                  "#V",
                  { $toString: { $ifNull: ["$bracket.stage", 1] } },
                  "-B",
                  { $toString: { $add: ["$_groupCtx.idx", 1] } },
                  "#",
                  { $toString: "$_orderDisplay" },
                ],
              },
              null,
            ],
          },
        },
      },

      // populate Registration A/B (lấy các field player)
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

      /* === NEW: lookup User để fallback nickname (giữ nguyên) === */
      // A.p1
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
      // A.p2
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
      // B.p1
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
      // B.p2
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

      // Project kết quả (loại bỏ các field nội bộ)
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

    res.json({
      items,
      total,
      page: p,
      pageSize: ps,
      totalPages: Math.max(1, Math.ceil(total / ps)),
    });
  } catch (err) {
    next(err);
  }
}
