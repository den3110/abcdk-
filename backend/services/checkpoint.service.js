import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import CheckpointEvent from "../models/checkpointEventModel.js";
import CheckpointSession from "../models/checkpointSessionModel.js";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";
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
const sessionTtlMs = () =>
  intEnv("CHECKPOINT_SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS);
const codeTtlMs = () =>
  intEnv("CHECKPOINT_CODE_TTL_MS", DEFAULT_CODE_TTL_MS);
const resendCooldownMs = () =>
  intEnv("CHECKPOINT_RESEND_COOLDOWN_MS", DEFAULT_RESEND_COOLDOWN_MS);
const trustMs = () => intEnv("CHECKPOINT_TRUST_MS", DEFAULT_TRUST_MS);
const maxAttempts = () =>
  intEnv("CHECKPOINT_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS);
const manualReviewLevel = () =>
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

const getPrimaryOtpFactor = (user) => {
  if (user?.email) {
    return {
      key: "email_otp",
      method: "email_otp",
      targetMasked: maskEmail(user.email),
      target: user.email,
    };
  }
  if (isValidPhoneVN(user?.phone || "")) {
    return {
      key: "phone_otp",
      method: "zalo_otp",
      targetMasked: maskPhone(user.phone),
      target: user.phone,
    };
  }
  return null;
};

const getRequiredFactorsForLevel = (level, primaryFactorKey = "phone_otp") => {
  if (level >= 3) return [primaryFactorKey, "cccd_upload", "face_video"];
  if (level >= 2) return [primaryFactorKey, "cccd_upload"];
  return [primaryFactorKey];
};

export function getCheckpointPolicySummary() {
  return {
    enabled: checkpointEnabled(),
    roleBypassEnabled: roleBypassEnabled(),
    primaryContactPriority: ["email_otp", "phone_otp"],
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
        reviewRequired: manualReviewLevel() <= 3,
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
      trustedDeviceWindowMs: trustMs(),
    },
  };
}

const buildFactorState = (level, primaryFactorKey) =>
  getRequiredFactorsForLevel(level, primaryFactorKey).map((key) => ({
    key,
    status: key === primaryFactorKey ? "sent" : "required",
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

function buildRiskDecision({ counters, user, intent }) {
  let rawScore = 0;
  const signals = [];
  const dampeners = [];
  const categories = new Set();

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

  addSignal(counters.authFailedDay >= 5, {
    key: "auth_failed_day",
    category: "auth",
    points: 25,
    levelHint: 1,
    count: counters.authFailedDay,
    window: "24h",
    reason: "Nhiều lần đăng nhập sai trong 24 giờ",
  });
  addSignal(counters.authFailedDay >= 12, {
    key: "auth_failed_day_burst",
    category: "auth",
    points: 25,
    levelHint: 2,
    count: counters.authFailedDay,
    window: "24h",
    reason: "Burst đăng nhập sai trong ngày",
  });
  addSignal(counters.authFailedWeek >= 25, {
    key: "auth_failed_week",
    category: "auth",
    points: 25,
    levelHint: 2,
    count: counters.authFailedWeek,
    window: "7d",
    reason: "Đăng nhập sai lặp lại nhiều ngày",
  });
  addSignal(counters.adminDeniedDay >= 6, {
    key: "admin_denied_day",
    category: "admin_route",
    points: 20,
    levelHint: 1,
    count: counters.adminDeniedDay,
    window: "24h",
    reason: "Truy cập route quản trị bị từ chối nhiều lần",
  });
  addSignal(counters.adminDeniedWeek >= 18, {
    key: "admin_denied_week",
    category: "admin_route",
    points: 25,
    levelHint: 2,
    count: counters.adminDeniedWeek,
    window: "7d",
    reason: "Thử route quản trị lặp lại nhiều ngày",
  });
  addSignal(counters.spamHour >= 25, {
    key: "spam_hour",
    category: "spam",
    points: 20,
    levelHint: 1,
    count: counters.spamHour,
    window: "1h",
    reason: "Tần suất thao tác ghi bất thường trong 1 giờ",
  });
  addSignal(counters.spamDay >= 80, {
    key: "spam_day",
    category: "spam",
    points: 25,
    levelHint: 2,
    count: counters.spamDay,
    window: "24h",
    reason: "Tần suất thao tác ghi bất thường trong ngày",
  });
  addSignal(counters.rateLimitedDay >= 4, {
    key: "rate_limited_day",
    category: "rate_limit",
    points: 25,
    levelHint: 2,
    count: counters.rateLimitedDay,
    window: "24h",
    reason: "Bị rate limit nhiều lần",
  });
  addSignal(counters.checkpointFailedWeek >= 3, {
    key: "checkpoint_failed_week",
    category: "checkpoint",
    points: 30,
    levelHint: counters.checkpointFailedWeek >= 8 ? 3 : 2,
    count: counters.checkpointFailedWeek,
    window: "7d",
    reason: "Nhập sai checkpoint nhiều lần",
  });
  addSignal(counters.abuseWeek >= 2, {
    key: "abuse_week",
    category: "abuse",
    points: 35,
    levelHint: 2,
    count: counters.abuseWeek,
    window: "7d",
    reason: "Có tín hiệu abuse đã bị chặn",
  });
  addSignal(counters.clientSuspiciousDay >= 10, {
    key: "client_suspicious_day",
    category: "client_signal",
    points: 20,
    levelHint: 1,
    count: counters.clientSuspiciousDay,
    window: "24h",
    reason: "Tín hiệu client bất thường lặp lại",
  });
  addSignal(counters.criticalMonth >= 1, {
    key: "critical_month",
    category: "critical",
    points: 35,
    levelHint: 3,
    count: counters.criticalMonth,
    window: "30d",
    reason: "Có tín hiệu rủi ro cao gần đây",
  });

  addDampener(counters.authSuccessWeek >= 3, {
    key: "recent_successful_logins",
    points: -10,
    reason: "Có đăng nhập thành công gần đây",
  });
  addDampener(counters.checkpointPassedMonth >= 1, {
    key: "recent_checkpoint_pass",
    points: -12,
    reason: "Đã vượt checkpoint gần đây",
  });
  addDampener(user?.cccdStatus === "verified", {
    key: "verified_identity",
    points: -8,
    reason: "Tài khoản đã xác minh CCCD",
  });
  addDampener(accountAgeDays(user) >= 30, {
    key: "aged_account",
    points: -6,
    reason: "Tài khoản đã hoạt động trên 30 ngày",
  });

  const dampenerTotal = dampeners.reduce(
    (sum, item) => sum + Number(item.points || 0),
    0
  );
  const hasHardSignal =
    counters.checkpointFailedWeek >= 8 ||
    counters.abuseWeek >= 2 ||
    counters.criticalMonth >= 1 ||
    counters.authFailedDay >= 20 ||
    counters.rateLimitedDay >= 8;
  const categoryCount = categories.size;
  const score = Math.max(0, rawScore + dampenerTotal);
  const maxLevelHint = signals.reduce(
    (max, signal) => Math.max(max, Number(signal.levelHint || 0)),
    0
  );

  let level = 0;
  if (score >= 85 && (hasHardSignal || categoryCount >= 3 || maxLevelHint >= 3)) {
    level = 3;
  } else if (
    score >= 55 &&
    (hasHardSignal || categoryCount >= 2 || maxLevelHint >= 2)
  ) {
    level = 2;
  } else if (score >= 25 && (signals.length >= 2 || hasHardSignal)) {
    level = 1;
  }

  if (intent === "login" && level > 0 && !getPrimaryOtpFactor(user)) {
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
  if (!checkpointEnabled()) {
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

  if (roleBypassEnabled() && isPrivilegedUser(user)) {
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

  return buildRiskDecision({ counters, user, intent });
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

async function sendOtpToSession(session, otp) {
  try {
    if (session.delivery.method === "email_otp") {
      const result = await sendCheckpointOtpEmail({
        to: session.delivery.phone,
        otp,
        expiresInSec: Math.ceil(codeTtlMs() / 1000),
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

async function completeSessionIfReady(session, { req, res, token }) {
  if (!allFactorsPassed(session)) {
    await session.save();
    return {
      authenticated: false,
      checkpoint: publicSessionPayload(session, token),
    };
  }

  const user = await User.findById(session.user);
  if (!user || user.isDeleted) {
    const error = new Error("Tài khoản không tồn tại hoặc đã bị khoá.");
    error.statusCode = 401;
    throw error;
  }

  session.status = "passed";
  session.passedAt = new Date();
  session.trustExpiresAt = new Date(Date.now() + trustMs());
  session.codeHash = "";
  await session.save();

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
}) {
  const risk =
    decision || (await shouldRequireLoginCheckpoint(user, req));
  const level = Math.max(1, Math.min(3, Number(risk.level || 1)));
  const primaryFactor = getPrimaryOtpFactor(user);
  if (!primaryFactor) {
    const error = new Error("Tài khoản chưa có số điện thoại hoặc email để checkpoint.");
    error.statusCode = 400;
    throw error;
  }
  const now = Date.now();
  const token = makeCheckpointToken();
  const otp = makeOtp(6);
  const ctx = getClientContext(req);

  const session = new CheckpointSession({
    user: user._id,
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
    },
    tokenHash: hashToken(token),
    codeHash: await bcrypt.hash(otp, await bcrypt.genSalt(10)),
    delivery: {
      method: primaryFactor.method,
      targetMasked: primaryFactor.targetMasked,
      phone: primaryFactor.target,
      lastSentAt: new Date(now),
      sendCount: 1,
    },
    attempts: 0,
    maxAttempts: maxAttempts(),
    expiresAt: new Date(now + sessionTtlMs()),
    codeExpiresAt: new Date(now + codeTtlMs()),
    resendAvailableAt: new Date(now + resendCooldownMs()),
    request: {
      ...ctx,
      reason,
    },
  });

  const zns = await sendOtpToSession(session, otp);
  session.delivery.tranId = String(zns?.tranId || "");
  session.delivery.cost = Number(zns?.cost || 0);
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
  const zns = await sendOtpToSession(session, otp);

  session.codeHash = await bcrypt.hash(otp, await bcrypt.genSalt(10));
  session.codeExpiresAt = new Date(now + codeTtlMs());
  session.resendAvailableAt = new Date(now + resendCooldownMs());
  session.delivery.lastSentAt = new Date(now);
  session.delivery.sendCount = Number(session.delivery.sendCount || 0) + 1;
  session.delivery.tranId = String(zns?.tranId || "");
  session.delivery.cost = Number(zns?.cost || 0);
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

  if (session.codeExpiresAt && session.codeExpiresAt <= new Date(now)) {
    const error = new Error("Mã checkpoint đã hết hạn. Vui lòng gửi lại mã.");
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

  const rows = Array.isArray(evidence) ? evidence : [];
  if (!rows.length) {
    const error = new Error("Thiếu bằng chứng xác minh.");
    error.statusCode = 400;
    throw error;
  }

  rows.forEach((item) => session.evidence.push(item));
  factorDoc.status = "submitted";
  factorDoc.submittedAt = new Date();

  const requiresManualReview =
    Number(session.level || 1) >= manualReviewLevel() &&
    (factor === "face_video" || !getFactor(session, "face_video"));

  if (requiresManualReview) {
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
