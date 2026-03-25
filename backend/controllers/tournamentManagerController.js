// controllers/tournamentManagerController.js
import TournamentManager from "../models/tournamentManagerModel.js";
import User from "../models/userModel.js";
import Tournament from "../models/tournamentModel.js";
import Match from "../models/matchModel.js";
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";

/** helper: admin hoặc người tạo giải mới được thêm/xoá manager */
async function canManageManagers(reqUser, tournamentId) {
  if (!reqUser || !tournamentId) return false;

  const isAdmin =
    reqUser.role === "admin" ||
    reqUser.isAdmin === true ||
    (Array.isArray(reqUser.roles) && reqUser.roles.includes("admin"));
  if (isAdmin) return true;

  const tournament = await Tournament.findById(tournamentId)
    .select("createdBy")
    .lean();
  if (!tournament) return false;

  return String(tournament.createdBy || "") === String(reqUser._id || "");
}

/** GET /api/tournaments/:id/managers */
export async function listManagers(req, res) {
  const { id } = req.params;
  const list = await TournamentManager.find({ tournament: id })
    .populate({ path: "user", select: "name email phone avatar nickname" })
    .sort({ createdAt: -1 })
    .lean();
  res.json(list);
}

/** POST /api/tournaments/:id/managers  body: { userId } */
export async function addManager(req, res) {
  const { id } = req.params;
  const { userId } = req.body;

  if (!(await canManageManagers(req.user, id))) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const u = await User.findById(userId).select("_id");
  if (!u) return res.status(404).json({ message: "User not found" });

  try {
    const doc = await TournamentManager.create({
      tournament: id,
      user: userId,
      createdBy: req.user?._id || null,
    });
    const populated = await doc.populate("user", "name email phone avatar nickname");
    return res.status(201).json(populated);
  } catch (e) {
    if (e?.code === 11000)
      return res.status(409).json({ message: "Already a manager" });
    return res.status(500).json({ message: e.message || "Create failed" });
  }
}

/** DELETE /api/tournaments/:id/managers/:userId */
export async function removeManager(req, res) {
  const { id, userId } = req.params;

  if (!(await canManageManagers(req.user, id))) {
    return res.status(403).json({ message: "Forbidden" });
  }
  await TournamentManager.deleteOne({ tournament: id, user: userId });
  res.json({ ok: true });
}

/** helper public: kiểm tra user có là manager của giải không */
export async function isTournamentManager(userId, tournamentId) {
  if (!userId || !tournamentId) return false;
  const exist = await TournamentManager.exists({
    user: userId,
    tournament: tournamentId,
  });
  return !!exist;
}


const isOID = (v) => mongoose.isValidObjectId(String(v || ""));
const OID = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * GET /api/tournaments/:tid/is-manager?user=<userId>
 * - Nếu không truyền ?user= thì mặc định dùng req.user._id
 * - Tiêu chí "manager" TRUE nếu:
 *    + có bản ghi TournamentManager(tournament, user)
 *    + HOẶC user là admin hệ thống
 *    + HOẶC user là người tạo giải (createdBy)
 */
export const verifyTournamentManager = asyncHandler(async (req, res) => {
  const tid = req.params.tid || req.params.id;
  const userId = req.query.user || req.query.userId || req.user?._id;

  if (!tid || !userId) {
    res.status(400);
    throw new Error("Thiếu tournament id hoặc user id");
  }
  if (!isOID(tid) || !isOID(userId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }

  const [tm, t] = await Promise.all([
    TournamentManager.findOne({
      tournament: OID(tid),
      user: OID(userId),
    })
      .select("_id role createdBy createdAt")
      .lean(),
    Tournament.findById(tid).select("_id createdBy").lean(),
  ]);

  const isAdmin = req.user?.role === "admin";
  const isCreator = !!t && String(t.createdBy) === String(userId);
  const isManager = !!(tm || isCreator || isAdmin);

  res.json({
    tournamentId: String(tid),
    userId: String(userId),
    isManager,
    via: tm ? "manager" : isCreator ? "creator" : isAdmin ? "admin" : "none",
    managerRecord: tm || null,
  });
});

/**
 * GET /api/tournaments/:tid/is-referee?user=<userId>
 * - Mac dinh dung req.user._id neu khong truyen ?user=
 * - TRUE neu user nam trong scope referee cua giai
 *   HOAC da duoc gan vao it nhat 1 tran cua giai
 * - Khong suy luan tu role=referee
 */
export const verifyTournamentReferee = asyncHandler(async (req, res) => {
  const tid = req.params.tid || req.params.id;
  const userId = req.query.user || req.query.userId || req.user?._id;

  if (!tid || !userId) {
    res.status(400);
    throw new Error("Thiếu tournament id hoặc user id");
  }
  if (!isOID(tid) || !isOID(userId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }

  const TID = OID(tid);
  const UID = OID(userId);

  const [scopeUser, assignedMatch] = await Promise.all([
    User.findOne({
      _id: UID,
      isDeleted: { $ne: true },
      "referee.tournaments": TID,
    })
      .select("_id role referee.tournaments")
      .lean(),
    Match.findOne({
      tournament: TID,
      referee: UID,
    })
      .select("_id referee tournament")
      .lean(),
  ]);

  const isReferee = !!(scopeUser || assignedMatch);

  res.json({
    tournamentId: String(tid),
    userId: String(userId),
    isReferee,
    via: scopeUser ? "tournament_scope" : assignedMatch ? "match_assignment" : "none",
    matchId: assignedMatch?._id ? String(assignedMatch._id) : null,
  });
});
