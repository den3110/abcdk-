// controllers/admin/adminNicknameController.js
// Admin duyệt/từ chối yêu cầu đổi biệt danh + reset cooldown đổi tên cho user.
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import NicknameChangeRequest from "../../models/nicknameChangeRequestModel.js";
import User from "../../models/userModel.js";
import { createInAppNotifications } from "../../services/inAppNotify.js";
import { sendToUserIds } from "../../services/notifications/expoPush.js";

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
  const reqDoc = await NicknameChangeRequest.findById(req.params.id);
  if (!reqDoc) {
    res.status(404);
    throw new Error("Không tìm thấy yêu cầu");
  }
  if (reqDoc.status !== "pending") {
    res.status(400);
    throw new Error(`Yêu cầu đã ${reqDoc.status}, không thể duyệt lại`);
  }

  const user = await User.findById(reqDoc.user);
  if (!user) {
    res.status(404);
    throw new Error("User không còn tồn tại");
  }

  // Recheck duplicate lúc duyệt (nickname unique)
  const dup = await User.findOne({
    _id: { $ne: user._id },
    nickname: reqDoc.newNickname,
  }).select("_id");
  if (dup) {
    reqDoc.status = "rejected";
    reqDoc.resolvedBy = req.user._id;
    reqDoc.resolvedAt = new Date();
    reqDoc.rejectionReason = "Nickname đã có người dùng khác";
    await reqDoc.save();
    res.status(400);
    throw new Error(
      "Nickname đã có người khác dùng — đã tự động từ chối yêu cầu này."
    );
  }

  // Apply đổi nickname + đánh dấu cooldown
  const oldNickname = user.nickname || "";
  user.nickname = reqDoc.newNickname;
  user.nicknameChangedAt = new Date();
  await user.save();

  reqDoc.oldNickname = oldNickname;
  reqDoc.status = "approved";
  reqDoc.resolvedBy = req.user._id;
  reqDoc.resolvedAt = new Date();
  await reqDoc.save();

  // Notify user
  createInAppNotifications({
    recipients: [String(user._id)],
    actorId: req.user._id,
    type: "NICKNAME_APPROVED",
    title: "Đổi biệt danh thành công",
    body: `Biệt danh của bạn đã được đổi thành "${reqDoc.newNickname}".`,
    url: `/profile/${user._id}`,
    data: { requestId: String(reqDoc._id) },
  }).catch(() => {});
  sendToUserIds(
    [String(user._id)],
    {
      title: "Đổi biệt danh thành công",
      body: `Biệt danh đã được cập nhật thành "${reqDoc.newNickname}".`,
      data: { url: `/profile/${user._id}`, kind: "NICKNAME_APPROVED" },
    },
    { ttl: 3600 }
  ).catch(() => {});

  res.json({ success: true, request: reqDoc });
});

/* ─────────────────── REJECT ─────────────────── */

// POST /api/admin/nickname-requests/:id/reject  body: { reason }
export const rejectNicknameRequest = asyncHandler(async (req, res) => {
  const reqDoc = await NicknameChangeRequest.findById(req.params.id);
  if (!reqDoc) {
    res.status(404);
    throw new Error("Không tìm thấy yêu cầu");
  }
  if (reqDoc.status !== "pending") {
    res.status(400);
    throw new Error(`Yêu cầu đã ${reqDoc.status}, không thể từ chối lại`);
  }
  const reason = String(req.body?.reason || "").slice(0, 500).trim();

  reqDoc.status = "rejected";
  reqDoc.resolvedBy = req.user._id;
  reqDoc.resolvedAt = new Date();
  reqDoc.rejectionReason = reason || "Tên không hợp lệ";
  await reqDoc.save();

  // KHÔNG đụng vào user.nickname và user.nicknameChangedAt → user không mất lần đổi

  // Notify user
  createInAppNotifications({
    recipients: [String(reqDoc.user)],
    actorId: req.user._id,
    type: "NICKNAME_REJECTED",
    title: "Yêu cầu đổi biệt danh bị từ chối",
    body: `Yêu cầu đổi sang "${reqDoc.newNickname}" đã bị từ chối. Lý do: ${reqDoc.rejectionReason}`,
    url: `/profile`,
    data: { requestId: String(reqDoc._id) },
  }).catch(() => {});
  sendToUserIds(
    [String(reqDoc.user)],
    {
      title: "Yêu cầu đổi biệt danh bị từ chối",
      body: reqDoc.rejectionReason,
      data: { url: `/profile`, kind: "NICKNAME_REJECTED" },
    },
    { ttl: 3600 }
  ).catch(() => {});

  res.json({ success: true, request: reqDoc });
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
