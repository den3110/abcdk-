// controllers/tournamentManagerController.js
import TournamentManager from "../models/tournamentManagerModel.js";
import User from "../models/userModel.js";
import Tournament from "../models/tournamentModel.js";
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";

/** helper: kiểm tra quyền admin hoặc chủ giải (tuỳ bạn có field owner/organizer) */
async function canManageManagers(reqUser, tournamentId) {
  if (!reqUser) return false;
  if (reqUser.role === "admin") return true;
  // nếu bạn có field organizer/owner cho Tournament, mở comment bên dưới:
  // const t = await Tournament.findById(tournamentId).select("organizer");
  // if (t && String(t.organizer) === String(reqUser._id)) return true;
  return false;
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
