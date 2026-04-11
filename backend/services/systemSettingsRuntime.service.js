import SystemSettings from "../models/systemSettingsModel.js";

export const SYSTEM_SETTINGS_CACHE_TTL_MS = 10_000;

export const DEFAULT_SYSTEM_SETTINGS = {
  _id: "system",
  maintenance: { enabled: false, message: "" },
  registration: {
    open: true,
    requireOptionalProfileFields: true,
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
  links: {
    guideUrl: "",
    liveObserverUrl: "",
  },
  appShell: {
    mode: "native",
    webViewUrl: "",
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
    autoExportNoSegmentMinutes: 15,
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
    links: {
      ...DEFAULT_SYSTEM_SETTINGS.links,
      ...(source.links || {}),
    },
    appShell: {
      ...DEFAULT_SYSTEM_SETTINGS.appShell,
      ...(source.appShell || {}),
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
