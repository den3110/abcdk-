// controllers/mlpController.js
// MLP tournament: teams + dual matches (Phase 1 chỉ CRUD, scoring ở Phase 2).
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Tournament from "../models/tournamentModel.js";
import MlpTeam from "../models/mlpTeamModel.js";
import MlpDualMatch from "../models/mlpDualMatchModel.js";

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
    cfg.cap = {
      mode: ["none", "hard", "soft"].includes(body.cap.mode)
        ? body.cap.mode
        : "none",
      points: Number.isFinite(Number(body.cap.points))
        ? Number(body.cap.points)
        : null,
    };
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
