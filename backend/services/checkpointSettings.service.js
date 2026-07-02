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
  trustDays: 45,
  maxAttempts: 5,
  primaryContactPriority: ["email_otp", "phone_otp"],
  thresholds: {
    level1Score: 40,
    level2Score: 75,
    level3Score: 110,
    minSignalsForLevel1: 3,
    minCategoriesForLevel1: 2,
    minCategoriesForLevel2: 2,
    minCategoriesForLevel3: 3,
  },
  hardSignals: {
    checkpointFailedWeek: 10,
    abuseWeek: 3,
    criticalMonth: 2,
    authFailedDay: 30,
    rateLimitedDay: 16,
  },
  rules: {
    authFailedDay: {
      enabled: true,
      category: "auth",
      threshold: 10,
      points: 18,
      levelHint: 1,
      window: "24h",
      reason: "Nhiều lần đăng nhập sai trong 24 giờ",
    },
    authFailedDayBurst: {
      enabled: true,
      category: "auth",
      threshold: 20,
      points: 22,
      levelHint: 2,
      window: "24h",
      reason: "Burst đăng nhập sai trong ngày",
    },
    authFailedWeek: {
      enabled: true,
      category: "auth",
      threshold: 45,
      points: 20,
      levelHint: 2,
      window: "7d",
      reason: "Đăng nhập sai lặp lại nhiều ngày",
    },
    adminDeniedDay: {
      enabled: true,
      category: "admin_route",
      threshold: 12,
      points: 12,
      levelHint: 1,
      window: "24h",
      reason: "Truy cập route quản trị bị từ chối nhiều lần",
    },
    adminDeniedWeek: {
      enabled: true,
      category: "admin_route",
      threshold: 36,
      points: 18,
      levelHint: 2,
      window: "7d",
      reason: "Thử route quản trị lặp lại nhiều ngày",
    },
    spamHour: {
      enabled: true,
      category: "spam",
      threshold: 80,
      points: 12,
      levelHint: 1,
      window: "1h",
      reason: "Tần suất thao tác ghi bất thường trong 1 giờ",
    },
    spamDay: {
      enabled: true,
      category: "spam",
      threshold: 240,
      points: 18,
      levelHint: 2,
      window: "24h",
      reason: "Tần suất thao tác ghi bất thường trong ngày",
    },
    rateLimitedDay: {
      enabled: true,
      category: "rate_limit",
      threshold: 12,
      points: 20,
      levelHint: 2,
      window: "24h",
      reason: "Bị rate limit nhiều lần",
    },
    checkpointFailedWeek: {
      enabled: true,
      category: "checkpoint",
      threshold: 5,
      points: 25,
      levelHint: 2,
      window: "7d",
      reason: "Nhập sai checkpoint nhiều lần",
    },
    abuseWeek: {
      enabled: true,
      category: "abuse",
      threshold: 3,
      points: 35,
      levelHint: 2,
      window: "7d",
      reason: "Có tín hiệu abuse đã bị chặn",
    },
    clientSuspiciousDay: {
      enabled: true,
      category: "client_signal",
      threshold: 20,
      points: 12,
      levelHint: 1,
      window: "24h",
      reason: "Tín hiệu client bất thường lặp lại",
    },
    criticalMonth: {
      enabled: true,
      category: "critical",
      threshold: 2,
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
      points: -16,
      reason: "Có đăng nhập thành công gần đây",
    },
    checkpointPassedMonth: {
      enabled: true,
      threshold: 1,
      points: -24,
      reason: "Đã vượt checkpoint gần đây",
    },
    verifiedIdentity: {
      enabled: true,
      threshold: 1,
      points: -14,
      reason: "Tài khoản đã xác minh CCCD",
    },
    agedAccount: {
      enabled: true,
      threshold: 30,
      points: -10,
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
  merged.trustDays = clampInt(merged.trustDays, 45, 1, 365);
  merged.maxAttempts = clampInt(merged.maxAttempts, 5, 1, 20);
  merged.primaryContactPriority = (Array.isArray(merged.primaryContactPriority)
    ? merged.primaryContactPriority
    : DEFAULT_CHECKPOINT_SETTINGS.primaryContactPriority
  ).filter((item) => ["email_otp", "phone_otp"].includes(item));
  if (!merged.primaryContactPriority.length) {
    merged.primaryContactPriority = [...DEFAULT_CHECKPOINT_SETTINGS.primaryContactPriority];
  }

  merged.thresholds.level1Score = Math.max(
    clampInt(merged.thresholds.level1Score, 40, 0, 200),
    DEFAULT_CHECKPOINT_SETTINGS.thresholds.level1Score
  );
  merged.thresholds.level2Score = Math.max(
    clampInt(merged.thresholds.level2Score, 75, 0, 200),
    DEFAULT_CHECKPOINT_SETTINGS.thresholds.level2Score
  );
  merged.thresholds.level3Score = Math.max(
    clampInt(merged.thresholds.level3Score, 110, 0, 240),
    DEFAULT_CHECKPOINT_SETTINGS.thresholds.level3Score
  );
  merged.thresholds.minSignalsForLevel1 = Math.max(
    clampInt(merged.thresholds.minSignalsForLevel1, 3, 1, 12),
    DEFAULT_CHECKPOINT_SETTINGS.thresholds.minSignalsForLevel1
  );
  merged.thresholds.minCategoriesForLevel1 = Math.max(
    clampInt(merged.thresholds.minCategoriesForLevel1, 2, 1, 12),
    DEFAULT_CHECKPOINT_SETTINGS.thresholds.minCategoriesForLevel1
  );
  merged.thresholds.minCategoriesForLevel2 = Math.max(
    clampInt(merged.thresholds.minCategoriesForLevel2, 2, 1, 12),
    DEFAULT_CHECKPOINT_SETTINGS.thresholds.minCategoriesForLevel2
  );
  merged.thresholds.minCategoriesForLevel3 = Math.max(
    clampInt(merged.thresholds.minCategoriesForLevel3, 3, 1, 12),
    DEFAULT_CHECKPOINT_SETTINGS.thresholds.minCategoriesForLevel3
  );

  merged.hardSignals = {
    ...DEFAULT_CHECKPOINT_SETTINGS.hardSignals,
    ...(merged.hardSignals || {}),
  };
  Object.keys(DEFAULT_CHECKPOINT_SETTINGS.hardSignals).forEach((key) => {
    merged.hardSignals[key] = Math.max(
      clampInt(
        merged.hardSignals[key],
        DEFAULT_CHECKPOINT_SETTINGS.hardSignals[key],
        0,
        10000
      ),
      DEFAULT_CHECKPOINT_SETTINGS.hardSignals[key]
    );
  });

  Object.keys(DEFAULT_CHECKPOINT_SETTINGS.rules).forEach((key) => {
    const rule = merged.rules[key] || DEFAULT_CHECKPOINT_SETTINGS.rules[key];
    const threshold = clampInt(
      rule.threshold,
      DEFAULT_CHECKPOINT_SETTINGS.rules[key].threshold,
      0,
      10000
    );
    const points = clampInt(rule.points, DEFAULT_CHECKPOINT_SETTINGS.rules[key].points, -200, 240);
    merged.rules[key] = {
      ...DEFAULT_CHECKPOINT_SETTINGS.rules[key],
      ...rule,
      threshold: Math.max(threshold, DEFAULT_CHECKPOINT_SETTINGS.rules[key].threshold),
      points:
        DEFAULT_CHECKPOINT_SETTINGS.rules[key].points >= 0
          ? Math.min(points, DEFAULT_CHECKPOINT_SETTINGS.rules[key].points)
          : points,
      levelHint: clampInt(rule.levelHint, DEFAULT_CHECKPOINT_SETTINGS.rules[key].levelHint, 1, 3),
      reason: String(rule.reason || DEFAULT_CHECKPOINT_SETTINGS.rules[key].reason || ""),
    };
  });

  Object.keys(DEFAULT_CHECKPOINT_SETTINGS.dampeners).forEach((key) => {
    const item = merged.dampeners[key] || DEFAULT_CHECKPOINT_SETTINGS.dampeners[key];
    const threshold = clampInt(
      item.threshold,
      DEFAULT_CHECKPOINT_SETTINGS.dampeners[key].threshold,
      0,
      10000
    );
    const points = clampInt(item.points, DEFAULT_CHECKPOINT_SETTINGS.dampeners[key].points, -200, 0);
    merged.dampeners[key] = {
      ...DEFAULT_CHECKPOINT_SETTINGS.dampeners[key],
      ...item,
      threshold: Math.min(threshold, DEFAULT_CHECKPOINT_SETTINGS.dampeners[key].threshold),
      points: Math.min(points, DEFAULT_CHECKPOINT_SETTINGS.dampeners[key].points),
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
