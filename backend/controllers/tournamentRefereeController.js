// controllers/tournamentRefereeController.js
// CRUD cho pool trọng tài của giải.
// Route: /api/tournaments/:tid/referees
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import TournamentReferee from "../models/tournamentRefereeModel.js";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";

const isAdmin = (u) =>
  u?.role === "admin" || u?.isAdmin || u?.isSuperUser;
const isManagerOf = (u, tour) => {
  if (!u?._id || !tour) return false;
  if (String(tour.createdBy?._id ?? tour.createdBy) === String(u._id))
    return true;
  if (Array.isArray(tour.managers)) {
    return tour.managers.some(
      (m) => String(m?.user?._id ?? m?.user ?? m) === String(u._id),
    );
  }
  return false;
};
const canManage = (u, tour) => isAdmin(u) || isManagerOf(u, tour);

// GET /api/tournaments/:tid/referees
export const listReferees = asyncHandler(async (req, res) => {
  const { tid } = req.params;
  if (!mongoose.isValidObjectId(tid)) {
    res.status(400);
    throw new Error("tid không hợp lệ");
  }
  const items = await TournamentReferee.find({ tournament: tid })
    .populate("user", "_id name nickname avatar phone email role")
    .sort({ createdAt: -1 })
    .lean();
  res.json({ items });
});

// POST /api/tournaments/:tid/referees
// body: { userId, note? }
export const addReferee = asyncHandler(async (req, res) => {
  const { tid } = req.params;
  const tour = await Tournament.findById(tid);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManage(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền quản lý trọng tài");
  }
  const { userId, note = "" } = req.body || {};
  if (!mongoose.isValidObjectId(userId)) {
    res.status(400);
    throw new Error("userId không hợp lệ");
  }
  const user = await User.findById(userId).select("_id name nickname").lean();
  if (!user) {
    res.status(404);
    throw new Error("User không tồn tại");
  }
  try {
    const doc = await TournamentReferee.create({
      tournament: tid,
      user: userId,
      createdBy: req.user._id,
      note: String(note || "").slice(0, 200),
    });
    await doc.populate("user", "_id name nickname avatar phone email role");
    res.status(201).json(doc);
  } catch (err) {
    if (err?.code === 11000) {
      res.status(400);
      throw new Error("User đã có trong pool trọng tài của giải này");
    }
    throw err;
  }
});

// PATCH /api/tournaments/:tid/referees/:refId
// body: { note }
export const updateReferee = asyncHandler(async (req, res) => {
  const { tid, refId } = req.params;
  const tour = await Tournament.findById(tid);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManage(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const doc = await TournamentReferee.findOne({
    _id: refId,
    tournament: tid,
  });
  if (!doc) {
    res.status(404);
    throw new Error("Không tìm thấy");
  }
  if (typeof req.body?.note === "string") {
    doc.note = req.body.note.slice(0, 200);
  }
  await doc.save();
  await doc.populate("user", "_id name nickname avatar phone email role");
  res.json(doc);
});

// DELETE /api/tournaments/:tid/referees/:refId
export const removeReferee = asyncHandler(async (req, res) => {
  const { tid, refId } = req.params;
  const tour = await Tournament.findById(tid);
  if (!tour) {
    res.status(404);
    throw new Error("Giải không tồn tại");
  }
  if (!canManage(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const result = await TournamentReferee.deleteOne({
    _id: refId,
    tournament: tid,
  });
  res.json({ success: true, deleted: result.deletedCount || 0 });
});
