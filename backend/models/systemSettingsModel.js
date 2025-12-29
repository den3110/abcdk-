// models/systemSettings.model.js
import mongoose from "mongoose";

const SystemSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "system" },

    maintenance: {
      enabled: { type: Boolean, default: false },
      message: { type: String, default: "" },
    },

    registration: {
      open: { type: Boolean, default: true },
      requireOptionalProfileFields: { type: Boolean, default: true },
    },

    kyc: {
      enabled: { type: Boolean, default: true },
      autoApprove: { type: Boolean, default: false },
      faceMatchThreshold: { type: Number, default: 0.78, min: 0, max: 1 },
    },

    security: {
      enforce2FAForAdmins: { type: Boolean, default: false },
      sessionTTLHours: { type: Number, default: 72, min: 1, max: 720 },
    },

    uploads: {
      maxAvatarSizeMB: { type: Number, default: 5, min: 1, max: 50 },
      avatarLogoEnabled: { type: Boolean, default: true },
    },

    notifications: {
      telegramEnabled: { type: Boolean, default: false },
      telegramComplaintChatId: { type: String, default: "" },
    },

    links: {
      guideUrl: { type: String, default: "", trim: true },
    },

    // 👇 NEW: OTA force update policy
    ota: {
      forceUpdateEnabled: { type: Boolean, default: false },
      minAppVersion: { type: String, default: "0.0.0", trim: true },
      iosMinBundleVersion: { type: String, default: "0", trim: true },
      androidMinBundleVersion: { type: String, default: "0", trim: true },
      message: { type: String, default: "", trim: true },
      iosStoreUrl: { type: String, default: "", trim: true },
      androidStoreUrl: { type: String, default: "", trim: true },
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
