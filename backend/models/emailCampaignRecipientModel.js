// models/emailCampaignRecipientModel.js
// Nhật ký gửi theo từng người nhận của 1 chiến dịch — để theo dõi "đã gửi cho ai".
import mongoose from "mongoose";

const { Schema } = mongoose;

const emailCampaignRecipientSchema = new Schema(
  {
    campaign: {
      type: Schema.Types.ObjectId,
      ref: "EmailCampaign",
      required: true,
      index: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: "" },
    avatar: { type: String, default: "" },
    status: {
      type: String,
      enum: ["sent", "failed", "skipped"],
      default: "sent",
      index: true,
    },
    error: { type: String, default: "" },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Mỗi email chỉ ghi 1 lần / chiến dịch (chống gửi trùng khi chạy lại)
emailCampaignRecipientSchema.index({ campaign: 1, email: 1 }, { unique: true });
emailCampaignRecipientSchema.index({ campaign: 1, status: 1 });

const EmailCampaignRecipient =
  mongoose.models.EmailCampaignRecipient ||
  mongoose.model("EmailCampaignRecipient", emailCampaignRecipientSchema);

export default EmailCampaignRecipient;
