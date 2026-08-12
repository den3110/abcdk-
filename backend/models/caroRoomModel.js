// models/caroRoomModel.js — Cờ Caro (Gomoku) 5-in-row, 2 người, 15x15.
import mongoose from "mongoose";

const { Schema } = mongoose;

const caroSeatSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    seatIndex: { type: Number, required: true }, // 0=X (đi trước), 1=O
    chips: { type: Number, default: 0, min: 0 },
    sittingOut: { type: Boolean, default: false },
  },
  { _id: false },
);

const caroMoveSchema = new Schema(
  {
    seatIndex: Number, // 0=X, 1=O
    row: Number,
    col: Number,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const caroRoomSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    stake: { type: Number, default: 100, min: 1 }, // chip cược mỗi ván
    buyIn: { type: Number, default: 1000, min: 10 },
    boardSize: { type: Number, default: 15, min: 10, max: 20 },
    maxSeats: { type: Number, default: 2 },
    seats: { type: [caroSeatSchema], default: [] },

    handNumber: { type: Number, default: 0 },
    stage: {
      type: String,
      enum: ["waiting", "playing", "showdown"],
      default: "waiting",
      index: true,
    },
    activeSeatIndex: { type: Number, default: -1 }, // 0 hoặc 1
    // Board: string 2D encoded. board[r*size + c] = "X" | "O" | ""
    // Lưu dạng flat array để dễ query.
    board: { type: [String], default: [] },
    moves: { type: [caroMoveSchema], default: [] },
    winnerSeatIndex: { type: Number, default: -1 },
    winningLine: { type: [[Number]], default: [] }, // list of [r, c]

    turnDurationSec: { type: Number, default: 30 },
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

caroRoomSchema.index({ status: 1, lastActivityAt: -1 });

const CaroRoom =
  mongoose.models.CaroRoom || mongoose.model("CaroRoom", caroRoomSchema);
export default CaroRoom;
