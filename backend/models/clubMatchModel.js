// models/clubMatchModel.js
// Trận giao hữu nội bộ CLB (đơn hoặc đôi) — dùng cho BXH nội bộ
import mongoose from "mongoose";

const ClubMatchSchema = new mongoose.Schema(
  {
    club: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      index: true,
      required: true,
    },
    teamA: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    teamB: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    scoreA: { type: Number, default: 0, min: 0 },
    scoreB: { type: Number, default: 0, min: 0 },
    playedAt: { type: Date, default: Date.now, index: true },
    note: { type: String, default: "", maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

ClubMatchSchema.index({ club: 1, playedAt: -1 });

export default mongoose.model("ClubMatch", ClubMatchSchema);
