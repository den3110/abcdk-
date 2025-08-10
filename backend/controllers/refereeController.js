// controllers/refereeController.js
import asyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";

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
export const getAssignedMatches = asyncHandler(async (req, res) => {
  const me = req.user?._id;
  const list = await Match.find({ referee: me })
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
    .sort({ "bracket.stage": 1, round: 1, order: 1, createdAt: 1 });

  res.json(list);
});

/*
  PATCH /api/referee/matches/:id/score
  body:
    - op: "inc" | "setGame" | "nextGame"
    - inc:   { op:"inc", side:"A"|"B", delta: 1|-1 }
    - setGame: { op:"setGame", gameIndex: number, a: number, b: number }
    - nextGame: { op:"nextGame" }
*/
export const patchScore = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { op } = req.body || {};
  const match = await Match.findById(id);
  if (!match) return res.status(404).json({ message: "Match not found" });

  const rules = match.rules || { bestOf: 3, pointsToWin: 11, winByTwo: true };
  const io = req.app.get("io");

  if (op === "inc") {
    const { side, delta } = req.body;
    if (!["A", "B"].includes(side)) {
      return res.status(400).json({ message: "Invalid side" });
    }
    if (!Number.isFinite(+delta)) {
      return res.status(400).json({ message: "Invalid delta" });
    }
    // nếu chưa có ván đầu tiên thì tạo
    if (!Array.isArray(match.gameScores) || match.gameScores.length === 0) {
      match.gameScores = [{ a: 0, b: 0 }];
    }
    const cur = match.gameScores[match.gameScores.length - 1] || { a: 0, b: 0 };
    if (side === "A") cur.a = Math.max(0, (cur.a ?? 0) + Number(delta));
    if (side === "B") cur.b = Math.max(0, (cur.b ?? 0) + Number(delta));
    match.gameScores[match.gameScores.length - 1] = cur;

    await match.save();
    io?.to(String(match._id)).emit("score:updated", { matchId: match._id });
    return res.json({ message: "Score updated", gameScores: match.gameScores });
  }

  if (op === "setGame") {
    let { gameIndex, a = 0, b = 0 } = req.body;
    if (!Number.isInteger(gameIndex) || gameIndex < 0) {
      return res.status(400).json({ message: "Invalid gameIndex" });
    }
    if (!Array.isArray(match.gameScores)) match.gameScores = [];
    if (gameIndex > match.gameScores.length) {
      return res.status(400).json({ message: "gameIndex out of range" });
    }
    if (gameIndex === match.gameScores.length) {
      match.gameScores.push({ a: Number(a) || 0, b: Number(b) || 0 });
    } else {
      match.gameScores[gameIndex] = { a: Number(a) || 0, b: Number(b) || 0 };
    }
    await match.save();
    io?.to(String(match._id)).emit("score:updated", { matchId: match._id });
    return res.json({ message: "Game set", gameScores: match.gameScores });
  }

  if (op === "nextGame") {
    if (!Array.isArray(match.gameScores) || match.gameScores.length === 0) {
      return res
        .status(400)
        .json({ message: "Chưa có ván hiện tại để kiểm tra" });
    }
    const last = match.gameScores[match.gameScores.length - 1];
    if (!isGameWin(last?.a, last?.b, rules)) {
      return res
        .status(400)
        .json({ message: "Ván hiện tại chưa đủ điều kiện kết thúc" });
    }
    const { aWins, bWins } = winsCount(match.gameScores, rules);
    const needWins = Math.floor((rules.bestOf || 3) / 2) + 1;
    if (aWins >= needWins || bWins >= needWins) {
      return res
        .status(400)
        .json({ message: "Trận đã đủ số ván thắng. Không thể tạo ván mới" });
    }
    match.gameScores.push({ a: 0, b: 0 });
    await match.save();
    io?.to(String(match._id)).emit("score:updated", { matchId: match._id });
    return res.json({
      message: "Đã tạo ván tiếp theo",
      gameScores: match.gameScores,
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
