import mongoose from "mongoose";

const SeoNewsLinkCandidateSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, unique: true },

    title: String,
    sourceName: String,
    publishedAt: Date,

    score: Number,
    reason: String,
    language: String,
    tags: [String],

    status: {
      type: String,
      enum: ["pending", "crawled", "skipped", "failed"],
      default: "pending",
    },

    lastError: String,
    lastErrorCode: String,
  },
  { timestamps: true }
);

SeoNewsLinkCandidateSchema.index({ status: 1, createdAt: -1 });
SeoNewsLinkCandidateSchema.index({ score: -1 });

export default mongoose.model("SeoNewsLinkCandidate", SeoNewsLinkCandidateSchema);
