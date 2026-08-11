// controllers/mlpController.js
// MLP tournament: teams + dual matches + DreamBreaker.
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Tournament from "../models/tournamentModel.js";
import MlpTeam from "../models/mlpTeamModel.js";
import MlpDualMatch from "../models/mlpDualMatchModel.js";
import Court from "../models/courtModel.js";
import CourtStation from "../models/courtStationModel.js";
import { getIO } from "../socket/index.js";
import { applyRatingForMlpSubMatch } from "../services/ratingEngine.js";
import {
  notifyMlpTeamStatus,
  notifyMlpDualEvent,
} from "../services/mlpNotifier.js";
import {
  ensureMlpSubMatchDoc,
  ensureMlpDualMatchDocs,
} from "../services/mlpMatchSync.js";
import { emitTournamentInvalidate } from "../socket/tournamentRealtime.js";
import {
  poolKeyFromIndex,
  shuffleInPlace,
  distributeRoundRobin,
  distributeSnake,
  applyPoolAssignments,
  resetPoolAssignments,
  listPools,
} from "../services/mlpPoolService.js";

// Emit event tới room mlp:dual:${id}. Client subscribe qua
// socket.emit("mlp:dual:subscribe", { dualId }) — handler thêm trong
// socket/index.js.
function emitMlpDual(dualId, event, payload) {
  try {
    const io = getIO?.();
    if (io) io.to(`mlp:dual:${dualId}`).emit(event, payload);
  } catch (err) {
    console.error("[mlp] emitMlpDual error:", err?.message || err);
  }
}

// Báo cho tab trọng tài + trang manage: có Match doc MLP mới hoặc thay
// đổi lineup/court/schedule. Client subscribe room tournament:${tid} và
// sẽ refetch danh sách trận.
function invalidateMlpTournament(tid, reason = "mlp:update") {
  try {
    const io = getIO?.();
    if (io && tid) {
      emitTournamentInvalidate(io, {
        tournamentId: String(tid),
        reason,
      });
    }
  } catch (err) {
    console.error(
      "[mlp] invalidateMlpTournament error:",
      err?.message || err,
    );
  }
}

const isAdmin = (u) =>
  u?.role === "admin" || u?.isAdmin || u?.isSuperUser;
const isManagerOf = (u, tour) => {
  if (!u?._id || !tour) return false;
  if (String(tour.createdBy) === String(u._id)) return true;
  if (Array.isArray(tour.managers)) {
    return tour.managers.some(
      (m) => String(m?.user ?? m) === String(u._id),
    );
  }
  return false;
};
const canManageTournament = (u, tour) => isAdmin(u) || isManagerOf(u, tour);

// Trọng tài được gán vào dual (dual.referees) hoặc bất kỳ sub-match nào
// (sub.referees) cũng được phép chấm điểm DreamBreaker + sub-match — nhất
// quán với flow trận thường (trọng tài của trận thì được chấm trận đó).
const isRefereeOfDual = (u, dual) => {
  if (!u?._id || !dual) return false;
  const uid = String(u._id);
  const dualRefs = Array.isArray(dual.referees) ? dual.referees : [];
  if (dualRefs.some((r) => String(r?._id ?? r) === uid)) return true;
  const subs = Array.isArray(dual.subMatches) ? dual.subMatches : [];
  return subs.some((s) => {
    const subRefs = Array.isArray(s?.referees) ? s.referees : [];
    return subRefs.some((r) => String(r?._id ?? r) === uid);
  });
};
const canScoreDual = (u, tour, dual) =>
  canManageTournament(u, tour) || isRefereeOfDual(u, dual);

const oid = (v) =>
  v && mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(v) : null;

/* ═════════════════════ CHECK-IN ═════════════════════ */

// POST /api/mlp/duals/:id/check-in — captain xác nhận đội sẵn sàng.
// body: { side: "A" | "B" }. Cho phép admin/manager check-in hộ.
export const checkInMlpDual = asyncHandler(async (req, res) => {
  const dual = await MlpDualMatch.findById(req.params.id);
  if (!dual) {
    res.status(404);
    throw new Error("Không tìm thấy dual");
  }
  const side = ["A", "B"].includes(req.body?.side) ? req.body.side : null;
  if (!side) {
    res.status(400);
    throw new Error("side phải là A hoặc B");
  }
  const tour = await Tournament.findById(dual.tournament);
  const teamId = side === "A" ? dual.teamA : dual.teamB;
  const team = await MlpTeam.findById(teamId).select("captain").lean();
  const isCaptain = String(team?.captain) === String(req.user?._id);
  if (!isCaptain && !canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Chỉ đội trưởng hoặc BTC được check-in");
  }
  if (dual.status === "finished") {
    res.status(400);
    throw new Error("Dual đã kết thúc");
  }
  const field = side === "A" ? "checkInA" : "checkInB";
  dual[field] = { checkedAt: new Date(), by: req.user._id };
  await dual.save();
  emitMlpDual(dual._id, "mlp:dual:updated", {
    dualId: dual._id,
    checkInA: dual.checkInA,
    checkInB: dual.checkInB,
  });
  invalidateMlpTournament(dual.tournament, "mlp:checkin");
  res.json({ success: true, dual });
});

/* ═════════════════════ ADMIN MODERATION ═════════════════════ */

// POST /api/mlp/duals/:id/force-finish — admin/manager kết thúc dual bằng
// tay khi cần (walkover, VĐV bỏ cuộc…). body: { winner: "A"|"B"|null }
export const forceFinishMlpDual = asyncHandler(async (req, res) => {
  const dual = await MlpDualMatch.findById(req.params.id);
  if (!dual) {
    res.status(404);
    throw new Error("Không tìm thấy dual");
  }
  const tour = await Tournament.findById(dual.tournament);
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const winner = ["A", "B"].includes(req.body?.winner)
    ? req.body.winner
    : dual.slotWinsA > dual.slotWinsB
      ? "A"
      : dual.slotWinsB > dual.slotWinsA
        ? "B"
        : null;
  dual.status = "finished";
  dual.winner = winner;
  dual.finishedAt = new Date();
  await dual.save();
  emitMlpDual(dual._id, "mlp:dual:finished", {
    dualId: dual._id,
    winner,
    forced: true,
  });
  recomputeMlpStandings(dual.tournament).catch(() => {});
  notifyMlpDualEvent({ dual, event: "finished" }).catch(() => {});
  advanceMlpKnockoutWinner(dual).catch(() => {});
  res.json({ success: true, dual });
});

// DELETE /api/mlp/duals/:id — admin/manager xoá 1 dual (kể cả finished).
// Không recompute standings tự động vì có thể xoá nhầm hàng loạt.
export const deleteMlpDual = asyncHandler(async (req, res) => {
  const dual = await MlpDualMatch.findById(req.params.id);
  if (!dual) {
    res.status(404);
    throw new Error("Không tìm thấy dual");
  }
  const tour = await Tournament.findById(dual.tournament);
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  await MlpDualMatch.deleteOne({ _id: dual._id });
  res.json({ success: true });
});

// POST /api/mlp/tournaments/:tid/reset
// Reset dữ liệu MLP về trạng thái mới để test lại. Body:
//   {
//     scope: {
//       duals?: boolean,          // xoá toàn bộ dual matches (kéo theo Match docs)
//       standings?: boolean,      // reset team.standing về 0
//       pools?: boolean,          // clear pool assignments + drawStatus
//       ratingChanges?: boolean,  // xoá RatingChange records của giải (KHÔNG revert user rating)
//     },
//     confirmName: string,        // phải khớp tour.name để confirm — chống nhầm
//   }
// Manager/admin only. Không đụng teams, config, tournament info.
export const resetMlpTournament = asyncHandler(async (req, res) => {
  const tour = await Tournament.findById(req.params.tid);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền reset giải");
  }
  if (tour.tournamentMode !== "mlp") {
    res.status(400);
    throw new Error("Giải này không MLP");
  }
  const confirmName = String(req.body?.confirmName || "").trim();
  if (confirmName !== String(tour.name || "").trim()) {
    res.status(400);
    throw new Error(
      `Xác nhận sai. Vui lòng gõ chính xác tên giải: "${tour.name}"`,
    );
  }
  const scope = req.body?.scope || {};
  const doDuals = scope.duals !== false;
  const doStandings = scope.standings !== false;
  const doPools = scope.pools === true; // opt-in
  const doRatingChanges = scope.ratingChanges === true; // opt-in

  const summary = {
    dualsDeleted: 0,
    matchDocsDeleted: 0,
    teamsReset: 0,
    poolsCleared: 0,
    ratingChangesDeleted: 0,
  };

  // 1) Xoá dual matches + Match docs shell của MLP.
  if (doDuals) {
    // Thu id Match doc từ subMatches trước khi xoá dual
    const duals = await MlpDualMatch.find({ tournament: tour._id })
      .select("subMatches.match")
      .lean();
    const matchIds = [];
    for (const d of duals) {
      for (const sm of d.subMatches || []) {
        if (sm.match) matchIds.push(sm.match);
      }
    }
    const dualDel = await MlpDualMatch.deleteMany({ tournament: tour._id });
    summary.dualsDeleted = dualDel.deletedCount || 0;
    if (matchIds.length) {
      const Match = (await import("../models/matchModel.js")).default;
      const matchDel = await Match.deleteMany({ _id: { $in: matchIds } });
      summary.matchDocsDeleted = matchDel.deletedCount || 0;
    }
    // Bonus: xoá Match docs mồ côi (có meta.mlp nhưng dualId trỏ tới dual đã xoá).
    try {
      const Match = (await import("../models/matchModel.js")).default;
      const orphanDel = await Match.deleteMany({
        tournament: tour._id,
        "meta.mlp.dualId": { $exists: true },
      });
      summary.matchDocsDeleted += orphanDel.deletedCount || 0;
    } catch (_err) {}
  }

  // 2) Reset team.standing về 0.
  if (doStandings) {
    const upd = await MlpTeam.updateMany(
      { tournament: tour._id },
      {
        $set: {
          "standing.wins": 0,
          "standing.losses": 0,
          "standing.slotsFor": 0,
          "standing.slotsAgainst": 0,
          "standing.pointsFor": 0,
          "standing.pointsAgainst": 0,
        },
      },
    );
    summary.teamsReset = upd.modifiedCount || 0;
  }

  // 3) Clear pool assignments + drawStatus.
  if (doPools) {
    summary.poolsCleared = await resetPoolAssignments(tour._id);
    const cfg = tour.mlpConfig || {};
    if (cfg.groupStage) {
      cfg.groupStage.drawStatus = "idle";
      cfg.groupStage.drawnAt = null;
      tour.mlpConfig = cfg;
      await tour.save();
    }
  }

  // 4) Xoá RatingChange records (không revert user rating).
  if (doRatingChanges) {
    try {
      const RatingChange = (
        await import("../models/ratingChangeModel.js")
      ).default;
      const del = await RatingChange.deleteMany({ tournament: tour._id });
      summary.ratingChangesDeleted = del.deletedCount || 0;
    } catch (_err) {}
  }

  res.json({
    success: true,
    scope: {
      duals: doDuals,
      standings: doStandings,
      pools: doPools,
      ratingChanges: doRatingChanges,
    },
    summary,
  });
});

// DELETE /api/mlp/tournaments/:tid/duals/round/:round
// Xoá toàn bộ dual match thuộc 1 vòng (ví dụ xoá lại knockout sinh sai
// hoặc reset 1 vòng round-robin trước khi generate lại).
export const deleteMlpRound = asyncHandler(async (req, res) => {
  const tour = await Tournament.findById(req.params.tid);
  if (!tour) {
    res.status(404);
    throw new Error("Không tìm thấy giải");
  }
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const round = Number(req.params.round);
  if (!Number.isFinite(round) || round < 1) {
    res.status(400);
    throw new Error("Round không hợp lệ");
  }
  const result = await MlpDualMatch.deleteMany({
    tournament: tour._id,
    round,
  });
  res.json({ success: true, deleted: result.deletedCount || 0 });
});

/* ═════════════════════ REPORTS / EXPORT ═════════════════════ */

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// GET /api/mlp/tournaments/:tid/export/standings.csv
export const exportMlpStandingsCsv = asyncHandler(async (req, res) => {
  const teams = await MlpTeam.find({
    tournament: req.params.tid,
    status: "approved",
  })
    .select("name shortName standing")
    .lean();
  const h2h = await buildHeadToHeadMap(req.params.tid);
  const rows = teams
    .map((t) => {
      const s = t.standing || {};
      const wins = Number(s.wins) || 0;
      const losses = Number(s.losses) || 0;
      const slotsFor = Number(s.slotsFor) || 0;
      const slotsAgainst = Number(s.slotsAgainst) || 0;
      const pointsFor = Number(s.pointsFor) || 0;
      const pointsAgainst = Number(s.pointsAgainst) || 0;
      return {
        name: t.name,
        shortName: t.shortName || "",
        wins,
        losses,
        played: wins + losses,
        slotsFor,
        slotsAgainst,
        slotDiff: slotsFor - slotsAgainst,
        pointsFor,
        pointsAgainst,
        pointDiff: pointsFor - pointsAgainst,
        _id: String(t._id),
      };
    })
    .sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      const rec = h2h.get(a._id)?.get(b._id);
      if (rec && rec.won !== rec.lost) return rec.lost - rec.won;
      if (a.slotDiff !== b.slotDiff) return b.slotDiff - a.slotDiff;
      if (a.pointDiff !== b.pointDiff) return b.pointDiff - a.pointDiff;
      return String(a.name).localeCompare(String(b.name), "vi");
    });

  const header = [
    "Hạng",
    "Team",
    "Ký hiệu",
    "Thắng",
    "Thua",
    "Đã đấu",
    "Slot ghi",
    "Slot thua",
    "Hiệu số slot",
    "Điểm ghi",
    "Điểm thua",
    "Hiệu số điểm",
  ];
  const lines = [header.join(",")];
  rows.forEach((r, i) => {
    lines.push(
      [
        i + 1,
        r.name,
        r.shortName,
        r.wins,
        r.losses,
        r.played,
        r.slotsFor,
        r.slotsAgainst,
        r.slotDiff,
        r.pointsFor,
        r.pointsAgainst,
        r.pointDiff,
      ]
        .map(csvEscape)
        .join(","),
    );
  });
  const csv = "﻿" + lines.join("\n"); // BOM cho Excel Vietnamese
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="mlp-standings-${req.params.tid}.csv"`,
  );
  res.send(csv);
});

// GET /api/mlp/tournaments/:tid/export/results.csv
// Kết quả tất cả dual đã finished + sub-match detail.
export const exportMlpResultsCsv = asyncHandler(async (req, res) => {
  const duals = await MlpDualMatch.find({
    tournament: req.params.tid,
    status: "finished",
  })
    .populate("teamA", "name shortName")
    .populate("teamB", "name shortName")
    .sort({ round: 1, order: 1 })
    .lean();

  const header = [
    "Vòng",
    "Thứ tự",
    "Team A",
    "Team B",
    "Slot A",
    "Slot B",
    "Team thắng",
    "Sub-match",
    "Slot key",
    "Score A",
    "Score B",
    "Winner",
  ];
  const lines = [header.join(",")];
  for (const d of duals) {
    const nameA = d.teamA?.name || "-";
    const nameB = d.teamB?.name || "-";
    const winnerName = d.winner === "A" ? nameA : d.winner === "B" ? nameB : "";
    if (!d.subMatches?.length) {
      lines.push(
        [
          d.round,
          d.order,
          nameA,
          nameB,
          d.slotWinsA,
          d.slotWinsB,
          winnerName,
          "",
          "",
          "",
          "",
          "",
        ]
          .map(csvEscape)
          .join(","),
      );
    } else {
      d.subMatches.forEach((sm, idx) => {
        lines.push(
          [
            d.round,
            d.order,
            idx === 0 ? nameA : "",
            idx === 0 ? nameB : "",
            idx === 0 ? d.slotWinsA : "",
            idx === 0 ? d.slotWinsB : "",
            idx === 0 ? winnerName : "",
            idx + 1,
            sm.slotKey,
            sm.result?.scoreA ?? 0,
            sm.result?.scoreB ?? 0,
            sm.result?.winner === "A"
              ? nameA
              : sm.result?.winner === "B"
                ? nameB
                : "",
          ]
            .map(csvEscape)
            .join(","),
        );
      });
    }
  }
  const csv = "﻿" + lines.join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="mlp-results-${req.params.tid}.csv"`,
  );
  res.send(csv);
});

// GET /api/mlp/tournaments/:tid/export/summary.json
// Tóm tắt cho PDF client render: metadata + BXH + kết quả
export const exportMlpSummary = asyncHandler(async (req, res) => {
  const tid = req.params.tid;
  const tour = await Tournament.findById(tid)
    .select("name startDate endDate image tournamentMode mlpConfig")
    .lean();
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  const [teams, duals, h2h] = await Promise.all([
    MlpTeam.find({ tournament: tid, status: "approved" })
      .select("name shortName logo color standing captain")
      .populate("captain", "name nickname avatar")
      .lean(),
    MlpDualMatch.find({ tournament: tid, status: "finished" })
      .populate("teamA", "name shortName")
      .populate("teamB", "name shortName")
      .sort({ round: 1, order: 1 })
      .lean(),
    buildHeadToHeadMap(tid),
  ]);
  const standings = teams
    .map((t) => {
      const s = t.standing || {};
      return {
        _id: t._id,
        name: t.name,
        shortName: t.shortName,
        logo: t.logo,
        color: t.color,
        captain: t.captain,
        wins: Number(s.wins) || 0,
        losses: Number(s.losses) || 0,
        slotsFor: Number(s.slotsFor) || 0,
        slotsAgainst: Number(s.slotsAgainst) || 0,
        slotDiff:
          (Number(s.slotsFor) || 0) - (Number(s.slotsAgainst) || 0),
        pointsFor: Number(s.pointsFor) || 0,
        pointsAgainst: Number(s.pointsAgainst) || 0,
        pointDiff:
          (Number(s.pointsFor) || 0) - (Number(s.pointsAgainst) || 0),
      };
    })
    .sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      const rec = h2h.get(String(a._id))?.get(String(b._id));
      if (rec && rec.won !== rec.lost) return rec.lost - rec.won;
      if (a.slotDiff !== b.slotDiff) return b.slotDiff - a.slotDiff;
      if (a.pointDiff !== b.pointDiff) return b.pointDiff - a.pointDiff;
      return String(a.name).localeCompare(String(b.name), "vi");
    })
    .map((r, idx) => ({ rank: idx + 1, ...r }));

  const champion = standings[0] || null;
  const runnerUp = standings[1] || null;

  res.json({
    tournament: {
      _id: tour._id,
      name: tour.name,
      startDate: tour.startDate,
      endDate: tour.endDate,
      image: tour.image,
    },
    generatedAt: new Date(),
    counts: {
      teams: teams.length,
      finishedDuals: duals.length,
    },
    champion,
    runnerUp,
    standings,
    results: duals.map((d) => ({
      _id: d._id,
      round: d.round,
      order: d.order,
      teamA: { _id: d.teamA?._id, name: d.teamA?.name },
      teamB: { _id: d.teamB?._id, name: d.teamB?.name },
      slotWinsA: d.slotWinsA,
      slotWinsB: d.slotWinsB,
      winner: d.winner,
      finishedAt: d.finishedAt,
      subMatches: (d.subMatches || []).map((sm) => ({
        slotKey: sm.slotKey,
        scoreA: sm.result?.scoreA ?? 0,
        scoreB: sm.result?.scoreB ?? 0,
        winner: sm.result?.winner,
      })),
    })),
  });
});

/* ═════════════════════ COURTS ═════════════════════ */

// GET /api/mlp/tournaments/:tid/courts — trả list court khả dụng cho giải
// (query cả Court cũ + CourtStation mới, dedup theo _id).
export const listMlpTournamentCourts = asyncHandler(async (req, res) => {
  const tid = req.params.tid;
  const tour = await Tournament.findById(tid)
    .select("allowedCourtClusterIds")
    .lean();
  const [courts, stations] = await Promise.all([
    Court.find({ tournament: tid, isActive: { $ne: false } })
      .select("_id name cluster status")
      .lean(),
    tour?.allowedCourtClusterIds?.length
      ? CourtStation.find({
          clusterId: { $in: tour.allowedCourtClusterIds },
        })
          .select("_id name clusterId status")
          .lean()
      : Promise.resolve([]),
  ]);
  const seen = new Set();
  const items = [];
  for (const c of courts) {
    const id = String(c._id);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      _id: c._id,
      name: c.name,
      cluster: c.cluster || null,
      type: "court",
      status: c.status || null,
    });
  }
  for (const s of stations) {
    const id = String(s._id);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      _id: s._id,
      name: s.name,
      cluster: null,
      type: "station",
      status: s.status || null,
    });
  }
  res.json({ items });
});

// POST /api/mlp/tournaments/:tid/duals/auto-assign-courts
// Simple auto-assign: chia đều dual (status != finished, không có court) vào
// các court/station khả dụng theo round-robin. Không kiểm tra xung đột giờ —
// admin phải xem lại schedule.
export const autoAssignMlpCourts = asyncHandler(async (req, res) => {
  const tid = req.params.tid;
  const tour = await Tournament.findById(tid);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const [courts, stations, unassigned] = await Promise.all([
    Court.find({ tournament: tid, isActive: { $ne: false } })
      .select("_id")
      .lean(),
    tour.allowedCourtClusterIds?.length
      ? CourtStation.find({
          clusterId: { $in: tour.allowedCourtClusterIds },
        })
          .select("_id")
          .lean()
      : Promise.resolve([]),
    MlpDualMatch.find({
      tournament: tid,
      status: { $in: ["scheduled", "live"] },
      court: null,
      courtStation: null,
    })
      .sort({ round: 1, order: 1 })
      .select("_id")
      .lean(),
  ]);
  const pool = [
    ...courts.map((c) => ({ id: c._id, field: "court" })),
    ...stations.map((s) => ({ id: s._id, field: "courtStation" })),
  ];
  if (!pool.length) {
    res.status(400);
    throw new Error("Không có sân nào khả dụng cho giải");
  }
  let assigned = 0;
  for (let i = 0; i < unassigned.length; i++) {
    const slot = pool[i % pool.length];
    await MlpDualMatch.updateOne(
      { _id: unassigned[i]._id },
      { $set: { [slot.field]: slot.id } }
    );
    assigned++;
  }
  res.json({ success: true, assigned });
});

/* ═════════════════════ STANDINGS ═════════════════════ */

// Recompute standings cho toàn bộ team của 1 giải, dựa vào các dual đã
// finished. Idempotent — chạy full recalc chứ không đụng delta để tránh
// drift. Dùng sau mỗi lần dual chuyển sang "finished" + endpoint recompute
// thủ công cho admin.
export async function recomputeMlpStandings(tid) {
  const tourId = oid(tid);
  if (!tourId) return;
  const teams = await MlpTeam.find({ tournament: tourId }).select("_id").lean();
  const stat = new Map(); // teamId -> {wins,losses,slotsFor,slotsAgainst,pointsFor,pointsAgainst}
  for (const t of teams) {
    stat.set(String(t._id), {
      wins: 0,
      losses: 0,
      slotsFor: 0,
      slotsAgainst: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    });
  }
  const duals = await MlpDualMatch.find({
    tournament: tourId,
    status: "finished",
  })
    .select(
      "teamA teamB winner slotWinsA slotWinsB subMatches.result.scoreA subMatches.result.scoreB dreamBreaker.scoreA dreamBreaker.scoreB"
    )
    .lean();
  for (const d of duals) {
    const a = stat.get(String(d.teamA));
    const b = stat.get(String(d.teamB));
    if (!a || !b) continue;
    if (d.winner === "A") {
      a.wins += 1;
      b.losses += 1;
    } else if (d.winner === "B") {
      b.wins += 1;
      a.losses += 1;
    }
    a.slotsFor += Number(d.slotWinsA) || 0;
    a.slotsAgainst += Number(d.slotWinsB) || 0;
    b.slotsFor += Number(d.slotWinsB) || 0;
    b.slotsAgainst += Number(d.slotWinsA) || 0;
    for (const sm of d.subMatches || []) {
      a.pointsFor += Number(sm?.result?.scoreA) || 0;
      a.pointsAgainst += Number(sm?.result?.scoreB) || 0;
      b.pointsFor += Number(sm?.result?.scoreB) || 0;
      b.pointsAgainst += Number(sm?.result?.scoreA) || 0;
    }
    // DreamBreaker cũng cộng vào pointsFor/Against
    if (d.dreamBreaker) {
      a.pointsFor += Number(d.dreamBreaker.scoreA) || 0;
      a.pointsAgainst += Number(d.dreamBreaker.scoreB) || 0;
      b.pointsFor += Number(d.dreamBreaker.scoreB) || 0;
      b.pointsAgainst += Number(d.dreamBreaker.scoreA) || 0;
    }
  }
  const ops = [];
  for (const [id, s] of stat) {
    ops.push({
      updateOne: {
        filter: { _id: oid(id) },
        update: { $set: { standing: s } },
      },
    });
  }
  if (ops.length) await MlpTeam.bulkWrite(ops);
}

// Build head-to-head map cho tie-break: teamId -> { opponentId: {won, lost} }
// scope: "all" | "group" — group thì chỉ tính dual phase=group.
async function buildHeadToHeadMap(tid, { scope = "all" } = {}) {
  const query = {
    tournament: tid,
    status: "finished",
    winner: { $in: ["A", "B"] },
  };
  if (scope === "group") query.phase = "group";
  const duals = await MlpDualMatch.find(query)
    .select("teamA teamB winner")
    .lean();
  const h2h = new Map();
  const get = (a, b) => {
    if (!h2h.has(a)) h2h.set(a, new Map());
    const inner = h2h.get(a);
    if (!inner.has(b)) inner.set(b, { won: 0, lost: 0 });
    return inner.get(b);
  };
  for (const d of duals) {
    const a = String(d.teamA);
    const b = String(d.teamB);
    if (d.winner === "A") {
      get(a, b).won += 1;
      get(b, a).lost += 1;
    } else if (d.winner === "B") {
      get(b, a).won += 1;
      get(a, b).lost += 1;
    }
  }
  return h2h;
}

// Aggregate rows từ team.standing + apply tiebreak sort.
// h2h optional — nếu có thì dùng head-to-head khi cùng wins.
function sortStandingRows(rows, h2h) {
  return rows
    .map((r) => ({
      ...r,
      played: (Number(r.wins) || 0) + (Number(r.losses) || 0),
      slotDiff:
        (Number(r.slotsFor) || 0) - (Number(r.slotsAgainst) || 0),
      pointDiff:
        (Number(r.pointsFor) || 0) - (Number(r.pointsAgainst) || 0),
    }))
    .sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      if (h2h) {
        const rec = h2h.get(String(a._id))?.get(String(b._id));
        if (rec && rec.won !== rec.lost) return rec.lost - rec.won;
      }
      if (a.slotDiff !== b.slotDiff) return b.slotDiff - a.slotDiff;
      if (a.pointDiff !== b.pointDiff) return b.pointDiff - a.pointDiff;
      return String(a.name).localeCompare(String(b.name), "vi");
    })
    .map((row, idx) => ({ rank: idx + 1, ...row }));
}

// GET /api/mlp/tournaments/:tid/standings
// Sort: wins → head-to-head (khi 2 team cùng wins) → slotDiff → pointDiff → name
// Nếu tournament.mlpConfig.groupStage.enabled → trả về thêm `pools: [{key, items[]}]`.
export const getMlpStandings = asyncHandler(async (req, res) => {
  const tour = await Tournament.findById(req.params.tid)
    .select("mlpConfig tournamentMode")
    .lean();
  const teams = await MlpTeam.find({
    tournament: req.params.tid,
    status: "approved",
  })
    .select("name shortName logo color standing poolKey poolIndex seed")
    .lean();
  const buildRow = (t) => {
    const s = t.standing || {};
    return {
      _id: t._id,
      name: t.name,
      shortName: t.shortName,
      logo: t.logo,
      color: t.color,
      poolKey: t.poolKey || null,
      poolIndex: Number.isFinite(t.poolIndex) ? t.poolIndex : null,
      seed: t.seed || null,
      wins: Number(s.wins) || 0,
      losses: Number(s.losses) || 0,
      slotsFor: Number(s.slotsFor) || 0,
      slotsAgainst: Number(s.slotsAgainst) || 0,
      pointsFor: Number(s.pointsFor) || 0,
      pointsAgainst: Number(s.pointsAgainst) || 0,
    };
  };
  const rows = teams.map(buildRow);

  const h2hAll = await buildHeadToHeadMap(req.params.tid);
  const items = sortStandingRows(rows, h2hAll);

  const gs = tour?.mlpConfig?.groupStage || null;
  let pools = null;
  if (gs?.enabled) {
    const h2hGroup = await buildHeadToHeadMap(req.params.tid, {
      scope: "group",
    });
    // Recompute per-pool: scope stats từ chỉ dual phase="group".
    // Đơn giản là filter rows theo poolKey, sort với h2hGroup — nhưng standing
    // hiện là aggregate all-phase. Để nghiêm ngặt: recompute per-pool inline.
    const groupDuals = await MlpDualMatch.find({
      tournament: req.params.tid,
      phase: "group",
      status: "finished",
    })
      .select(
        "teamA teamB winner slotWinsA slotWinsB poolKey subMatches.result.scoreA subMatches.result.scoreB dreamBreaker.scoreA dreamBreaker.scoreB",
      )
      .lean();
    const groupStat = new Map(); // teamId → stat
    const ensureStat = (id) => {
      const k = String(id);
      if (!groupStat.has(k)) {
        groupStat.set(k, {
          wins: 0,
          losses: 0,
          slotsFor: 0,
          slotsAgainst: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        });
      }
      return groupStat.get(k);
    };
    for (const d of groupDuals) {
      const a = ensureStat(d.teamA);
      const b = ensureStat(d.teamB);
      if (d.winner === "A") {
        a.wins += 1;
        b.losses += 1;
      } else if (d.winner === "B") {
        b.wins += 1;
        a.losses += 1;
      }
      a.slotsFor += Number(d.slotWinsA) || 0;
      a.slotsAgainst += Number(d.slotWinsB) || 0;
      b.slotsFor += Number(d.slotWinsB) || 0;
      b.slotsAgainst += Number(d.slotWinsA) || 0;
      for (const sm of d.subMatches || []) {
        a.pointsFor += Number(sm?.result?.scoreA) || 0;
        a.pointsAgainst += Number(sm?.result?.scoreB) || 0;
        b.pointsFor += Number(sm?.result?.scoreB) || 0;
        b.pointsAgainst += Number(sm?.result?.scoreA) || 0;
      }
      if (d.dreamBreaker) {
        a.pointsFor += Number(d.dreamBreaker.scoreA) || 0;
        a.pointsAgainst += Number(d.dreamBreaker.scoreB) || 0;
        b.pointsFor += Number(d.dreamBreaker.scoreB) || 0;
        b.pointsAgainst += Number(d.dreamBreaker.scoreA) || 0;
      }
    }
    const byPool = new Map();
    for (const t of teams) {
      if (!t.poolKey) continue;
      const stat = groupStat.get(String(t._id)) || {
        wins: 0,
        losses: 0,
        slotsFor: 0,
        slotsAgainst: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      };
      const row = {
        _id: t._id,
        name: t.name,
        shortName: t.shortName,
        logo: t.logo,
        color: t.color,
        poolKey: t.poolKey,
        poolIndex: t.poolIndex,
        seed: t.seed || null,
        ...stat,
      };
      if (!byPool.has(t.poolKey)) {
        byPool.set(t.poolKey, {
          key: t.poolKey,
          index: t.poolIndex,
          rows: [],
        });
      }
      byPool.get(t.poolKey).rows.push(row);
    }
    pools = [...byPool.values()]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((p) => ({
        key: p.key,
        index: p.index,
        items: sortStandingRows(p.rows, h2hGroup),
      }));
  }

  res.json({
    items,
    pools,
    groupStage: gs
      ? {
          enabled: !!gs.enabled,
          poolCount: gs.poolCount,
          poolSize: gs.poolSize,
          topPerPool: gs.topPerPool,
          drawStatus: gs.drawStatus,
        }
      : null,
  });
});

// POST /api/mlp/tournaments/:tid/standings/recompute — admin trigger recalc
export const recomputeStandingsHandler = asyncHandler(async (req, res) => {
  const tour = await Tournament.findById(req.params.tid);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  await recomputeMlpStandings(req.params.tid);
  res.json({ success: true });
});

/* ═════════════════════ POOL DRAW (GROUP STAGE) ═════════════════════ */

// GET /api/mlp/tournaments/:tid/pools
// Trả về danh sách bảng + đội chưa gán bảng.
export const listMlpPools = asyncHandler(async (req, res) => {
  const tour = await Tournament.findById(req.params.tid)
    .select("_id name tournamentMode mlpConfig")
    .lean();
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  const { pools, unassigned } = await listPools(tour._id);
  res.json({
    groupStage: tour.mlpConfig?.groupStage || null,
    pools,
    unassigned,
  });
});

// POST /api/mlp/tournaments/:tid/pools/draw
// body: {
//   method: "random" | "snake" | "manual",
//   // (random/snake) — override poolCount/poolSize từ config nếu cần
//   poolCount?: number, poolSize?: number,
//   // (snake) — thứ tự seed đã sort giảm dần (mạnh nhất trước)
//   seedOrder?: [teamId],
//   // (manual) — assignments cụ thể
//   assignments?: [{ teamId, poolIndex?, poolKey?, seed? }],
//   // tuỳ chọn — không apply lên DB, chỉ preview
//   dryRun?: boolean,
// }
export const drawMlpPools = asyncHandler(async (req, res) => {
  const tour = await Tournament.findById(req.params.tid);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền bốc thăm");
  }
  if (tour.tournamentMode !== "mlp") {
    res.status(400);
    throw new Error("Giải này không MLP");
  }
  const gs = tour.mlpConfig?.groupStage || {};
  if (!gs.enabled) {
    res.status(400);
    throw new Error(
      "Vòng bảng chưa bật trong cấu hình MLP. Vào Cấu hình → Vòng bảng để bật.",
    );
  }
  const body = req.body || {};
  const method = ["random", "snake", "manual"].includes(body.method)
    ? body.method
    : "random";
  const poolCount = Math.max(
    1,
    Math.min(
      32,
      Number(body.poolCount) || Number(gs.poolCount) || 4,
    ),
  );

  const teams = await MlpTeam.find({
    tournament: tour._id,
    status: "approved",
  })
    .select("_id name standing")
    .lean();
  if (teams.length < 2) {
    res.status(400);
    throw new Error("Cần ít nhất 2 đội đã duyệt");
  }

  let assignments = [];
  if (method === "manual") {
    if (!Array.isArray(body.assignments) || body.assignments.length === 0) {
      res.status(400);
      throw new Error("assignments rỗng");
    }
    const validIds = new Set(teams.map((t) => String(t._id)));
    const seenPool = new Map(); // poolIndex → seed counter
    for (const a of body.assignments) {
      const teamId = String(a?.teamId || "");
      if (!validIds.has(teamId)) continue;
      let poolIndex = Number.isFinite(Number(a.poolIndex))
        ? Number(a.poolIndex)
        : null;
      if (poolIndex == null && typeof a.poolKey === "string") {
        // Reverse map poolKey (A → 0)
        const k = a.poolKey.toUpperCase();
        if (/^[A-Z]$/.test(k)) poolIndex = k.charCodeAt(0) - 65;
      }
      if (poolIndex == null || poolIndex < 0 || poolIndex >= poolCount) continue;
      const nextSeed = (seenPool.get(poolIndex) || 0) + 1;
      seenPool.set(poolIndex, nextSeed);
      assignments.push({
        teamId,
        poolIndex,
        poolKey: poolKeyFromIndex(poolIndex),
        seed: Number.isFinite(Number(a.seed)) ? Number(a.seed) : nextSeed,
      });
    }
    if (!assignments.length) {
      res.status(400);
      throw new Error("Không có assignment hợp lệ");
    }
  } else if (method === "snake") {
    let ordered = [];
    if (Array.isArray(body.seedOrder) && body.seedOrder.length) {
      const byId = new Map(teams.map((t) => [String(t._id), t]));
      ordered = body.seedOrder
        .map((id) => byId.get(String(id)))
        .filter(Boolean);
      // Đội còn lại không có trong seedOrder → append theo tên
      const inSeed = new Set(ordered.map((t) => String(t._id)));
      for (const t of teams) {
        if (!inSeed.has(String(t._id))) ordered.push(t);
      }
    } else {
      // Fallback: sort theo wins → tên
      ordered = teams.slice().sort((a, b) => {
        const wa = Number(a.standing?.wins) || 0;
        const wb = Number(b.standing?.wins) || 0;
        if (wa !== wb) return wb - wa;
        return String(a.name).localeCompare(String(b.name), "vi");
      });
    }
    assignments = distributeSnake(
      ordered.map((t) => t._id),
      poolCount,
    );
  } else {
    // random
    const shuffled = shuffleInPlace(teams.slice());
    assignments = distributeRoundRobin(
      shuffled.map((t) => t._id),
      poolCount,
    );
  }

  if (body.dryRun) {
    const byId = new Map(teams.map((t) => [String(t._id), t]));
    return res.json({
      success: true,
      dryRun: true,
      method,
      poolCount,
      assignments: assignments.map((a) => ({
        ...a,
        name: byId.get(String(a.teamId))?.name || null,
      })),
    });
  }

  const { updated, cleared } = await applyPoolAssignments(
    tour._id,
    assignments,
  );

  // Cập nhật drawStatus
  const cfg = tour.mlpConfig || {};
  cfg.groupStage = {
    ...(cfg.groupStage || {}),
    poolCount,
    drawStatus: "committed",
    drawnAt: new Date(),
    seedMethod: method,
  };
  tour.mlpConfig = cfg;
  await tour.save();

  const { pools, unassigned } = await listPools(tour._id);
  res.json({
    success: true,
    method,
    poolCount,
    updated,
    cleared,
    pools,
    unassigned,
    groupStage: cfg.groupStage,
  });
});

// Emit tới room mlp:tour:${tid}
function emitMlpTour(tid, event, payload) {
  try {
    const io = getIO?.();
    if (io) io.to(`mlp:tour:${tid}`).emit(event, payload);
  } catch (err) {
    console.error("[mlp] emitMlpTour error:", err?.message || err);
  }
}

// ─── LIVE DRAW STAGE ─────────────────────────────────────
// Backend giữ minimal state: chỉ relay socket event. Operator (BTC) drive
// bốc thăm ở /tournament/:id/mlp/draw/live, viewers subscribe room
// mlp:tour:${tid} để xem realtime. Commit qua endpoint pools/draw hiện có.

// POST /api/mlp/tournaments/:tid/pools/live-draw/broadcast
// body: { event, payload }
// event whitelist: "start" | "reveal" | "reset" | "commit" | "highlight"
// Chỉ manager mới được broadcast (chống spam).
const LIVE_DRAW_EVENTS = new Set([
  "start",
  "reveal",
  "reset",
  "commit",
  "highlight",
  "countdown",
]);
export const broadcastMlpLiveDraw = asyncHandler(async (req, res) => {
  const tour = await Tournament.findById(req.params.tid).select(
    "_id tournamentMode createdBy managers",
  );
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const event = String(req.body?.event || "").trim();
  if (!LIVE_DRAW_EVENTS.has(event)) {
    res.status(400);
    throw new Error("Event không hợp lệ");
  }
  const payload = req.body?.payload || {};
  emitMlpTour(tour._id, `mlp:draw:${event}`, {
    tourId: String(tour._id),
    at: Date.now(),
    ...payload,
  });
  res.json({ success: true });
});

// POST /api/mlp/tournaments/:tid/pools/reset
export const resetMlpPools = asyncHandler(async (req, res) => {
  const tour = await Tournament.findById(req.params.tid);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const cleared = await resetPoolAssignments(tour._id);
  const cfg = tour.mlpConfig || {};
  cfg.groupStage = {
    ...(cfg.groupStage || {}),
    drawStatus: "idle",
    drawnAt: null,
  };
  tour.mlpConfig = cfg;
  await tour.save();
  res.json({ success: true, cleared, groupStage: cfg.groupStage });
});

/* ═════════════════════ TOURNAMENT MLP CONFIG ═════════════════════ */

// PATCH /api/tournaments/:id/mlp-config — cập nhật mlpConfig (admin/manager)
export const updateMlpConfig = asyncHandler(async (req, res) => {
  const tour = await Tournament.findById(req.params.id);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền cấu hình MLP cho giải này");
  }
  if (tour.tournamentMode !== "mlp") {
    res.status(400);
    throw new Error(
      "Giải này không ở chế độ MLP. Đổi tournamentMode='mlp' trước.",
    );
  }

  const body = req.body || {};
  const cfg = tour.mlpConfig || {};

  if (Number.isFinite(Number(body.minRosterSize)))
    cfg.minRosterSize = Math.max(1, Math.min(30, Number(body.minRosterSize)));
  if (Number.isFinite(Number(body.maxRosterSize)))
    cfg.maxRosterSize = Math.max(1, Math.min(30, Number(body.maxRosterSize)));
  if (Array.isArray(body.slots)) {
    cfg.slots = body.slots
      .slice(0, 20)
      .map((s, idx) => ({
        key: String(s.key || `S${idx + 1}`).slice(0, 20),
        label: String(s.label || "").slice(0, 60),
        matchType: ["single", "double"].includes(s.matchType)
          ? s.matchType
          : "double",
        genderRule: ["any", "male", "female", "mixed"].includes(s.genderRule)
          ? s.genderRule
          : "any",
        order: Number.isFinite(Number(s.order)) ? Number(s.order) : idx,
      }));
  }
  if ([11, 15, 21].includes(Number(body.pointsToWin)))
    cfg.pointsToWin = Number(body.pointsToWin);
  if (typeof body.winByTwo === "boolean") cfg.winByTwo = body.winByTwo;
  if (body.cap && typeof body.cap === "object") {
    const mode = ["none", "hard", "soft"].includes(body.cap.mode)
      ? body.cap.mode
      : "none";
    let points = null;
    if (mode !== "none") {
      const raw = body.cap.points;
      const n = raw == null || raw === "" ? NaN : Number(raw);
      points = Number.isFinite(n) && n >= 1 ? Math.min(99, Math.floor(n)) : null;
    }
    cfg.cap = { mode, points };
  }
  if (typeof body.rallyScoring === "boolean")
    cfg.rallyScoring = body.rallyScoring;
  if (body.dreamBreaker && typeof body.dreamBreaker === "object") {
    const db = body.dreamBreaker;
    cfg.dreamBreaker = {
      enabled: db.enabled !== false,
      pointsToWin: Math.max(1, Math.min(99, Number(db.pointsToWin) || 21)),
      rotationEveryPoints: Math.max(
        1,
        Math.min(21, Number(db.rotationEveryPoints) || 4),
      ),
      winByTwo: !!db.winByTwo,
    };
  }
  if (body.groupStage && typeof body.groupStage === "object") {
    const gs = body.groupStage;
    const prev = cfg.groupStage || {};
    cfg.groupStage = {
      enabled: gs.enabled === true,
      poolCount: Math.max(1, Math.min(32, Number(gs.poolCount) || 4)),
      poolSize: Math.max(2, Math.min(32, Number(gs.poolSize) || 4)),
      topPerPool: Math.max(1, Math.min(16, Number(gs.topPerPool) || 2)),
      doubleRound: !!gs.doubleRound,
      seedMethod: ["random", "snake", "manual"].includes(gs.seedMethod)
        ? gs.seedMethod
        : "random",
      tiebreakers: Array.isArray(gs.tiebreakers)
        ? gs.tiebreakers.slice(0, 10).map(String)
        : prev.tiebreakers || [
            "wins",
            "headToHead",
            "slotDiff",
            "pointDiff",
            "pointsFor",
          ],
      // Preserve draw state khi chỉ update settings
      drawStatus: prev.drawStatus || "idle",
      drawnAt: prev.drawnAt || null,
    };
  }

  tour.mlpConfig = cfg;
  await tour.save();
  res.json({ success: true, mlpConfig: tour.mlpConfig });
});

/* ═════════════════════ TEAM CRUD ═════════════════════ */

// POST /api/mlp/tournaments/:tid/teams
// body: { name, shortName?, logo?, color?, players: [userId], captain: userId? }
export const createMlpTeam = asyncHandler(async (req, res) => {
  const { tid } = req.params;
  const tour = await Tournament.findById(tid);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (tour.tournamentMode !== "mlp") {
    res.status(400);
    throw new Error("Giải này không ở chế độ MLP");
  }

  const cfg = tour.mlpConfig || {};
  const minSize = cfg.minRosterSize || 1;
  const maxSize = cfg.maxRosterSize || 30;

  const body = req.body || {};
  const players = Array.isArray(body.players)
    ? [...new Set(body.players.filter((id) => mongoose.isValidObjectId(id)))]
    : [];
  const captain = mongoose.isValidObjectId(body.captain)
    ? body.captain
    : String(req.user?._id || "");

  if (!captain) {
    res.status(400);
    throw new Error("Cần captain (userId)");
  }
  // Captain auto có trong roster
  if (!players.some((p) => String(p) === String(captain))) {
    players.unshift(captain);
  }
  if (players.length < minSize) {
    res.status(400);
    throw new Error(`Roster tối thiểu ${minSize} VĐV`);
  }
  if (players.length > maxSize) {
    res.status(400);
    throw new Error(`Roster tối đa ${maxSize} VĐV`);
  }
  if (!body.name || !String(body.name).trim()) {
    res.status(400);
    throw new Error("Cần nhập tên team");
  }

  // Không cho phép trùng captain hoặc trùng VĐV giữa các team pending/approved
  const conflict = await MlpTeam.findOne({
    tournament: tid,
    status: { $in: ["pending", "approved"] },
    players: { $in: players },
  })
    .select("_id name players")
    .lean();
  if (conflict) {
    res.status(400);
    throw new Error(
      `VĐV đã có trong team "${conflict.name}". Mỗi VĐV chỉ được thuộc 1 team trong giải.`,
    );
  }

  // Waitlist: nếu tour.maxPairs > 0 và số team approved đã đạt → team mới
  // vào waitlist (kể cả BTC tạo, để công bằng với đội đăng ký trước).
  let waitlisted = false;
  if (tour.maxPairs && tour.maxPairs > 0) {
    const currentApproved = await MlpTeam.countDocuments({
      tournament: tid,
      status: { $in: ["approved", "pending"] },
    });
    if (currentApproved >= tour.maxPairs) waitlisted = true;
  }

  const isManager = canManageTournament(req.user, tour);
  const doc = await MlpTeam.create({
    tournament: tid,
    name: String(body.name).trim().slice(0, 100),
    shortName: String(body.shortName || "").slice(0, 20),
    logo: String(body.logo || "").slice(0, 500),
    color: String(body.color || "").slice(0, 20),
    captain,
    players,
    createdBy: req.user._id,
    // Ưu tiên waitlist nếu quá cap. Ngược lại: admin/manager → approved,
    // user thường → pending.
    status: waitlisted ? "waitlisted" : isManager ? "approved" : "pending",
    approvedBy: waitlisted ? null : isManager ? req.user._id : null,
    approvedAt: waitlisted ? null : isManager ? new Date() : null,
  });
  res.status(201).json(doc);
});

// GET /api/mlp/tournaments/:tid/teams?status=&cursor=&limit=
export const listMlpTeams = asyncHandler(async (req, res) => {
  const { tid } = req.params;
  if (!mongoose.isValidObjectId(tid)) {
    res.status(400);
    throw new Error("tid không hợp lệ");
  }
  const q = { tournament: tid };
  const status = req.query.status;
  if (
    status &&
    ["pending", "approved", "rejected", "withdrawn", "waitlisted"].includes(
      status,
    )
  ) {
    q.status = status;
  }
  const items = await MlpTeam.find(q)
    .sort({ createdAt: -1 })
    .populate("captain", "_id name nickname avatar phone")
    .populate("players", "_id name nickname avatar gender phone")
    .populate("approvedBy", "_id name nickname avatar")
    .lean();
  res.json({ items });
});

// GET /api/mlp/teams/:id
export const getMlpTeam = asyncHandler(async (req, res) => {
  const doc = await MlpTeam.findById(req.params.id)
    .populate("captain", "_id name nickname avatar phone")
    .populate("players", "_id name nickname avatar gender phone")
    .populate("approvedBy", "_id name nickname avatar");
  if (!doc) {
    res.status(404);
    throw new Error("Không tìm thấy team");
  }
  res.json(doc);
});

// PATCH /api/mlp/teams/:id — captain/admin sửa roster + info
export const updateMlpTeam = asyncHandler(async (req, res) => {
  const doc = await MlpTeam.findById(req.params.id);
  if (!doc) {
    res.status(404);
    throw new Error("Không tìm thấy team");
  }
  const tour = await Tournament.findById(doc.tournament);
  const isOwner = String(doc.captain) === String(req.user?._id);
  const canEdit = isOwner || canManageTournament(req.user, tour);
  if (!canEdit) {
    res.status(403);
    throw new Error("Không có quyền sửa team này");
  }

  const body = req.body || {};
  if (body.name != null) doc.name = String(body.name).trim().slice(0, 100);
  if (body.shortName != null)
    doc.shortName = String(body.shortName).slice(0, 20);
  if (body.logo != null) doc.logo = String(body.logo).slice(0, 500);
  if (body.color != null) doc.color = String(body.color).slice(0, 20);

  if (Array.isArray(body.players)) {
    const cfg = tour?.mlpConfig || {};
    const minSize = cfg.minRosterSize || 1;
    const maxSize = cfg.maxRosterSize || 30;
    const players = [
      ...new Set(body.players.filter((id) => mongoose.isValidObjectId(id))),
    ];
    if (!players.some((p) => String(p) === String(doc.captain))) {
      players.unshift(String(doc.captain));
    }
    if (players.length < minSize) {
      res.status(400);
      throw new Error(`Roster tối thiểu ${minSize} VĐV`);
    }
    if (players.length > maxSize) {
      res.status(400);
      throw new Error(`Roster tối đa ${maxSize} VĐV`);
    }
    // Conflict với team khác
    const conflict = await MlpTeam.findOne({
      _id: { $ne: doc._id },
      tournament: doc.tournament,
      status: { $in: ["pending", "approved"] },
      players: { $in: players },
    })
      .select("_id name")
      .lean();
    if (conflict) {
      res.status(400);
      throw new Error(`Có VĐV đã ở team khác: ${conflict.name}`);
    }
    doc.players = players;
  }

  // Admin approve/reject/withdraw/promote-from-waitlist
  let statusChanged = null;
  const prevStatus = doc.status;
  if (
    body.status &&
    ["pending", "approved", "rejected", "withdrawn", "waitlisted"].includes(
      body.status,
    ) &&
    canManageTournament(req.user, tour)
  ) {
    if (doc.status !== body.status) statusChanged = body.status;
    doc.status = body.status;
    if (body.status === "approved") {
      doc.approvedBy = req.user._id;
      doc.approvedAt = new Date();
    }
  }

  // Admin update payment
  if (
    body.payment &&
    typeof body.payment === "object" &&
    canManageTournament(req.user, tour)
  ) {
    const p = body.payment;
    doc.payment = {
      status: ["unpaid", "partial", "paid"].includes(p.status)
        ? p.status
        : doc.payment?.status || "unpaid",
      amount: Number.isFinite(Number(p.amount))
        ? Number(p.amount)
        : doc.payment?.amount || 0,
      paidAt:
        p.status === "paid"
          ? new Date()
          : p.paidAt
            ? new Date(p.paidAt)
            : null,
      note: String(p.note ?? doc.payment?.note ?? "").slice(0, 500),
    };
  }

  await doc.save();
  if (statusChanged && ["approved", "rejected"].includes(statusChanged)) {
    notifyMlpTeamStatus({
      team: doc,
      tournamentId: doc.tournament,
      status: statusChanged,
    }).catch(() => {});
  }
  // Auto-promote FIFO nếu team approved bị chuyển sang rejected/withdrawn.
  if (
    statusChanged &&
    ["rejected", "withdrawn"].includes(statusChanged) &&
    ["approved", "pending"].includes(prevStatus)
  ) {
    try {
      const { autoPromoteMlpTeamFromWaitlist } = await import(
        "../services/waitlistService.js"
      );
      await autoPromoteMlpTeamFromWaitlist(doc.tournament, req.user?._id);
    } catch (err) {
      console.error(
        "[waitlist] mlp auto-promote after status change error:",
        err?.message || err,
      );
    }
  }
  res.json(doc);
});

// DELETE /api/mlp/teams/:id — captain rút, admin xoá
export const deleteMlpTeam = asyncHandler(async (req, res) => {
  const doc = await MlpTeam.findById(req.params.id);
  if (!doc) {
    res.status(404);
    throw new Error("Không tìm thấy team");
  }
  const tour = await Tournament.findById(doc.tournament);
  const isOwner = String(doc.captain) === String(req.user?._id);
  const isMgr = canManageTournament(req.user, tour);
  if (!isOwner && !isMgr) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  // Nếu team đã có dual match → không cho xoá cứng
  const inMatch = await MlpDualMatch.exists({
    tournament: doc.tournament,
    $or: [{ teamA: doc._id }, { teamB: doc._id }],
  });
  if (inMatch && !isMgr) {
    res.status(400);
    throw new Error("Team đã có trận đấu, không thể xoá. Chỉ admin mới xoá được.");
  }
  const wasApprovedOrPending = ["approved", "pending"].includes(doc.status);
  const tournamentId = doc.tournament;
  await doc.deleteOne();

  // Auto-promote FIFO khi team approved/pending bị xoá.
  if (wasApprovedOrPending) {
    try {
      const { autoPromoteMlpTeamFromWaitlist } = await import(
        "../services/waitlistService.js"
      );
      await autoPromoteMlpTeamFromWaitlist(tournamentId, req.user?._id);
    } catch (err) {
      console.error(
        "[waitlist] mlp auto-promote after delete error:",
        err?.message || err,
      );
    }
  }
  res.json({ success: true });
});

/* ═════════════════════ DUAL MATCHES (Phase 3) ═════════════════════ */

// POST /api/mlp/tournaments/:tid/duals/generate
// body: { format: "roundrobin"|"single_elim", teamIds?: [id] }
// POST /api/mlp/tournaments/:tid/duals/generate-knockout
// body: {
//   topN?: number,               // (flat mode) lấy top N global — mặc định 4
//   seedByStanding?: boolean,    // (flat mode) sort theo BXH
//   topPerPool?: number,         // (group mode) override mlpConfig.groupStage.topPerPool
//   crossPoolPairing?: "cross" | "adjacent",  // (group mode) A1-B2 kiểu chéo hay A1-A2
// }
//
// Sinh full bracket (round 1..N). Round 1 điền teamA/B thật, round 2+ để null
// (auto-advance sẽ điền khi round trước finished).
export const generateMlpKnockout = asyncHandler(async (req, res) => {
  const { tid } = req.params;
  const tour = await Tournament.findById(tid);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  if (tour.tournamentMode !== "mlp") {
    res.status(400);
    throw new Error("Giải này không MLP");
  }

  const slots = tour.mlpConfig?.slots || [];
  if (!slots.length) {
    res.status(400);
    throw new Error("Chưa cấu hình slots MLP");
  }

  const gs = tour.mlpConfig?.groupStage || {};
  const useGroupStage = gs.enabled === true;

  // Danh sách qualified — mỗi entry:
  //   { poolKey?, poolRank?, team: MlpTeam|null }
  // team=null có nghĩa "chưa xác định" → frontend hiện placeholder từ
  // sourceA/B (poolKey + poolRank).
  let qualified = [];
  let mode = "flat";
  if (useGroupStage) {
    mode = "group";
    const topPerPool = Math.max(
      1,
      Math.min(16, Number(req.body?.topPerPool) || Number(gs.topPerPool) || 2),
    );
    const teams = await MlpTeam.find({
      tournament: tid,
      status: "approved",
    })
      .select("_id name shortName logo color standing poolKey poolIndex seed")
      .lean();
    if (!teams.some((t) => t.poolKey)) {
      res.status(400);
      throw new Error(
        "Chưa bốc thăm chia bảng. Bốc thăm trước khi sinh knockout.",
      );
    }
    // Aggregate per-pool standings (giống getMlpStandings) — có thể rỗng
    // nếu chưa chấm dual nào (preview mode).
    const groupDuals = await MlpDualMatch.find({
      tournament: tid,
      phase: "group",
      status: "finished",
    })
      .select("teamA teamB winner slotWinsA slotWinsB poolKey subMatches.result.scoreA subMatches.result.scoreB dreamBreaker.scoreA dreamBreaker.scoreB")
      .lean();
    const stat = new Map();
    const ensureStat = (id) => {
      const k = String(id);
      if (!stat.has(k)) {
        stat.set(k, {
          wins: 0,
          losses: 0,
          slotsFor: 0,
          slotsAgainst: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        });
      }
      return stat.get(k);
    };
    for (const d of groupDuals) {
      const a = ensureStat(d.teamA);
      const b = ensureStat(d.teamB);
      if (d.winner === "A") {
        a.wins += 1;
        b.losses += 1;
      } else if (d.winner === "B") {
        b.wins += 1;
        a.losses += 1;
      }
      a.slotsFor += Number(d.slotWinsA) || 0;
      a.slotsAgainst += Number(d.slotWinsB) || 0;
      b.slotsFor += Number(d.slotWinsB) || 0;
      b.slotsAgainst += Number(d.slotWinsA) || 0;
      for (const sm of d.subMatches || []) {
        a.pointsFor += Number(sm?.result?.scoreA) || 0;
        a.pointsAgainst += Number(sm?.result?.scoreB) || 0;
        b.pointsFor += Number(sm?.result?.scoreB) || 0;
        b.pointsAgainst += Number(sm?.result?.scoreA) || 0;
      }
      if (d.dreamBreaker) {
        a.pointsFor += Number(d.dreamBreaker.scoreA) || 0;
        a.pointsAgainst += Number(d.dreamBreaker.scoreB) || 0;
        b.pointsFor += Number(d.dreamBreaker.scoreB) || 0;
        b.pointsAgainst += Number(d.dreamBreaker.scoreA) || 0;
      }
    }
    const h2hGroup = await buildHeadToHeadMap(tid, { scope: "group" });
    const byPool = new Map();
    for (const t of teams) {
      if (!t.poolKey) continue;
      const s = stat.get(String(t._id)) || {
        wins: 0,
        losses: 0,
        slotsFor: 0,
        slotsAgainst: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      };
      const row = { ...t, ...s };
      if (!byPool.has(t.poolKey)) byPool.set(t.poolKey, []);
      byPool.get(t.poolKey).push(row);
    }
    // Check pool có đủ dữ liệu resolve top-N chưa: đủ nghĩa là mọi dual
    // trong bảng đó đã finished (không còn dual pending/live).
    const pendingByPool = new Map(); // poolKey → count dual chưa xong
    const pendingDuals = await MlpDualMatch.find({
      tournament: tid,
      phase: "group",
      status: { $ne: "finished" },
    })
      .select("poolKey")
      .lean();
    for (const d of pendingDuals) {
      if (!d.poolKey) continue;
      pendingByPool.set(d.poolKey, (pendingByPool.get(d.poolKey) || 0) + 1);
    }
    // Sort per pool (only for bảng đã hoàn tất) + slice top-N
    const perPool = [...byPool.entries()]
      .sort((a, b) => {
        const ai = a[1][0]?.poolIndex ?? 0;
        const bi = b[1][0]?.poolIndex ?? 0;
        return ai - bi;
      })
      .map(([key, rows]) => {
        const poolResolved = !pendingByPool.has(key);
        const sorted = poolResolved
          ? sortStandingRows(rows, h2hGroup).slice(0, topPerPool)
          : []; // preview mode: chưa resolve
        return { key, resolved: poolResolved, rows: sorted };
      });
    // Cross-pool pairing (mặc định): A1-B2, B1-A2, C1-D2, D1-C2, ...
    const pairing =
      req.body?.crossPoolPairing === "adjacent" ? "adjacent" : "cross";
    if (pairing === "cross" && perPool.length >= 2 && topPerPool >= 2) {
      for (let i = 0; i < perPool.length; i += 2) {
        const p1 = perPool[i];
        const p2 = perPool[i + 1];
        for (let j = 0; j < topPerPool; j++) {
          const r2Idx = topPerPool - 1 - j;
          qualified.push({
            poolKey: p1?.key || null,
            poolRank: j + 1,
            team: p1?.resolved ? p1.rows[j] || null : null,
          });
          qualified.push({
            poolKey: p2?.key || null,
            poolRank: r2Idx + 1,
            team: p2?.resolved ? p2.rows[r2Idx] || null : null,
          });
        }
      }
    } else {
      // Adjacent: đội 1 mọi bảng trước, rồi đội 2 mọi bảng...
      for (let rank = 0; rank < topPerPool; rank++) {
        for (const p of perPool) {
          qualified.push({
            poolKey: p?.key || null,
            poolRank: rank + 1,
            team: p?.resolved ? p.rows[rank] || null : null,
          });
        }
      }
    }
  } else {
    const topN = Math.max(2, Math.min(32, Number(req.body?.topN) || 4));
    const seedByStanding = req.body?.seedByStanding !== false;
    const teams = await MlpTeam.find({
      tournament: tid,
      status: "approved",
    })
      .select("_id name shortName logo color standing")
      .lean();
    const sorted = seedByStanding
      ? teams
          .map((t) => ({
            ...t,
            slotDiff:
              (Number(t.standing?.slotsFor) || 0) -
              (Number(t.standing?.slotsAgainst) || 0),
            pointDiff:
              (Number(t.standing?.pointsFor) || 0) -
              (Number(t.standing?.pointsAgainst) || 0),
            wins: Number(t.standing?.wins) || 0,
          }))
          .sort((a, b) => {
            if (a.wins !== b.wins) return b.wins - a.wins;
            if (a.slotDiff !== b.slotDiff) return b.slotDiff - a.slotDiff;
            if (a.pointDiff !== b.pointDiff) return b.pointDiff - a.pointDiff;
            return String(a.name).localeCompare(String(b.name), "vi");
          })
      : teams;
    // Flat mode: build qualified thành shape đồng nhất {team}
    qualified = sorted.slice(0, topN).map((t) => ({ team: t }));
  }

  if (qualified.length < 2) {
    res.status(400);
    throw new Error("Cần ít nhất 2 entry qualified");
  }

  // Pad về power-of-two với entry rỗng
  let size = 2;
  while (size < qualified.length) size *= 2;
  const seeded = [...qualified];
  while (seeded.length < size) seeded.push({ team: null });

  const totalRounds = Math.log2(size);

  // Xoá knockout cũ (phase="knockout" hoặc round≥2 cũ chưa đá).
  await MlpDualMatch.deleteMany({
    tournament: tid,
    $or: [
      { phase: "knockout" },
      { phase: null, round: { $gte: 2 }, slotWinsA: 0, slotWinsB: 0 },
    ],
  });

  // Tạo tất cả round shells trước (round 2..N), rồi round 1 (điền teamA/B).
  const shellsByRound = new Map(); // round → [doc, doc, ...]
  for (let r = totalRounds; r >= 2; r--) {
    const count = Math.pow(2, totalRounds - r);
    const arr = [];
    for (let i = 0; i < count; i++) {
      const doc = await MlpDualMatch.create({
        tournament: tid,
        round: r + 1,
        order: i,
        phase: "knockout",
        knockoutRound: r,
        bracketSlot: i,
        teamA: null,
        teamB: null,
        // Nguồn: 2 dual con trong round r-1 (order 2i và 2i+1)
        sourceA: { kind: "winner", fromMatchOrder: 2 * i },
        sourceB: { kind: "winner", fromMatchOrder: 2 * i + 1 },
        subMatches: buildSubMatchesTemplate(slots),
        status: "scheduled",
        createdBy: req.user._id,
      });
      arr.push(doc);
    }
    shellsByRound.set(r, arr);
  }

  const round1 = [];
  const pairs = Math.floor(size / 2);
  const isGroupCross =
    useGroupStage && req.body?.crossPoolPairing !== "adjacent";
  for (let i = 0; i < pairs; i++) {
    let entryA, entryB;
    if (isGroupCross) {
      entryA = seeded[2 * i];
      entryB = seeded[2 * i + 1];
    } else {
      entryA = seeded[i];
      entryB = seeded[size - 1 - i];
    }
    const parent = shellsByRound.get(2)?.[Math.floor(i / 2)] || null;
    const teamAId = entryA?.team?._id || null;
    const teamBId = entryB?.team?._id || null;
    // sourceA/B: nếu có poolKey → placeholder poolRank; nếu không → null.
    const buildSource = (e) =>
      e && e.poolKey
        ? { kind: "poolRank", poolKey: e.poolKey, poolRank: e.poolRank || 1 }
        : { kind: null };
    const doc = await MlpDualMatch.create({
      tournament: tid,
      round: 2,
      order: i,
      phase: "knockout",
      knockoutRound: 1,
      bracketSlot: i,
      teamA: teamAId,
      teamB: teamBId,
      sourceA: buildSource(entryA),
      sourceB: buildSource(entryB),
      nextMatch: parent?._id || null,
      nextSlot: parent ? (i % 2 === 0 ? "A" : "B") : null,
      subMatches: buildSubMatchesTemplate(slots),
      status: "scheduled",
      createdBy: req.user._id,
    });
    round1.push(doc);
    // BYE auto-advance CHỈ khi 1 bên có team thật (không phải cả 2 placeholder)
    const oneNull = (teamAId && !teamBId) || (!teamAId && teamBId);
    const oneIsPlaceholder =
      (entryA?.poolKey && !teamAId) || (entryB?.poolKey && !teamBId);
    if (oneNull && !oneIsPlaceholder) {
      const winnerSide = teamAId ? "A" : "B";
      const winnerTeamId = teamAId || teamBId;
      doc.winner = winnerSide;
      doc.status = "finished";
      doc.finishedAt = new Date();
      await doc.save();
      if (parent && winnerTeamId) {
        const slot = i % 2 === 0 ? "teamA" : "teamB";
        parent[slot] = winnerTeamId;
        await parent.save();
      }
    }
  }

  // Link nextMatch cho round 2..N-1 → round tiếp
  for (let r = 2; r < totalRounds; r++) {
    const arr = shellsByRound.get(r) || [];
    const parents = shellsByRound.get(r + 1) || [];
    for (let i = 0; i < arr.length; i++) {
      const parent = parents[Math.floor(i / 2)];
      if (!parent) continue;
      arr[i].nextMatch = parent._id;
      arr[i].nextSlot = i % 2 === 0 ? "A" : "B";
      await arr[i].save();
    }
  }

  invalidateMlpTournament(tid, "mlp:knockout:generated");
  res.json({
    success: true,
    mode,
    size,
    totalRounds,
    round1Generated: round1.length,
    shellsGenerated: [...shellsByRound.values()].reduce(
      (n, arr) => n + arr.length,
      0,
    ),
    qualified: qualified.map((e) => ({
      _id: e.team?._id || null,
      name: e.team?.name || null,
      poolKey: e.poolKey || e.team?.poolKey || null,
      poolRank: e.poolRank || null,
      placeholder: !e.team,
    })),
  });
});

// Auto-resolve KO placeholder teams từ standings hiện tại. Gọi sau khi
// vòng bảng cuối kết thúc. Idempotent.
// Trả về số slot đã fill.
export async function resolveMlpKnockoutSlots(tournamentId) {
  try {
    // Lấy KO dual round 1 (knockoutRound=1) có sourceA/B kind="poolRank" và teamA/B null
    const koDuals = await MlpDualMatch.find({
      tournament: tournamentId,
      phase: "knockout",
      knockoutRound: 1,
      $or: [
        { teamA: null, "sourceA.kind": "poolRank" },
        { teamB: null, "sourceB.kind": "poolRank" },
      ],
    });
    if (!koDuals.length) return 0;
    // Compute per-pool standings
    const teams = await MlpTeam.find({
      tournament: tournamentId,
      status: "approved",
    })
      .select("_id name standing poolKey poolIndex")
      .lean();
    const groupDuals = await MlpDualMatch.find({
      tournament: tournamentId,
      phase: "group",
    })
      .select("teamA teamB winner slotWinsA slotWinsB status poolKey subMatches.result.scoreA subMatches.result.scoreB dreamBreaker.scoreA dreamBreaker.scoreB")
      .lean();
    // Chỉ resolve pool nào ĐÃ finish hết dual
    const finishedByPool = new Map();
    const totalByPool = new Map();
    for (const d of groupDuals) {
      if (!d.poolKey) continue;
      totalByPool.set(d.poolKey, (totalByPool.get(d.poolKey) || 0) + 1);
      if (d.status === "finished") {
        finishedByPool.set(d.poolKey, (finishedByPool.get(d.poolKey) || 0) + 1);
      }
    }
    const readyPools = new Set();
    for (const [k, total] of totalByPool) {
      if ((finishedByPool.get(k) || 0) >= total) readyPools.add(k);
    }
    if (!readyPools.size) return 0;

    // Aggregate stat per team
    const stat = new Map();
    const ensureStat = (id) => {
      const k = String(id);
      if (!stat.has(k)) {
        stat.set(k, {
          wins: 0,
          losses: 0,
          slotsFor: 0,
          slotsAgainst: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        });
      }
      return stat.get(k);
    };
    for (const d of groupDuals) {
      if (d.status !== "finished") continue;
      const a = ensureStat(d.teamA);
      const b = ensureStat(d.teamB);
      if (d.winner === "A") { a.wins++; b.losses++; }
      else if (d.winner === "B") { b.wins++; a.losses++; }
      a.slotsFor += Number(d.slotWinsA) || 0;
      a.slotsAgainst += Number(d.slotWinsB) || 0;
      b.slotsFor += Number(d.slotWinsB) || 0;
      b.slotsAgainst += Number(d.slotWinsA) || 0;
      for (const sm of d.subMatches || []) {
        a.pointsFor += Number(sm?.result?.scoreA) || 0;
        a.pointsAgainst += Number(sm?.result?.scoreB) || 0;
        b.pointsFor += Number(sm?.result?.scoreB) || 0;
        b.pointsAgainst += Number(sm?.result?.scoreA) || 0;
      }
      if (d.dreamBreaker) {
        a.pointsFor += Number(d.dreamBreaker.scoreA) || 0;
        a.pointsAgainst += Number(d.dreamBreaker.scoreB) || 0;
        b.pointsFor += Number(d.dreamBreaker.scoreB) || 0;
        b.pointsAgainst += Number(d.dreamBreaker.scoreA) || 0;
      }
    }
    const h2h = await buildHeadToHeadMap(tournamentId, { scope: "group" });
    const byPool = new Map();
    for (const t of teams) {
      if (!t.poolKey) continue;
      const s = stat.get(String(t._id)) || {
        wins: 0, losses: 0, slotsFor: 0, slotsAgainst: 0,
        pointsFor: 0, pointsAgainst: 0,
      };
      const row = { ...t, ...s };
      if (!byPool.has(t.poolKey)) byPool.set(t.poolKey, []);
      byPool.get(t.poolKey).push(row);
    }
    const sortedByPool = new Map();
    for (const [k, rows] of byPool) {
      sortedByPool.set(k, sortStandingRows(rows, h2h));
    }

    let filled = 0;
    for (const d of koDuals) {
      let dirty = false;
      const side = ["A", "B"];
      for (const s of side) {
        const src = s === "A" ? d.sourceA : d.sourceB;
        const teamField = s === "A" ? "teamA" : "teamB";
        if (d[teamField]) continue;
        if (src?.kind !== "poolRank" || !src.poolKey) continue;
        if (!readyPools.has(src.poolKey)) continue;
        const sorted = sortedByPool.get(src.poolKey) || [];
        const pick = sorted[Math.max(0, (src.poolRank || 1) - 1)];
        if (pick) {
          d[teamField] = pick._id;
          filled++;
          dirty = true;
        }
      }
      if (dirty) await d.save();
    }
    if (filled > 0) {
      invalidateMlpTournament(tournamentId, "mlp:knockout:resolved");
    }
    return filled;
  } catch (err) {
    console.error(
      "[mlp] resolveMlpKnockoutSlots error:",
      err?.message || err,
    );
    return 0;
  }
}

// POST /api/mlp/tournaments/:tid/duals/knockout/resolve — manual trigger
export const resolveMlpKnockoutHandler = asyncHandler(async (req, res) => {
  const tour = await Tournament.findById(req.params.tid);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const filled = await resolveMlpKnockoutSlots(tour._id);
  res.json({ success: true, filled });
});

// Helper — đưa winner của dual knockout vào slot round tiếp theo.
// Idempotent: nếu parent slot đã filled với winner này → no-op.
// Gọi khi dual knockout vừa finish (syncSubMatchResult / forceFinishMlpDual /
// syncMatchToMlpSubMatch).
export async function advanceMlpKnockoutWinner(dual) {
  try {
    if (!dual || dual.phase !== "knockout") return;
    if (!dual.nextMatch || !dual.nextSlot) return;
    if (!dual.winner || !["A", "B"].includes(dual.winner)) return;
    const winnerTeamId =
      dual.winner === "A" ? dual.teamA : dual.teamB;
    if (!winnerTeamId) return;
    const parent = await MlpDualMatch.findById(dual.nextMatch);
    if (!parent) return;
    const slotField = dual.nextSlot === "A" ? "teamA" : "teamB";
    // Skip nếu parent đã filled cùng winner (idempotent).
    if (parent[slotField] && String(parent[slotField]) === String(winnerTeamId)) {
      return;
    }
    parent[slotField] = winnerTeamId;
    await parent.save();
    emitMlpDual(parent._id, "mlp:dual:advance", {
      dualId: parent._id,
      slot: dual.nextSlot,
      teamId: winnerTeamId,
      fromDualId: dual._id,
    });
    // Cascade: nếu parent giờ đã đủ cả 2 slot và cả 2 đến từ BYE, có thể
    // trigger auto-advance tiếp (không giả định — trainer manual).
  } catch (err) {
    console.error(
      "[mlp] advanceMlpKnockoutWinner error:",
      err?.message || err,
    );
  }
}

// Helper — build sub-match template từ tournament slots (deep-clone-friendly)
function buildSubMatchesTemplate(slots) {
  return slots
    .slice()
    .sort((x, y) => (x.order || 0) - (y.order || 0))
    .map((s, i) => ({
      slotKey: s.key,
      order: i,
      playersA: [],
      playersB: [],
      match: null,
      result: {
        status: "pending",
        scoreA: 0,
        scoreB: 0,
        winner: null,
      },
    }));
}

export const generateMlpDuals = asyncHandler(async (req, res) => {
  const { tid } = req.params;
  const tour = await Tournament.findById(tid);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  if (tour.tournamentMode !== "mlp") {
    res.status(400);
    throw new Error("Giải này không MLP");
  }

  const body = req.body || {};
  const format = body.format === "single_elim" ? "single_elim" : "roundrobin";
  const teamFilter = { tournament: tid, status: "approved" };
  if (Array.isArray(body.teamIds) && body.teamIds.length) {
    teamFilter._id = {
      $in: body.teamIds.filter((x) => mongoose.isValidObjectId(x)),
    };
  }
  const teams = await MlpTeam.find(teamFilter)
    .select("_id name poolKey poolIndex seed")
    .lean();
  if (teams.length < 2) {
    res.status(400);
    throw new Error("Cần ít nhất 2 team đã duyệt để sinh dual matches");
  }

  const slots = tour.mlpConfig?.slots || [];
  if (!slots.length) {
    res.status(400);
    throw new Error("Chưa cấu hình slots — vào Cấu hình MLP trước");
  }

  // ─── Group stage branch ───
  const gs = tour.mlpConfig?.groupStage || {};
  const useGroupStage =
    gs.enabled === true && format === "roundrobin" && body.mode !== "flat";

  if (useGroupStage) {
    // Chia đội theo poolKey. Đội chưa gán bảng → skip (không sinh dual).
    const grouped = new Map(); // poolKey → [teams]
    for (const t of teams) {
      if (!t.poolKey || !Number.isFinite(t.poolIndex)) continue;
      if (!grouped.has(t.poolKey)) grouped.set(t.poolKey, []);
      grouped.get(t.poolKey).push(t);
    }
    if (grouped.size === 0) {
      res.status(400);
      throw new Error(
        "Chưa bốc thăm chia bảng. Vào Bốc thăm chia bảng trước khi sinh dual.",
      );
    }

    // Xoá dual vòng bảng CHƯA đá của giải này (giữ dual đã có score).
    await MlpDualMatch.deleteMany({
      tournament: tid,
      phase: "group",
      status: "scheduled",
      slotWinsA: 0,
      slotWinsB: 0,
    });
    // Xoá luôn dual round=1 cũ (từ mode flat trước đây) chưa đá — tránh dup.
    await MlpDualMatch.deleteMany({
      tournament: tid,
      phase: null,
      status: "scheduled",
      slotWinsA: 0,
      slotWinsB: 0,
    });

    const doubleRound = !!gs.doubleRound;
    let orderCounter = 0;
    const created = [];
    // Sort poolKey theo poolIndex để order dual A trước B trước C...
    const poolEntries = [...grouped.entries()].sort((a, b) => {
      const ai = a[1][0]?.poolIndex ?? 0;
      const bi = b[1][0]?.poolIndex ?? 0;
      return ai - bi;
    });
    for (const [poolKey, poolTeams] of poolEntries) {
      // Round-robin trong bảng
      const pairs = [];
      for (let i = 0; i < poolTeams.length; i++) {
        for (let j = i + 1; j < poolTeams.length; j++) {
          pairs.push([poolTeams[i], poolTeams[j]]);
        }
      }
      if (doubleRound) {
        const rev = pairs.map(([a, b]) => [b, a]);
        pairs.push(...rev);
      }
      for (const [a, b] of pairs) {
        const doc = await MlpDualMatch.create({
          tournament: tid,
          round: 1,
          order: orderCounter++,
          phase: "group",
          poolKey,
          teamA: a._id,
          teamB: b._id,
          subMatches: buildSubMatchesTemplate(slots),
          status: "scheduled",
          createdBy: req.user._id,
        });
        created.push(doc);
      }
    }

    return res.json({
      success: true,
      count: created.length,
      format,
      groupStage: true,
      pools: poolEntries.map(([key, arr]) => ({
        key,
        teamCount: arr.length,
      })),
    });
  }

  // ─── Flat (legacy) branch ───
  // Xoá dual matches cũ chưa bắt đầu (safeguard trước khi regenerate)
  await MlpDualMatch.deleteMany({
    tournament: tid,
    status: "scheduled",
    slotWinsA: 0,
    slotWinsB: 0,
  });

  const pairs = [];
  if (format === "roundrobin") {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        pairs.push([teams[i], teams[j]]);
      }
    }
  } else {
    // single_elim: pair adjacent teams; if odd, last team bye
    for (let i = 0; i + 1 < teams.length; i += 2) {
      pairs.push([teams[i], teams[i + 1]]);
    }
  }

  const created = [];
  for (let idx = 0; idx < pairs.length; idx++) {
    const [a, b] = pairs[idx];
    const doc = await MlpDualMatch.create({
      tournament: tid,
      round: format === "single_elim" ? 1 : 1,
      order: idx,
      teamA: a._id,
      teamB: b._id,
      subMatches: buildSubMatchesTemplate(slots),
      status: "scheduled",
      createdBy: req.user._id,
    });
    created.push(doc);
  }

  invalidateMlpTournament(tid, "mlp:duals:generated");
  res.json({ success: true, count: created.length, format });
});

// GET /api/mlp/tournaments/:tid/duals?status=
export const listMlpDuals = asyncHandler(async (req, res) => {
  const { tid } = req.params;
  const q = { tournament: tid };
  const status = req.query.status;
  if (
    status &&
    ["scheduled", "live", "tie_break", "finished"].includes(status)
  ) {
    q.status = status;
  }
  const items = await MlpDualMatch.find(q)
    .sort({ round: 1, order: 1 })
    .populate("teamA", "_id name shortName logo color captain")
    .populate("teamB", "_id name shortName logo color captain")
    .populate({
      path: "subMatches.playersA",
      select: "_id name nickname avatar gender",
    })
    .populate({
      path: "subMatches.playersB",
      select: "_id name nickname avatar gender",
    })
    .populate({
      path: "subMatches.referees",
      select: "_id name nickname avatar",
    })
    .populate({
      path: "subMatches.court",
      select: "_id name code",
    })
    .populate({
      path: "subMatches.courtStation",
      select: "_id name",
    })
    .populate({
      path: "dreamBreaker.lineupA",
      select: "_id name nickname avatar",
    })
    .populate({
      path: "dreamBreaker.lineupB",
      select: "_id name nickname avatar",
    })
    .populate("court", "_id name code")
    .populate("courtStation", "_id name")
    .populate("referees", "_id name nickname avatar")
    .lean();
  res.json({ items });
});

// GET /api/mlp/duals/:id
export const getMlpDual = asyncHandler(async (req, res) => {
  const doc = await MlpDualMatch.findById(req.params.id)
    // Nested populate cho roster team — LineupDialog cần user object đủ
    // (name/nickname/avatar/gender) để render checkbox chọn VĐV.
    .populate({
      path: "teamA",
      select: "_id name shortName logo color players captain",
      populate: {
        path: "players",
        select: "_id name nickname avatar gender",
      },
    })
    .populate({
      path: "teamB",
      select: "_id name shortName logo color players captain",
      populate: {
        path: "players",
        select: "_id name nickname avatar gender",
      },
    })
    .populate({
      path: "subMatches.playersA",
      select: "_id name nickname avatar gender",
    })
    .populate({
      path: "subMatches.playersB",
      select: "_id name nickname avatar gender",
    })
    .populate({
      path: "subMatches.referees",
      select: "_id name nickname avatar",
    })
    .populate({
      path: "subMatches.court",
      select: "_id name code",
    })
    .populate({
      path: "subMatches.courtStation",
      select: "_id name",
    })
    .populate({
      path: "dreamBreaker.lineupA",
      select: "_id name nickname avatar",
    })
    .populate({
      path: "dreamBreaker.lineupB",
      select: "_id name nickname avatar",
    })
    .populate("court", "_id name code")
    .populate("courtStation", "_id name")
    .populate("referees", "_id name nickname avatar");
  if (!doc) {
    res.status(404);
    throw new Error("Không tìm thấy");
  }
  res.json(doc);
});

// PATCH /api/mlp/duals/:id/subs/:subId/lineup
// body: { playersA: [uid], playersB: [uid] }
// PATCH /api/mlp/duals/:id — set court / courtStation / referees /
// scheduledAt / note. Manager/admin only. Không cho sửa nếu dual đã
// finished.
export const patchMlpDual = asyncHandler(async (req, res) => {
  const dual = await MlpDualMatch.findById(req.params.id);
  if (!dual) {
    res.status(404);
    throw new Error("Không tìm thấy dual");
  }
  const tour = await Tournament.findById(dual.tournament);
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  if (dual.status === "finished") {
    res.status(400);
    throw new Error("Dual đã kết thúc, không sửa được");
  }
  const b = req.body || {};
  if ("court" in b) {
    dual.court =
      b.court && mongoose.isValidObjectId(b.court) ? b.court : null;
  }
  let stationChanged = false;
  if ("courtStation" in b) {
    const newStation =
      b.courtStation && mongoose.isValidObjectId(b.courtStation)
        ? b.courtStation
        : null;
    stationChanged = String(dual.courtStation || "") !== String(newStation || "");
    dual.courtStation = newStation;
  }
  if (Array.isArray(b.referees)) {
    dual.referees = b.referees
      .filter((id) => mongoose.isValidObjectId(id))
      .slice(0, 5);
  }
  // Auto-fill referees từ courtStation.defaultReferees khi đổi sân
  // (nếu client không truyền referees explicit). "Trọng tài đứng theo sân"
  // — không cần gán từng dual.
  if (stationChanged && !Array.isArray(b.referees) && dual.courtStation) {
    try {
      const station = await CourtStation.findById(dual.courtStation)
        .select("defaultReferees")
        .lean();
      const refs = Array.isArray(station?.defaultReferees)
        ? station.defaultReferees
        : [];
      dual.referees = refs.slice(0, 5);
    } catch (_err) {}
  } else if (stationChanged && !dual.courtStation && !Array.isArray(b.referees)) {
    // Bỏ sân → clear referee
    dual.referees = [];
  }
  if ("scheduledAt" in b) {
    dual.scheduledAt = b.scheduledAt ? new Date(b.scheduledAt) : null;
  }
  if (typeof b.note === "string") {
    dual.note = b.note.slice(0, 500);
  }
  await dual.save();

  // Sync assignment (referee/court/scheduledAt) xuống các Match doc con
  try {
    await ensureMlpDualMatchDocs(dual, tour);
  } catch (err) {
    console.error("[mlp] ensureMlpDualMatchDocs failed:", err?.message);
  }

  emitMlpDual(dual._id, "mlp:dual:updated", {
    dualId: dual._id,
    court: dual.court,
    courtStation: dual.courtStation,
    referees: dual.referees,
    scheduledAt: dual.scheduledAt,
    note: dual.note,
  });
  invalidateMlpTournament(dual.tournament, "mlp:dual:patched");
  res.json({ success: true, dual });
});

// PATCH /api/mlp/duals/:id/subs/:subId
// body: { referees?, court?, courtStation?, scheduledAt? }
// Set per-sub-match assignment. Sub-level override dual-level.
export const patchMlpSubMatch = asyncHandler(async (req, res) => {
  const dual = await MlpDualMatch.findById(req.params.id);
  if (!dual) {
    res.status(404);
    throw new Error("Không tìm thấy dual");
  }
  const tour = await Tournament.findById(dual.tournament);
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const sub = dual.subMatches.id(req.params.subId);
  if (!sub) {
    res.status(404);
    throw new Error("Không tìm thấy sub-match");
  }
  const b = req.body || {};
  if (Array.isArray(b.referees)) {
    sub.referees = b.referees
      .filter((id) => mongoose.isValidObjectId(id))
      .slice(0, 5);
  }
  if ("court" in b) {
    sub.court =
      b.court && mongoose.isValidObjectId(b.court) ? b.court : null;
  }
  let subStationChanged = false;
  if ("courtStation" in b) {
    const newStation =
      b.courtStation && mongoose.isValidObjectId(b.courtStation)
        ? b.courtStation
        : null;
    subStationChanged =
      String(sub.courtStation || "") !== String(newStation || "");
    sub.courtStation = newStation;
  }
  // Auto-fill referees per sub-match từ station (nếu station đổi + client
  // không truyền referees tay).
  if (subStationChanged && !Array.isArray(b.referees) && sub.courtStation) {
    try {
      const station = await CourtStation.findById(sub.courtStation)
        .select("defaultReferees")
        .lean();
      const refs = Array.isArray(station?.defaultReferees)
        ? station.defaultReferees
        : [];
      sub.referees = refs.slice(0, 5);
    } catch (_err) {}
  } else if (
    subStationChanged &&
    !sub.courtStation &&
    !Array.isArray(b.referees)
  ) {
    sub.referees = [];
  }
  if ("scheduledAt" in b) {
    sub.scheduledAt = b.scheduledAt ? new Date(b.scheduledAt) : null;
  }
  await dual.save();

  try {
    await ensureMlpSubMatchDoc(dual, sub, tour);
    await dual.save();
  } catch (err) {
    console.error("[mlp] ensureMlpSubMatchDoc after sub patch failed:", err?.message);
  }

  emitMlpDual(dual._id, "mlp:dual:updated", {
    dualId: dual._id,
    subId: sub._id,
  });
  invalidateMlpTournament(dual.tournament, "mlp:sub:patched");
  res.json({ success: true, sub });
});

export const assignSubMatchLineup = asyncHandler(async (req, res) => {
  const dual = await MlpDualMatch.findById(req.params.id).populate(
    "teamA teamB",
  );
  if (!dual) {
    res.status(404);
    throw new Error("Không tìm thấy dual");
  }
  const tour = await Tournament.findById(dual.tournament);
  const canMgr = canManageTournament(req.user, tour);
  const uid = String(req.user?._id || "");
  const isCaptainA =
    uid && String(dual.teamA?.captain?._id ?? dual.teamA?.captain) === uid;
  const isCaptainB =
    uid && String(dual.teamB?.captain?._id ?? dual.teamB?.captain) === uid;
  if (!canMgr && !isCaptainA && !isCaptainB) {
    res.status(403);
    throw new Error("Không có quyền chọn lineup");
  }
  const sub = dual.subMatches.id(req.params.subId);
  if (!sub) {
    res.status(404);
    throw new Error("Không tìm thấy sub-match");
  }

  const { playersA = [], playersB = [] } = req.body || {};
  // Manager: set cả 2 bên. Captain: chỉ set bên của mình, bên kia giữ nguyên.
  if (canMgr || isCaptainA) {
    sub.playersA = playersA.filter((id) => mongoose.isValidObjectId(id));
  }
  if (canMgr || isCaptainB) {
    sub.playersB = playersB.filter((id) => mongoose.isValidObjectId(id));
  }
  await dual.save();

  // Tạo/cập nhật Match doc để trọng tài chấm điểm qua RefereeScorePanel
  try {
    await ensureMlpSubMatchDoc(dual, sub, tour);
    await dual.save();
  } catch (err) {
    console.error(
      "[mlp] ensureMlpSubMatchDoc after lineup failed:",
      err?.message,
    );
  }

  emitMlpDual(dual._id, "mlp:dual:updated", {
    dualId: dual._id,
    subId: sub._id,
  });
  invalidateMlpTournament(dual.tournament, "mlp:lineup:assigned");

  res.json({ success: true, sub });
});

// POST /api/mlp/duals/:id/subs/:subId/score
// body: { scoreA, scoreB, status?: "scheduled"|"live"|"finished" }
// Chấm score trực tiếp trên sub-match (không dùng Match doc riêng).
export const syncSubMatchResult = asyncHandler(async (req, res) => {
  const dual = await MlpDualMatch.findById(req.params.id);
  if (!dual) {
    res.status(404);
    throw new Error("Không tìm thấy dual");
  }
  const tour = await Tournament.findById(dual.tournament);
  if (!canManageTournament(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const sub = dual.subMatches.id(req.params.subId);
  if (!sub) {
    res.status(404);
    throw new Error("Không tìm thấy sub-match");
  }
  const body = req.body || {};
  const scoreA = Math.max(0, Number(body.scoreA) || 0);
  const scoreB = Math.max(0, Number(body.scoreB) || 0);
  const status =
    body.status && ["scheduled", "live", "finished"].includes(body.status)
      ? body.status
      : sub.result?.status || "live";

  const wasFinished = sub.result?.status === "finished";
  sub.result.scoreA = scoreA;
  sub.result.scoreB = scoreB;
  sub.result.status = status;
  let subJustFinished = false;
  if (status === "finished") {
    sub.result.winner = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : null;
    sub.result.finishedAt = new Date();
    if (!wasFinished) subJustFinished = true;
  } else {
    sub.result.winner = null;
    sub.result.finishedAt = null;
    sub.result.ratingApplied = false;
  }

  // Aggregate slot wins
  let wa = 0,
    wb = 0;
  let allFinished = true;
  for (const s of dual.subMatches) {
    if (s.result?.winner === "A") wa++;
    else if (s.result?.winner === "B") wb++;
    if (s.result?.status !== "finished") allFinished = false;
  }
  dual.slotWinsA = wa;
  dual.slotWinsB = wb;

  let justFinished = false;
  if (allFinished) {
    const cfg = tour?.mlpConfig || {};
    const dbEnabled = cfg.dreamBreaker?.enabled !== false;
    if (wa === wb && dbEnabled) {
      dual.status = "tie_break";
    } else {
      dual.status = "finished";
      dual.winner = wa > wb ? "A" : wb > wa ? "B" : null;
      dual.finishedAt = new Date();
      justFinished = true;
    }
  } else if (dual.status === "scheduled" && (scoreA > 0 || scoreB > 0)) {
    dual.status = "live";
    if (!dual.startedAt) dual.startedAt = new Date();
  }

  await dual.save();
  emitMlpDual(dual._id, "mlp:sub:score", {
    dualId: dual._id,
    subId: sub._id,
    scoreA,
    scoreB,
    status,
    winner: sub.result.winner,
    slotWinsA: dual.slotWinsA,
    slotWinsB: dual.slotWinsB,
    dualStatus: dual.status,
  });
  // Báo tab MLP Duals + Standings web/mobile refetch. Debounce có sẵn
  // (INVALIDATE_FLUSH_MS) → burst score sẽ collapse thành ít emit.
  invalidateMlpTournament(dual.tournament, "mlp:sub:score");

  // Apply rating khi sub-match vừa finished (idempotent, cờ ratingApplied).
  if (subJustFinished && !sub.result.ratingApplied && sub.result.winner) {
    const slot = (tour?.mlpConfig?.slots || []).find(
      (s) => s.key === sub.slotKey
    );
    applyRatingForMlpSubMatch({
      playersA: sub.playersA || [],
      playersB: sub.playersB || [],
      scoreA,
      scoreB,
      winner: sub.result.winner,
      tournamentId: dual.tournament,
      subMatchId: sub._id,
      matchType: slot?.matchType || "double",
    })
      .then(async () => {
        await MlpDualMatch.updateOne(
          { _id: dual._id, "subMatches._id": sub._id },
          { $set: { "subMatches.$.result.ratingApplied": true } }
        );
      })
      .catch((err) =>
        console.error("[mlp] rating apply error:", err?.message || err)
      );
  }

  if (justFinished) {
    emitMlpDual(dual._id, "mlp:dual:finished", {
      dualId: dual._id,
      winner: dual.winner,
    });
    recomputeMlpStandings(dual.tournament).catch((err) =>
      console.error("[mlp] recomputeStandings error:", err?.message || err)
    );
    notifyMlpDualEvent({ dual, event: "finished" }).catch(() => {});
    // Auto-advance winner nếu dual thuộc knockout
    advanceMlpKnockoutWinner(dual).catch(() => {});
    // Nếu dual thuộc vòng bảng → thử resolve KO placeholder (bảng có thể đã xong hết)
    if (dual.phase === "group") {
      resolveMlpKnockoutSlots(dual.tournament).catch(() => {});
    }
  }
  res.json({ success: true, dual });
});

/* ═════════════════════ DREAMBREAKER (Phase 4) ═════════════════════ */

// POST /api/mlp/duals/:id/dreambreaker/start
// body: { lineupA: [uid], lineupB: [uid] }  (thứ tự thi đấu)
export const startDreamBreaker = asyncHandler(async (req, res) => {
  const dual = await MlpDualMatch.findById(req.params.id);
  if (!dual) {
    res.status(404);
    throw new Error("Không tìm thấy dual");
  }
  const tour = await Tournament.findById(dual.tournament);
  if (!canScoreDual(req.user, tour, dual)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  if (dual.status !== "tie_break") {
    res.status(400);
    throw new Error("Dual chưa ở trạng thái tie_break");
  }
  const { lineupA = [], lineupB = [] } = req.body || {};
  if (!lineupA.length || !lineupB.length) {
    res.status(400);
    throw new Error("Cần lineup cả 2 team");
  }
  dual.dreamBreaker = {
    triggered: true,
    lineupA: lineupA.filter((id) => mongoose.isValidObjectId(id)),
    lineupB: lineupB.filter((id) => mongoose.isValidObjectId(id)),
    points: [],
    scoreA: 0,
    scoreB: 0,
    winner: null,
    finishedAt: null,
  };
  await dual.save();
  res.json({ success: true, dual });
});

// Helper: xác định VĐV nào đang cầm vợt tại score X.
function currentPlayerAt(scoreForSide, lineup, rotateEvery) {
  if (!lineup?.length) return null;
  const rotationIdx =
    Math.floor(Math.max(0, scoreForSide) / Math.max(1, rotateEvery)) %
    lineup.length;
  return lineup[rotationIdx];
}

// POST /api/mlp/duals/:id/dreambreaker/point
// body: { side: "A"|"B" }
export const scoreDreamBreakerPoint = asyncHandler(async (req, res) => {
  const dual = await MlpDualMatch.findById(req.params.id);
  if (!dual) {
    res.status(404);
    throw new Error("Không tìm thấy dual");
  }
  const tour = await Tournament.findById(dual.tournament);
  if (!canScoreDual(req.user, tour, dual)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  if (!dual.dreamBreaker?.triggered) {
    res.status(400);
    throw new Error("DreamBreaker chưa start");
  }
  if (dual.dreamBreaker.winner) {
    res.status(400);
    throw new Error("DreamBreaker đã kết thúc");
  }
  const side = String(req.body?.side || "").toUpperCase();
  if (!["A", "B"].includes(side)) {
    res.status(400);
    throw new Error("side phải là 'A' hoặc 'B'");
  }
  const cfg = tour.mlpConfig?.dreamBreaker || {};
  const target = cfg.pointsToWin || 21;
  const rotate = cfg.rotationEveryPoints || 4;
  const winByTwo = !!cfg.winByTwo;

  const db = dual.dreamBreaker;
  const playerA = currentPlayerAt(db.scoreA, db.lineupA, rotate);
  const playerB = currentPlayerAt(db.scoreB, db.lineupB, rotate);
  db.points.push({
    scoredBy: side,
    playerAId: playerA,
    playerBId: playerB,
    at: new Date(),
  });
  if (side === "A") db.scoreA += 1;
  else db.scoreB += 1;

  // Check winner
  const reached = db.scoreA >= target || db.scoreB >= target;
  const diff = Math.abs(db.scoreA - db.scoreB);
  let justFinished = false;
  if (reached && (!winByTwo || diff >= 2)) {
    db.winner = db.scoreA > db.scoreB ? "A" : "B";
    db.finishedAt = new Date();
    dual.status = "finished";
    dual.winner = db.winner;
    dual.finishedAt = new Date();
    justFinished = true;
  }
  await dual.save();
  emitMlpDual(dual._id, "mlp:db:score", {
    dualId: dual._id,
    scoreA: db.scoreA,
    scoreB: db.scoreB,
    winner: db.winner,
  });
  if (justFinished) {
    emitMlpDual(dual._id, "mlp:dual:finished", {
      dualId: dual._id,
      winner: dual.winner,
    });
    recomputeMlpStandings(dual.tournament).catch((err) =>
      console.error("[mlp] recomputeStandings error:", err?.message || err)
    );
    notifyMlpDualEvent({ dual, event: "finished" }).catch(() => {});
    advanceMlpKnockoutWinner(dual).catch(() => {});
    // Nếu dual thuộc vòng bảng → thử resolve KO placeholder (bảng có thể đã xong hết)
    if (dual.phase === "group") {
      resolveMlpKnockoutSlots(dual.tournament).catch(() => {});
    }
  }
  res.json({
    success: true,
    scoreA: db.scoreA,
    scoreB: db.scoreB,
    winner: db.winner,
    currentPlayerA: currentPlayerAt(db.scoreA, db.lineupA, rotate),
    currentPlayerB: currentPlayerAt(db.scoreB, db.lineupB, rotate),
  });
});

// POST /api/mlp/duals/:id/dreambreaker/undo — undo điểm gần nhất
export const undoDreamBreakerPoint = asyncHandler(async (req, res) => {
  const dual = await MlpDualMatch.findById(req.params.id);
  if (!dual) {
    res.status(404);
    throw new Error("Không tìm thấy dual");
  }
  const tour = await Tournament.findById(dual.tournament);
  if (!canScoreDual(req.user, tour, dual)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const db = dual.dreamBreaker;
  if (!db?.points?.length) {
    res.status(400);
    throw new Error("Không có điểm để undo");
  }
  const last = db.points.pop();
  if (last.scoredBy === "A") db.scoreA = Math.max(0, db.scoreA - 1);
  else db.scoreB = Math.max(0, db.scoreB - 1);
  if (db.winner) {
    db.winner = null;
    db.finishedAt = null;
    dual.status = "tie_break";
    dual.winner = null;
    dual.finishedAt = null;
  }
  await dual.save();
  res.json({ success: true, scoreA: db.scoreA, scoreB: db.scoreB });
});
