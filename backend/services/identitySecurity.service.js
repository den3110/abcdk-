import crypto from "crypto";
import mongoose from "mongoose";
import AuthLog from "../models/authLogModel.js";
import User from "../models/userModel.js";
import UserLogin from "../models/userLoginModel.js";
import { openai, OPENAI_DEFAULT_MODEL } from "../lib/openaiClient.js";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 180;
const MAX_EVENTS = 240;

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
    if (!key) return;
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

const summarizeBaseline = (events) => {
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
  const last15m = sorted.filter((event) => {
    const at = toDate(event.at)?.getTime() || 0;
    return now - at <= 15 * 60 * 1000;
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
  const failedLast15m = last15m.filter((event) => !event.success).length;
  const latestHour = latest ? toDate(latest.at)?.getHours() : null;

  const anomalies = [];
  if (latest?.ip && previous.length >= 3 && !priorIps.has(latest.ip)) {
    anomalies.push({
      code: "new_ip",
      severity: "medium",
      label: "New IP for this account",
      detail: "The latest auth event came from an IP not seen in the baseline window.",
    });
  }
  if (latest?.deviceHash && previous.length >= 3 && !priorDevices.has(latest.deviceHash)) {
    anomalies.push({
      code: "new_device",
      severity: "medium",
      label: "New device fingerprint",
      detail: "The latest auth event used a device fingerprint not seen before.",
    });
  }
  if (failedLast15m >= 3) {
    anomalies.push({
      code: "failure_burst",
      severity: "high",
      label: "Failure burst",
      detail: `${failedLast15m} failed auth events were seen in the last 15 minutes.`,
    });
  }
  if (
    latest?.success &&
    failedEvents.some((event) => {
      const at = toDate(event.at)?.getTime() || 0;
      const latestAt = toDate(latest.at)?.getTime() || 0;
      return latestAt - at >= 0 && latestAt - at <= 30 * 60 * 1000;
    })
  ) {
    anomalies.push({
      code: "failed_then_success",
      severity: "medium",
      label: "Failed attempts before success",
      detail: "A successful login happened shortly after failed attempts.",
    });
  }
  if (
    latestHour !== null &&
    successEvents.length >= 8 &&
    usualHours.length > 0 &&
    !usualHours.includes(latestHour)
  ) {
    anomalies.push({
      code: "off_hour",
      severity: "low",
      label: "Unusual login hour",
      detail: "The latest event happened outside the account's usual login hours.",
    });
  }

  return {
    latest,
    totals: {
      events: sorted.length,
      success: successEvents.length,
      failed: failedEvents.length,
      failedLast24h,
      failedLast15m,
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
      ageHours: at ? Math.round((Date.now() - at.getTime()) / 36_000) / 10 : null,
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
        ageHours: at ? Math.round((Date.now() - at.getTime()) / 36_000) / 10 : null,
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

const scoreTrust = ({ user, baseline, relatedAccounts, sessions }) => {
  let score = 65;
  const positive = [];
  const negative = [];

  const createdAt = toDate(user.createdAt);
  const accountAgeDays = createdAt
    ? Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000))
    : 0;

  if (accountAgeDays >= 180) {
    score += 8;
    positive.push("Mature account age");
  } else if (accountAgeDays < 7) {
    score -= 8;
    negative.push("Very new account");
  }

  if (user.verified === "verified") {
    score += 5;
    positive.push("Account is verified");
  }
  if (user.cccdStatus === "verified") {
    score += 6;
    positive.push("KYC is verified");
  }
  if (user.phoneVerified === true) {
    score += 5;
    positive.push("Phone is verified");
  }

  if (baseline.totals.success >= 5 && baseline.totals.uniqueDevices <= 3) {
    score += 5;
    positive.push("Stable device baseline");
  }
  if (baseline.totals.failedLast24h > 0) {
    const penalty = Math.min(18, baseline.totals.failedLast24h * 3);
    score -= penalty;
    negative.push(`${baseline.totals.failedLast24h} failed auth events in 24h`);
  }

  baseline.anomalies.forEach((anomaly) => {
    const penalty = anomaly.severity === "high" ? 14 : anomaly.severity === "medium" ? 8 : 4;
    score -= penalty;
    negative.push(anomaly.label);
  });

  if (relatedAccounts.length >= 3) {
    score -= 8;
    negative.push("Several accounts share identity signals");
  }
  if (sessions.summary.deviceChanges >= 5) {
    score -= 6;
    negative.push("Many device changes in recent sessions");
  }
  if (user.isDeleted || user.deletedAt) {
    score -= 30;
    negative.push("Account is disabled or deleted");
  }

  score = clamp(Math.round(score), 0, 100);
  const level =
    score >= 85 ? "high_trust" : score >= 70 ? "normal" : score >= 50 ? "watch" : "high_risk";
  const recommendedAction =
    level === "high_risk"
      ? "challenge"
      : level === "watch"
        ? "monitor"
        : "allow";

  return {
    score,
    level,
    recommendedAction,
    positive: positive.slice(0, 5),
    negative: negative.slice(0, 6),
  };
};

const buildExplainableSecurityUx = ({ trust, baseline, sessions }) => {
  const risky = trust.level === "high_risk" || trust.level === "watch";
  const userMessage = risky
    ? "We noticed sign-in activity that differs from your usual pattern. Please confirm this was you before continuing sensitive actions."
    : "Your recent sign-in pattern looks consistent with your normal account activity.";

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
    challengeCopy: risky
      ? "For your safety, please verify your account before making this change."
      : "No extra verification is needed right now.",
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
          $ne: null,
          $ne: new mongoose.Types.ObjectId(user._id),
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
  const limit = clampInt(eventLimit, MAX_EVENTS, 20, MAX_EVENTS);
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
  const baseline = summarizeBaseline(events);
  const sessions = buildSessionForensics(loginHistory, authEvents);
  const graph = buildIdentityGraph({ user, events, relatedAccounts });
  const trust = scoreTrust({ user, baseline, relatedAccounts, sessions });
  const explainableUx = buildExplainableSecurityUx({ trust, baseline, sessions });

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
  const resolvedDays = clampInt(days, DEFAULT_DAYS, 1, MAX_DAYS);
  const resolvedLimit = clampInt(limit, 12, 3, 30);
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

  try {
    const response = await openai.chat.completions.create({
      model: process.env.IDENTITY_SECURITY_AI_MODEL || OPENAI_DEFAULT_MODEL,
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
    return {
      ...fallback,
      error: error?.message || "AI explanation failed",
    };
  }
}
