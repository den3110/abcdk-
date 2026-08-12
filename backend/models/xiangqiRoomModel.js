// models/xiangqiRoomModel.js — Cờ tướng (Xiangqi) 9x10, 2 người.
import mongoose from "mongoose";

const { Schema } = mongoose;

const xiangqiSeatSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    seatIndex: { type: Number, required: true }, // 0=đỏ (dưới, đi trước), 1=đen
    chips: { type: Number, default: 0, min: 0 },
    sittingOut: { type: Boolean, default: false },
  },
  { _id: false },
);

const xiangqiMoveSchema = new Schema(
  {
    seatIndex: Number,
    from: [Number], // [row, col]
    to: [Number],
    piece: String, // "K","A","E","H","R","C","P" (red uppercase) / lowercase = black
    captured: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const xiangqiRoomSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    stake: { type: Number, default: 100, min: 1 },
    buyIn: { type: Number, default: 1000, min: 10 },
    maxSeats: { type: Number, default: 2 },
    seats: { type: [xiangqiSeatSchema], default: [] },

    handNumber: { type: Number, default: 0 },
    stage: {
      type: String,
      enum: ["waiting", "playing", "showdown"],
      default: "waiting",
      index: true,
    },
    // Board 10 hàng × 9 cột. board[r * 9 + c] = "K"|"A"|"E"|"H"|"R"|"C"|"P"
    // Red UPPERCASE (K=Tướng, A=Sĩ, E=Tượng, H=Mã, R=Xe, C=Pháo, P=Tốt)
    // Black lowercase. "" = trống.
    board: { type: [String], default: [] },
    activeSeatIndex: { type: Number, default: 0 },
    moves: { type: [xiangqiMoveSchema], default: [] },
    winnerSeatIndex: { type: Number, default: -1 },
    resultReason: { type: String, default: null },

    turnDurationSec: { type: Number, default: 60 },
    turnDeadlineAt: { type: Date, default: null },
    handStartedAt: { type: Date, default: null },
    handEndedAt: { type: Date, default: null },

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

xiangqiRoomSchema.index({ status: 1, lastActivityAt: -1 });

const XiangqiRoom =
  mongoose.models.XiangqiRoom || mongoose.model("XiangqiRoom", xiangqiRoomSchema);
export default XiangqiRoom;
