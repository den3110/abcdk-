// models/samRoomModel.js — Sâm Lốc room, chip vui chơi.
// 4 người chơi, mỗi người 10 lá. Chơi combo: đôi/tam/sảnh/tứ quý/sảnh rồng.
// PHASE 2 SKELETON — combo detector + turn state machine hoàn thiện Phase 3.
import mongoose from "mongoose";

const { Schema } = mongoose;

const samSeatSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    seatIndex: { type: Number, required: true }, // 0..3
    chips: { type: Number, default: 0, min: 0 },
    cards: { type: [String], default: [] },
    hasFinished: { type: Boolean, default: false }, // đã hết bài
    finishOrder: { type: Number, default: 0 }, // 1..4
    lastAction: { type: String, default: null },
    sittingOut: { type: Boolean, default: false },
  },
  { _id: false },
);

const samPlayLogSchema = new Schema(
  {
    seatIndex: Number,
    action: String, // "play" | "pass" | "chat"
    cards: [String], // combo đã đánh
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const samRoomSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    stake: { type: Number, default: 100, min: 1 },
    buyIn: { type: Number, default: 1000, min: 10 },
    maxSeats: { type: Number, default: 4 },
    // Có bắt tứ quý 2 / sảnh rồng không (đền chip)
    allowInstantWin: { type: Boolean, default: true },

    seats: { type: [samSeatSchema], default: [] },

    handNumber: { type: Number, default: 0 },
    stage: {
      type: String,
      enum: ["waiting", "dealing", "playing", "showdown"],
      default: "waiting",
      index: true,
    },
    // Người đánh trước ván này (ai có 3♠ đánh đầu; ván sau người thắng)
    starterIndex: { type: Number, default: 0 },
    activeIndex: { type: Number, default: -1 },
    deck: { type: [String], default: [] },

    // Combo hiện tại trên bàn (người sau phải đánh combo cao hơn cùng loại)
    currentCombo: {
      type: new Schema(
        {
          cards: [String],
          type: String, // "single" | "pair" | "triple" | "straight" | "quad" | "dragon"
          fromSeat: Number,
        },
        { _id: false },
      ),
      default: null,
    },
    // Ai đã pass trong vòng hiện tại (round reset khi tất cả pass)
    passedSeats: { type: [Number], default: [] },

    plays: { type: [samPlayLogSchema], default: [] },

    winners: {
      type: [
        new Schema(
          {
            seatIndex: Number,
            userId: { type: Schema.Types.ObjectId, ref: "User" },
            userName: String,
            handDescription: String,
            amountWon: Number,
            revealedCards: [String],
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    handStartedAt: { type: Date, default: null },
    handEndedAt: { type: Date, default: null },

    turnDeadlineAt: { type: Date, default: null },
    turnDurationSec: { type: Number, default: 30 },

    messages: {
      type: [
        new Schema(
          {
            user: { type: Schema.Types.ObjectId, ref: "User" },
            name: String,
            avatar: String,
            text: { type: String, maxlength: 300 },
            at: { type: Date, default: Date.now },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    lastActivityAt: { type: Date, default: Date.now, index: true },
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      index: true,
    },
  },
  { timestamps: true },
);

samRoomSchema.index({ status: 1, lastActivityAt: -1 });

const SamRoom =
  mongoose.models.SamRoom || mongoose.model("SamRoom", samRoomSchema);
export default SamRoom;
