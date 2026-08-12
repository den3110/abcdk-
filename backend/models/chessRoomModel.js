// models/chessRoomModel.js — Cờ vua (Chess) 8x8, 2 người.
// Board state lưu dạng FEN (chess.js standard).
import mongoose from "mongoose";

const { Schema } = mongoose;

const chessSeatSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    seatIndex: { type: Number, required: true }, // 0=trắng, 1=đen
    chips: { type: Number, default: 0, min: 0 },
    sittingOut: { type: Boolean, default: false },
  },
  { _id: false },
);

const chessMoveSchema = new Schema(
  {
    seatIndex: Number,
    from: String, // "e2"
    to: String, // "e4"
    promotion: String, // "q"|"r"|"b"|"n" nếu pawn promotion
    san: String, // "e4", "Nf3", "Qxd5+"
    fenAfter: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const chessRoomSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    stake: { type: Number, default: 100, min: 1 },
    buyIn: { type: Number, default: 1000, min: 10 },
    maxSeats: { type: Number, default: 2 },
    seats: { type: [chessSeatSchema], default: [] },

    handNumber: { type: Number, default: 0 },
    stage: {
      type: String,
      enum: ["waiting", "playing", "showdown"],
      default: "waiting",
      index: true,
    },
    // FEN: standard chess starting: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    fen: {
      type: String,
      default:
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    },
    activeSeatIndex: { type: Number, default: 0 }, // seat của bên đến lượt
    moves: { type: [chessMoveSchema], default: [] },
    winnerSeatIndex: { type: Number, default: -1 }, // -1 = hoà / chưa xong
    resultReason: { type: String, default: null }, // "checkmate" | "resign" | "draw" | "stalemate" | "timeout"

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

chessRoomSchema.index({ status: 1, lastActivityAt: -1 });

const ChessRoom =
  mongoose.models.ChessRoom || mongoose.model("ChessRoom", chessRoomSchema);
export default ChessRoom;
