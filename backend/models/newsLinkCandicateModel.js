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

    // Mô tả lỗi human-readable (hiện ở UI)
    lastError: String,

    // 🆕 Mã lỗi ngắn để filter/thống kê ở FE:
    // VD: PARSE_TOO_SHORT, DUPLICATE_CONTENT, HTTP_403, HUMAN_VERIFICATION, TIMEOUT, OTHER
    lastErrorCode: String,
  },
  { timestamps: true }
);

// Index tối ưu cho màn monitoring
NewsLinkCandidateSchema.index({ status: 1, createdAt: -1 });
NewsLinkCandidateSchema.index({ score: -1 });

export default mongoose.model("NewsLinkCandidate", NewsLinkCandidateSchema);
