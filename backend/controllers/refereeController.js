// controllers/refereeController.js
import asyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";
import {
  addPoint /* optional: nextGame helper nếu bạn tách riêng */,
} from "../socket/liveHandlers.js";

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
// GET /api/matches/assigned?page=1&pageSize=10
export const getAssignedMatches = asyncHandler(async (req, res) => {
  const me = req.user?._id;

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(
    Math.max(parseInt(req.query.pageSize) || 10, 1),
    50
  );
  const skip = (page - 1) * pageSize;

  // 1) Lấy danh sách _id đã sort theo custom status + stage/round/order/createdAt
  const agg = await Match.aggregate([
    { $match: { referee: me } },
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
    },
  ]);

  const ids = (agg?.[0]?.pageIds || []).map((d) => d._id);
  const total = agg?.[0]?.total?.[0]?.count || 0;

  // 2) Lấy đầy đủ document theo ids và populate như cũ
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
      .lean();
    // giữ đúng thứ tự theo ids
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
