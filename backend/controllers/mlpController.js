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
async function buildHeadToHeadMap(tid) {
  const duals = await MlpDualMatch.find({
    tournament: tid,
    status: "finished",
    winner: { $in: ["A", "B"] },
  })
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

// GET /api/mlp/tournaments/:tid/standings
// Sort: wins → head-to-head (khi 2 team cùng wins) → slotDiff → pointDiff → name
export const getMlpStandings = asyncHandler(async (req, res) => {
  const teams = await MlpTeam.find({
    tournament: req.params.tid,
    status: "approved",
  })
    .select("name shortName logo color standing")
    .lean();
  const h2h = await buildHeadToHeadMap(req.params.tid);
  const rows = teams.map((t) => {
    const s = t.standing || {};
    const wins = Number(s.wins) || 0;
    const losses = Number(s.losses) || 0;
    const slotsFor = Number(s.slotsFor) || 0;
    const slotsAgainst = Number(s.slotsAgainst) || 0;
    const pointsFor = Number(s.pointsFor) || 0;
    const pointsAgainst = Number(s.pointsAgainst) || 0;
    return {
      _id: t._id,
      name: t.name,
      shortName: t.shortName,
      logo: t.logo,
      color: t.color,
      wins,
      losses,
      played: wins + losses,
      slotsFor,
      slotsAgainst,
      slotDiff: slotsFor - slotsAgainst,
      pointsFor,
      pointsAgainst,
      pointDiff: pointsFor - pointsAgainst,
    };
  });
  const items = rows
    .sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      // Head-to-head khi cùng wins
      const rec = h2h.get(String(a._id))?.get(String(b._id));
      if (rec && rec.won !== rec.lost) return rec.lost - rec.won; // a thắng b nhiều hơn → a lên trên
      if (a.slotDiff !== b.slotDiff) return b.slotDiff - a.slotDiff;
      if (a.pointDiff !== b.pointDiff) return b.pointDiff - a.pointDiff;
      return String(a.name).localeCompare(String(b.name), "vi");
    })
    .map((row, idx) => ({ rank: idx + 1, ...row }));
  res.json({ items });
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

  const doc = await MlpTeam.create({
    tournament: tid,
    name: String(body.name).trim().slice(0, 100),
    shortName: String(body.shortName || "").slice(0, 20),
    logo: String(body.logo || "").slice(0, 500),
    color: String(body.color || "").slice(0, 20),
    captain,
    players,
    createdBy: req.user._id,
    // Admin/manager tạo → auto approved. User thường → pending.
    status: canManageTournament(req.user, tour) ? "approved" : "pending",
    approvedBy: canManageTournament(req.user, tour) ? req.user._id : null,
    approvedAt: canManageTournament(req.user, tour) ? new Date() : null,
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
    ["pending", "approved", "rejected", "withdrawn"].includes(status)
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

  // Admin approve/reject/withdraw
  let statusChanged = null;
  if (
    body.status &&
    ["pending", "approved", "rejected", "withdrawn"].includes(body.status) &&
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
  await doc.deleteOne();
  res.json({ success: true });
});

/* ═════════════════════ DUAL MATCHES (Phase 3) ═════════════════════ */

// POST /api/mlp/tournaments/:tid/duals/generate
// body: { format: "roundrobin"|"single_elim", teamIds?: [id] }
// Sinh dual matches theo format. Nếu format="roundrobin" → mọi cặp team đấu 1 lần.
// POST /api/mlp/tournaments/:tid/duals/generate-knockout
// Sinh knockout bracket từ BXH hiện tại. body: { topN, seedByStanding=true }
// Seed 1 vs N, 2 vs N-1... theo BXH sort wins → slotDiff → pointDiff.
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
  const topN = Math.max(2, Math.min(32, Number(req.body?.topN) || 4));
  const seedByStanding = req.body?.seedByStanding !== false;

  // Lấy team, sort theo standing giống getMlpStandings
  const teams = await MlpTeam.find({
    tournament: tid,
    status: "approved",
  })
    .select("_id name standing")
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

  const picked = sorted.slice(0, topN);
  if (picked.length < 2) {
    res.status(400);
    throw new Error("Cần ít nhất 2 team đủ điều kiện");
  }

  // Đảm bảo số team là power of 2 (pad bằng BYE null nếu không đủ)
  let size = 2;
  while (size < picked.length) size *= 2;
  const seeded = [...picked];
  while (seeded.length < size) seeded.push(null);

  // Round 1: seed 1 vs N, 2 vs N-1... (standard bracket)
  const slots = tour.mlpConfig?.slots || [];
  if (!slots.length) {
    res.status(400);
    throw new Error("Chưa cấu hình slots MLP");
  }

  const subTemplate = slots
    .slice()
    .sort((x, y) => (x.order || 0) - (y.order || 0))
    .map((s, i) => ({
      slotKey: s.key,
      order: i,
      playersA: [],
      playersB: [],
      result: {
        status: "pending",
        scoreA: 0,
        scoreB: 0,
        winner: null,
      },
    }));

  // Xoá knockout cũ (round > 1 hoặc marked knockout)
  await MlpDualMatch.deleteMany({
    tournament: tid,
    round: { $gte: 2 },
    slotWinsA: 0,
    slotWinsB: 0,
  });

  const round1 = [];
  const pairs = Math.floor(size / 2);
  for (let i = 0; i < pairs; i++) {
    const a = seeded[i];
    const b = seeded[size - 1 - i];
    if (!a || !b) continue;
    const doc = await MlpDualMatch.create({
      tournament: tid,
      round: 2, // 2+ = knockout (vòng bảng vẫn round=1)
      order: i,
      teamA: a._id,
      teamB: b._id,
      subMatches: JSON.parse(JSON.stringify(subTemplate)),
      status: "scheduled",
      createdBy: req.user._id,
    });
    round1.push(doc);
  }
  res.json({
    success: true,
    round: 2,
    generated: round1.length,
    seeds: picked.map((t) => ({ _id: t._id, name: t.name })),
  });
});

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
  const teams = await MlpTeam.find(teamFilter).select("_id name").lean();
  if (teams.length < 2) {
    res.status(400);
    throw new Error("Cần ít nhất 2 team đã duyệt để sinh dual matches");
  }

  const slots = tour.mlpConfig?.slots || [];
  if (!slots.length) {
    res.status(400);
    throw new Error("Chưa cấu hình slots — vào Cấu hình MLP trước");
  }

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
    const subMatches = slots
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
    const doc = await MlpDualMatch.create({
      tournament: tid,
      round: format === "single_elim" ? 1 : 1,
      order: idx,
      teamA: a._id,
      teamB: b._id,
      subMatches,
      status: "scheduled",
      createdBy: req.user._id,
    });
    created.push(doc);
  }

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
    .populate("teamA", "_id name shortName logo color")
    .populate("teamB", "_id name shortName logo color")
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
      select: "_id name shortName logo color players",
      populate: {
        path: "players",
        select: "_id name nickname avatar gender",
      },
    })
    .populate({
      path: "teamB",
      select: "_id name shortName logo color players",
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
  if ("courtStation" in b) {
    dual.courtStation =
      b.courtStation && mongoose.isValidObjectId(b.courtStation)
        ? b.courtStation
        : null;
  }
  if (Array.isArray(b.referees)) {
    dual.referees = b.referees
      .filter((id) => mongoose.isValidObjectId(id))
      .slice(0, 5);
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
  if ("courtStation" in b) {
    sub.courtStation =
      b.courtStation && mongoose.isValidObjectId(b.courtStation)
        ? b.courtStation
        : null;
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
  res.json({ success: true, sub });
});

export const assignSubMatchLineup = asyncHandler(async (req, res) => {
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

  const { playersA = [], playersB = [] } = req.body || {};
  sub.playersA = playersA.filter((id) => mongoose.isValidObjectId(id));
  sub.playersB = playersB.filter((id) => mongoose.isValidObjectId(id));
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
  if (!canManageTournament(req.user, tour)) {
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
  if (!canManageTournament(req.user, tour)) {
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
  if (!canManageTournament(req.user, tour)) {
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
