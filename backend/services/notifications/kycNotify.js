// src/services/notifications/cccdNotify.js
import mongoose from "mongoose";
import User from "../../models/User.js"; // chỉnh path nếu khác
import { publishNotification, EVENTS, CATEGORY } from "./notificationHub.js";

/**
 * Cập nhật cccdStatus và gửi thông báo tương ứng.
 * @param {Object} opts
 * @param {string} opts.userId - ObjectId user (chuỗi 24 hex)
 * @param {"verified"|"rejected"|"pending"|"unverified"|"approved"} opts.status
 *        (chấp nhận "approved" như alias của "verified")
 * @param {string} [opts.reason] - lý do từ chối (nếu rejected)
 * @param {boolean} [opts.alsoVerifyAccount=true] - nếu status=verified thì set luôn user.verified="verified"
 */
export async function updateCccdStatusAndNotify({
  userId,
  status,
  reason = "",
  alsoVerifyAccount = true,
}) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("userId không hợp lệ");
  }

  const s = String(status || "").toLowerCase();
  const mapped = s === "approved" ? "verified" : s; // alias tiện dụng

  const allowed = ["verified", "rejected", "pending", "unverified"];
  if (!allowed.includes(mapped)) {
    throw new Error(`Trạng thái không hợp lệ: ${status}`);
  }

  // Chuẩn bị update doc
  const $set = { cccdStatus: mapped };
  if (alsoVerifyAccount && mapped === "verified") {
    $set.verified = "verified"; // đồng bộ cờ verified tổng
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $set },
    {
      new: true,
      runValidators: true,
      lean: true,
      projection: "_id cccdStatus verified",
    }
  );

  if (!user) {
    throw new Error("User không tồn tại");
  }

  // Gửi notify theo kết quả
  if (mapped === "verified") {
    publishNotification(EVENTS.KYC_APPROVED, {
      userId: String(user._id),
      topicType: "user",
      topicId: String(user._id),
      category: CATEGORY.KYC,
    });
  } else if (mapped === "rejected") {
    publishNotification(EVENTS.KYC_REJECTED, {
      userId: String(user._id),
      topicType: "user",
      topicId: String(user._id),
      category: CATEGORY.KYC,
      reason,
    });
  }

  return {
    ok: true,
    userId: String(user._id),
    cccdStatus: mapped,
    verified: user.verified,
  };
}

// Sugar helpers
export const notifyCccdApproved = (userId, opts = {}) =>
  updateCccdStatusAndNotify({ userId, status: "verified", ...opts });

export const notifyCccdRejected = (userId, reason = "", opts = {}) =>
  updateCccdStatusAndNotify({ userId, status: "rejected", reason, ...opts });
