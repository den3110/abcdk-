import CheckpointSettings from "../models/checkpointSettingsModel.js";

export const CHECKPOINT_SETTINGS_ID = "checkpoint-engine";

export const DEFAULT_CHECKPOINT_SETTINGS = Object.freeze({
  _id: CHECKPOINT_SETTINGS_ID,
  enabled: true,
  roleBypassEnabled: true,
  manualReviewLevel: 3,
  sessionTtlMinutes: 30,
  codeTtlMinutes: 5,
  resendCooldownSeconds: 60,
  trustDays: 15,
  maxAttempts: 5,
  primaryContactPriority: ["email_otp", "phone_otp"],
  thresholds: {
    level1Score: 25,
    level2Score: 55,
    level3Score: 85,
    minSignalsForLevel1: 2,
    minCategoriesForLevel2: 2,
    minCategoriesForLevel3: 3,
  },
  hardSignals: {
    checkpointFailedWeek: 8,
    abuseWeek: 2,
    criticalMonth: 1,
    authFailedDay: 20,
    rateLimitedDay: 8,
  },
  rules: {
    authFailedDay: {
      enabled: true,
      category: "auth",
      threshold: 5,
      points: 25,
      levelHint: 1,
      window: "24h",
      reason: "Nhiều lần đăng nhập sai trong 24 giờ",
    },
    authFailedDayBurst: {
      enabled: true,
      category: "auth",
      threshold: 12,
      points: 25,
      levelHint: 2,
      window: "24h",
      reason: "Burst đăng nhập sai trong ngày",
    },
    authFailedWeek: {
      enabled: true,
      category: "auth",
      threshold: 25,
      points: 25,
      levelHint: 2,
      window: "7d",
      reason: "Đăng nhập sai lặp lại nhiều ngày",
    },
    adminDeniedDay: {
      enabled: true,
      category: "admin_route",
      threshold: 6,
      points: 20,
      levelHint: 1,
      window: "24h",
      reason: "Truy cập route quản trị bị từ chối nhiều lần",
    },
    adminDeniedWeek: {
      enabled: true,
      category: "admin_route",
      threshold: 18,
      points: 25,
      levelHint: 2,
      window: "7d",
      reason: "Thử route quản trị lặp lại nhiều ngày",
    },
    spamHour: {
      enabled: true,
      category: "spam",
      threshold: 25,
      points: 20,
      levelHint: 1,
      window: "1h",
      reason: "Tần suất thao tác ghi bất thường trong 1 giờ",
    },
    spamDay: {
      enabled: true,
      category: "spam",
      threshold: 80,
      points: 25,
      levelHint: 2,
      window: "24h",
      reason: "Tần suất thao tác ghi bất thường trong ngày",
    },
    rateLimitedDay: {
      enabled: true,
      category: "rate_limit",
      threshold: 4,
      points: 25,
      levelHint: 2,
      window: "24h",
      reason: "Bị rate limit nhiều lần",
    },
    checkpointFailedWeek: {
      enabled: true,
      category: "checkpoint",
      threshold: 3,
      points: 30,
      levelHint: 2,
      window: "7d",
      reason: "Nhập sai checkpoint nhiều lần",
    },
    abuseWeek: {
      enabled: true,
      category: "abuse",
      threshold: 2,
      points: 35,
      levelHint: 2,
      window: "7d",
      reason: "Có tín hiệu abuse đã bị chặn",
    },
    clientSuspiciousDay: {
      enabled: true,
      category: "client_signal",
      threshold: 10,
      points: 20,
      levelHint: 1,
      window: "24h",
      reason: "Tín hiệu client bất thường lặp lại",
    },
    criticalMonth: {
      enabled: true,
      category: "critical",
      threshold: 1,
      points: 35,
      levelHint: 3,
      window: "30d",
      reason: "Có tín hiệu rủi ro cao gần đây",
    },
  },
  dampeners: {
    authSuccessWeek: {
      enabled: true,
      threshold: 3,
      points: -10,
      reason: "Có đăng nhập thành công gần đây",
    },
    checkpointPassedMonth: {
      enabled: true,
      threshold: 1,
      points: -12,
      reason: "Đã vượt checkpoint gần đây",
    },
    verifiedIdentity: {
      enabled: true,
      threshold: 1,
      points: -8,
      reason: "Tài khoản đã xác minh CCCD",
    },
    agedAccount: {
      enabled: true,
      threshold: 30,
      points: -6,
      reason: "Tài khoản đã hoạt động trên 30 ngày",
    },
  },
  allowlist: {
    enabled: true,
    users: [],
    emails: [],
    phones: [],
    deviceIds: [],
    ips: [],
  },
  review: {
    requireNoteOnReject: true,
    extendPendingMinutesOnApprove: 10,
  },
});

const isPlainObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

const deepMerge = (base, override) => {
  const out = Array.isArray(base) ? [...base] : { ...base };
  Object.entries(override || {}).forEach(([key, value]) => {
    if (value === undefined) return;
    if (isPlainObject(base?.[key]) && isPlainObject(value)) {
      out[key] = deepMerge(base[key], value);
      return;
    }
    out[key] = value;
  });
  return out;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const clampInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
};

const normalizeAllowlistEntry = (entry = {}) => ({
  _id: entry._id,
  value: String(entry.value || "").trim(),
  reason: String(entry.reason || "").trim(),
  expiresAt: entry.expiresAt || null,
  createdBy: entry.createdBy || null,
  createdAt: entry.createdAt || new Date(),
});

const normalizeAllowlistGroup = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map(normalizeAllowlistEntry)
    .filter((entry) => entry.value);

export function normalizeCheckpointSettings(input = {}) {
  const source = input?.toObject ? input.toObject() : input || {};
  const merged = deepMerge(DEFAULT_CHECKPOINT_SETTINGS, source);

  merged.enabled = merged.enabled !== false;
  merged.roleBypassEnabled = merged.roleBypassEnabled !== false;
  merged.manualReviewLevel = clampInt(merged.manualReviewLevel, 3, 1, 4);
  merged.sessionTtlMinutes = clampInt(merged.sessionTtlMinutes, 30, 5, 240);
  merged.codeTtlMinutes = clampInt(merged.codeTtlMinutes, 5, 1, 60);
  merged.resendCooldownSeconds = clampInt(merged.resendCooldownSeconds, 60, 10, 600);
  merged.trustDays = clampInt(merged.trustDays, 15, 1, 365);
  merged.maxAttempts = clampInt(merged.maxAttempts, 5, 1, 20);
  merged.primaryContactPriority = (Array.isArray(merged.primaryContactPriority)
    ? merged.primaryContactPriority
    : DEFAULT_CHECKPOINT_SETTINGS.primaryContactPriority
  ).filter((item) => ["email_otp", "phone_otp"].includes(item));
  if (!merged.primaryContactPriority.length) {
    merged.primaryContactPriority = [...DEFAULT_CHECKPOINT_SETTINGS.primaryContactPriority];
  }

  merged.thresholds.level1Score = clampInt(merged.thresholds.level1Score, 25, 0, 200);
  merged.thresholds.level2Score = clampInt(merged.thresholds.level2Score, 55, 0, 200);
  merged.thresholds.level3Score = clampInt(merged.thresholds.level3Score, 85, 0, 240);
  merged.thresholds.minSignalsForLevel1 = clampInt(merged.thresholds.minSignalsForLevel1, 2, 1, 12);
  merged.thresholds.minCategoriesForLevel2 = clampInt(merged.thresholds.minCategoriesForLevel2, 2, 1, 12);
  merged.thresholds.minCategoriesForLevel3 = clampInt(merged.thresholds.minCategoriesForLevel3, 3, 1, 12);

  Object.keys(DEFAULT_CHECKPOINT_SETTINGS.rules).forEach((key) => {
    const rule = merged.rules[key] || DEFAULT_CHECKPOINT_SETTINGS.rules[key];
    merged.rules[key] = {
      ...DEFAULT_CHECKPOINT_SETTINGS.rules[key],
      ...rule,
      threshold: clampInt(rule.threshold, DEFAULT_CHECKPOINT_SETTINGS.rules[key].threshold, 0, 10000),
      points: clampInt(rule.points, DEFAULT_CHECKPOINT_SETTINGS.rules[key].points, -200, 240),
      levelHint: clampInt(rule.levelHint, DEFAULT_CHECKPOINT_SETTINGS.rules[key].levelHint, 1, 3),
      reason: String(rule.reason || DEFAULT_CHECKPOINT_SETTINGS.rules[key].reason || ""),
    };
  });

  Object.keys(DEFAULT_CHECKPOINT_SETTINGS.dampeners).forEach((key) => {
    const item = merged.dampeners[key] || DEFAULT_CHECKPOINT_SETTINGS.dampeners[key];
    merged.dampeners[key] = {
      ...DEFAULT_CHECKPOINT_SETTINGS.dampeners[key],
      ...item,
      threshold: clampInt(
        item.threshold,
        DEFAULT_CHECKPOINT_SETTINGS.dampeners[key].threshold,
        0,
        10000
      ),
      points: clampInt(item.points, DEFAULT_CHECKPOINT_SETTINGS.dampeners[key].points, -200, 0),
      reason: String(item.reason || DEFAULT_CHECKPOINT_SETTINGS.dampeners[key].reason || ""),
    };
  });

  merged.allowlist = {
    ...DEFAULT_CHECKPOINT_SETTINGS.allowlist,
    ...(merged.allowlist || {}),
    users: normalizeAllowlistGroup(merged.allowlist?.users),
    emails: normalizeAllowlistGroup(merged.allowlist?.emails),
    phones: normalizeAllowlistGroup(merged.allowlist?.phones),
    deviceIds: normalizeAllowlistGroup(merged.allowlist?.deviceIds),
    ips: normalizeAllowlistGroup(merged.allowlist?.ips),
  };

  return merged;
}

export async function getCheckpointSettings() {
  const doc = await CheckpointSettings.findById(CHECKPOINT_SETTINGS_ID).lean();
  return normalizeCheckpointSettings(doc || DEFAULT_CHECKPOINT_SETTINGS);
}

export async function updateCheckpointSettings(input = {}, actorId = null) {
  const current = await getCheckpointSettings();
  const next = normalizeCheckpointSettings(deepMerge(current, input || {}));
  delete next.createdAt;
  delete next.updatedAt;
  delete next.__v;
  next._id = CHECKPOINT_SETTINGS_ID;
  next.updatedBy = actorId || null;

  const updatePayload = { ...next };
  delete updatePayload._id;
  const saved = await CheckpointSettings.findByIdAndUpdate(
    CHECKPOINT_SETTINGS_ID,
    { $set: updatePayload },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();

  return normalizeCheckpointSettings(saved || next);
}

export function getDefaultCheckpointSettings() {
  return normalizeCheckpointSettings(DEFAULT_CHECKPOINT_SETTINGS);
}

const activeEntries = (items = []) =>
  (Array.isArray(items) ? items : []).filter((entry) => {
    if (!entry?.value) return false;
    if (!entry.expiresAt) return true;
    const expiresAt = new Date(entry.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  });

const includesValue = (items, value) => {
  const clean = String(value || "").trim().toLowerCase();
  if (!clean) return null;
  return activeEntries(items).find(
    (entry) => String(entry.value || "").trim().toLowerCase() === clean
  );
};

export function findCheckpointAllowlistMatch({ settings, user, context = {} }) {
  if (settings?.allowlist?.enabled === false) return null;
  const allowlist = settings?.allowlist || {};
  return (
    includesValue(allowlist.users, user?._id || user?.id) ||
    includesValue(allowlist.emails, user?.email) ||
    includesValue(allowlist.phones, user?.phone) ||
    includesValue(allowlist.deviceIds, context?.deviceId) ||
    includesValue(allowlist.ips, context?.ip) ||
    null
  );
}
