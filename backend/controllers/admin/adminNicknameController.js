// controllers/admin/adminNicknameController.js
// Admin duyệt/từ chối yêu cầu đổi biệt danh + reset cooldown đổi tên cho user.
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import NicknameChangeRequest from "../../models/nicknameChangeRequestModel.js";
import User from "../../models/userModel.js";
import {
  approveRequest,
  rejectRequest,
} from "../../services/nicknameRequest.service.js";

/* ─────────────────── LIST + GET ─────────────────── */

// GET /api/admin/nickname-requests?status=pending&limit=&cursor=
export const listNicknameRequests = asyncHandler(async (req, res) => {
  const status = ["pending", "approved", "rejected", "cancelled", "all"].includes(
    req.query.status
  )
    ? req.query.status
    : "pending";
  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || 20, 1),
    100
  );

  const q = {};
  if (status !== "all") q.status = status;
  if (req.query.cursor && mongoose.isValidObjectId(req.query.cursor)) {
    q._id = { $lt: new mongoose.Types.ObjectId(req.query.cursor) };
  }

  const docs = await NicknameChangeRequest.find(q)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("user", "_id name nickname phone email province avatar role nicknameChangedAt")
    .populate("resolvedBy", "_id name nickname");

  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit);
  const nextCursor = hasMore ? String(items[items.length - 1]._id) : null;

  const [pendingCount, totalCount] = await Promise.all([
    NicknameChangeRequest.countDocuments({ status: "pending" }),
    NicknameChangeRequest.countDocuments({}),
  ]);

  res.json({
    items,
    nextCursor,
    hasMore,
    counts: { pending: pendingCount, total: totalCount },
  });
});

/* ─────────────────── APPROVE ─────────────────── */

// POST /api/admin/nickname-requests/:id/approve
export const approveNicknameRequest = asyncHandler(async (req, res) => {
  const result = await approveRequest(req.params.id, req.user?._id);
  if (!result.ok) {
    res.status(400);
    throw new Error(result.error || "Duyệt thất bại");
  }
  res.json({ success: true, request: result.request });
});

/* ─────────────────── REJECT ─────────────────── */

// POST /api/admin/nickname-requests/:id/reject  body: { reason }
export const rejectNicknameRequest = asyncHandler(async (req, res) => {
  const result = await rejectRequest(
    req.params.id,
    req.user?._id,
    req.body?.reason
  );
  if (!result.ok) {
    res.status(400);
    throw new Error(result.error || "Từ chối thất bại");
  }
  res.json({ success: true, request: result.request });
});

/* ─────────────────── RESET COOLDOWN ─────────────────── */

// POST /api/admin/users/:id/reset-nickname-cooldown
export const resetNicknameCooldown = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400);
    throw new Error("User ID không hợp lệ");
  }
  const user = await User.findById(req.params.id).select(
    "_id name nickname nicknameChangedAt"
  );
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy user");
  }
  const prev = user.nicknameChangedAt;
  user.nicknameChangedAt = null;
  await user.save();

  res.json({
    success: true,
    userId: String(user._id),
    previousChangedAt: prev,
    message: "Đã reset lần đổi biệt danh — user có thể đổi ngay.",
  });
});
