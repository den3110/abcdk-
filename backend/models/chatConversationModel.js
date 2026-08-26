// models/chatConversationModel.js
// Cuộc trò chuyện — hỗ trợ 3 loại:
//   - "dm"          : 1-1 giữa 2 user thường
//   - "tournament"  : user ↔ nhóm quản lý giải (organizer + managers)
//   - "club"        : chat nhóm của 1 CLB (participants = thành viên active)
import mongoose from "mongoose";

const { Schema } = mongoose;

const lastMessageSchema = new Schema(
  {
    text: { type: String, default: "" },
    sender: { type: Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: null },
    hasAttachment: { type: Boolean, default: false },
  },
  { _id: false }
);

const chatConversationSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["dm", "tournament", "club"],
      required: true,
      index: true,
    },
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    // Với type=tournament: gắn giải; participants gồm initiator + organizer + managers.
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      default: null,
      index: true,
    },
    // Với type=club: gắn CLB; participants = thành viên active của CLB.
    club: {
      type: Schema.Types.ObjectId,
      ref: "Club",
      default: null,
      index: true,
    },
    initiator: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Denormalized preview cho conversation list
    lastMessage: { type: lastMessageSchema, default: () => ({}) },
    lastMessageAt: { type: Date, default: null, index: true },
    // Map<userIdString, unreadCount>
    unread: {
      type: Map,
      of: Number,
      default: {},
    },
    // User đã tắt thông báo cho hội thoại này
    mutedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    // User "ẩn" hội thoại (không xoá messages, chỉ ẩn khỏi list của mình)
    hiddenFor: [{ type: Schema.Types.ObjectId, ref: "User" }],
    // Tin nhắn được ghim (BTC ghim thông báo quan trọng trong nhóm giải)
    pinnedMessages: [{ type: Schema.Types.ObjectId, ref: "ChatMessage" }],
    // Admin flag
    isBlocked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

chatConversationSchema.index({ participants: 1, lastMessageAt: -1 });
// Đảm bảo tra "user-A và user-B đã có DM chưa" nhanh (participants sorted).
chatConversationSchema.index({ type: 1, participants: 1 });
// Tournament chat: mỗi user chỉ có 1 conversation với 1 giải.
chatConversationSchema.index(
  { type: 1, tournament: 1, initiator: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "tournament" },
  }
);
// Club chat: mỗi CLB chỉ có duy nhất 1 hội thoại nhóm.
chatConversationSchema.index(
  { type: 1, club: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "club" },
  }
);

chatConversationSchema.methods.markRead = function (userId) {
  const uid = String(userId);
  if (this.unread && this.unread.has(uid)) {
    this.unread.set(uid, 0);
  }
  return this;
};

chatConversationSchema.methods.bumpUnreadExcept = function (senderId) {
  const sid = String(senderId);
  for (const p of this.participants) {
    const pid = String(p);
    if (pid === sid) continue;
    const cur = (this.unread?.get(pid) || 0) + 1;
    this.unread.set(pid, cur);
  }
  return this;
};

const ChatConversation =
  mongoose.models.ChatConversation ||
  mongoose.model("ChatConversation", chatConversationSchema);

export default ChatConversation;
