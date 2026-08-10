// controllers/mlpController.js
// MLP tournament: teams + dual matches + DreamBreaker.
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Tournament from "../models/tournamentModel.js";
import MlpTeam from "../models/mlpTeamModel.js";
import MlpDualMatch from "../models/mlpDualMatchModel.js";
import { getIO } from "../socket/index.js";

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

// GET /api/mlp/tournaments/:tid/standings
export const getMlpStandings = asyncHandler(async (req, res) => {
  const teams = await MlpTeam.find({
    tournament: req.params.tid,
    status: "approved",
  })
    .select("name shortName logo color standing")
    .lean();
  const items = teams
    .map((t) => {
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
    })
    // Sort: wins desc → slotDiff desc → pointDiff desc → name asc
    .sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
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
  if (
    body.status &&
    ["pending", "approved", "rejected", "withdrawn"].includes(body.status) &&
    canManageTournament(req.user, tour)
  ) {
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
    .populate("teamA", "_id name shortName logo color players")
    .populate("teamB", "_id name shortName logo color players")
    .populate({
      path: "subMatches.playersA",
      select: "_id name nickname avatar gender",
    })
    .populate({
      path: "subMatches.playersB",
      select: "_id name nickname avatar gender",
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

  sub.result.scoreA = scoreA;
  sub.result.scoreB = scoreB;
  sub.result.status = status;
  if (status === "finished") {
    sub.result.winner = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : null;
    sub.result.finishedAt = new Date();
  } else {
    sub.result.winner = null;
    sub.result.finishedAt = null;
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
  if (justFinished) {
    emitMlpDual(dual._id, "mlp:dual:finished", {
      dualId: dual._id,
      winner: dual.winner,
    });
    recomputeMlpStandings(dual.tournament).catch((err) =>
      console.error("[mlp] recomputeStandings error:", err?.message || err)
    );
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
