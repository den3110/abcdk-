import mongoose from "mongoose";

const azureAccountSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, default: "Tài khoản Azure" },
    isActive: { type: Boolean, default: true },

    capabilities: {
      useForVmWorker: { type: Boolean, default: false },
      useForTts: { type: Boolean, default: false },
    },

    clientId: { type: String, default: "", trim: true },
    clientSecret: { type: String, default: "", trim: true },
    tenantId: { type: String, default: "", trim: true },
    subscriptionId: { type: String, default: "", trim: true },

    resourceGroup: { type: String, default: "", trim: true },
    vmName: { type: String, default: "", trim: true },
    sshUser: { type: String, default: "azureuser", trim: true },
    sshPrivateKey: { type: String, default: "", trim: true },

    ttsRegion: { type: String, default: "", trim: true },
    ttsApiKey: { type: String, default: "", trim: true },
    ttsVoiceName: { type: String, default: "vi-VN-HoaiMyNeural", trim: true },
  },
  { _id: false }
);

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
      systemPushEnabled: { type: Boolean, default: true },
    },

    links: {
      guideUrl: { type: String, default: "", trim: true },
      liveObserverUrl: { type: String, default: "", trim: true },
    },

    appShell: {
      mode: {
        type: String,
        enum: ["native", "webview"],
        default: "native",
      },
      webViewUrl: { type: String, default: "", trim: true },
    },

    // 👇 NEW: OTA force update policy
    ota: {
      enabled: { type: Boolean, default: true },
      forceUpdateEnabled: { type: Boolean, default: false },
      minAppVersion: { type: String, default: "0.0.0", trim: true },
      iosMinBundleVersion: { type: String, default: "0", trim: true },
      androidMinBundleVersion: { type: String, default: "0", trim: true },
      message: { type: String, default: "", trim: true },
      iosStoreUrl: { type: String, default: "", trim: true },
      androidStoreUrl: { type: String, default: "", trim: true },
    },

    recordingDrive: {
      enabled: { type: Boolean, default: true },
      mode: {
        type: String,
        enum: ["serviceAccount", "oauthUser"],
        default: "serviceAccount",
      },
      showAdvancedControls: { type: Boolean, default: false },
      useModernPickerFlow: { type: Boolean, default: true },
      folderId: { type: String, default: "", trim: true },
      sharedDriveId: { type: String, default: "", trim: true },
    },

    liveRecording: {
      autoExportNoSegmentMinutes: {
        type: Number,
        default: 15,
        min: 1,
        max: 1440,
      },
      aiCommentary: {
        enabled: { type: Boolean, default: false },
        autoGenerateAfterDriveUpload: { type: Boolean, default: true },
        defaultLanguage: {
          type: String,
          enum: ["vi", "en"],
          default: "vi",
        },
        defaultVoicePreset: {
          type: String,
          enum: [
            "vi_male_pro",
            "vi_female_pro",
            "en_male_pro",
            "en_female_pro",
          ],
          default: "vi_male_pro",
        },
        scriptBaseUrl: { type: String, default: "", trim: true },
        scriptModel: { type: String, default: "", trim: true },
        ttsBaseUrl: { type: String, default: "", trim: true },
        ttsModel: { type: String, default: "", trim: true },
        defaultTonePreset: {
          type: String,
          enum: ["professional", "energetic", "dramatic"],
          default: "professional",
        },
        keepOriginalAudioBed: { type: Boolean, default: true },
        audioBedLevelDb: { type: Number, default: -18, min: -40, max: 0 },
        duckAmountDb: { type: Number, default: -12, min: -30, max: 0 },
      },
    },

    referee: {
      matchControlLockEnabled: { type: Boolean, default: true },
    },

    privacy: {
      hideUserRatings: { type: Boolean, default: false },
      hideUserRatingsSelf: { type: Boolean, default: false },
    },

    azure: {
      enabled: { type: Boolean, default: false },
      accounts: { type: [azureAccountSchema], default: [] },
    },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    _id: false,
    minimize: false,
    timestamps: false,
  },
);

export default mongoose.model("SystemSettings", SystemSettingsSchema);
