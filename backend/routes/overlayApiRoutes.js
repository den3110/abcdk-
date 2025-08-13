import express from "express";
import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";
import Registration from "../models/registrationModel.js";

const router = express.Router();

// helper: tên hiển thị team theo eventType
function regName(reg, evType) {
  if (!reg) return "—";
  if (evType === "single") return reg?.player1?.fullName || "N/A";
  const a = reg?.player1?.fullName || "N/A";
  const b = reg?.player2?.fullName || "N/A";
  return `${a} & ${b}`;
}
const gamesToWin = (bestOf) => Math.floor((Number(bestOf) || 3) / 2) + 1;
const gameWon = (x, y, pts, byTwo) =>
  Number(x) >= Number(pts) && (byTwo ? x - y >= 2 : x - y >= 1);

// tính số set thắng mỗi bên
function setWins(gameScores = [], rules) {
  let a = 0,
    b = 0;
  for (const g of gameScores || []) {
    if (gameWon(g?.a ?? 0, g?.b ?? 0, rules.pointsToWin, rules.winByTwo)) a++;
    else if (gameWon(g?.b ?? 0, g?.a ?? 0, rules.pointsToWin, rules.winByTwo))
      b++;
  }
  return { a, b };
}

router.get("/match/:id", async (req, res) => {
  const { id } = req.params;

  const m = await Match.findById(id)
    .populate({ path: "tournament", select: "name eventType" })
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" })
    .lean();

  if (!m) return res.status(404).json({ message: "Match not found" });

  const evType = m?.tournament?.eventType === "single" ? "single" : "double";
  const rules = {
    bestOf: Number(m?.rules?.bestOf ?? 3),
    pointsToWin: Number(m?.rules?.pointsToWin ?? 11),
    winByTwo: Boolean(m?.rules?.winByTwo ?? true),
  };
  const { a: setsA, b: setsB } = setWins(m.gameScores, rules);

  res.json({
    matchId: String(m._id),
    status: m.status,
    winner: m.winner || "",
    tournament: {
      id: m?.tournament?._id || null,
      name: m?.tournament?.name || "",
      eventType: evType,
    },
    teams: {
      A: {
        name: regName(m.pairA, evType),
      },
      B: {
        name: regName(m.pairB, evType),
      },
    },
    rules,
    serve: m?.serve || { side: "A", server: 2 },
    currentGame: m?.currentGame ?? 0,
    gameScores: m?.gameScores ?? [],
    sets: { A: setsA, B: setsB },
    needSetsToWin: gamesToWin(rules.bestOf),
  });
});

export default router;
