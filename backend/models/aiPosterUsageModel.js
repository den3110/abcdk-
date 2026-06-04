import mongoose from "mongoose";

const aiPosterUsageSchema = new mongoose.Schema(
  {
    scope: { type: String, required: true, default: "openai-poster" },
    ymd: { type: String, required: true },
    count: { type: Number, default: 0 },
    lastAttemptAt: { type: Date },
    model: { type: String, default: "" },
  },
  { timestamps: true },
);

aiPosterUsageSchema.index({ scope: 1, ymd: 1 }, { unique: true });

export default mongoose.models.AiPosterUsage ||
  mongoose.model("AiPosterUsage", aiPosterUsageSchema);
