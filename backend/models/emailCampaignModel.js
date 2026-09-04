// models/emailCampaignModel.js
// Chiến dịch gửi email (quảng cáo giải, thông báo…) từ email của PickleTour.
import mongoose from "mongoose";

const { Schema } = mongoose;

const emailCampaignSchema = new Schema(
  {
    name: { type: String, default: "", trim: true }, // tên nội bộ để quản lý
    subject: { type: String, required: true, trim: true },
    previewText: { type: String, default: "", trim: true },
    heading: { type: String, default: "", trim: true },
    bodyHtml: { type: String, default: "" },
    ctaText: { type: String, default: "", trim: true },
    ctaUrl: { type: String, default: "", trim: true },

    audience: {
      // all: mọi user có email; tournament: người tham gia 1 giải; list: danh sách email nhập tay
      scope: {
        type: String,
        enum: ["all", "tournament", "list", "contactList"],
        default: "all",
      },
      tournament: { type: Schema.Types.ObjectId, ref: "Tournament", default: null },
      contactList: {
        type: Schema.Types.ObjectId,
        ref: "EmailContactList",
        default: null,
      },
      emails: { type: [String], default: [] },
      estimatedCount: { type: Number, default: 0 },
    },

    status: {
      type: String,
      enum: ["draft", "queued", "running", "completed", "failed", "canceled"],
      default: "draft",
      index: true,
    },

    progress: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
    sampleFailures: {
      type: [{ email: String, error: String }],
      default: [],
    },

    triggeredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    queueJobId: { type: String, default: "" },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    error: { type: String, default: "" },
  },
  { timestamps: true }
);

emailCampaignSchema.index({ createdAt: -1 });

const EmailCampaign =
  mongoose.models.EmailCampaign ||
  mongoose.model("EmailCampaign", emailCampaignSchema);

export default EmailCampaign;
