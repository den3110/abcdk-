// controllers/adminController.js
import asyncHandler from "express-async-handler";
import User from "../../models/userModel.js";
import {
  CATEGORY,
  EVENTS,
  publishNotification,
} from "../../services/notifications/notificationHub.js";
import mongoose from "mongoose";

/**
 * GET  /api/admin/users
 * Query: page=1 keyword=abc role=user|referee|admin
 * Private/Admin
 */
export const getUsers = asyncHandler(async (req, res) => {
  const pageSize = 10;
  const page = Number(req.query.page) || 1;

  // ---- filter ----
  const keyword = req.query.keyword
    ? {
        $or: [
          { name: { $regex: req.query.keyword, $options: "i" } },
          { email: { $regex: req.query.keyword, $options: "i" } },
        ],
      }
    : {};

  const roleFilter = req.query.role ? { role: req.query.role } : {};

  const where = { ...keyword, ...roleFilter };

  const total = await User.countDocuments(where);
  const users = await User.find(where)
    .select("-password -__v")
    .sort({ createdAt: -1 })
    .limit(pageSize)
    .skip(pageSize * (page - 1));

  res.json({ users, page, pageSize, total });
});

/**
 * PUT /api/admin/users/:id/role
 * body { role }
 * Private/Admin
 */
export const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!["user", "referee", "admin"].includes(role)) {
    res.status(400);
    throw new Error("Role không hợp lệ");
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User không tồn tại");
  }

  user.role = role;
  await user.save();
  res.json({ message: "Cập nhật role thành công", role: user.role });
});

/**
 * DELETE /api/admin/users/:id
 * Private/Admin
 */
export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User không tồn tại");
  }

  await user.deleteOne();
  res.json({ message: "Đã xoá user" });
});

/* ✨ Cập nhật thông tin tuỳ ý */
export const updateUserInfo = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // danh sách field cho phép sửa
  const fields = [
    "name",
    "nickname",
    "phone",
    "email",
    "dob",
    "gender",
    "province",
    "cccd",
    "isHiddenFromRankings",
  ];

  let rankingUpdateNeeded = false;
  let newHiddenStatus = false;

  fields.forEach((f) => {
    if (req.body[f] !== undefined) {
      if (f === "isHiddenFromRankings" && user[f] !== req.body[f]) {
        rankingUpdateNeeded = true;
        newHiddenStatus = req.body[f];
      }
      user[f] = req.body[f];
    }
  });

  /* --- kiểm tra trùng email / phone --- */
  if (req.body.email && req.body.email !== user.email) {
    const dupe = await User.findOne({ email: req.body.email });
    if (dupe) {
      res.status(400);
      throw new Error("Email đã tồn tại");
    }
  }
  if (req.body.phone && req.body.phone !== user.phone) {
    const dupe = await User.findOne({ phone: req.body.phone });
    if (dupe) {
      res.status(400);
      throw new Error("Số điện thoại đã tồn tại");
    }
  }

  if (req.body.cccd && req.body.cccd !== user.cccd) {
    const dupe = await User.findOne({ cccd: req.body.cccd });
    if (dupe) {
      res.status(400);
      throw new Error("CCCD đã tồn tại");
    }
  }

  await user.save();

  if (rankingUpdateNeeded) {
    try {
      const { default: Ranking } = await import("../../models/rankingModel.js");
      await Ranking.updateOne(
        { user: user._id },
        { isHiddenFromRankings: newHiddenStatus },
      );
    } catch (err) {
      console.error("Error updating ranking isHiddenFromRankings:", err);
    }
  }

  res.json({ message: "User updated", user });
});
/* ✨ Duyệt / Từ chối KYC */
export const reviewUserKyc = asyncHandler(async (req, res) => {
  const { action, reason = "" } = req.body || {};
  const { id } = req.params;

  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ message: "Hành động không hợp lệ" });
  }
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "ID người dùng không hợp lệ" });
  }

  const user = await User.findById(id).select("_id cccdStatus verified");
  if (!user) return res.status(404).json({ message: "User not found" });

  // Cập nhật trạng thái CCCD
  const nextStatus = action === "approve" ? "verified" : "rejected";
  user.cccdStatus = nextStatus;

  // (tuỳ chọn) đồng bộ cờ verified tổng khi CCCD được duyệt
  if (action === "approve" && user.verified !== "verified") {
    user.verified = "verified";
  }

  await user.save();

  // Gửi thông báo – không để lỗi notify phá hỏng response
  try {
    if (action === "approve") {
      publishNotification(EVENTS.KYC_APPROVED, {
        userId: String(user._id),
        topicType: "user",
        topicId: String(user._id),
        category: CATEGORY.KYC,
      });
    } else {
      publishNotification(EVENTS.KYC_REJECTED, {
        userId: String(user._id),
        topicType: "user",
        topicId: String(user._id),
        category: CATEGORY.KYC,
        reason: String(reason || ""),
      });
    }
  } catch (e) {
    console.error("[notify] KYC decision failed:", e?.message);
  }

  return res.json({ message: "KYC updated", status: user.cccdStatus });
});
