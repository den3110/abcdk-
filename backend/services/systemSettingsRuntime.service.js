import SystemSettings from "../models/systemSettingsModel.js";
import { setObserverRuntimeSettings } from "./observerConfig.service.js";

export const SYSTEM_SETTINGS_CACHE_TTL_MS = 10_000;

export const DEFAULT_SYSTEM_SETTINGS = {
  _id: "system",
  maintenance: { enabled: false, message: "" },
  registration: {
    open: true,
    requireOptionalProfileFields: true,
  },
  captcha: {
    enabled: true,
  },
  checkpoint: {
    enabled: true,
  },
  kyc: { enabled: true, autoApprove: false, faceMatchThreshold: 0.78 },
  security: { enforce2FAForAdmins: false, sessionTTLHours: 72 },
  uploads: {
    maxAvatarSizeMB: 5,
    avatarLogoEnabled: true,
  },
  notifications: {
    telegramEnabled: false,
    telegramComplaintChatId: "",
    systemPushEnabled: true,
  },
  observerLogging: {
    enabled: true,
    httpAccessEnabled: true,
    smartMode: "smart",
    primaryLogEnabled: true,
    minLevel: "info",
    successSampleRate: 1,
    batchSize: 100,
    flushIntervalMs: 5000,
    maxPendingEvents: 2000,
    timeoutMs: 4000,
    primaryBatchSize: 100,
    primaryFlushIntervalMs: 5000,
    primaryMaxPendingEvents: 5000,
    primaryRetentionDays: 14,
    primaryQueueBurstThreshold: 3000,
    burstReqPerMinuteThreshold: 1200,
    burstP95MsThreshold: 1500,
    burst5xxPerMinuteThreshold: 30,
    burstCooldownMs: 300000,
    runtimePushEnabled: true,
    runtimePushIntervalMs: 15000,
    nightlySyncEnabled: true,
    nightlySyncStartHour: 1,
    nightlySyncEndHour: 5,
    nightlySyncIntervalMs: 600000,
    nightlySyncLimit: 500,
    nightlySyncLookbackHours: 24,
    aiAdvisorEnabled: true,
    aiAdvisorTimeoutMs: 8000,
    aiAdvisorMinIntervalMs: 300000,
  },
  links: {
    guideUrl: "",
    liveObserverUrl: "",
    docsApiBaseUrl: "",
  },
  appShell: {
    mode: "native",
    webViewUrl: "",
  },
  frontendUi: {
    version: "v1",
  },
  pikora: {
    enabled: true,
  },
  ota: {
    enabled: true,
    forceUpdateEnabled: false,
    minAppVersion: "0.0.0",
    iosMinBundleVersion: "0",
    androidMinBundleVersion: "0",
    message: "Vui lòng cập nhật phiên bản mới để tiếp tục sử dụng.",
    iosStoreUrl: "",
    androidStoreUrl: "",
  },
  recordingDrive: {
    enabled: true,
    mode: "serviceAccount",
    showAdvancedControls: false,
    useModernPickerFlow: true,
    folderId: "",
    sharedDriveId: "",
  },
  liveRecording: {
    autoExportNoSegmentMinutes: 60,
    aiCommentary: {
      enabled: false,
      autoGenerateAfterDriveUpload: true,
      defaultLanguage: "vi",
      defaultVoicePreset: "vi_male_pro",
      scriptBaseUrl: "",
      scriptModel: "",
      ttsBaseUrl: "",
      ttsModel: "",
      defaultTonePreset: "professional",
      keepOriginalAudioBed: true,
      audioBedLevelDb: -18,
      duckAmountDb: -12,
    },
  },
  referee: {
    matchControlLockEnabled: true,
  },
  privacy: {
    hideUserRatings: false,
    hideUserRatingsSelf: false,
  },
  azure: {
    enabled: false,
    accounts: [],
  },
  aiGateway: {
    enabled: true,
    strategy: "failover",
    timeoutMs: 45000,
    modelsRefreshTtlMs: 900000,
    failureCooldownMs: 60000,
    endpoints: [],
    scopes: {
      cccd: {
        enabled: true,
        endpointIds: [],
        model: "",
        fallbackToEnv: true,
      },
      poster: {
        enabled: true,
        endpointIds: [],
        model: "",
        fallbackToEnv: true,
      },
      default: {
        enabled: true,
        endpointIds: [],
        model: "",
        fallbackToEnv: true,
      },
    },
  },
};

let runtimeCache = { doc: null, ts: 0 };

export function normalizeSystemSettings(doc = {}) {
  const source =
    doc && typeof doc.toObject === "function" ? doc.toObject() : { ...doc };

  return {
    ...DEFAULT_SYSTEM_SETTINGS,
    ...source,
    maintenance: {
      ...DEFAULT_SYSTEM_SETTINGS.maintenance,
      ...(source.maintenance || {}),
    },
    registration: {
      ...DEFAULT_SYSTEM_SETTINGS.registration,
      ...(source.registration || {}),
    },
    captcha: {
      ...DEFAULT_SYSTEM_SETTINGS.captcha,
      ...(source.captcha || {}),
    },
    checkpoint: {
      ...DEFAULT_SYSTEM_SETTINGS.checkpoint,
      ...(source.checkpoint || {}),
    },
    kyc: {
      ...DEFAULT_SYSTEM_SETTINGS.kyc,
      ...(source.kyc || {}),
    },
    security: {
      ...DEFAULT_SYSTEM_SETTINGS.security,
      ...(source.security || {}),
    },
    uploads: {
      ...DEFAULT_SYSTEM_SETTINGS.uploads,
      ...(source.uploads || {}),
    },
    notifications: {
      ...DEFAULT_SYSTEM_SETTINGS.notifications,
      ...(source.notifications || {}),
    },
    observerLogging: {
      ...DEFAULT_SYSTEM_SETTINGS.observerLogging,
      ...(source.observerLogging || {}),
    },
    links: {
      ...DEFAULT_SYSTEM_SETTINGS.links,
      ...(source.links || {}),
    },
    appShell: {
      ...DEFAULT_SYSTEM_SETTINGS.appShell,
      ...(source.appShell || {}),
    },
    frontendUi: {
      ...DEFAULT_SYSTEM_SETTINGS.frontendUi,
      ...(source.frontendUi || {}),
    },
    pikora: {
      ...DEFAULT_SYSTEM_SETTINGS.pikora,
      ...(source.pikora || {}),
    },
    ota: {
      ...DEFAULT_SYSTEM_SETTINGS.ota,
      ...(source.ota || {}),
    },
    recordingDrive: {
      ...DEFAULT_SYSTEM_SETTINGS.recordingDrive,
      ...(source.recordingDrive || {}),
    },
    liveRecording: {
      ...DEFAULT_SYSTEM_SETTINGS.liveRecording,
      ...(source.liveRecording || {}),
      aiCommentary: {
        ...DEFAULT_SYSTEM_SETTINGS.liveRecording.aiCommentary,
        ...(source.liveRecording?.aiCommentary || {}),
      },
    },
    referee: {
      ...DEFAULT_SYSTEM_SETTINGS.referee,
      ...(source.referee || {}),
    },
    privacy: {
      ...DEFAULT_SYSTEM_SETTINGS.privacy,
      ...(source.privacy || {}),
    },
    azure: {
      ...DEFAULT_SYSTEM_SETTINGS.azure,
      ...(source.azure || {}),
      accounts: Array.isArray(source.azure?.accounts) 
        ? source.azure.accounts 
        : DEFAULT_SYSTEM_SETTINGS.azure.accounts,
    },
    aiGateway: {
      ...DEFAULT_SYSTEM_SETTINGS.aiGateway,
      ...(source.aiGateway || {}),
      endpoints: Array.isArray(source.aiGateway?.endpoints)
        ? source.aiGateway.endpoints
        : DEFAULT_SYSTEM_SETTINGS.aiGateway.endpoints,
      scopes: {
        cccd: {
          ...DEFAULT_SYSTEM_SETTINGS.aiGateway.scopes.cccd,
          ...(source.aiGateway?.scopes?.cccd || {}),
        },
        poster: {
          ...DEFAULT_SYSTEM_SETTINGS.aiGateway.scopes.poster,
          ...(source.aiGateway?.scopes?.poster || {}),
        },
        default: {
          ...DEFAULT_SYSTEM_SETTINGS.aiGateway.scopes.default,
          ...(source.aiGateway?.scopes?.default || {}),
        },
      },
    },
  };
}

export async function ensureSystemSettingsDocument() {
  return await SystemSettings.findByIdAndUpdate(
    "system",
    {
      $setOnInsert: DEFAULT_SYSTEM_SETTINGS,
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );
}

export async function getSystemSettingsRuntime(options = {}) {
  const { forceRefresh = false, ensureDocument = false } = options;
  const now = Date.now();

  if (
    !forceRefresh &&
    runtimeCache.doc &&
    now - runtimeCache.ts <= SYSTEM_SETTINGS_CACHE_TTL_MS
  ) {
    return runtimeCache.doc;
  }

  const doc = ensureDocument
    ? await ensureSystemSettingsDocument()
    : await SystemSettings.findById("system").lean();

  const normalized = normalizeSystemSettings(doc || DEFAULT_SYSTEM_SETTINGS);
  setObserverRuntimeSettings(normalized.observerLogging);
  runtimeCache = { doc: normalized, ts: now };
  return normalized;
}

export function invalidateSystemSettingsRuntimeCache() {
  runtimeCache = { doc: null, ts: 0 };
}

export async function getRefereeMatchControlLockRuntime(options = {}) {
  const settings = await getSystemSettingsRuntime(options);
  return {
    enabled: settings?.referee?.matchControlLockEnabled !== false,
    updatedAt: settings?.updatedAt
      ? new Date(settings.updatedAt).toISOString()
      : null,
  };
}

export async function getRefereeMatchControlLockEnabled(options = {}) {
  const runtime = await getRefereeMatchControlLockRuntime(options);
  return runtime.enabled;
}

export async function getCheckpointSystemEnabled(options = {}) {
  const settings = await getSystemSettingsRuntime(options);
  return settings?.checkpoint?.enabled !== false;
}
