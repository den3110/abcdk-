// models/chatMessageModel.js
// Message trong 1 conversation. Soft-delete, readBy array, reply-to.
import mongoose from "mongoose";

const { Schema } = mongoose;

const attachmentSchema = new Schema(
  {
    type: { type: String, enum: ["image", "video", "file"], required: true },
    url: { type: String, required: true, trim: true },
    name: { type: String, trim: true },
    mime: { type: String, trim: true },
    sizeBytes: { type: Number, min: 0 },
    width: Number,
    height: Number,
  },
  { _id: false }
);

const chatMessageSchema = new Schema(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: "ChatConversation",
      required: true,
      index: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    content: { type: String, default: "", maxlength: 4000 },
    attachments: { type: [attachmentSchema], default: [] },
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: "ChatMessage",
      default: null,
    },
    // Users được @ tag trong content — link tới hồ sơ
    mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],
    // Giải đấu được gắn kèm — hiện card + link
    linkedTournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      default: null,
    },
    // readBy: users đã xem tính đến message này
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    // Metadata cho system message (ví dụ: "X đã tham gia giải")
    systemKind: {
      type: String,
      enum: [null, "conversation_created", "user_joined", "notice"],
      default: null,
    },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Newest-first per conversation
chatMessageSchema.index({ conversation: 1, _id: -1 });

const ChatMessage =
  mongoose.models.ChatMessage ||
  mongoose.model("ChatMessage", chatMessageSchema);

export default ChatMessage;
