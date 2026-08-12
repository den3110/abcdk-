// models/phomRoomModel.js — Phỏm (Tá lả) room, chip vui chơi.
// 4 người chơi, mỗi người 9 lá (nhà cái 10), rút - hạ phỏm - móm/ù.
// PHASE 2 SKELETON — turn state machine + scoring engine sẽ hoàn thiện Phase 3.
import mongoose from "mongoose";

const { Schema } = mongoose;

const phomSeatSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    seatIndex: { type: Number, required: true }, // 0..3
    chips: { type: Number, default: 0, min: 0 },
    // Hand VĐV cầm — chỉ owner tự thấy.
    cards: { type: [String], default: [] },
    // Phỏm hạ (mỗi phỏm là 1 array card codes). Public sau khi hạ.
    melds: { type: [[String]], default: [] },
    // Bài lẻ còn lại sau khi hạ + gửi. Public cuối ván.
    leftover: { type: [String], default: [] },
    // Đã "ù" chưa (ăn trắng, ù khan, ù tròn...)
    hasWon: { type: Boolean, default: false },
    // Đã "hạ phỏm" (down) chưa
    hasDowned: { type: Boolean, default: false },
    // Trong phase downing: đã confirm hạ chưa
    hasFinishedDowning: { type: Boolean, default: false },
    lastAction: { type: String, default: null },
    sittingOut: { type: Boolean, default: false },
  },
  { _id: false },
);

const phomActionLogSchema = new Schema(
  {
    seatIndex: Number,
    action: String, // "draw_deck" | "draw_discard" | "discard" | "down" | "gui" | "u"
    card: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const phomRoomSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Cược mỗi ván (mất khi móm)
    buyIn: { type: Number, default: 500, min: 10 },
    stake: { type: Number, default: 50, min: 1 },
    maxSeats: { type: Number, default: 4 },

    seats: { type: [phomSeatSchema], default: [] },

    // Trạng thái ván
    handNumber: { type: Number, default: 0 },
    stage: {
      type: String,
      enum: ["waiting", "dealing", "playing", "downing", "showdown"],
      default: "waiting",
      index: true,
    },
    dealerIndex: { type: Number, default: 0 }, // nhà cái (được +1 lá)
    activeIndex: { type: Number, default: -1 },
    deck: { type: [String], default: [] }, // ẩn client
    // Discard pile — mỗi phần tử { card, from } (bài user thảy ra bàn)
    discards: {
      type: [
        new Schema(
          {
            card: String,
            fromSeat: Number,
            at: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    // Ù/thắng cuối ván
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

phomRoomSchema.index({ status: 1, lastActivityAt: -1 });

const PhomRoom =
  mongoose.models.PhomRoom || mongoose.model("PhomRoom", phomRoomSchema);
export default PhomRoom;
