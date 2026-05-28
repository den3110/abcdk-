import crypto from "crypto";
import mongoose from "mongoose";
import AuthLog from "../models/authLogModel.js";
import IdentitySecuritySettings from "../models/identitySecuritySettingsModel.js";
import User from "../models/userModel.js";
import UserLogin from "../models/userLoginModel.js";
import { openai, OPENAI_DEFAULT_MODEL } from "../lib/openaiClient.js";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 180;
const MAX_EVENTS = 240;

export const IDENTITY_SECURITY_SETTINGS_ID = "identity-security";

export const DEFAULT_IDENTITY_SECURITY_SETTINGS = Object.freeze({
  _id: IDENTITY_SECURITY_SETTINGS_ID,
  enabled: true,
  analysis: {
    defaultWindowDays: 30,
    overviewLimit: 12,
    eventLimit: 240,
  },
  rules: {
    newIp: { enabled: true, severity: "medium", threshold: 3, penalty: 8 },
    newDevice: { enabled: true, severity: "medium", threshold: 3, penalty: 8 },
    failureBurst: {
      enabled: true,
      severity: "high",
      threshold: 3,
      windowMinutes: 15,
      penalty: 14,
    },
    failedThenSuccess: {
      enabled: true,
      severity: "medium",
      windowMinutes: 30,
      penalty: 8,
    },
    offHour: { enabled: true, severity: "low", threshold: 8, penalty: 4 },
    sharedAccounts: {
      enabled: true,
      severity: "medium",
      threshold: 3,
      penalty: 8,
    },
    deviceChanges: {
      enabled: true,
      severity: "low",
      threshold: 5,
      penalty: 6,
    },
  },
  trust: {
    baseScore: 65,
    highTrustMin: 85,
    normalMin: 70,
    watchMin: 50,
    matureAccountDays: 180,
    newAccountDays: 7,
    matureAccountBonus: 8,
    newAccountPenalty: 8,
    verifiedBonus: 5,
    kycBonus: 6,
    phoneVerifiedBonus: 5,
    stableDeviceBonus: 5,
    failedAuthPenaltyEach: 3,
    failedAuthPenaltyMax: 18,
  },
  actions: {
    highRisk: "challenge",
    watch: "monitor",
    normal: "allow",
    highTrust: "allow",
  },
  explainableUx: {
    normalUserMessage:
      "Hoạt động đăng nhập gần đây của bạn đang phù hợp với thói quen tài khoản.",
    riskyUserMessage:
      "Chúng tôi nhận thấy hoạt động đăng nhập khác với thói quen thường ngày. Vui lòng xác minh trước khi tiếp tục thao tác nhạy cảm.",
    normalChallengeCopy: "Hiện tại chưa cần xác minh bổ sung.",
    riskyChallengeCopy:
      "Để bảo vệ tài khoản, vui lòng xác minh trước khi thực hiện thay đổi này.",
  },
  ai: {
    enabled: true,
    model: "",
    fallbackEnabled: true,
  },
});

const isPlainObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

const deepMerge = (base, override) => {
  const out = { ...base };
  Object.entries(override || {}).forEach(([key, value]) => {
    if (value === undefined) return;
    if (isPlainObject(base[key]) && isPlainObject(value)) {
      out[key] = deepMerge(base[key], value);
      return;
    }
    out[key] = value;
  });
  return out;
};

const normalizeSettings = (settings = {}) => {
  const merged = deepMerge(
    DEFAULT_IDENTITY_SECURITY_SETTINGS,
    settings?.toObject ? settings.toObject() : settings,
  );
  merged.analysis.defaultWindowDays = clampInt(
    merged.analysis.defaultWindowDays,
    DEFAULT_DAYS,
    1,
    MAX_DAYS,
  );
  merged.analysis.overviewLimit = clampInt(merged.analysis.overviewLimit, 12, 3, 30);
  merged.analysis.eventLimit = clampInt(merged.analysis.eventLimit, MAX_EVENTS, 20, MAX_EVENTS);
  merged.trust.baseScore = clampInt(merged.trust.baseScore, 65, 0, 100);
  merged.trust.highTrustMin = clampInt(merged.trust.highTrustMin, 85, 0, 100);
  merged.trust.normalMin = clampInt(merged.trust.normalMin, 70, 0, 100);
  merged.trust.watchMin = clampInt(merged.trust.watchMin, 50, 0, 100);
  return merged;
};

export async function getIdentitySecuritySettings() {
  const doc = await IdentitySecuritySettings.findById(IDENTITY_SECURITY_SETTINGS_ID).lean();
  return normalizeSettings(doc || DEFAULT_IDENTITY_SECURITY_SETTINGS);
}

export async function updateIdentitySecuritySettings(input = {}, actorId = null) {
  const current = await getIdentitySecuritySettings();
  const next = normalizeSettings(deepMerge(current, input || {}));
  delete next.createdAt;
  delete next.updatedAt;
  delete next.__v;
  next._id = IDENTITY_SECURITY_SETTINGS_ID;
  next.updatedBy = actorId || null;
  const updatePayload = { ...next };
  delete updatePayload._id;

  const saved = await IdentitySecuritySettings.findByIdAndUpdate(
    IDENTITY_SECURITY_SETTINGS_ID,
    { $set: updatePayload },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();

  return normalizeSettings(saved || next);
}

export function getDefaultIdentitySecuritySettings() {
  return normalizeSettings(DEFAULT_IDENTITY_SECURITY_SETTINGS);
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const toDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const clampInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
};

const hashValue = (value) =>
  crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);

const maskEmail = (value = "") => {
  const email = String(value || "").trim();
  const [name, domain] = email.split("@");
  if (!name || !domain) return email || "No email";
  return `${name.slice(0, 2)}***@${domain}`;
};

const maskPhone = (value = "") => {
  const phone = String(value || "").replace(/\s+/g, "");
  if (!phone) return "No phone";
  if (phone.length <= 4) return phone;
  return `${phone.slice(0, 2)}***${phone.slice(-3)}`;
};

const maskIp = (value = "") => {
  const ip = String(value || "").trim();
  if (!ip) return "Unknown IP";
  if (ip.includes(":")) return `${ip.split(":").slice(0, 2).join(":")}:...`;
  const parts = ip.split(".");
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
};

const compactUserAgent = (ua = "") => {
  const text = String(ua || "").trim();
  if (!text) return "Unknown device";
  const lower = text.toLowerCase();
  const os = lower.includes("android")
    ? "Android"
    : lower.includes("iphone") || lower.includes("ipad")
      ? "iOS"
      : lower.includes("windows")
        ? "Windows"
        : lower.includes("mac os")
          ? "macOS"
          : lower.includes("linux")
            ? "Linux"
            : "Unknown OS";

  const browser = lower.includes("edg/")
    ? "Edge"
    : lower.includes("chrome/")
      ? "Chrome"
      : lower.includes("firefox/")
        ? "Firefox"
        : lower.includes("safari/")
          ? "Safari"
          : lower.includes("okhttp") || lower.includes("reactnative")
            ? "Mobile app"
            : "Unknown client";

  return `${browser} on ${os}`;
};

const countBy = (items, keyFn) => {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (key === undefined || key === null || key === "") return;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
};

const lastSeenBy = (items, keyFn) => {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    const at = toDate(item.at);
    const current = map.get(key);
    if (!current || (at && at > current.lastSeenAt)) {
      map.set(key, { key, lastSeenAt: at, count: (current?.count || 0) + 1 });
      return;
    }
    current.count += 1;
  });
  return Array.from(map.values()).sort(
    (a, b) => (b.lastSeenAt?.getTime() || 0) - (a.lastSeenAt?.getTime() || 0),
  );
};

const normalizeAuthLog = (log) => ({
  id: String(log._id),
  source: "authLog",
  action: log.action || "auth",
  status: log.status || "unknown",
  success: log.status === "success",
  at: log.createdAt,
  ip: log.ip || "",
  ipMasked: maskIp(log.ip),
  userAgent: log.userAgent || "",
  deviceLabel: compactUserAgent(log.userAgent),
  deviceHash: log.userAgent ? hashValue(log.userAgent) : "",
  channel: log.channel || "unknown",
  path: log.path || "",
  method: log.method || "",
  statusCode: log.statusCode || 0,
  loginKey: log.loginKey || "",
  errorMessage: log.errorMessage || "",
});

const normalizeLoginEvent = (event, index) => ({
  id: `loginHistory:${index}:${toDate(event.at)?.getTime() || index}`,
  source: "userLogin",
  action: "login",
  status: event.success === false ? "failed" : "success",
  success: event.success !== false,
  at: event.at,
  ip: event.ip || "",
  ipMasked: maskIp(event.ip),
  userAgent: event.userAgent || "",
  deviceLabel: compactUserAgent(event.userAgent),
  deviceHash: event.userAgent ? hashValue(event.userAgent) : "",
  channel: "session",
  path: "",
  method: event.method || "password",
  statusCode: event.success === false ? 401 : 200,
  loginKey: "",
  errorMessage: "",
});

const getUserDisplayName = (user) =>
  user?.name || user?.nickname || user?.email || user?.phone || String(user?._id || "");

const buildUserLookupFilter = (user) => {
  const identifiers = [user.email, user.phone, user.nickname]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  const or = [
    { user: user._id },
    { "response.userId": String(user._id) },
  ];

  identifiers.forEach((value) => {
    or.push({ loginKey: value });
    or.push({ email: value.toLowerCase() });
    or.push({ phone: value });
    or.push({ nickname: value });
  });

  return { $or: or };
};

const makeEventFilter = (user, since) => ({
  ...buildUserLookupFilter(user),
  createdAt: { $gte: since },
});

const summarizeBaseline = (events, settings = DEFAULT_IDENTITY_SECURITY_SETTINGS) => {
  const rules = settings.rules || DEFAULT_IDENTITY_SECURITY_SETTINGS.rules;
  const sorted = [...events].sort((a, b) => {
    const atA = toDate(a.at)?.getTime() || 0;
    const atB = toDate(b.at)?.getTime() || 0;
    return atB - atA;
  });

  const latest = sorted[0] || null;
  const previous = sorted.slice(1);
  const successEvents = sorted.filter((event) => event.success);
  const failedEvents = sorted.filter((event) => !event.success);
  const now = Date.now();
  const last24h = sorted.filter((event) => {
    const at = toDate(event.at)?.getTime() || 0;
    return now - at <= 24 * 60 * 60 * 1000;
  });
  const failureBurstWindowMinutes =
    rules.failureBurst?.windowMinutes ||
    DEFAULT_IDENTITY_SECURITY_SETTINGS.rules.failureBurst.windowMinutes;
  const lastFailureBurstWindow = sorted.filter((event) => {
    const at = toDate(event.at)?.getTime() || 0;
    return now - at <= failureBurstWindowMinutes * 60 * 1000;
  });

  const hourCounts = countBy(successEvents, (event) => toDate(event.at)?.getHours());
  const dayCounts = countBy(successEvents, (event) => toDate(event.at)?.getDay());
  const channelCounts = countBy(sorted, (event) => event.channel || "unknown");
  const ipCounts = countBy(sorted, (event) => event.ip);
  const deviceCounts = countBy(sorted, (event) => event.deviceHash);
  const priorIps = new Set(previous.map((event) => event.ip).filter(Boolean));
  const priorDevices = new Set(previous.map((event) => event.deviceHash).filter(Boolean));
  const usualHours = hourCounts.slice(0, 4).map((item) => item.key);
  const failedLast24h = last24h.filter((event) => !event.success).length;
  const failedInBurstWindow = lastFailureBurstWindow.filter((event) => !event.success).length;
  const latestHour = latest ? toDate(latest.at)?.getHours() : null;

  const anomalies = [];
  if (
    rules.newIp?.enabled &&
    latest?.ip &&
    previous.length >= (rules.newIp?.threshold || 3) &&
    !priorIps.has(latest.ip)
  ) {
    anomalies.push({
      code: "new_ip",
      severity: rules.newIp?.severity || "medium",
      label: "New IP for this account",
      detail: "The latest auth event came from an IP not seen in the baseline window.",
      penalty: rules.newIp?.penalty || 0,
    });
  }
  if (
    rules.newDevice?.enabled &&
    latest?.deviceHash &&
    previous.length >= (rules.newDevice?.threshold || 3) &&
    !priorDevices.has(latest.deviceHash)
  ) {
    anomalies.push({
      code: "new_device",
      severity: rules.newDevice?.severity || "medium",
      label: "New device fingerprint",
      detail: "The latest auth event used a device fingerprint not seen before.",
      penalty: rules.newDevice?.penalty || 0,
    });
  }
  if (
    rules.failureBurst?.enabled &&
    failedInBurstWindow >= (rules.failureBurst?.threshold || 3)
  ) {
    anomalies.push({
      code: "failure_burst",
      severity: rules.failureBurst?.severity || "high",
      label: "Failure burst",
      detail: `${failedInBurstWindow} failed auth events were seen in the configured burst window.`,
      penalty: rules.failureBurst?.penalty || 0,
    });
  }
  if (
    rules.failedThenSuccess?.enabled &&
    latest?.success &&
    failedEvents.some((event) => {
      const at = toDate(event.at)?.getTime() || 0;
      const latestAt = toDate(latest.at)?.getTime() || 0;
      return (
        latestAt - at >= 0 &&
        latestAt - at <=
          (rules.failedThenSuccess?.windowMinutes || 30) * 60 * 1000
      );
    })
  ) {
    anomalies.push({
      code: "failed_then_success",
      severity: rules.failedThenSuccess?.severity || "medium",
      label: "Failed attempts before success",
      detail: "A successful login happened shortly after failed attempts.",
      penalty: rules.failedThenSuccess?.penalty || 0,
    });
  }
  if (
    rules.offHour?.enabled &&
    latestHour !== null &&
    successEvents.length >= (rules.offHour?.threshold || 8) &&
    usualHours.length > 0 &&
    !usualHours.includes(latestHour)
  ) {
    anomalies.push({
      code: "off_hour",
      severity: rules.offHour?.severity || "low",
      label: "Unusual login hour",
      detail: "The latest event happened outside the account's usual login hours.",
      penalty: rules.offHour?.penalty || 0,
    });
  }

  return {
    latest,
    totals: {
      events: sorted.length,
      success: successEvents.length,
      failed: failedEvents.length,
      failedLast24h,
      failedInBurstWindow,
      uniqueIps: ipCounts.length,
      uniqueDevices: deviceCounts.length,
    },
    usualHours,
    activeDays: dayCounts.slice(0, 7),
    channels: channelCounts.slice(0, 8),
    topIps: ipCounts.slice(0, 8).map((item) => ({
      ...item,
      masked: maskIp(item.key),
    })),
    topDevices: deviceCounts.slice(0, 8).map((item) => {
      const match = sorted.find((event) => event.deviceHash === item.key);
      return {
        key: item.key,
        count: item.count,
        label: match?.deviceLabel || "Unknown device",
      };
    }),
    anomalies,
  };
};

const buildSessionForensics = (loginHistory = [], authEvents = []) => {
  const historySessions = loginHistory.map((event, index) => {
    const normalized = normalizeLoginEvent(event, index);
    const at = toDate(normalized.at);
    const flags = [];
    if (!normalized.success) flags.push("failed");
    if (!normalized.ip) flags.push("missing_ip");
    if (!normalized.userAgent) flags.push("missing_user_agent");

    return {
      id: hashValue(`${normalized.ip}:${normalized.userAgent}:${at?.toISOString() || index}`),
      at,
      method: normalized.method,
      success: normalized.success,
      ipMasked: normalized.ipMasked,
      device: normalized.deviceLabel,
      deviceHash: normalized.deviceHash,
      flags,
      ageHours: at ? Math.round((Date.now() - at.getTime()) / 360_000) / 10 : null,
    };
  });

  const authSessions = authEvents
    .filter((event) => event.action === "login")
    .slice(0, 50)
    .map((event) => {
      const at = toDate(event.at);
      const flags = [];
      if (!event.success) flags.push("failed");
      if (event.statusCode >= 400) flags.push(`http_${event.statusCode}`);

      return {
        id: event.id,
        at,
        method: event.method || "password",
        success: event.success,
        ipMasked: event.ipMasked,
        device: event.deviceLabel,
        deviceHash: event.deviceHash,
        flags,
        ageHours: at ? Math.round((Date.now() - at.getTime()) / 360_000) / 10 : null,
      };
    });

  const merged = [...historySessions, ...authSessions]
    .filter((item) => item.at)
    .sort((a, b) => b.at - a.at);

  const seen = new Set();
  const sessions = [];
  merged.forEach((item) => {
    const key = `${item.at?.getTime()}:${item.ipMasked}:${item.deviceHash}:${item.success}`;
    if (seen.has(key)) return;
    seen.add(key);
    sessions.push(item);
  });

  const deviceChanges = lastSeenBy(sessions, (session) => session.deviceHash).length;
  const ipChanges = lastSeenBy(sessions, (session) => session.ipMasked).length;
  const failedSessions = sessions.filter((session) => !session.success).length;

  return {
    summary: {
      sessions: sessions.length,
      failedSessions,
      deviceChanges,
      ipChanges,
      latestAt: sessions[0]?.at || null,
    },
    sessions: sessions.slice(0, 20),
  };
};

const buildIdentityGraph = ({ user, events, relatedAccounts }) => {
  const userNodeId = `user:${user._id}`;
  const nodes = [
    {
      id: userNodeId,
      type: "user",
      label: getUserDisplayName(user),
      meta: {
        role: user.role || "user",
        status: user.isDeleted ? "deleted" : "active",
      },
    },
  ];
  const edges = [];
  const addNode = (node) => {
    if (nodes.some((item) => item.id === node.id)) return;
    nodes.push(node);
  };
  const addEdge = (edge) => {
    const existing = edges.find(
      (item) => item.source === edge.source && item.target === edge.target && item.type === edge.type,
    );
    if (existing) {
      existing.weight += edge.weight || 1;
      if (edge.lastSeenAt && (!existing.lastSeenAt || edge.lastSeenAt > existing.lastSeenAt)) {
        existing.lastSeenAt = edge.lastSeenAt;
      }
      return;
    }
    edges.push({ ...edge, weight: edge.weight || 1 });
  };

  if (user.email) {
    const id = `email:${hashValue(user.email)}`;
    addNode({ id, type: "email", label: maskEmail(user.email) });
    addEdge({ source: userNodeId, target: id, type: "owns_email", weight: 1 });
  }
  if (user.phone) {
    const id = `phone:${hashValue(user.phone)}`;
    addNode({ id, type: "phone", label: maskPhone(user.phone) });
    addEdge({ source: userNodeId, target: id, type: "owns_phone", weight: 1 });
  }

  countBy(events, (event) => event.ip)
    .slice(0, 10)
    .forEach((item) => {
      const id = `ip:${hashValue(item.key)}`;
      const lastSeen = events.find((event) => event.ip === item.key)?.at || null;
      addNode({ id, type: "ip", label: maskIp(item.key) });
      addEdge({
        source: userNodeId,
        target: id,
        type: "used_ip",
        weight: item.count,
        lastSeenAt: toDate(lastSeen),
      });
    });

  countBy(events, (event) => event.deviceHash)
    .slice(0, 10)
    .forEach((item) => {
      const match = events.find((event) => event.deviceHash === item.key);
      const id = `device:${item.key}`;
      addNode({ id, type: "device", label: match?.deviceLabel || "Unknown device" });
      addEdge({
        source: userNodeId,
        target: id,
        type: "used_device",
        weight: item.count,
        lastSeenAt: toDate(match?.at),
      });
    });

  relatedAccounts.slice(0, 8).forEach((account) => {
    const accountNodeId = `related_user:${account.userId}`;
    addNode({
      id: accountNodeId,
      type: "related_user",
      label: account.name || account.email || account.phone || String(account.userId),
      meta: {
        sharedEvents: account.sharedEvents || 0,
      },
    });

    (account.sharedIps || []).slice(0, 3).forEach((ip) => {
      const ipNodeId = `ip:${hashValue(ip)}`;
      addNode({ id: ipNodeId, type: "ip", label: maskIp(ip) });
      addEdge({
        source: accountNodeId,
        target: ipNodeId,
        type: "shared_ip",
        weight: 1,
        lastSeenAt: toDate(account.lastSeenAt),
      });
    });
  });

  return {
    nodes,
    edges,
    summary: {
      nodes: nodes.length,
      edges: edges.length,
      relatedAccounts: relatedAccounts.length,
      ips: nodes.filter((node) => node.type === "ip").length,
      devices: nodes.filter((node) => node.type === "device").length,
    },
  };
};

const scoreTrust = ({
  user,
  baseline,
  relatedAccounts,
  sessions,
  settings = DEFAULT_IDENTITY_SECURITY_SETTINGS,
}) => {
  const trustConfig = settings.trust || DEFAULT_IDENTITY_SECURITY_SETTINGS.trust;
  const rules = settings.rules || DEFAULT_IDENTITY_SECURITY_SETTINGS.rules;
  let score = trustConfig.baseScore;
  const positive = [];
  const negative = [];

  const createdAt = toDate(user.createdAt);
  const accountAgeDays = createdAt
    ? Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000))
    : 0;

  if (accountAgeDays >= trustConfig.matureAccountDays) {
    score += trustConfig.matureAccountBonus;
    positive.push("Mature account age");
  } else if (accountAgeDays < trustConfig.newAccountDays) {
    score -= trustConfig.newAccountPenalty;
    negative.push("Very new account");
  }

  if (user.verified === "verified") {
    score += trustConfig.verifiedBonus;
    positive.push("Account is verified");
  }
  if (user.cccdStatus === "verified") {
    score += trustConfig.kycBonus;
    positive.push("KYC is verified");
  }
  if (user.phoneVerified === true) {
    score += trustConfig.phoneVerifiedBonus;
    positive.push("Phone is verified");
  }

  if (baseline.totals.success >= 5 && baseline.totals.uniqueDevices <= 3) {
    score += trustConfig.stableDeviceBonus;
    positive.push("Stable device baseline");
  }
  if (baseline.totals.failedLast24h > 0) {
    const penalty = Math.min(
      trustConfig.failedAuthPenaltyMax,
      baseline.totals.failedLast24h * trustConfig.failedAuthPenaltyEach,
    );
    score -= penalty;
    negative.push(`${baseline.totals.failedLast24h} failed auth events in 24h`);
  }

  baseline.anomalies.forEach((anomaly) => {
    const penalty =
      anomaly.penalty ||
      (anomaly.severity === "high" ? 14 : anomaly.severity === "medium" ? 8 : 4);
    score -= penalty;
    negative.push(anomaly.label);
  });

  if (
    rules.sharedAccounts?.enabled &&
    relatedAccounts.length >= (rules.sharedAccounts?.threshold || 3)
  ) {
    score -= rules.sharedAccounts?.penalty || 8;
    negative.push("Several accounts share identity signals");
  }
  if (
    rules.deviceChanges?.enabled &&
    sessions.summary.deviceChanges >= (rules.deviceChanges?.threshold || 5)
  ) {
    score -= rules.deviceChanges?.penalty || 6;
    negative.push("Many device changes in recent sessions");
  }
  if (user.isDeleted || user.deletedAt) {
    score -= 30;
    negative.push("Account is disabled or deleted");
  }

  score = clamp(Math.round(score), 0, 100);
  const level =
    score >= trustConfig.highTrustMin
      ? "high_trust"
      : score >= trustConfig.normalMin
        ? "normal"
        : score >= trustConfig.watchMin
          ? "watch"
          : "high_risk";
  const recommendedAction =
    level === "high_risk"
      ? settings.actions?.highRisk || "challenge"
      : level === "watch"
        ? settings.actions?.watch || "monitor"
        : level === "high_trust"
          ? settings.actions?.highTrust || "allow"
          : settings.actions?.normal || "allow";

  return {
    score,
    level,
    recommendedAction,
    positive: positive.slice(0, 5),
    negative: negative.slice(0, 6),
  };
};

const buildExplainableSecurityUx = ({
  trust,
  baseline,
  sessions,
  settings = DEFAULT_IDENTITY_SECURITY_SETTINGS,
}) => {
  const copy = settings.explainableUx || DEFAULT_IDENTITY_SECURITY_SETTINGS.explainableUx;
  const risky = trust.level === "high_risk" || trust.level === "watch";
  const userMessage = risky ? copy.riskyUserMessage : copy.normalUserMessage;

  const adminSummary = [
    `Trust score ${trust.score}/100 (${trust.level}).`,
    `${baseline.totals.events} auth events in the analysis window.`,
    `${baseline.totals.failedLast24h} failed auth events in the last 24 hours.`,
    `${sessions.summary.deviceChanges} device fingerprints and ${sessions.summary.ipChanges} IP groups observed in session history.`,
  ];

  const actions =
    trust.recommendedAction === "challenge"
      ? ["Require re-authentication", "Ask the user to confirm recent activity", "Review shared IP/device graph"]
      : trust.recommendedAction === "monitor"
        ? ["Keep monitoring the next login", "Use step-up verification for sensitive changes"]
        : ["Allow normal access", "Keep baseline collection active"];

  return {
    userMessage,
    adminSummary,
    suggestedActions: actions,
    challengeCopy: risky ? copy.riskyChallengeCopy : copy.normalChallengeCopy,
  };
};

const loadRelatedAccounts = async ({ user, events, since }) => {
  const topIps = countBy(events, (event) => event.ip)
    .slice(0, 6)
    .map((item) => item.key)
    .filter(Boolean);
  const topUserAgents = countBy(events, (event) => event.userAgent)
    .slice(0, 6)
    .map((item) => item.key)
    .filter(Boolean);

  if (!topIps.length && !topUserAgents.length) return [];

  const matchOr = [];
  if (topIps.length) matchOr.push({ ip: { $in: topIps } });
  if (topUserAgents.length) matchOr.push({ userAgent: { $in: topUserAgents } });

  const rows = await AuthLog.aggregate([
    {
      $match: {
        createdAt: { $gte: since },
        user: {
          $exists: true,
          $nin: [null, new mongoose.Types.ObjectId(user._id)],
        },
        $or: matchOr,
      },
    },
    {
      $group: {
        _id: "$user",
        sharedEvents: { $sum: 1 },
        lastSeenAt: { $max: "$createdAt" },
        sharedIps: { $addToSet: "$ip" },
        sharedDevices: { $addToSet: "$userAgent" },
      },
    },
    { $sort: { sharedEvents: -1, lastSeenAt: -1 } },
    { $limit: 12 },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        userId: "$_id",
        sharedEvents: 1,
        lastSeenAt: 1,
        sharedIps: 1,
        sharedDevices: 1,
        name: "$user.name",
        nickname: "$user.nickname",
        email: "$user.email",
        phone: "$user.phone",
      },
    },
  ]);

  return rows.map((row) => ({
    ...row,
    userId: String(row.userId),
    email: row.email ? maskEmail(row.email) : "",
    phone: row.phone ? maskPhone(row.phone) : "",
    sharedIps: (row.sharedIps || []).filter(Boolean),
    sharedDevices: (row.sharedDevices || []).filter(Boolean).map(hashValue),
  }));
};

export async function buildIdentitySecuritySnapshot({
  userId,
  days = DEFAULT_DAYS,
  eventLimit = MAX_EVENTS,
} = {}) {
  if (!mongoose.isValidObjectId(String(userId || ""))) {
    const err = new Error("Invalid userId");
    err.statusCode = 400;
    throw err;
  }

  const resolvedDays = clampInt(days, DEFAULT_DAYS, 1, MAX_DAYS);
  const settings = await getIdentitySecuritySettings();
  const limit = clampInt(eventLimit, settings.analysis.eventLimit, 20, MAX_EVENTS);
  const since = new Date(Date.now() - resolvedDays * 24 * 60 * 60 * 1000);

  const user = await User.findById(userId)
    .select(
      "_id name nickname email phone role verified cccdStatus phoneVerified isDeleted deletedAt createdAt updatedAt",
    )
    .lean();

  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    throw err;
  }

  const [authLogs, loginDoc] = await Promise.all([
    AuthLog.find(makeEventFilter(user, since)).sort({ createdAt: -1 }).limit(limit).lean(),
    UserLogin.findOne({ user: user._id }).lean(),
  ]);

  const loginHistory = Array.isArray(loginDoc?.loginHistory)
    ? loginDoc.loginHistory.slice(0, 80)
    : [];

  const authEvents = authLogs.map(normalizeAuthLog);
  const loginEvents = loginHistory.map(normalizeLoginEvent);
  const events = [...authEvents, ...loginEvents]
    .filter((event) => toDate(event.at))
    .sort((a, b) => (toDate(b.at)?.getTime() || 0) - (toDate(a.at)?.getTime() || 0))
    .slice(0, limit);

  const relatedAccounts = await loadRelatedAccounts({ user, events, since });
  const baseline = summarizeBaseline(events, settings);
  const sessions = buildSessionForensics(loginHistory, authEvents);
  const graph = buildIdentityGraph({ user, events, relatedAccounts });
  const trust = scoreTrust({ user, baseline, relatedAccounts, sessions, settings });
  const explainableUx = buildExplainableSecurityUx({ trust, baseline, sessions, settings });

  return {
    user: {
      _id: String(user._id),
      name: user.name || "",
      nickname: user.nickname || "",
      email: maskEmail(user.email),
      phone: maskPhone(user.phone),
      role: user.role || "user",
      verified: user.verified || "",
      cccdStatus: user.cccdStatus || "",
      phoneVerified: Boolean(user.phoneVerified),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    window: {
      days: resolvedDays,
      since,
      generatedAt: new Date(),
    },
    settings: {
      enabled: settings.enabled,
      analysis: settings.analysis,
      actions: settings.actions,
      ai: {
        enabled: settings.ai?.enabled,
        model: settings.ai?.model || "",
        fallbackEnabled: settings.ai?.fallbackEnabled,
      },
    },
    graph,
    baseline,
    sessions,
    trust,
    explainableUx,
    relatedAccounts,
    events: events.slice(0, 80).map((event) => ({
      ...event,
      ip: undefined,
      userAgent: undefined,
    })),
  };
}

export function toUserSafeSnapshot(snapshot) {
  return {
    user: snapshot.user,
    window: snapshot.window,
    trust: snapshot.trust,
    baseline: {
      totals: snapshot.baseline.totals,
      anomalies: snapshot.baseline.anomalies.map((item) => ({
        code: item.code,
        severity: item.severity,
        label: item.label,
      })),
    },
    sessions: {
      summary: snapshot.sessions.summary,
      sessions: snapshot.sessions.sessions.slice(0, 8).map((session) => ({
        at: session.at,
        method: session.method,
        success: session.success,
        device: session.device,
        flags: session.flags,
      })),
    },
    explainableUx: {
      userMessage: snapshot.explainableUx.userMessage,
      challengeCopy: snapshot.explainableUx.challengeCopy,
    },
  };
}

export async function buildIdentitySecurityOverview({ days = DEFAULT_DAYS, limit = 12 } = {}) {
  const settings = await getIdentitySecuritySettings();
  const resolvedDays = clampInt(days, settings.analysis.defaultWindowDays, 1, MAX_DAYS);
  const resolvedLimit = clampInt(limit, settings.analysis.overviewLimit, 3, 30);
  const since = new Date(Date.now() - resolvedDays * 24 * 60 * 60 * 1000);

  const [totalEvents, failedEvents, successEvents, recentLogs] = await Promise.all([
    AuthLog.countDocuments({ createdAt: { $gte: since } }),
    AuthLog.countDocuments({ createdAt: { $gte: since }, status: "failed" }),
    AuthLog.countDocuments({ createdAt: { $gte: since }, status: "success" }),
    AuthLog.find({ createdAt: { $gte: since }, user: { $exists: true, $ne: null } })
      .sort({ createdAt: -1 })
      .limit(500)
      .select("user createdAt status ip userAgent")
      .lean(),
  ]);

  const userIds = [];
  const seen = new Set();
  recentLogs.forEach((log) => {
    const id = String(log.user || "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    userIds.push(id);
  });

  const snapshots = await Promise.all(
    userIds.slice(0, resolvedLimit).map((id) =>
      buildIdentitySecuritySnapshot({
        userId: id,
        days: resolvedDays,
        eventLimit: 120,
      }).catch(() => null),
    ),
  );

  const accounts = snapshots
    .filter(Boolean)
    .map((snapshot) => ({
      user: snapshot.user,
      trust: snapshot.trust,
      baseline: {
        totals: snapshot.baseline.totals,
        anomalies: snapshot.baseline.anomalies,
      },
      graphSummary: snapshot.graph.summary,
      sessionSummary: snapshot.sessions.summary,
      explainableUx: snapshot.explainableUx,
    }))
    .sort((a, b) => a.trust.score - b.trust.score);

  return {
    window: {
      days: resolvedDays,
      since,
      generatedAt: new Date(),
    },
    settings: {
      enabled: settings.enabled,
      analysis: settings.analysis,
    },
    summary: {
      totalEvents,
      failedEvents,
      successEvents,
      failureRate: totalEvents ? Math.round((failedEvents / totalEvents) * 1000) / 10 : 0,
      accountsScanned: accounts.length,
      watchAccounts: accounts.filter((item) => ["watch", "high_risk"].includes(item.trust.level)).length,
    },
    accounts,
  };
}

const extractJson = (text = "") => {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch {
      return null;
    }
  }
};

export async function buildAiIdentityExplanation({ snapshot, audience = "admin" } = {}) {
  const settings = await getIdentitySecuritySettings();
  const input = {
    audience,
    user: snapshot.user,
    trust: snapshot.trust,
    baseline: {
      totals: snapshot.baseline.totals,
      anomalies: snapshot.baseline.anomalies,
      channels: snapshot.baseline.channels,
      topDevices: snapshot.baseline.topDevices,
    },
    graph: snapshot.graph.summary,
    sessions: snapshot.sessions.summary,
    relatedAccounts: snapshot.relatedAccounts.map((account) => ({
      userId: account.userId,
      sharedEvents: account.sharedEvents,
      sharedIpCount: account.sharedIps?.length || 0,
    })),
  };

  const fallback = {
    source: "fallback",
    summary: snapshot.explainableUx.adminSummary.join(" "),
    confidence: "medium",
    bullets: snapshot.trust.negative.length
      ? snapshot.trust.negative
      : ["No major account anomaly was found in the current analysis window."],
    recommendedActions: snapshot.explainableUx.suggestedActions,
    userFacingMessage: snapshot.explainableUx.userMessage,
  };

  if (!settings.ai?.enabled) {
    return {
      ...fallback,
      source: "disabled",
      summary: `${fallback.summary} AI explanation is disabled in Identity Security settings.`,
    };
  }

  try {
    const response = await openai.chat.completions.create({
      model:
        settings.ai?.model ||
        process.env.IDENTITY_SECURITY_AI_MODEL ||
        OPENAI_DEFAULT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an identity security analyst. Return compact JSON only with keys: summary, confidence, bullets, recommendedActions, userFacingMessage. Do not reveal raw IPs, tokens, cookies, or exact detection thresholds.",
        },
        {
          role: "user",
          content: JSON.stringify(input),
        },
      ],
    });

    const content = response?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(content);
    if (!parsed) return fallback;

    return {
      source: "ai",
      summary: String(parsed.summary || fallback.summary),
      confidence: String(parsed.confidence || fallback.confidence),
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 6) : fallback.bullets,
      recommendedActions: Array.isArray(parsed.recommendedActions)
        ? parsed.recommendedActions.slice(0, 6)
        : fallback.recommendedActions,
      userFacingMessage: String(parsed.userFacingMessage || fallback.userFacingMessage),
    };
  } catch (error) {
    if (settings.ai?.fallbackEnabled === false) {
      throw error;
    }

    return {
      ...fallback,
      error: error?.message || "AI explanation failed",
    };
  }
}
