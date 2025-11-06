import mongoose from "mongoose";

const NewsLinkCandidateSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, unique: true },
    title: String,
    sourceName: String,
    publishedAt: Date,
    score: Number,
    reason: String,
    tags: [String],
    status: {
      type: String,
      enum: ["pending", "crawled", "skipped", "failed"],
      default: "pending",
    },
    lastError: String,
  },
  { timestamps: true }
);

NewsLinkCandidateSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("NewsLinkCandidate", NewsLinkCandidateSchema);
