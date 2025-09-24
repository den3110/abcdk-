// models/systemSettings.model.js
import mongoose from "mongoose";

const SystemSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "system" }, // single-doc pattern

    maintenance: {
      enabled: { type: Boolean, default: false },
      message: { type: String, default: "" },
    },

    registration: {
      open: { type: Boolean, default: true }, // có cho đăng ký tài khoản mới không
    },

    kyc: {
      enabled: { type: Boolean, default: true }, // có dùng KYC trong hệ thống
      autoApprove: { type: Boolean, default: false }, // ⬅️ TỰ ĐỘNG DUYỆT KYC
      faceMatchThreshold: { type: Number, default: 0.78, min: 0, max: 1 },
    },

    security: {
      enforce2FAForAdmins: { type: Boolean, default: false },
      sessionTTLHours: { type: Number, default: 72, min: 1, max: 720 },
    },

    uploads: {
      maxAvatarSizeMB: { type: Number, default: 5, min: 1, max: 50 },
    },

    notifications: {
      telegramEnabled: { type: Boolean, default: false },
      telegramComplaintChatId: { type: String, default: "" }, // token để ở ENV
    },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    _id: false,
    minimize: false,
    timestamps: false,
  }
);

export default mongoose.model("SystemSettings", SystemSettingsSchema);
