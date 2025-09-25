// models/TournamentManager.js
import mongoose from "mongoose";

const tournamentManagerSchema = new mongoose.Schema(
  {
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: { type: String, enum: ["manager"], default: "manager" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, strict: true }
);



// 1 user chỉ quản lý 1 giải một lần
tournamentManagerSchema.index({ tournament: 1, user: 1 }, { unique: true });

export default mongoose.model("TournamentManager", tournamentManagerSchema);
