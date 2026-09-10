import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import CourtOwnerRequest from "../models/courtOwnerRequestModel.js";
import User from "../models/userModel.js";
import { isCourtOwnerLike } from "../utils/venueAuth.js";
import { publishNotification, EVENTS } from "../services/notifications/notificationHub.js";
import { createInAppNotifications } from "../services/inAppNotify.js";
import { notifyOpsEvent } from "../services/ops/opsAlert.service.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);

/** GET /api/court-owner/request/mine — trạng thái đăng ký của tôi + đã là chủ sân chưa */
export const getMyRequest = expressAsyncHandler(async (req, res) => {
  const isOwner = isCourtOwnerLike(req.user);
  const request = await CourtOwnerRequest.findOne({ user: req.user._id })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ isOwner, request: request || null });
});

/** POST /api/court-owner/request  { businessName, phone, address, note } */
export const submitRequest = expressAsyncHandler(async (req, res) => {
  if (isCourtOwnerLike(req.user)) {
    return res.status(400).json({ message: "Bạn đã là chủ sân." });
  }
  const existing = await CourtOwnerRequest.findOne({ user: req.user._id, status: "pending" });
  if (existing) {
    return res.status(409).json({ message: "Bạn đã có yêu cầu đang chờ duyệt." });
  }
  const doc = await CourtOwnerRequest.create({
    user: req.user._id,
    businessName: String(req.body?.businessName || "").slice(0, 160),
    phone: String(req.body?.phone || req.user.phone || "").slice(0, 30),
    address: String(req.body?.address || "").slice(0, 300),
    note: String(req.body?.note || "").slice(0, 500),
    status: "pending",
  });

  // 🆕 Báo lên kênh vận hành: có đơn xin làm chủ sân chờ duyệt.
  notifyOpsEvent({
    severity: "info",
    title: "Đơn xin làm chủ sân — chờ duyệt",
    lines: [
      { label: "Người gửi", value: req.user?.name || req.user?.nickname || req.user?.email || String(req.user?._id) },
      { label: "Cơ sở", value: doc.businessName || "—" },
      { label: "SĐT", value: doc.phone || "—" },
      { label: "Địa chỉ", value: doc.address || "—" },
    ],
  }).catch(() => {});

  res.status(201).json(doc);
});

/* ============================ ADMIN ============================ */

/** GET /api/admin/court-owner/requests?status=&page= */
export const adminListRequests = expressAsyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const filter = {};
  if (["pending", "approved", "rejected"].includes(req.query.status)) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    CourtOwnerRequest.find(filter)
      .sort({ status: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("user", "name nickname phone email avatar role")
      .lean(),
    CourtOwnerRequest.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

async function notifyUser(userId, title, body) {
  await Promise.allSettled([
    createInAppNotifications({ recipients: userId, type: "SYSTEM", title, body, url: "/owner" }),
    publishNotification(EVENTS.USER_DIRECT_BROADCAST, { userId: String(userId), title, body, url: "/owner" }).catch(() => {}),
  ]);
}

/** PATCH /api/admin/court-owner/requests/:id/approve */
export const adminApproveRequest = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const reqDoc = await CourtOwnerRequest.findById(id);
  if (!reqDoc) {
    res.status(404);
    throw new Error("Không tìm thấy yêu cầu");
  }
  const user = await User.findById(reqDoc.user);
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }
  if (user.role !== "admin") user.role = "courtOwner";
  await user.save();
  reqDoc.status = "approved";
  reqDoc.reviewedBy = req.user._id;
  reqDoc.reviewedAt = new Date();
  await reqDoc.save();
  notifyUser(user._id, "✅ Đã duyệt làm chủ sân", "Bạn có thể tạo cụm sân và nhận đặt sân ngay bây giờ.").catch(() => {});
  res.json(reqDoc);
});

/** PATCH /api/admin/court-owner/requests/:id/reject  { reason } */
export const adminRejectRequest = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const reqDoc = await CourtOwnerRequest.findById(id);
  if (!reqDoc) {
    res.status(404);
    throw new Error("Không tìm thấy yêu cầu");
  }
  reqDoc.status = "rejected";
  reqDoc.reviewedBy = req.user._id;
  reqDoc.reviewedAt = new Date();
  reqDoc.rejectReason = String(req.body?.reason || "").slice(0, 300);
  await reqDoc.save();
  notifyUser(reqDoc.user, "Yêu cầu làm chủ sân chưa được duyệt", reqDoc.rejectReason || "Vui lòng liên hệ hỗ trợ để biết thêm.").catch(() => {});
  res.json(reqDoc);
});
