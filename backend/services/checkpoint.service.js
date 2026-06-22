import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import CheckpointEvent from "../models/checkpointEventModel.js";
import CheckpointSession from "../models/checkpointSessionModel.js";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";
import {
  findCheckpointAllowlistMatch,
  getCheckpointSettings,
} from "./checkpointSettings.service.js";
import {
  consumeCheckpointMandate,
  getActiveCheckpointMandateForUser,
} from "./checkpointMandate.service.js";
import { sendCheckpointOtpEmail } from "./emailService.js";
import { sendTingTingOtp } from "./tingtingZns.service.js";

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CODE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RESEND_COOLDOWN_MS = 60 * 1000;
const DEFAULT_TRUST_MS = 15 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_MANUAL_REVIEW_LEVEL = 3;

const boolEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "off", "no"].includes(String(raw).toLowerCase());
};

const intEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

const checkpointEnabled = () => boolEnv("CHECKPOINT_ENGINE_ENABLED", true);
const roleBypassEnabled = () => boolEnv("CHECKPOINT_ROLE_BYPASS", true);
const sessionTtlMs = (settings = null) =>
  settings?.sessionTtlMinutes
    ? Number(settings.sessionTtlMinutes) * 60 * 1000
    : intEnv("CHECKPOINT_SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS);
const codeTtlMs = (settings = null) =>
  settings?.codeTtlMinutes
    ? Number(settings.codeTtlMinutes) * 60 * 1000
    : intEnv("CHECKPOINT_CODE_TTL_MS", DEFAULT_CODE_TTL_MS);
const resendCooldownMs = (settings = null) =>
  settings?.resendCooldownSeconds
    ? Number(settings.resendCooldownSeconds) * 1000
    : intEnv("CHECKPOINT_RESEND_COOLDOWN_MS", DEFAULT_RESEND_COOLDOWN_MS);
const trustMs = (settings = null) =>
  settings?.trustDays
    ? Number(settings.trustDays) * 24 * 60 * 60 * 1000
    : intEnv("CHECKPOINT_TRUST_MS", DEFAULT_TRUST_MS);
const maxAttempts = (settings = null) =>
  settings?.maxAttempts || intEnv("CHECKPOINT_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS);
const manualReviewLevel = (settings = null) =>
  settings?.manualReviewLevel ||
  intEnv("CHECKPOINT_MANUAL_REVIEW_LEVEL", DEFAULT_MANUAL_REVIEW_LEVEL);

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token || "")).digest("hex");

const makeCheckpointToken = () => crypto.randomBytes(32).toString("base64url");

const makeOtp = (length = 6) => {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(Math.random() * 10);
  }
  return out;
};

const maskPhone = (phone = "") => {
  const s = String(phone || "").trim();
  if (s.length <= 4) return s;
  return `${s.slice(0, 2)}****${s.slice(-2)}`;
};

const normalizePhoneVN = (raw = "") => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("84")) return `0${digits.slice(2)}`;
  return digits;
};

const isValidPhoneVN = (raw = "") =>
  /^0(3|5|7|8|9)\d{8}$/.test(normalizePhoneVN(raw));

const safeStringify = (value) => {
  try {
    if (value == null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const getClientContext = (req) => {
  const xff = String(req?.headers?.["x-forwarded-for"] || "");
  return {
    ip:
      xff.split(",")[0]?.trim() ||
      req?.ip ||
      req?.socket?.remoteAddress ||
      "",
    userAgent: String(req?.headers?.["user-agent"] || ""),
    deviceId: String(req?.headers?.["x-device-id"] || "").trim(),
    deviceName: String(req?.headers?.["x-device-name"] || "").trim(),
  };
};

const isPrivilegedUser = (user) =>
  Boolean(
    user?.isSuperUser ||
      user?.isSuperAdmin ||
      user?.role === "admin" ||
      user?.role === "referee"
  );

const maskEmail = (email = "") => {
  const s = String(email || "").trim();
  const [name, domain] = s.split("@");
  if (!name || !domain) return s;
  if (name.length <= 2) return `${name[0] || ""}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
};

const buildOtpFactor = (user, factorKey) => {
  if (factorKey === "email_otp" && user?.email) {
    return {
      key: "email_otp",
      method: "email_otp",
      targetMasked: maskEmail(user.email),
      target: user.email,
    };
  }
  if (factorKey === "phone_otp" && isValidPhoneVN(user?.phone || "")) {
    return {
      key: "phone_otp",
      method: "zalo_otp",
      targetMasked: maskPhone(user.phone),
      target: user.phone,
    };
  }
  return null;
};

const getPrimaryOtpFactor = (user, settings = null) => {
  const priority = Array.isArray(settings?.primaryContactPriority)
    ? settings.primaryContactPriority
    : ["email_otp", "phone_otp"];
  for (const key of priority) {
    const factor = buildOtpFactor(user, key);
    if (factor) return factor;
  }
  return buildOtpFactor(user, "email_otp") || buildOtpFactor(user, "phone_otp");
};

const getRequiredFactorsForLevel = (level, primaryFactorKey = "phone_otp") => {
  if (level >= 3) return [primaryFactorKey, "cccd_upload", "face_video"];
  if (level >= 2) return [primaryFactorKey, "cccd_upload"];
  return [primaryFactorKey];
};

export async function getCheckpointPolicySummary() {
  const settings = await getCheckpointSettings();
  return {
    enabled: settings.enabled !== false && checkpointEnabled(),
    roleBypassEnabled: settings.roleBypassEnabled !== false && roleBypassEnabled(),
    primaryContactPriority: settings.primaryContactPriority || ["email_otp", "phone_otp"],
    levels: [
      {
        level: 1,
        factors: ["email_otp_or_phone_otp"],
      },
      {
        level: 2,
        factors: ["email_otp_or_phone_otp", "cccd_upload"],
      },
      {
        level: 3,
        factors: ["email_otp_or_phone_otp", "cccd_upload", "face_video"],
        reviewRequired: manualReviewLevel(settings) <= 3,
      },
    ],
    observedCategories: [
      "auth",
      "admin_route",
      "spam",
      "rate_limit",
      "checkpoint",
      "abuse",
      "client_signal",
    ],
    scoringShape: {
      windows: ["1h", "24h", "7d", "30d"],
      usesDampeners: true,
      requiresMultipleSignalsForLowRiskActions: true,
      trustedDeviceWindowMs: trustMs(settings),
    },
    thresholds: settings.thresholds,
    hardSignals: settings.hardSignals,
    rules: settings.rules,
    dampeners: settings.dampeners,
    allowlist: {
      enabled: settings.allowlist?.enabled !== false,
      counts: {
        users: settings.allowlist?.users?.length || 0,
        emails: settings.allowlist?.emails?.length || 0,
        phones: settings.allowlist?.phones?.length || 0,
        deviceIds: settings.allowlist?.deviceIds?.length || 0,
        ips: settings.allowlist?.ips?.length || 0,
      },
    },
  };
}

const buildFactorState = (level, primaryFactorKey) =>
  getRequiredFactorsForLevel(level, primaryFactorKey).map((key) => ({
    key,
    status: "required",
  }));

const buildRoles = (user) => {
  const isSuperUser = Boolean(user?.isSuperUser || user?.isSuperAdmin);
  return Array.from(
    new Set(
      [
        ...(Array.isArray(user?.roles) ? user.roles : []),
        ...(user?.role ? [user.role] : []),
        ...(isSuperUser ? ["superadmin", "superuser"] : []),
      ]
        .map((role) => String(role || "").toLowerCase())
        .filter(Boolean)
    )
  );
};

export function buildCheckpointAuthPayload(user) {
  const isSuperUser = Boolean(user?.isSuperUser || user?.isSuperAdmin);
  const tokenExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const token = jwt.sign(
    {
      userId: user._id,
      name: user.name,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
      avatar: user.avatar,
      province: user.province,
      dob: user.dob,
      verified: user.verified,
      cccdStatus: user.cccdStatus,
      ratingSingle: user.ratingSingle,
      ratingDouble: user.ratingDouble,
      createdAt: user.createdAt,
      cccd: user.cccd,
      role: user.role,
      isAdmin: user.role === "admin",
      isSuperUser,
      isSuperAdmin: isSuperUser,
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  return {
    _id: user._id,
    name: user.name,
    nickname: user.nickname,
    phone: user.phone,
    email: user.email,
    avatar: user.avatar,
    province: user.province,
    dob: user.dob,
    verified: user.verified,
    cccdStatus: user.cccdStatus,
    ratingSingle: user.ratingSingle,
    ratingDouble: user.ratingDouble,
    createdAt: user.createdAt,
    cccd: user.cccd,
    role: user.role,
    isAdmin: user.role === "admin",
    roles: buildRoles(user),
    isSuperUser,
    isSuperAdmin: isSuperUser,
    token,
    tokenExpiresAt,
  };
}

export async function recordCheckpointEvent({
  req,
  user = null,
  subjectUser = null,
  type,
  category = "system",
  outcome = "observed",
  severity = "low",
  weight = 1,
  routeGroup = "",
  target = {},
  metadata = {},
} = {}) {
  if (!type) return null;

  const ctx = getClientContext(req);
  const event = {
    user: user?._id || user?.id || undefined,
    subjectUser: subjectUser?._id || subjectUser?.id || undefined,
    type,
    category,
    outcome,
    severity,
    weight,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    deviceId: ctx.deviceId,
    deviceName: ctx.deviceName,
    method: req?.method || "",
    path: req?.originalUrl || req?.url || "",
    routeGroup,
    target: {
      type: String(target?.type || ""),
      id: String(target?.id || ""),
    },
    metadata,
  };

  try {
    return await CheckpointEvent.create(event);
  } catch (error) {
    console.error("[checkpoint] event write failed:", error?.message || error);
    return null;
  }
}

const countEvents = (query) => CheckpointEvent.countDocuments(query);

async function countRiskSignals({ user, req }) {
  const ctx = getClientContext(req);
  const now = Date.now();
  const scope = [];

  if (user?._id || user?.id) {
    const uid = user._id || user.id;
    scope.push({ user: uid }, { subjectUser: uid });
  }
  if (ctx.deviceId) scope.push({ deviceId: ctx.deviceId });
  if (!user && ctx.ip) scope.push({ ip: ctx.ip });

  if (!scope.length) return null;

  const scoped = { $or: scope };
  const since = (ms) => new Date(now - ms);
  const hour = since(60 * 60 * 1000);
  const day = since(24 * 60 * 60 * 1000);
  const week = since(7 * 24 * 60 * 60 * 1000);
  const month = since(30 * 24 * 60 * 60 * 1000);

  const [
    authFailedDay,
    authFailedWeek,
    authSuccessWeek,
    adminDeniedDay,
    adminDeniedWeek,
    spamHour,
    spamDay,
    rateLimitedDay,
    checkpointFailedWeek,
    checkpointPassedMonth,
    abuseWeek,
    clientSuspiciousDay,
    criticalMonth,
  ] = await Promise.all([
    countEvents({
      ...scoped,
      category: "auth",
      outcome: "failed",
      createdAt: { $gte: day },
    }),
    countEvents({
      ...scoped,
      category: "auth",
      outcome: "failed",
      createdAt: { $gte: week },
    }),
    countEvents({
      ...scoped,
      category: "auth",
      outcome: "success",
      createdAt: { $gte: week },
    }),
    countEvents({
      ...scoped,
      category: "admin_route",
      outcome: { $in: ["denied", "blocked", "failed"] },
      createdAt: { $gte: day },
    }),
    countEvents({
      ...scoped,
      category: "admin_route",
      outcome: { $in: ["denied", "blocked", "failed"] },
      createdAt: { $gte: week },
    }),
    countEvents({
      ...scoped,
      category: "spam",
      createdAt: { $gte: hour },
    }),
    countEvents({
      ...scoped,
      category: "spam",
      createdAt: { $gte: day },
    }),
    countEvents({
      ...scoped,
      outcome: "rate_limited",
      createdAt: { $gte: day },
    }),
    countEvents({
      ...scoped,
      category: "checkpoint",
      outcome: "failed",
      createdAt: { $gte: week },
    }),
    countEvents({
      ...scoped,
      category: "checkpoint",
      outcome: "success",
      createdAt: { $gte: month },
    }),
    countEvents({
      ...scoped,
      category: "abuse",
      outcome: { $in: ["blocked", "suspicious", "failed"] },
      createdAt: { $gte: week },
    }),
    countEvents({
      ...scoped,
      category: "client_signal",
      outcome: "suspicious",
      createdAt: { $gte: day },
    }),
    countEvents({
      ...scoped,
      severity: { $in: ["critical", "high"] },
      createdAt: { $gte: month },
    }),
  ]);

  return {
    authFailedDay,
    authFailedWeek,
    authSuccessWeek,
    adminDeniedDay,
    adminDeniedWeek,
    spamHour,
    spamDay,
    rateLimitedDay,
    checkpointFailedWeek,
    checkpointPassedMonth,
    abuseWeek,
    clientSuspiciousDay,
    criticalMonth,
  };
}

function accountAgeDays(user) {
  const createdAt = user?.createdAt ? new Date(user.createdAt).getTime() : 0;
  if (!createdAt) return 0;
  return Math.max(0, Math.floor((Date.now() - createdAt) / 86400000));
}

function buildRiskDecision({ counters, user, intent, settings = null }) {
  let rawScore = 0;
  const signals = [];
  const dampeners = [];
  const categories = new Set();
  const rules = settings?.rules || {};
  const settingsDampeners = settings?.dampeners || {};
  const thresholds = settings?.thresholds || {};
  const hardSignals = settings?.hardSignals || {};

  const addSignal = (condition, signal) => {
    if (!condition) return;
    const points = Number(signal.points || 0);
    rawScore += points;
    categories.add(signal.category || "system");
    signals.push({
      key: signal.key,
      category: signal.category || "system",
      points,
      levelHint: Number(signal.levelHint || 1),
      count: signal.count,
      window: signal.window || "",
      reason: signal.reason,
    });
  };

  const addDampener = (condition, dampener) => {
    if (!condition) return;
    dampeners.push({
      key: dampener.key,
      points: Number(dampener.points || 0),
      reason: dampener.reason,
    });
  };

  const addRuleSignal = (ruleKey, counterKey, { key, levelHint } = {}) => {
    const rule = rules[ruleKey] || {};
    if (rule.enabled === false) return;
    const count = Number(counters[counterKey] || 0);
    const threshold = Number(rule.threshold || 0);
    addSignal(count >= threshold, {
      key: key || ruleKey,
      category: rule.category || "system",
      points: Number(rule.points || 0),
      levelHint: Number(levelHint || rule.levelHint || 1),
      count,
      window: rule.window || "",
      reason: rule.reason || ruleKey,
    });
  };

  const addConfiguredDampener = (dampenerKey, condition, key) => {
    const dampener = settingsDampeners[dampenerKey] || {};
    if (dampener.enabled === false) return;
    addDampener(condition, {
      key,
      points: Number(dampener.points || 0),
      reason: dampener.reason || dampenerKey,
    });
  };

  addRuleSignal("authFailedDay", "authFailedDay", { key: "auth_failed_day" });
  addRuleSignal("authFailedDayBurst", "authFailedDay", {
    key: "auth_failed_day_burst",
  });
  addRuleSignal("authFailedWeek", "authFailedWeek", { key: "auth_failed_week" });
  addRuleSignal("adminDeniedDay", "adminDeniedDay", { key: "admin_denied_day" });
  addRuleSignal("adminDeniedWeek", "adminDeniedWeek", { key: "admin_denied_week" });
  addRuleSignal("spamHour", "spamHour", { key: "spam_hour" });
  addRuleSignal("spamDay", "spamDay", { key: "spam_day" });
  addRuleSignal("rateLimitedDay", "rateLimitedDay", { key: "rate_limited_day" });
  addRuleSignal("checkpointFailedWeek", "checkpointFailedWeek", {
    key: "checkpoint_failed_week",
    levelHint:
      Number(counters.checkpointFailedWeek || 0) >=
      Number(hardSignals.checkpointFailedWeek || 8)
        ? 3
        : undefined,
  });
  addRuleSignal("abuseWeek", "abuseWeek", { key: "abuse_week" });
  addRuleSignal("clientSuspiciousDay", "clientSuspiciousDay", {
    key: "client_suspicious_day",
  });
  addRuleSignal("criticalMonth", "criticalMonth", { key: "critical_month" });

  addConfiguredDampener(
    "authSuccessWeek",
    counters.authSuccessWeek >= Number(settingsDampeners.authSuccessWeek?.threshold || 3),
    "recent_successful_logins"
  );
  addConfiguredDampener(
    "checkpointPassedMonth",
    counters.checkpointPassedMonth >=
      Number(settingsDampeners.checkpointPassedMonth?.threshold || 1),
    "recent_checkpoint_pass"
  );
  addConfiguredDampener(
    "verifiedIdentity",
    user?.cccdStatus === "verified",
    "verified_identity"
  );
  addConfiguredDampener(
    "agedAccount",
    accountAgeDays(user) >= Number(settingsDampeners.agedAccount?.threshold || 30),
    "aged_account"
  );

  const dampenerTotal = dampeners.reduce(
    (sum, item) => sum + Number(item.points || 0),
    0
  );
  const hasHardSignal =
    counters.checkpointFailedWeek >= Number(hardSignals.checkpointFailedWeek || 8) ||
    counters.abuseWeek >= Number(hardSignals.abuseWeek || 2) ||
    counters.criticalMonth >= Number(hardSignals.criticalMonth || 1) ||
    counters.authFailedDay >= Number(hardSignals.authFailedDay || 20) ||
    counters.rateLimitedDay >= Number(hardSignals.rateLimitedDay || 8);
  const categoryCount = categories.size;
  const score = Math.max(0, rawScore + dampenerTotal);
  const maxLevelHint = signals.reduce(
    (max, signal) => Math.max(max, Number(signal.levelHint || 0)),
    0
  );

  let level = 0;
  if (
    score >= Number(thresholds.level3Score || 85) &&
    (hasHardSignal ||
      categoryCount >= Number(thresholds.minCategoriesForLevel3 || 3) ||
      maxLevelHint >= 3)
  ) {
    level = 3;
  } else if (
    score >= Number(thresholds.level2Score || 55) &&
    (hasHardSignal ||
      categoryCount >= Number(thresholds.minCategoriesForLevel2 || 2) ||
      maxLevelHint >= 2)
  ) {
    level = 2;
  } else if (
    score >= Number(thresholds.level1Score || 25) &&
    (signals.length >= Number(thresholds.minSignalsForLevel1 || 2) || hasHardSignal)
  ) {
    level = 1;
  }

  if (intent === "login" && level > 0 && !getPrimaryOtpFactor(user, settings)) {
    return {
      required: false,
      level: 0,
      score,
      rawScore,
      confidence: "missing_factor",
      reasons: ["Tài khoản chưa có số điện thoại hoặc email để checkpoint"],
      signals,
      dampeners,
      counters,
      categoryCount,
    };
  }

  const confidence =
    level >= 3 || hasHardSignal
      ? "high"
      : level >= 2 || categoryCount >= 2
      ? "medium"
      : "low";

  return {
    required: level > 0,
    level,
    score,
    rawScore,
    confidence,
    reasons: signals.map((signal) => signal.reason).filter(Boolean),
    signals,
    dampeners,
    counters,
    categoryCount,
  };
}

export async function evaluateCheckpointRisk({ user, req, intent = "login" }) {
  const settings = await getCheckpointSettings();
  const ctx = getClientContext(req);

  if (!checkpointEnabled() || settings.enabled === false) {
    return {
      required: false,
      level: 0,
      score: 0,
      rawScore: 0,
      confidence: "disabled",
      reasons: [],
      signals: [],
      dampeners: [],
      counters: {},
    };
  }

  const allowlistMatch = findCheckpointAllowlistMatch({
    settings,
    user,
    context: ctx,
  });
  if (allowlistMatch) {
    return {
      required: false,
      level: 0,
      score: 0,
      rawScore: 0,
      confidence: "allowlisted",
      reasons: [allowlistMatch.reason || "Checkpoint allowlist còn hiệu lực"],
      signals: [],
      dampeners: [],
      counters: {},
      allowlist: {
        value: allowlistMatch.value,
        reason: allowlistMatch.reason || "",
        expiresAt: allowlistMatch.expiresAt || null,
      },
    };
  }

  if (settings.roleBypassEnabled !== false && roleBypassEnabled() && isPrivilegedUser(user)) {
    return {
      required: false,
      level: 0,
      score: 0,
      rawScore: 0,
      confidence: "role_bypass",
      reasons: [],
      signals: [],
      dampeners: [],
      counters: {},
    };
  }

  const counters = await countRiskSignals({ user, req });
  if (!counters) {
    return {
      required: false,
      level: 0,
      score: 0,
      rawScore: 0,
      confidence: "low",
      reasons: [],
      signals: [],
      dampeners: [],
      counters: {},
    };
  }

  return buildRiskDecision({ counters, user, intent, settings });
}

export async function simulateCheckpointRiskDecision({
  counters = {},
  user = {},
  intent = "login",
} = {}) {
  const settings = await getCheckpointSettings();
  const normalizedCounters = {
    authFailedDay: 0,
    authFailedWeek: 0,
    authSuccessWeek: 0,
    adminDeniedDay: 0,
    adminDeniedWeek: 0,
    spamHour: 0,
    spamDay: 0,
    rateLimitedDay: 0,
    checkpointFailedWeek: 0,
    checkpointPassedMonth: 0,
    abuseWeek: 0,
    clientSuspiciousDay: 0,
    criticalMonth: 0,
    ...Object.entries(counters || {}).reduce((acc, [key, value]) => {
      const n = Number(value);
      acc[key] = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
      return acc;
    }, {}),
  };
  return buildRiskDecision({
    counters: normalizedCounters,
    user,
    intent,
    settings,
  });
}

async function hasTrustedLoginCheckpoint(user, req, minLevel = 1) {
  const ctx = getClientContext(req);
  if (!ctx.deviceId) return false;

  const trusted = await CheckpointSession.exists({
    user: user._id,
    type: "login",
    channel: "web",
    status: "passed",
    level: { $gte: minLevel },
    "request.deviceId": ctx.deviceId,
    trustExpiresAt: { $gt: new Date() },
  });

  return Boolean(trusted);
}

export async function shouldRequireLoginCheckpoint(user, req) {
  const decision = await evaluateCheckpointRisk({ user, req, intent: "login" });
  if (!decision.required) return decision;

  const trusted = await hasTrustedLoginCheckpoint(user, req, decision.level);
  return trusted
    ? {
        ...decision,
        required: false,
        confidence: "trusted_device",
      }
    : decision;
}

export async function shouldRequireManualLoginCheckpoint(user) {
  const mandate = await getActiveCheckpointMandateForUser(user?._id || user?.id);
  if (!mandate) {
    return {
      required: false,
      level: 0,
      score: 0,
      rawScore: 0,
      confidence: "no_manual_mandate",
      reasons: [],
      signals: [],
      dampeners: [],
      counters: {},
    };
  }

  const level = Math.max(1, Math.min(3, Number(mandate.level || 1)));
  return {
    required: true,
    level,
    score: 100,
    rawScore: 100,
    confidence: "manual_admin",
    reasons: [mandate.reason || `Admin yêu cầu checkpoint level ${level}`],
    signals: [
      {
        key: "admin_manual_checkpoint",
        category: "checkpoint",
        points: 100,
        levelHint: level,
        count: 1,
        window: "manual",
        reason: mandate.reason || `Admin yêu cầu checkpoint level ${level}`,
      },
    ],
    dampeners: [],
    counters: {},
    mandateId: String(mandate._id),
    mandate,
  };
}

export async function shouldRequireActionCheckpoint({
  user,
  req,
  intent = "sensitive_action",
  minLevel = 1,
} = {}) {
  const decision = await evaluateCheckpointRisk({ user, req, intent });
  if (!decision.required || Number(decision.level || 0) < Number(minLevel || 1)) {
    return decision;
  }

  const trusted = await hasTrustedLoginCheckpoint(user, req, decision.level);
  return trusted
    ? {
        ...decision,
        required: false,
        confidence: "trusted_device",
      }
    : decision;
}

export async function getActiveCheckpointSessionForUser(userId) {
  const uid = userId?._id || userId?.id || userId;
  if (!uid) return null;

  const now = new Date();
  await CheckpointSession.updateMany(
    {
      user: uid,
      status: "pending",
      expiresAt: { $lte: now },
    },
    {
      $set: {
        status: "expired",
        failedAt: now,
      },
    }
  );

  return CheckpointSession.findOne({
    user: uid,
    type: "login",
    channel: "web",
    status: { $in: ["pending", "review_required"] },
    expiresAt: { $gt: now },
  }).sort({ createdAt: -1 });
}

export async function getCurrentCheckpointRequirementForUser({
  user,
  req,
  createSession = false,
  includeRisk = false,
} = {}) {
  const existing = await getActiveCheckpointSessionForUser(user?._id || user?.id);
  if (existing?.publicToken) {
    return {
      required: true,
      level: Number(existing.level || 1),
      reason: existing.risk?.reasons?.[0] || "",
      checkpoint: publicSessionPayload(existing, existing.publicToken),
      mandateId: existing.mandate ? String(existing.mandate) : "",
    };
  }

  const decision = await shouldRequireManualLoginCheckpoint(user);
  if (!decision.required) {
    if (includeRisk && createSession) {
      const riskDecision = await shouldRequireActionCheckpoint({
        user,
        req,
        intent: "ongoing_api_activity",
        minLevel: 1,
      });

      if (riskDecision.required) {
        const checkpoint = await startLoginCheckpoint({
          user,
          req,
          decision: riskDecision,
          reason: "ongoing_api_activity_policy",
        });

        return {
          required: true,
          level: Number(riskDecision.level || 1),
          reason: riskDecision.reasons?.[0] || "",
          checkpoint,
          mandate: null,
          mandateId: "",
        };
      }
    }

    return {
      required: false,
      level: 0,
      reason: "",
      checkpoint: null,
      mandate: null,
    };
  }

  if (!createSession) {
    return {
      required: true,
      level: Number(decision.level || 1),
      reason: decision.reasons?.[0] || "",
      checkpoint: null,
      mandate: decision.mandate || null,
      mandateId: decision.mandateId || "",
    };
  }

  const checkpoint = await startLoginCheckpoint({
    user,
    req,
    decision,
    mandate: decision.mandate,
    reason: "manual_admin_realtime",
  });

  return {
    required: true,
    level: Number(decision.level || 1),
    reason: decision.reasons?.[0] || "",
    checkpoint,
    mandate: decision.mandate || null,
    mandateId: decision.mandateId || "",
  };
}

function publicSessionPayload(session, token = "") {
  const now = Date.now();
  const resendAt = session?.resendAvailableAt
    ? new Date(session.resendAvailableAt).getTime()
    : 0;

  return {
    token,
    type: session.type,
    channel: session.channel,
    status: session.status,
    level: session.level,
    factors: (session.factors || []).map((factor) => ({
      key: factor.key,
      status: factor.status,
      passedAt: factor.passedAt?.toISOString?.() || null,
      submittedAt: factor.submittedAt?.toISOString?.() || null,
    })),
    evidence: (session.evidence || []).map((item) => ({
      factor: item.factor,
      kind: item.kind,
      url: item.url,
      uploadedAt: item.uploadedAt?.toISOString?.() || null,
    })),
    deliveryMethod: session.delivery?.method || "zalo_otp",
    targetMasked: session.delivery?.targetMasked || "",
    started: Number(session.delivery?.sendCount || 0) > 0,
    delivery: {
      method: session.delivery?.method || "zalo_otp",
      targetMasked: session.delivery?.targetMasked || "",
      sendCount: Number(session.delivery?.sendCount || 0),
      lastSentAt: session.delivery?.lastSentAt?.toISOString?.() || null,
    },
    expiresAt: session.expiresAt?.toISOString?.() || null,
    codeExpiresAt: session.codeExpiresAt?.toISOString?.() || null,
    resendAvailableAt: session.resendAvailableAt?.toISOString?.() || null,
    cooldown: Math.max(0, Math.ceil((resendAt - now) / 1000)),
    attemptsRemaining: Math.max(
      0,
      Number(session.maxAttempts || 0) - Number(session.attempts || 0)
    ),
    risk: {
      score: session.risk?.score || 0,
      rawScore: session.risk?.rawScore || session.risk?.score || 0,
      level: session.risk?.level || session.level || 1,
      confidence: session.risk?.confidence || "low",
      reasons: Array.isArray(session.risk?.reasons) ? session.risk.reasons : [],
      signals: Array.isArray(session.risk?.signals) ? session.risk.signals : [],
      dampeners: Array.isArray(session.risk?.dampeners)
        ? session.risk.dampeners
        : [],
    },
  };
}

async function sendOtpToSession(session, otp, settings = null) {
  try {
    if (session.delivery.method === "email_otp") {
      const result = await sendCheckpointOtpEmail({
        to: session.delivery.phone,
        otp,
        expiresInSec: Math.ceil(codeTtlMs(settings) / 1000),
      });
      if (!result?.ok) {
        throw result?.error || new Error("Email checkpoint failed");
      }
      return { tranId: "email", cost: 0 };
    }

    return await sendTingTingOtp({
      phone: session.delivery.phone,
      otp,
    });
  } catch (error) {
    const detail =
      safeStringify(error?.body) ||
      safeStringify(error?.response?.data) ||
      safeStringify(error?.message) ||
      "unknown";
    const detailShort =
      detail.length > 600 ? `${detail.slice(0, 600)}...` : detail;
    throw new Error(
      `Gửi mã checkpoint thất bại. Vui lòng thử lại. | ${detailShort}`
    );
  }
}

function getFactor(session, key) {
  return (session.factors || []).find((factor) => factor.key === key);
}

function markFactorPassed(session, key) {
  const factor = getFactor(session, key);
  if (!factor) return;
  factor.status = "passed";
  factor.passedAt = new Date();
}

function allFactorsPassed(session) {
  return (session.factors || []).every((factor) => factor.status === "passed");
}

function getNextActionFactor(session) {
  return (session.factors || []).find(
    (factor) => !["passed", "submitted"].includes(factor.status)
  );
}

async function completeSessionIfReady(session, { req, res, token }) {
  if (!allFactorsPassed(session)) {
    await session.save();
    return {
      authenticated: false,
      checkpoint: publicSessionPayload(session, token),
    };
  }

  const settings = await getCheckpointSettings();
  const user = await User.findById(session.user);
  if (!user || user.isDeleted) {
    const error = new Error("Tài khoản không tồn tại hoặc đã bị khoá.");
    error.statusCode = 401;
    throw error;
  }

  session.status = "passed";
  session.passedAt = new Date();
  session.trustExpiresAt = new Date(Date.now() + trustMs(settings));
  session.codeHash = "";
  await session.save();
  if (session.mandate) {
    await consumeCheckpointMandate({
      id: session.mandate,
      sessionId: session._id,
    });
  }

  generateToken(res, user);
  void User.recordLogin(user._id, { req, method: "otp", success: true });
  void recordCheckpointEvent({
    req,
    user,
    subjectUser: user,
    type: "checkpoint_passed",
    category: "checkpoint",
    outcome: "success",
    severity: "info",
    metadata: { level: session.level },
  });

  return {
    authenticated: true,
    user: {
      ...buildCheckpointAuthPayload(user),
      checkpointPassed: true,
      checkpointTrustExpiresAt: session.trustExpiresAt.toISOString(),
    },
  };
}

export async function startLoginCheckpoint({
  user,
  req,
  decision,
  reason = "login_risk",
  mandate = null,
}) {
  const settings = await getCheckpointSettings();
  const risk =
    decision || (await shouldRequireLoginCheckpoint(user, req));
  const level = Math.max(1, Math.min(3, Number(risk.level || 1)));
  const mandateId = mandate?._id || risk.mandateId || risk.mandate?._id || null;
  const primaryFactor = getPrimaryOtpFactor(user, settings);
  if (!primaryFactor) {
    const error = new Error("Tài khoản chưa có số điện thoại hoặc email để checkpoint.");
    error.statusCode = 400;
    throw error;
  }
  const now = Date.now();
  const token = makeCheckpointToken();
  const ctx = getClientContext(req);

  const session = new CheckpointSession({
    user: user._id,
    mandate: mandateId || null,
    type: "login",
    channel: "web",
    status: "pending",
    level,
    factors: buildFactorState(level, primaryFactor.key),
    risk: {
      score: risk.score || 0,
      rawScore: risk.rawScore || risk.score || 0,
      level,
      confidence: risk.confidence || "low",
      reasons: risk.reasons || [],
      signals: risk.signals || [],
      dampeners: risk.dampeners || [],
      counters: risk.counters || {},
      mandateId: mandateId ? String(mandateId) : "",
    },
    tokenHash: hashToken(token),
    publicToken: token,
    codeHash: "",
    delivery: {
      method: primaryFactor.method,
      targetMasked: primaryFactor.targetMasked,
      phone: primaryFactor.target,
      lastSentAt: null,
      sendCount: 0,
    },
    attempts: 0,
    maxAttempts: maxAttempts(settings),
    expiresAt: new Date(now + sessionTtlMs(settings)),
    codeExpiresAt: null,
    resendAvailableAt: null,
    request: {
      ...ctx,
      reason,
    },
  });

  await session.save();

  void recordCheckpointEvent({
    req,
    user,
    subjectUser: user,
    type: "checkpoint_required",
    category: "checkpoint",
    outcome: "blocked",
    severity: level >= 3 ? "high" : level >= 2 ? "medium" : "low",
    metadata: {
      level,
      score: risk.score || 0,
      confidence: risk.confidence || "low",
      reasons: risk.reasons || [],
      mandateId: mandateId ? String(mandateId) : "",
    },
  });

  return publicSessionPayload(session, token);
}

export async function getCheckpointSessionByToken(token) {
  const session = await CheckpointSession.findOne({
    tokenHash: hashToken(token),
  });

  if (!session) {
    const error = new Error("Checkpoint không tồn tại hoặc đã hết hạn.");
    error.statusCode = 404;
    throw error;
  }

  if (session.status === "pending" && session.expiresAt <= new Date()) {
    session.status = "expired";
    await session.save();
  }

  return session;
}

export async function getPublicCheckpointSession(token) {
  const session = await getCheckpointSessionByToken(token);
  return publicSessionPayload(session, token);
}

export async function resendCheckpointCode({ token, req }) {
  const settings = await getCheckpointSettings();
  const session = await getCheckpointSessionByToken(token);
  const now = Date.now();

  if (session.status !== "pending") {
    const error = new Error("Checkpoint này không còn hiệu lực.");
    error.statusCode = 400;
    throw error;
  }

  if (session.expiresAt <= new Date(now)) {
    session.status = "expired";
    await session.save();
    const error = new Error("Checkpoint đã hết hạn. Vui lòng đăng nhập lại.");
    error.statusCode = 410;
    throw error;
  }

  const otpFactor =
    getFactor(session, "phone_otp") || getFactor(session, "email_otp");
  const expectedFactor = getNextActionFactor(session);
  if (
    !otpFactor ||
    otpFactor.status === "passed" ||
    !["phone_otp", "email_otp"].includes(expectedFactor?.key)
  ) {
    const error = new Error("Bước OTP đã hoàn tất hoặc không còn là bước hiện tại.");
    error.statusCode = 400;
    throw error;
  }

  const resendAt = session.resendAvailableAt
    ? new Date(session.resendAvailableAt).getTime()
    : 0;
  if (resendAt > now) {
    const remaining = Math.ceil((resendAt - now) / 1000);
    const error = new Error(`Vui lòng đợi ${remaining}s để gửi lại mã.`);
    error.statusCode = 429;
    error.remainingTime = remaining;
    throw error;
  }

  const otp = makeOtp(6);
  const zns = await sendOtpToSession(session, otp, settings);

  session.codeHash = await bcrypt.hash(otp, await bcrypt.genSalt(10));
  session.codeExpiresAt = new Date(now + codeTtlMs(settings));
  session.resendAvailableAt = new Date(now + resendCooldownMs(settings));
  session.delivery.lastSentAt = new Date(now);
  session.delivery.sendCount = Number(session.delivery.sendCount || 0) + 1;
  session.delivery.tranId = String(zns?.tranId || "");
  session.delivery.cost = Number(zns?.cost || 0);
  if (otpFactor && otpFactor.status === "required") {
    otpFactor.status = "sent";
  }
  await session.save();

  void recordCheckpointEvent({
    req,
    subjectUser: { _id: session.user },
    type: "checkpoint_code_resend",
    category: "checkpoint",
    outcome: "observed",
    severity: "info",
    metadata: { level: session.level },
  });

  return publicSessionPayload(session, token);
}

export async function startCheckpointVerification({ token, req }) {
  return resendCheckpointCode({ token, req });
}

export async function verifyPhoneOtpFactor({ token, code, req, res }) {
  const cleanCode = String(code || "").replace(/\D/g, "").slice(0, 6);
  if (cleanCode.length < 4) {
    const error = new Error("Mã checkpoint không hợp lệ.");
    error.statusCode = 400;
    throw error;
  }

  const session = await getCheckpointSessionByToken(token);
  const now = Date.now();

  if (session.status !== "pending") {
    const error = new Error("Checkpoint này không còn hiệu lực.");
    error.statusCode = 400;
    throw error;
  }

  if (session.expiresAt <= new Date(now)) {
    session.status = "expired";
    await session.save();
    const error = new Error("Checkpoint đã hết hạn. Vui lòng đăng nhập lại.");
    error.statusCode = 410;
    throw error;
  }

  const expectedFactor = getNextActionFactor(session);
  if (!["phone_otp", "email_otp"].includes(expectedFactor?.key)) {
    const error = new Error("Bước OTP đã hoàn tất hoặc không còn là bước hiện tại.");
    error.statusCode = 400;
    throw error;
  }

  if (session.codeExpiresAt && session.codeExpiresAt <= new Date(now)) {
    const error = new Error("Mã checkpoint đã hết hạn. Vui lòng gửi lại mã.");
    error.statusCode = 400;
    throw error;
  }

  if (!session.codeHash) {
    const error = new Error("Vui lòng bắt đầu xác minh để nhận mã checkpoint.");
    error.statusCode = 400;
    throw error;
  }

  if (Number(session.attempts || 0) >= Number(session.maxAttempts || 0)) {
    session.status = "failed";
    session.failedAt = new Date(now);
    await session.save();
    const error = new Error(
      "Bạn đã nhập sai quá nhiều lần. Vui lòng đăng nhập lại."
    );
    error.statusCode = 429;
    throw error;
  }

  const ok = await bcrypt.compare(cleanCode, session.codeHash || "");
  if (!ok) {
    session.attempts = Number(session.attempts || 0) + 1;
    if (session.attempts >= Number(session.maxAttempts || 0)) {
      session.status = "failed";
      session.failedAt = new Date(now);
    }
    await session.save();

    void recordCheckpointEvent({
      req,
      subjectUser: { _id: session.user },
      type: "checkpoint_code_failed",
      category: "checkpoint",
      outcome: "failed",
      severity: "medium",
      weight: 4,
      metadata: { level: session.level },
    });

    const error = new Error("Mã checkpoint không đúng.");
    error.statusCode = 400;
    throw error;
  }

  const otpFactor =
    getFactor(session, "phone_otp") || getFactor(session, "email_otp");
  if (otpFactor) markFactorPassed(session, otpFactor.key);
  session.codeHash = "";
  return completeSessionIfReady(session, { req, res, token });
}

export async function submitCheckpointEvidence({
  token,
  factor,
  evidence,
  req,
  res,
}) {
  const session = await getCheckpointSessionByToken(token);
  if (session.status !== "pending") {
    const error = new Error("Checkpoint này không còn hiệu lực.");
    error.statusCode = 400;
    throw error;
  }

  const factorDoc = getFactor(session, factor);
  if (!factorDoc) {
    const error = new Error("Factor checkpoint không hợp lệ.");
    error.statusCode = 400;
    throw error;
  }

  const expectedFactor = getNextActionFactor(session);
  if (!expectedFactor || expectedFactor.key !== factor) {
    const error = new Error("Vui lòng hoàn tất các bước checkpoint theo đúng thứ tự.");
    error.statusCode = 400;
    throw error;
  }

  const rows = Array.isArray(evidence) ? evidence : [];
  if (!rows.length) {
    const error = new Error("Thiếu bằng chứng xác minh.");
    error.statusCode = 400;
    throw error;
  }

  rows.forEach((item) => session.evidence.push(item));
  factorDoc.status = "submitted";
  factorDoc.submittedAt = new Date();

  const level = Number(session.level || 1);
  const shouldEnterReview =
    (level === 2 && factor === "cccd_upload") ||
    (level >= 3 && factor === "face_video");

  if (shouldEnterReview) {
    session.status = "review_required";
    await session.save();
    void recordCheckpointEvent({
      req,
      subjectUser: { _id: session.user },
      type: "checkpoint_review_required",
      category: "checkpoint",
      outcome: "blocked",
      severity: "high",
      metadata: { level: session.level, factor },
    });
    return {
      authenticated: false,
      reviewRequired: true,
      checkpoint: publicSessionPayload(session, token),
    };
  }

  markFactorPassed(session, factor);
  return completeSessionIfReady(session, { req, res, token });
}
