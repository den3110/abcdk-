import mongoose from "mongoose";

const ratingChangeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: true,
    },
    match: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      index: true,
      required: true,
    },
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      index: true,
      required: true,
    },

    // "singles" | "doubles"
    kind: { type: String, enum: ["singles", "doubles"], required: true },

    before: { type: Number, required: true }, // DUPR trước (2.0..8.0)
    after: { type: Number, required: true }, // DUPR sau
    delta: { type: Number, required: true }, // after - before

    expected: { type: Number, required: true }, // P(win) của team người chơi
    score: { type: Number, required: true }, // 1=thắng, 0=thua

    // Reliability trước/sau để debug K
    reliabilityBefore: { type: Number, default: 0 },
    reliabilityAfter: { type: Number, default: 0 },

    // Optional: margin info (từ gameScores)
    marginBonus: { type: Number, default: 0 },
  },
  { timestamps: true, strict: true }
);

// idempotent: 1 user chỉ được log 1 lần cho 1 match/kind
ratingChangeSchema.index({ user: 1, match: 1, kind: 1 }, { unique: true });

export default mongoose.model("RatingChange", ratingChangeSchema);
