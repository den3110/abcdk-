// controllers/mlpOverlayController.js
// Overlay cho giải MLP theo sân (courtStation) — hoạt động xuyên suốt
// từ sub-match sang DreamBreaker:
// - Sub-match: hiển thị tên team + cặp đấu (2v2)
// - DreamBreaker: hiển thị team + VĐV đang cầm vợt (1v1 rotating)
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import CourtStation from "../models/courtStationModel.js";
import Match from "../models/matchModel.js";
import MlpDualMatch from "../models/mlpDualMatchModel.js";
import Tournament from "../models/tournamentModel.js";
import MlpTeam from "../models/mlpTeamModel.js";
import User from "../models/userModel.js";

function ensureValidObjectId(value, label = "id") {
  if (!mongoose.isValidObjectId(String(value || ""))) {
    const error = new Error(`Invalid ${label}`);
    error.status = 400;
    throw error;
  }
}

function playerBrief(p) {
  if (!p) return null;
  return {
    _id: String(p._id || p),
    name: p.name || "",
    nickname: p.nickname || p.name || "",
    avatar: p.avatar || "",
  };
}

function teamBrief(team) {
  if (!team) return null;
  return {
    _id: String(team._id || team),
    name: team.name || "",
    shortName: team.shortName || "",
    color: team.color || "",
    logo: team.logo || "",
  };
}

function rotationPlayerAt(scoreForSide, lineup, rotateEvery) {
  if (!Array.isArray(lineup) || !lineup.length) return { player: null, idx: 0 };
  const idx =
    Math.floor(Math.max(0, Number(scoreForSide || 0)) / Math.max(1, rotateEvery)) %
    lineup.length;
  return { player: lineup[idx], idx };
}

// GET /api/live/courts/:courtStationId/mlp-overlay
export const getMlpCourtOverlay = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.courtStationId, "courtStationId");
  const stationId = req.params.courtStationId;

  const station = await CourtStation.findById(stationId)
    .select("_id name code label clusterId currentMatch currentTournament")
    .lean();
  if (!station) {
    res.status(404);
    throw new Error("Court station not found");
  }

  // === Bước 1: tìm live Match doc trên court (sub-match) ===
  // Ưu tiên station.currentMatch (đã gán). Fallback: query Match theo
  // courtStation field — cover trường hợp assign court nhưng chưa
  // start.
  let liveMatch = null;
  if (station.currentMatch) {
    liveMatch = await Match.findById(station.currentMatch)
      .select(
        "_id status winner gameScores currentGame rules meta serve scheduledAt startedAt tournament",
      )
      .lean();
  }
  // Nếu chưa có, tìm MLP Match trên station này. MLP flow tạo Match doc
  // với status="scheduled" (không đi qua assignCourtToMatch nên không
  // được set thành "assigned"). Nên phải nhận cả 3 trạng thái. Sort ưu
  // tiên live > assigned > scheduled (dùng updatedAt/startedAt gần nhất).
  if (!liveMatch) {
    const candidates = await Match.find({
      courtStation: stationId,
      status: { $in: ["live", "assigned", "scheduled"] },
      "meta.mlp.dualId": { $exists: true },
    })
      .sort({ startedAt: -1, updatedAt: -1 })
      .select(
        "_id status winner gameScores currentGame rules meta serve scheduledAt startedAt tournament",
      )
      .limit(10)
      .lean();
    // Ưu tiên theo status
    const priority = { live: 0, assigned: 1, scheduled: 2 };
    candidates.sort(
      (a, b) =>
        (priority[a.status] ?? 3) - (priority[b.status] ?? 3),
    );
    liveMatch = candidates[0] || null;
  }

  const isMlpSub = !!liveMatch?.meta?.mlp?.dualId;
  const isDisplayable = ["live", "assigned", "scheduled"].includes(
    String(liveMatch?.status || "").toLowerCase(),
  );

  // === Bước 2: nếu Match tồn tại và là MLP sub → build sub-match overlay ===
  if (liveMatch && isMlpSub && isDisplayable) {
    const mlp = liveMatch.meta.mlp;
    const dual = await MlpDualMatch.findById(mlp.dualId).lean();
    const tour = await Tournament.findById(liveMatch.tournament)
      .select("name image mlpConfig")
      .lean();
    const [teamA, teamB] = await Promise.all([
      dual?.teamA ? MlpTeam.findById(dual.teamA).lean() : null,
      dual?.teamB ? MlpTeam.findById(dual.teamB).lean() : null,
    ]);

    const gameScores = Array.isArray(liveMatch.gameScores)
      ? liveMatch.gameScores
      : [];
    const lastGame = gameScores[gameScores.length - 1] || { a: 0, b: 0 };

    return res.json({
      mode: "sub",
      status: liveMatch.status,
      tournament: {
        name: tour?.name || "",
        image: tour?.image || "",
      },
      station: {
        _id: String(station._id),
        name: station.name || station.label || "",
        code: station.code || "",
      },
      slot: {
        key: mlp.slotKey,
        label: mlp.slotLabel || mlp.slotKey,
        matchType: mlp.matchType || "double",
      },
      dualId: String(dual?._id || mlp.dualId),
      teamA: {
        ...teamBrief(teamA),
        slotWins: Number(dual?.slotWinsA || 0),
        players: (mlp.pairA?.player1
          ? [mlp.pairA.player1, mlp.pairA.player2].filter(Boolean).map(playerBrief)
          : []),
        isWinner: dual?.winner === "A",
      },
      teamB: {
        ...teamBrief(teamB),
        slotWins: Number(dual?.slotWinsB || 0),
        players: (mlp.pairB?.player1
          ? [mlp.pairB.player1, mlp.pairB.player2].filter(Boolean).map(playerBrief)
          : []),
        isWinner: dual?.winner === "B",
      },
      score: {
        currentGameA: Number(lastGame.a) || 0,
        currentGameB: Number(lastGame.b) || 0,
        // MLP mặc định bestOf=1 → games = 1 hoặc 0
        gamesWonA: 0,
        gamesWonB: 0,
      },
      serve: liveMatch.serve || null,
      rules: liveMatch.rules || null,
    });
  }

  // === Bước 3: không có sub-match live → tìm MLP dual đang tie_break trên court ===
  const tieDual = await MlpDualMatch.findOne({
    $or: [{ courtStation: stationId }, { court: stationId }],
    status: "tie_break",
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (tieDual) {
    const tour = await Tournament.findById(tieDual.tournament)
      .select("name image mlpConfig")
      .lean();
    const [teamA, teamB] = await Promise.all([
      tieDual.teamA ? MlpTeam.findById(tieDual.teamA).lean() : null,
      tieDual.teamB ? MlpTeam.findById(tieDual.teamB).lean() : null,
    ]);
    const dbCfg = tour?.mlpConfig?.dreamBreaker || {};
    const target = Number(dbCfg.pointsToWin) || 21;
    const rotate = Number(dbCfg.rotationEveryPoints) || 4;
    const db = tieDual.dreamBreaker || {};
    const lineupA = Array.isArray(db.lineupA) ? db.lineupA : [];
    const lineupB = Array.isArray(db.lineupB) ? db.lineupB : [];
    const scoreA = Number(db.scoreA || 0);
    const scoreB = Number(db.scoreB || 0);
    const { player: currentAId, idx: currentAIdx } = rotationPlayerAt(
      scoreA,
      lineupA,
      rotate,
    );
    const { player: currentBId, idx: currentBIdx } = rotationPlayerAt(
      scoreB,
      lineupB,
      rotate,
    );

    // Populate lineup + current player user docs
    const allIds = [...lineupA, ...lineupB, currentAId, currentBId]
      .map((v) => (v ? String(v?._id ?? v) : ""))
      .filter((v) => v && mongoose.isValidObjectId(v));
    const users = allIds.length
      ? await User.find({ _id: { $in: [...new Set(allIds)] } })
          .select("_id name nickname avatar")
          .lean()
      : [];
    const byId = new Map(users.map((u) => [String(u._id), u]));
    const pick = (id) => (id ? byId.get(String(id?._id ?? id)) || null : null);

    const lineupUsersA = lineupA.map(pick).filter(Boolean);
    const lineupUsersB = lineupB.map(pick).filter(Boolean);

    return res.json({
      mode: "dreambreaker",
      status: tieDual.status,
      tournament: {
        name: tour?.name || "",
        image: tour?.image || "",
      },
      station: {
        _id: String(station._id),
        name: station.name || station.label || "",
        code: station.code || "",
      },
      dualId: String(tieDual._id),
      dreamBreaker: {
        triggered: !!db.triggered,
        scoreA,
        scoreB,
        winner: db.winner || null,
        target,
        rotate,
        pointsInBlockA: scoreA % Math.max(1, rotate),
        pointsInBlockB: scoreB % Math.max(1, rotate),
      },
      teamA: {
        ...teamBrief(teamA),
        currentPlayer: playerBrief(pick(currentAId)),
        currentPlayerIdx: currentAIdx,
        lineup: lineupUsersA.map(playerBrief),
        slotWins: Number(tieDual.slotWinsA || 0),
        isWinner: tieDual.winner === "A" || db.winner === "A",
      },
      teamB: {
        ...teamBrief(teamB),
        currentPlayer: playerBrief(pick(currentBId)),
        currentPlayerIdx: currentBIdx,
        lineup: lineupUsersB.map(playerBrief),
        slotWins: Number(tieDual.slotWinsB || 0),
        isWinner: tieDual.winner === "B" || db.winner === "B",
      },
    });
  }

  res.status(404);
  throw new Error("No MLP overlay data for this court station");
});
