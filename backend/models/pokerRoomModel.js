// models/pokerRoomModel.js — Poker room (Texas Hold'em, chip vui chơi).
// 1 room = 1 bàn 6 ghế. currentHand embed hand đang chơi.
import mongoose from "mongoose";

const { Schema } = mongoose;

const seatSchema = new Schema(
  {
    // null = ghế trống
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    seatIndex: { type: Number, required: true }, // 0..5
    chips: { type: Number, default: 0, min: 0 }, // stack hiện tại
    // Trạng thái trong ván hiện tại
    cards: { type: [String], default: [] }, // ["Ah","Ks"] chỉ user tự thấy
    betThisStreet: { type: Number, default: 0 },
    totalBetThisHand: { type: Number, default: 0 },
    hasFolded: { type: Boolean, default: false },
    isAllIn: { type: Boolean, default: false },
    lastAction: { type: String, default: null }, // "fold" "check" "call" "raise" "allin"
    sittingOut: { type: Boolean, default: false }, // ghế vẫn giữ nhưng skip ván
  },
  { _id: false },
);

const actionLogSchema = new Schema(
  {
    seatIndex: Number,
    action: String, // "fold", "check", "call", "raise", "allin", "post_sb", "post_bb"
    amount: Number,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const pokerRoomSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Blinds cố định vui chơi
    smallBlind: { type: Number, default: 5, min: 1 },
    bigBlind: { type: Number, default: 10, min: 2 },
    // Số chip mặc định khi user mới ngồi vào bàn (buy-in)
    buyIn: { type: Number, default: 1000, min: 10 },
    maxSeats: { type: Number, default: 6, min: 2, max: 9 },
    seats: { type: [seatSchema], default: [] },

    // Trạng thái ván hiện tại — reset mỗi ván mới
    handNumber: { type: Number, default: 0 },
    stage: {
      type: String,
      enum: ["waiting", "preflop", "flop", "turn", "river", "showdown"],
      default: "waiting",
      index: true,
    },
    dealerIndex: { type: Number, default: 0 }, // seatIndex của button
    activeIndex: { type: Number, default: -1 }, // seatIndex đang tới lượt
    board: { type: [String], default: [] }, // ["Kh","7c","2s"] ...
    deck: { type: [String], default: [] }, // ẩn với client
    pot: { type: Number, default: 0 },
    currentBet: { type: Number, default: 0 }, // mức cược lớn nhất street này
    minRaise: { type: Number, default: 0 },
    lastAggressorIndex: { type: Number, default: -1 },
    actions: { type: [actionLogSchema], default: [] },
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

    // Turn timer — 30 giây suy nghĩ. Nếu quá deadline, auto check/fold.
    turnDeadlineAt: { type: Date, default: null },
    turnDurationSec: { type: Number, default: 30 },

    // Chat trong bàn — cap 100 tin gần nhất, cũ hơn bị cắt.
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

    // Auto-close nếu không hoạt động lâu
    lastActivityAt: { type: Date, default: Date.now, index: true },

    // Room status
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      index: true,
    },
  },
  { timestamps: true },
);

pokerRoomSchema.index({ status: 1, lastActivityAt: -1 });

const PokerRoom =
  mongoose.models.PokerRoom || mongoose.model("PokerRoom", pokerRoomSchema);
export default PokerRoom;
