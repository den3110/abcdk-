// src/routes/overlayRoutes.js (ví dụ)
import express from "express";
import Match from "../models/matchModel.js";

const router = express.Router();

// helper: tên hiển thị team theo eventType (fallback)
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

// Ưu tiên nickname
const preferNick = (p) =>
  (
    p?.nickname ||
    p?.nickName ||
    p?.shortName ||
    p?.name ||
    p?.fullName ||
    ""
  ).trim();

router.get("/match/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const m = await Match.findById(id)
      .populate({ path: "tournament", select: "name eventType" })
      .populate({
        path: "pairA",
        select: "player1 player2",
        populate: [
          { path: "player1", select: "fullName nickname name shortName" },
          { path: "player2", select: "fullName nickname name shortName" },
        ],
      })
      .populate({
        path: "pairB",
        select: "player1 player2",
        populate: [
          { path: "player1", select: "fullName nickname name shortName" },
          { path: "player2", select: "fullName nickname name shortName" },
        ],
      })
      .lean();

    if (!m) return res.status(404).json({ message: "Match not found" });

    const evType =
      (m?.tournament?.eventType || "").toLowerCase() === "single"
        ? "single"
        : "double";

    const rules = {
      bestOf: Number(m?.rules?.bestOf ?? 3),
      pointsToWin: Number(m?.rules?.pointsToWin ?? 11),
      winByTwo: Boolean(m?.rules?.winByTwo ?? true),
    };

    const { a: setsA, b: setsB } = setWins(m?.gameScores || [], rules);

    const playersFromReg = (reg) => {
      if (!reg) return [];
      return [reg.player1, reg.player2].filter(Boolean).map((p) => ({
        id: String(p?._id || ""),
        nickname: preferNick(p),
        name: p?.fullName || p?.name || "",
      }));
    };

    const teamName = (reg) => {
      const ps = playersFromReg(reg);
      const nick = ps
        .map((x) => x.nickname)
        .filter(Boolean)
        .join(" & ");
      return nick || regName(reg, evType);
    };

    // Chuẩn hóa serve
    const serve =
      m?.serve && (m.serve.side || m.serve.server || m.serve.playerIndex)
        ? m.serve
        : { side: "A", server: 1 };

    res.json({
      matchId: String(m._id),
      status: m.status || "",
      winner: m.winner || "",
      tournament: {
        id: m?.tournament?._id || null,
        name: m?.tournament?.name || "",
        eventType: evType,
      },
      teams: {
        A: {
          name: teamName(m.pairA),
          players: playersFromReg(m.pairA),
        },
        B: {
          name: teamName(m.pairB),
          players: playersFromReg(m.pairB),
        },
      },
      rules,
      serve,
      currentGame: Number.isInteger(m?.currentGame) ? m.currentGame : 0,
      gameScores: Array.isArray(m?.gameScores) ? m.gameScores : [],
      // nếu có thông tin bracket/round thì trả thêm (ScoreOverlay sẽ tự xử lý nếu vắng)
      bracketType: m?.bracket?.type || "",
      roundCode:
        m?.roundCode ||
        (Number.isFinite(m?.roundSize) ? `R${m.roundSize}` : undefined),
      roundName: m?.roundName || "",
      round: Number.isFinite(m?.round) ? m.round : undefined,

      // tổng kết set
      sets: { A: setsA, B: setsB },
      needSetsToWin: gamesToWin(rules.bestOf),
    });
  } catch (err) {
    console.error("GET /overlay/match error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
