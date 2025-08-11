// models/reputationEventModel.js
import mongoose from "mongoose";

const reputationEventSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, enum: ["TOURNAMENT_FINISHED"], required: true },
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    amount: { type: Number, required: true }, // % cộng (vd 10)
  },
  { timestamps: true, strict: true }
);

// đảm bảo 1 user chỉ nhận bonus 1 lần / giải
reputationEventSchema.index(
  { user: 1, type: 1, tournament: 1 },
  { unique: true }
);

export default mongoose.model("ReputationEvent", reputationEventSchema);
