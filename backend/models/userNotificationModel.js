// models/userNotificationModel.js
// Thông báo in-app cho từng user (khác NotificationLog — cái đó cho push
// broadcast của event-based system). Dùng cho notification center.
import mongoose from "mongoose";

const { Schema } = mongoose;

export const NOTIFICATION_TYPES = [
  "FEED_COMMENT_NEW",
  "FEED_REPLY_NEW",
  "FEED_REACTION_NEW",
  "FEED_MENTION",
  "CHAT_MESSAGE_NEW",
  "FRIEND_REQUEST_NEW",
  "FRIEND_ACCEPTED",
  "TOURNAMENT_UPDATE",
  "SYSTEM",
];

const userNotificationSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // actor: người gây ra thông báo (ai comment / ai gửi tin nhắn / ai kết bạn)
    actor: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    title: { type: String, default: "" },
    body: { type: String, default: "" },
    // Deep link tuỳ tính năng — client tự navigate
    url: { type: String, default: "" },
    // Payload thêm (id post/comment/conversation/edge tuỳ context)
    data: { type: Schema.Types.Mixed, default: {} },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// list newest-first + filter unread
userNotificationSchema.index({ user: 1, _id: -1 });
userNotificationSchema.index({ user: 1, isRead: 1, _id: -1 });

const UserNotification =
  mongoose.models.UserNotification ||
  mongoose.model("UserNotification", userNotificationSchema);

export default UserNotification;
