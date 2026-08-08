// services/nicknameRequest.service.js
// Logic dùng chung cho approve/reject nickname request — được gọi từ
// admin controller (HTTP) và telegram bot (callback query).
import NicknameChangeRequest from "../models/nicknameChangeRequestModel.js";
import User from "../models/userModel.js";
import { createInAppNotifications } from "./inAppNotify.js";
import { sendToUserIds } from "./notifications/expoPush.js";

/**
 * Duyệt yêu cầu đổi nickname.
 * @param {ObjectId|string} requestId
 * @param {ObjectId|string} actorId (admin id / null nếu qua bot mà không rõ)
 * @returns {Promise<{ok: boolean, error?: string, request?: object, user?: object}>}
 */
export async function approveRequest(requestId, actorId) {
  const reqDoc = await NicknameChangeRequest.findById(requestId);
  if (!reqDoc) return { ok: false, error: "Không tìm thấy yêu cầu" };
  if (reqDoc.status !== "pending")
    return {
      ok: false,
      error: `Yêu cầu đã ${reqDoc.status}, không thể duyệt lại`,
    };

  const user = await User.findById(reqDoc.user);
  if (!user) return { ok: false, error: "User không còn tồn tại" };

  // Kiểm dupe nickname (nhỡ có user khác lấy trong lúc chờ duyệt)
  const dup = await User.findOne({
    _id: { $ne: user._id },
    nickname: reqDoc.newNickname,
  }).select("_id");
  if (dup) {
    reqDoc.status = "rejected";
    reqDoc.resolvedBy = actorId || null;
    reqDoc.resolvedAt = new Date();
    reqDoc.rejectionReason = "Nickname đã có người dùng khác";
    await reqDoc.save();
    return {
      ok: false,
      error:
        "Nickname đã có người khác dùng — đã tự động từ chối yêu cầu này.",
      request: reqDoc,
    };
  }

  const oldNickname = user.nickname || "";
  user.nickname = reqDoc.newNickname;
  user.nicknameChangedAt = new Date();
  await user.save();

  reqDoc.oldNickname = oldNickname;
  reqDoc.status = "approved";
  reqDoc.resolvedBy = actorId || null;
  reqDoc.resolvedAt = new Date();
  await reqDoc.save();

  // Notify user
  createInAppNotifications({
    recipients: [String(user._id)],
    actorId: actorId || undefined,
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

  return { ok: true, request: reqDoc, user };
}

/**
 * Từ chối yêu cầu — user KHÔNG mất lần đổi (không đụng nicknameChangedAt).
 */
export async function rejectRequest(requestId, actorId, reason) {
  const reqDoc = await NicknameChangeRequest.findById(requestId);
  if (!reqDoc) return { ok: false, error: "Không tìm thấy yêu cầu" };
  if (reqDoc.status !== "pending")
    return {
      ok: false,
      error: `Yêu cầu đã ${reqDoc.status}, không thể từ chối lại`,
    };

  reqDoc.status = "rejected";
  reqDoc.resolvedBy = actorId || null;
  reqDoc.resolvedAt = new Date();
  reqDoc.rejectionReason =
    String(reason || "").slice(0, 500).trim() || "Tên không hợp lệ";
  await reqDoc.save();

  createInAppNotifications({
    recipients: [String(reqDoc.user)],
    actorId: actorId || undefined,
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

  return { ok: true, request: reqDoc };
}
