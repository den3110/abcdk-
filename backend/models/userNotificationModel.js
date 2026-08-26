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
  "MARKET_OFFER_NEW",
  "MARKET_OFFER_ACCEPTED",
  "MARKET_OFFER_REJECTED",
  "PLAY_INVITE_JOIN",
  "PLAY_INVITE_ACCEPTED",
  "CLUB_ACTIVITY",
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
    // Gộp notif cùng nguồn (VD nhiều tin nhắn cùng conversation) → hiển thị 1 dòng + badge
    count: { type: Number, default: 1 },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// list newest-first + filter unread. Sort chính là createdAt để notif upsert
// (chat gộp) bubble lên top khi có msg mới.
userNotificationSchema.index({ user: 1, createdAt: -1, _id: -1 });
userNotificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
// Fast upsert lookup: unread notif cùng conversation của cùng user
userNotificationSchema.index(
  { user: 1, type: 1, "data.conversationId": 1, isRead: 1 },
  {
    partialFilterExpression: {
      type: "CHAT_MESSAGE_NEW",
      isRead: false,
    },
    name: "chat_unread_by_convo",
  }
);

const UserNotification =
  mongoose.models.UserNotification ||
  mongoose.model("UserNotification", userNotificationSchema);

export default UserNotification;
