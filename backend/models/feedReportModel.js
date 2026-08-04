// models/feedReportModel.js
// User report bài / comment. Admin moderation queue.
import mongoose from "mongoose";

const { Schema } = mongoose;

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate",
  "nudity",
  "violence",
  "misinformation",
  "impersonation",
  "other",
];

const feedReportSchema = new Schema(
  {
    reporter: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ["post", "comment"],
      required: true,
    },
    targetId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    // để admin xem nhanh, tránh join
    postId: { type: Schema.Types.ObjectId, ref: "FeedPost", index: true },
    reason: {
      type: String,
      enum: REPORT_REASONS,
      required: true,
    },
    note: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ["pending", "reviewed", "dismissed", "actioned"],
      default: "pending",
      index: true,
    },
    action: {
      type: String,
      enum: [null, "hidden", "deleted"],
      default: null,
    },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    resolvedNote: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

// 1 user chỉ report 1 target 1 lần (idempotent)
feedReportSchema.index(
  { reporter: 1, targetType: 1, targetId: 1 },
  { unique: true }
);
feedReportSchema.index({ status: 1, createdAt: -1 });

const FeedReport =
  mongoose.models.FeedReport ||
  mongoose.model("FeedReport", feedReportSchema);

export default FeedReport;
