// services/mlpMatchSync.js
// Bridge giữa MLP sub-match và Match doc chuẩn — cho phép trọng tài chấm điểm
// qua RefereeScorePanel như trận bình thường. Match doc là "shell" gán ra
// trọng tài/sân/giờ; điểm sync ngược về sub-match cache khi Match save.

import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import MlpDualMatch from "../models/mlpDualMatchModel.js";
import MlpTeam from "../models/mlpTeamModel.js";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";
import { applyRatingForMlpSubMatch } from "./ratingEngine.js";

function toId(v) {
  if (!v) return null;
  if (typeof v === "object" && v._id) return v._id;
  return v;
}

async function buildPairSnapshots(playersA, playersB, teamAName, teamBName) {
  const ids = [...(playersA || []), ...(playersB || [])]
    .map(toId)
    .filter((v) => v && mongoose.isValidObjectId(v));
  const users = ids.length
    ? await User.find({ _id: { $in: ids } })
        .select(
          "_id name nickname avatar phone dob gender province cccd cccdImages cccdStatus",
        )
        .lean()
    : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const pickPlayers = (arr) =>
    (arr || [])
      .map((v) => byId.get(String(toId(v))) || null)
      .filter(Boolean);
  const pa = pickPlayers(playersA);
  const pb = pickPlayers(playersB);
  const label = (arr) =>
    arr.map((u) => u.nickname || u.name || "VĐV").join(" / ");
  const pairALabel = `${teamAName || "Team A"} · ${label(pa)}`;
  const pairBLabel = `${teamBName || "Team B"} · ${label(pb)}`;
  const synth = (side, teamName, arr, joinedLabel) => ({
    _id: `mlp-side-${side}`,
    name: teamName,
    displayName: joinedLabel,
    teamName,
    player1: arr[0] || null,
    player2: arr[1] || null,
    players: arr,
  });
  return {
    pairALabel,
    pairBLabel,
    pairA: synth("A", teamAName, pa, pairALabel),
    pairB: synth("B", teamBName, pb, pairBLabel),
  };
}

/**
 * Tạo hoặc cập nhật Match doc cho MLP sub-match.
 * Chỉ tạo khi lineup 2 bên đã có. Sub.match được set vào Match._id để lần sau
 * chỉ update chứ không tạo trùng.
 */
export async function ensureMlpSubMatchDoc(dual, sub, tour) {
  if (!dual || !sub || !tour) return null;
  const hasLineup =
    Array.isArray(sub.playersA) &&
    sub.playersA.length > 0 &&
    Array.isArray(sub.playersB) &&
    sub.playersB.length > 0;
  if (!hasLineup) return null;

  const [teamA, teamB] = await Promise.all([
    dual.teamA
      ? MlpTeam.findById(dual.teamA).select("name shortName").lean()
      : null,
    dual.teamB
      ? MlpTeam.findById(dual.teamB).select("name shortName").lean()
      : null,
  ]);
  const teamAName = teamA?.name || "Team A";
  const teamBName = teamB?.name || "Team B";

  const cfg = tour.mlpConfig || {};
  const slot = (cfg.slots || []).find((s) => s.key === sub.slotKey) || {};
  const rules = {
    bestOf: 1,
    pointsToWin: cfg.pointsToWin || 21,
    winByTwo: cfg.winByTwo !== false,
    cap: {
      mode: cfg.cap?.mode || "none",
      points: cfg.cap?.points || null,
    },
  };

  const { pairALabel, pairBLabel, pairA, pairB } = await buildPairSnapshots(
    sub.playersA,
    sub.playersB,
    teamAName,
    teamBName,
  );

  const participants = [...(sub.playersA || []), ...(sub.playersB || [])]
    .map(toId)
    .filter((v) => v && mongoose.isValidObjectId(v));

  const mlpMeta = {
    dualId: String(dual._id),
    subId: String(sub._id),
    slotKey: sub.slotKey,
    slotLabel: slot.label || sub.slotKey,
    matchType: slot.matchType || "double",
    teamAId: dual.teamA ? String(dual.teamA) : null,
    teamBId: dual.teamB ? String(dual.teamB) : null,
    teamAName,
    teamBName,
    pairALabel,
    pairBLabel,
    pairA,
    pairB,
    playersA: (sub.playersA || []).map((p) => String(toId(p))),
    playersB: (sub.playersB || []).map((p) => String(toId(p))),
  };

  // Ưu tiên cấu hình per-sub-match, fallback về dual-level, cuối cùng
  // fallback về station.defaultReferees ("trọng tài đứng theo sân").
  const subReferees = Array.isArray(sub.referees) ? sub.referees : [];
  const dualReferees = Array.isArray(dual.referees) ? dual.referees : [];
  let effectiveReferees = subReferees.length
    ? subReferees
    : dualReferees.length
      ? dualReferees
      : [];
  const effectiveStation = sub.courtStation || dual.courtStation || null;
  if (!effectiveReferees.length && effectiveStation) {
    try {
      const CourtStation = (
        await import("../models/courtStationModel.js")
      ).default;
      const station = await CourtStation.findById(effectiveStation)
        .select("defaultReferees")
        .lean();
      if (Array.isArray(station?.defaultReferees)) {
        effectiveReferees = station.defaultReferees;
      }
    } catch (_err) {}
  }
  const assignmentFields = {
    referee: effectiveReferees.slice(0, 5),
    court: sub.court || dual.court || null,
    courtStation: effectiveStation,
    scheduledAt: sub.scheduledAt || dual.scheduledAt || null,
    participants,
    rules,
  };

  let matchDoc = null;
  if (sub.match) {
    matchDoc = await Match.findById(sub.match);
  }

  if (!matchDoc) {
    matchDoc = new Match({
      tournament: dual.tournament,
      bracket: dual.bracket || null,
      ...assignmentFields,
      status: "scheduled",
      meta: { mlp: mlpMeta },
      note: slot.label || sub.slotKey || "",
    });
    await matchDoc.save();
    sub.match = matchDoc._id;
  } else {
    matchDoc.referee = assignmentFields.referee;
    matchDoc.court = assignmentFields.court;
    matchDoc.courtStation = assignmentFields.courtStation;
    matchDoc.scheduledAt = assignmentFields.scheduledAt;
    matchDoc.participants = assignmentFields.participants;
    // Chỉ set rules khi trận chưa live/finished (tránh đổi luật giữa chừng)
    if (!["live", "finished"].includes(String(matchDoc.status || ""))) {
      matchDoc.rules = assignmentFields.rules;
    }
    matchDoc.meta = { ...(matchDoc.meta || {}), mlp: mlpMeta };
    await matchDoc.save();
  }
  return matchDoc;
}

/**
 * Đồng bộ toàn bộ sub-match trong 1 dual — dùng khi patchMlpDual đổi
 * referee/court/scheduledAt.
 */
export async function ensureMlpDualMatchDocs(dual, tour) {
  if (!dual || !tour) return;
  for (const sub of dual.subMatches || []) {
    try {
      await ensureMlpSubMatchDoc(dual, sub, tour);
    } catch (err) {
      console.error(
        "[mlp] ensureMlpSubMatchDoc failed:",
        String(sub?._id),
        err?.message,
      );
    }
  }
  // sub.match có thể vừa được set → save dual để persist
  await dual.save();
}

/**
 * Sync ngược từ Match doc về MLP sub-match sau khi Match được save
 * (referee chấm điểm bằng RefereeScorePanel).
 */
export async function syncMatchToMlpSubMatch(matchDoc) {
  const mlp = matchDoc?.meta?.mlp;
  if (!mlp?.subId || !mlp?.dualId) return null;

  const dual = await MlpDualMatch.findById(mlp.dualId);
  if (!dual) return null;
  const sub = dual.subMatches.id(mlp.subId);
  if (!sub) return null;

  // Điểm: lấy game cuối trong gameScores (MLP mặc định bestOf=1).
  const gameScores = Array.isArray(matchDoc.gameScores)
    ? matchDoc.gameScores
    : [];
  const lastGame = gameScores[gameScores.length - 1] || { a: 0, b: 0 };
  const scoreA = Math.max(0, Number(lastGame?.a) || 0);
  const scoreB = Math.max(0, Number(lastGame?.b) || 0);

  const rawStatus = String(matchDoc.status || "").toLowerCase();
  const status =
    rawStatus === "finished"
      ? "finished"
      : ["live", "assigned"].includes(rawStatus)
        ? "live"
        : "scheduled";

  const wasFinished = sub.result?.status === "finished";
  sub.result.scoreA = scoreA;
  sub.result.scoreB = scoreB;
  sub.result.status = status;

  let subJustFinished = false;
  if (status === "finished") {
    sub.result.winner =
      matchDoc.winner === "A"
        ? "A"
        : matchDoc.winner === "B"
          ? "B"
          : scoreA > scoreB
            ? "A"
            : scoreB > scoreA
              ? "B"
              : null;
    sub.result.finishedAt = matchDoc.finishedAt || new Date();
    if (!wasFinished) subJustFinished = true;
  } else {
    sub.result.winner = null;
    sub.result.finishedAt = null;
    sub.result.ratingApplied = false;
  }

  // Recompute dual slot wins + overall status
  let wa = 0;
  let wb = 0;
  let allFinished = true;
  for (const ss of dual.subMatches) {
    if (ss.result?.winner === "A") wa++;
    else if (ss.result?.winner === "B") wb++;
    if (ss.result?.status !== "finished") allFinished = false;
  }
  dual.slotWinsA = wa;
  dual.slotWinsB = wb;

  const tour = await Tournament.findById(dual.tournament);
  let justFinished = false;
  if (allFinished) {
    const cfg = tour?.mlpConfig || {};
    const dbEnabled = cfg.dreamBreaker?.enabled !== false;
    if (wa === wb && dbEnabled) {
      dual.status = "tie_break";
    } else {
      const wasFinishedDual = dual.status === "finished";
      dual.status = "finished";
      dual.winner = wa > wb ? "A" : wb > wa ? "B" : null;
      dual.finishedAt = new Date();
      if (!wasFinishedDual) justFinished = true;
    }
  } else if (dual.status === "scheduled" && (scoreA > 0 || scoreB > 0)) {
    dual.status = "live";
    if (!dual.startedAt) dual.startedAt = new Date();
  }

  await dual.save();

  // Auto-advance winner nếu dual thuộc knockout — lazy import để tránh
  // circular (mlpController import mlpMatchSync qua ensureMlpSubMatchDoc).
  if (justFinished) {
    try {
      const mod = await import("../controllers/mlpController.js");
      if (dual.phase === "knockout") {
        mod.advanceMlpKnockoutWinner?.(dual).catch?.(() => {});
      } else if (dual.phase === "group") {
        mod.resolveMlpKnockoutSlots?.(dual.tournament).catch?.(() => {});
      }
    } catch (_err) {}
  }

  if (subJustFinished && !sub.result.ratingApplied && sub.result.winner) {
    const slot = (tour?.mlpConfig?.slots || []).find(
      (sl) => sl.key === sub.slotKey,
    );
    try {
      await applyRatingForMlpSubMatch({
        playersA: sub.playersA || [],
        playersB: sub.playersB || [],
        scoreA,
        scoreB,
        winner: sub.result.winner,
        tournamentId: dual.tournament,
        subMatchId: sub._id,
        matchType: slot?.matchType || "double",
      });
      sub.result.ratingApplied = true;
      await dual.save();
    } catch (err) {
      console.error("[mlp] rating apply failed:", err?.message);
    }
  }

  return dual;
}
