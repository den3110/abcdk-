// models/regInviteModel.js
import mongoose from "mongoose";

const invitePlayerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    }, // có thể null (match theo phone/nickname)
    phone: { type: String, default: "" },
    nickname: { type: String, default: "" },
    fullName: { type: String, default: "" },
    avatar: { type: String, default: "" },
    score: { type: Number, default: 0 }, // snapshot điểm lúc mời (nếu cần)
  },
  { _id: false }
);

const regInviteSchema = new mongoose.Schema(
  {
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    eventType: { type: String, enum: ["single", "double"], required: true },

    player1: { type: invitePlayerSchema, required: true },
    player2: { type: invitePlayerSchema, default: null }, // null nếu single

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Xác nhận theo từng người
    confirmations: {
      p1: {
        type: String,
        enum: ["pending", "accepted", "declined"],
        default: "pending",
      },
      // ⚠️ UPDATE: p2 để optional, KHÔNG đặt default khi single
      p2: {
        type: String,
        enum: ["pending", "accepted", "declined"],
        required: false,
      },
    },

    status: {
      type: String,
      enum: ["pending", "finalized", "declined"],
      default: "pending",
    },
    registrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      default: null,
    },

    // Lý do fail (full, duplicate, cap, time, declined, …)
    failReason: { type: String, default: "" },
    message: { type: String, default: "" }, // giữ lại message khi mời (để snapshot vào Registration nếu cần)
  },
  { timestamps: true }
);

// Indexes
regInviteSchema.index({ tournament: 1, status: 1 });
regInviteSchema.index({ "player1.user": 1 });
regInviteSchema.index({ "player2.user": 1 });
regInviteSchema.index({ "player1.phone": 1 });
regInviteSchema.index({ "player1.nickname": 1 });
regInviteSchema.index({ "player2.phone": 1 });
regInviteSchema.index({ "player2.nickname": 1 });

export default mongoose.model("RegInvite", regInviteSchema);
