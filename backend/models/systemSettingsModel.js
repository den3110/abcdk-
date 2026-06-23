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

const aiGatewayEndpointSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    label: { type: String, default: "", trim: true },
    baseUrl: { type: String, default: "", trim: true },
    apiKey: { type: String, default: "", trim: true },
    enabled: { type: Boolean, default: true },
    priority: { type: Number, default: 100, min: 1, max: 10000 },
    timeoutMs: { type: Number, default: 45000, min: 1000, max: 300000 },
    defaultModel: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    modelCache: {
      models: { type: [String], default: [] },
      updatedAt: { type: Date },
      error: { type: String, default: "", trim: true },
    },
    health: {
      status: {
        type: String,
        enum: ["unknown", "ok", "error"],
        default: "unknown",
      },
      lastCheckedAt: { type: Date },
      lastOkAt: { type: Date },
      lastError: { type: String, default: "", trim: true },
      latencyMs: { type: Number, default: 0, min: 0 },
      selectedModel: { type: String, default: "", trim: true },
    },
  },
  { _id: false },
);

const aiGatewayScopeSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    endpointIds: { type: [String], default: [] },
    model: { type: String, default: "", trim: true },
    fallbackToEnv: { type: Boolean, default: true },
  },
  { _id: false },
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

    captcha: {
      enabled: { type: Boolean, default: true },
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

    observerLogging: {
      enabled: { type: Boolean, default: true },
      httpAccessEnabled: { type: Boolean, default: true },
      smartMode: {
        type: String,
        enum: ["smart", "primary", "observer", "hybrid"],
        default: "smart",
      },
      primaryLogEnabled: { type: Boolean, default: true },
      minLevel: {
        type: String,
        enum: ["info", "warn", "error"],
        default: "info",
      },
      successSampleRate: { type: Number, default: 1, min: 0, max: 1 },
      batchSize: { type: Number, default: 100, min: 1, max: 1000 },
      flushIntervalMs: { type: Number, default: 5000, min: 500, max: 60000 },
      maxPendingEvents: { type: Number, default: 2000, min: 100, max: 50000 },
      timeoutMs: { type: Number, default: 4000, min: 500, max: 30000 },
      primaryBatchSize: { type: Number, default: 100, min: 1, max: 1000 },
      primaryFlushIntervalMs: { type: Number, default: 5000, min: 500, max: 60000 },
      primaryMaxPendingEvents: { type: Number, default: 5000, min: 100, max: 100000 },
      primaryRetentionDays: { type: Number, default: 14, min: 1, max: 365 },
      primaryQueueBurstThreshold: { type: Number, default: 3000, min: 100, max: 100000 },
      burstReqPerMinuteThreshold: { type: Number, default: 1200, min: 10, max: 100000 },
      burstP95MsThreshold: { type: Number, default: 1500, min: 50, max: 60000 },
      burst5xxPerMinuteThreshold: { type: Number, default: 30, min: 1, max: 10000 },
      burstCooldownMs: { type: Number, default: 300000, min: 10000, max: 3600000 },
      runtimePushEnabled: { type: Boolean, default: true },
      runtimePushIntervalMs: { type: Number, default: 15000, min: 5000, max: 300000 },
      nightlySyncEnabled: { type: Boolean, default: true },
      nightlySyncStartHour: { type: Number, default: 1, min: 0, max: 23 },
      nightlySyncEndHour: { type: Number, default: 5, min: 0, max: 23 },
      nightlySyncIntervalMs: { type: Number, default: 600000, min: 60000, max: 86400000 },
      nightlySyncLimit: { type: Number, default: 500, min: 1, max: 500 },
      nightlySyncLookbackHours: { type: Number, default: 24, min: 1, max: 168 },
      aiAdvisorEnabled: { type: Boolean, default: true },
      aiAdvisorTimeoutMs: { type: Number, default: 8000, min: 1000, max: 60000 },
      aiAdvisorMinIntervalMs: { type: Number, default: 300000, min: 60000, max: 3600000 },
    },

    links: {
      guideUrl: { type: String, default: "", trim: true },
      liveObserverUrl: { type: String, default: "", trim: true },
      docsApiBaseUrl: { type: String, default: "", trim: true },
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
        default: 60,
        min: 60,
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

    frontendUi: {
      version: {
        type: String,
        enum: ["v1", "v2", "v3"],
        default: "v1",
      },
    },

    pikora: {
      enabled: { type: Boolean, default: true },
    },

    azure: {
      enabled: { type: Boolean, default: false },
      accounts: { type: [azureAccountSchema], default: [] },
    },

    aiGateway: {
      enabled: { type: Boolean, default: true },
      strategy: {
        type: String,
        enum: ["failover", "roundRobin"],
        default: "failover",
      },
      timeoutMs: { type: Number, default: 45000, min: 1000, max: 300000 },
      modelsRefreshTtlMs: {
        type: Number,
        default: 900000,
        min: 60000,
        max: 86400000,
      },
      failureCooldownMs: {
        type: Number,
        default: 60000,
        min: 1000,
        max: 600000,
      },
      endpoints: { type: [aiGatewayEndpointSchema], default: [] },
      scopes: {
        cccd: { type: aiGatewayScopeSchema, default: () => ({}) },
        poster: { type: aiGatewayScopeSchema, default: () => ({}) },
        default: { type: aiGatewayScopeSchema, default: () => ({}) },
      },
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
