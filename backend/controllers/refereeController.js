// controllers/refereeController.js
import asyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";
import Bracket from "../models/bracketModel.js";
import {
  addPoint, /* optional: nextGame helper nếu bạn tách riêng */
  toDTO,
} from "../socket/liveHandlers.js";
import mongoose from "mongoose";

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

export const patchScore = asyncHandler(async (req, res) => {
  const winsCount = (gs = [], rules = { pointsToWin: 11, winByTwo: true }) => {
    let aWins = 0,
      bWins = 0;
    for (const g of gs) {
      if (gameWon(g?.a ?? 0, g?.b ?? 0, rules.pointsToWin, rules.winByTwo))
        aWins++;
      if (gameWon(g?.b ?? 0, g?.a ?? 0, rules.pointsToWin, rules.winByTwo))
        bWins++;
    }
    return { aWins, bWins };
  };
  const { id } = req.params;
  const { op } = req.body || {};
  const io = req.app.get("io");

  const match = await Match.findById(id);
  if (!match) return res.status(404).json({ message: "Match not found" });

  // bảo vệ rules mặc định
  const rules = {
    bestOf: Number(match.rules?.bestOf ?? 3),
    pointsToWin: Number(match.rules?.pointsToWin ?? 11),
    winByTwo: Boolean(match.rules?.winByTwo ?? true),
  };

  // ===== 1) TĂNG/GIẢM ĐIỂM -> delegate ra liveHandlers để dùng chung luật + serve =====
  if (op === "inc") {
    const { side, delta } = req.body;
    const d = Number(delta);
    if (!["A", "B"].includes(side))
      return res.status(400).json({ message: "Invalid side" });
    if (!Number.isFinite(d) || d === 0)
      return res.status(400).json({ message: "Invalid delta" });

    // Dùng service chung để: cập nhật điểm, xét kết thúc ván/trận, xoay giao bóng (nếu bạn đã thêm).
    await addPoint(id, side, d, req.user?._id, io);

    // Trả snapshot mới nhất
    const fresh = await Match.findById(id).lean();
    io?.to(`match:${id}`).emit("score:updated", { matchId: id }); // đúng room
    return res.json({
      message: "Score updated",
      gameScores: fresh?.gameScores ?? [],
      status: fresh?.status, // NEW
      winner: fresh?.winner, // NEW
      ratingApplied: fresh?.ratingApplied, // NEW
    });
  }

  // ===== 2) SET GAME TẠI CHỈ SỐ CỤ THỂ =====
  if (op === "setGame") {
    let { gameIndex, a = 0, b = 0 } = req.body;
    if (!Number.isInteger(gameIndex) || gameIndex < 0) {
      return res.status(400).json({ message: "Invalid gameIndex" });
    }
    if (!Array.isArray(match.gameScores)) match.gameScores = [];

    // chèn/ghi đè
    if (gameIndex > match.gameScores.length) {
      return res.status(400).json({ message: "gameIndex out of range" });
    }
    const nextScore = { a: Number(a) || 0, b: Number(b) || 0 };
    if (gameIndex === match.gameScores.length) match.gameScores.push(nextScore);
    else match.gameScores[gameIndex] = nextScore;

    // cập nhật currentGame = gameIndex
    match.currentGame = gameIndex;

    await match.save();
    io?.to(`match:${id}`).emit("score:updated", { matchId: id });
    return res.json({
      message: "Game set",
      gameScores: match.gameScores,
      currentGame: match.currentGame,
    });
  }

  // ===== 3) MỞ VÁN MỚI (sau khi ván hiện tại đã kết thúc & trận chưa đủ set thắng) =====
  if (op === "nextGame") {
    if (!Array.isArray(match.gameScores) || match.gameScores.length === 0) {
      return res
        .status(400)
        .json({ message: "Chưa có ván hiện tại để kiểm tra" });
    }
    const last = match.gameScores[match.gameScores.length - 1];
    if (
      !gameWon(last?.a ?? 0, last?.b ?? 0, rules.pointsToWin, rules.winByTwo)
    ) {
      return res
        .status(400)
        .json({ message: "Ván hiện tại chưa đủ điều kiện kết thúc" });
    }

    const { aWins, bWins } = winsCount(match.gameScores, rules);
    const need = Math.floor(rules.bestOf / 2) + 1;
    if (aWins >= need || bWins >= need) {
      return res
        .status(400)
        .json({ message: "Trận đã đủ số ván thắng. Không thể tạo ván mới" });
    }

    // thêm ván mới + cập nhật currentGame
    match.gameScores.push({ a: 0, b: 0 });
    match.currentGame = match.gameScores.length - 1;

    // reset giao bóng đầu ván theo luật truyền thống: 0-0-2
    match.serving = match.serving || { team: "A", server: 2 }; // tuỳ bạn có field này chưa
    match.serving.team = match.serving.team || "A";
    match.serving.server = 2;

    // log (nếu dùng liveLog)
    match.liveLog = match.liveLog || [];
    match.liveLog.push({
      type: "serve",
      by: req.user?._id || null,
      payload: { team: match.serving.team, server: 2 },
      at: new Date(),
    });

    await match.save();
    io?.to(`match:${id}`).emit("score:updated", { matchId: id });
    return res.json({
      message: "Đã tạo ván tiếp theo",
      gameScores: match.gameScores,
      currentGame: match.currentGame,
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

  match.status = status;
  await match.save();

  const io = req.app.get("io");
  io?.to(String(match._id)).emit("status:updated", {
    matchId: match._id,
    status,
  });
  if(match._id) {
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

    if (m) io?.to(`match:${String(match._id)}`).emit("match:snapshot", toDTO(m));
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

  return res.json({ message: "Winner updated", winner: match.winner });
});


// ===== helpers =====
const toObjectId = (id) => {
  try { return new mongoose.Types.ObjectId(id); } catch { return null; }
};

const escapeRegex = (s = "") =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // an toàn cho $regex

// Định nghĩa tập trạng thái "đang chờ/đang diễn ra" để tính pendingCount
const PENDING_STATES = ["queued", "assigned", "live"];

/**
 * 1) GET /referee/tournaments
 * Trả về danh sách giải mà trọng tài (req.user._id) có trận,
 * kèm pendingCount (số trận ở trạng thái queued/assigned/live).
 */
export async function listRefereeTournaments(req, res, next) {
  console.log(123)
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

    const {
      status,
      bracketId,
      q,
      page = 1,
      pageSize = 10,
    } = req.query;

    // Build filter
    const filter = {
      tournament: tid,
      $or: [{ referees: userId }, { referee: userId }], // tùy model của bạn
    };

    if (status && status !== "all") filter.status = status;
    if (bracketId) {
      const bid = toObjectId(bracketId);
      if (!bid) return res.status(400).json({ message: "Invalid bracket id" });
      filter.bracket = bid;
    }

    if (q && String(q).trim()) {
      const rx = new RegExp(escapeRegex(String(q).trim()), "i");
      // Tối ưu: đảm bảo bạn có field 'code' trên Match (pre-save) & index text cho tên
      filter.$or = [
        { code: rx }, // gợi ý nên có index
        { "pairA.player1.nickname": rx },
        { "pairA.player2.nickname": rx },
        { "pairA.player1.fullName": rx },
        { "pairA.player2.fullName": rx },
        { "pairA.player1.name": rx },
        { "pairA.player2.name": rx },
        { "pairB.player1.nickname": rx },
        { "pairB.player2.nickname": rx },
        { "pairB.player1.fullName": rx },
        { "pairB.player2.fullName": rx },
        { "pairB.player1.name": rx },
        { "pairB.player2.name": rx },
      ];
    }

    // Pagination
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 10));

    const total = await Match.countDocuments(filter);

    // Sắp xếp: ưu tiên status (alphabet không ý nghĩa lắm),
    // bạn có thể thêm trường 'statusWeight' trong DB. Ở đây giữ ổn định theo round/order.
    const items = await Match.find(filter)
      .sort({ status: 1, round: 1, order: 1, _id: 1 })
      .skip((p - 1) * ps)
      .limit(ps)
      .populate([
        { path: "tournament", select: "_id name eventType" },
        { path: "bracket", select: "_id name type stage" },
        { path: "court", select: "_id name" },
      ])
      .lean();

    return res.json({
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