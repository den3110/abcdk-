// models/chatBotMessageModel.js
import mongoose from "mongoose";

const chatBotMessageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    role: {
      type: String,
      enum: ["user", "bot", "system"],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },

    // meta từ bot (type, source, usedSkill, confidence, v.v.)
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // navigation: deepLink, screen, missingContext...
    navigation: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // context để dễ filter theo tournament, match,...
    context: {
      tournamentId: { type: String },
      matchId: { type: String },
      bracketId: { type: String },
      courtCode: { type: String },
    },

    // nếu muốn map bot-message trả lời cho 1 user-message cụ thể
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatBotMessage",
      default: null,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  },
);

const ChatBotMessage =
  mongoose.models.ChatBotMessage ||
  mongoose.model("ChatBotMessage", chatBotMessageSchema);

export default ChatBotMessage;
