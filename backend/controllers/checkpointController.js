import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import CheckpointEvent from "../models/checkpointEventModel.js";
import CheckpointSession from "../models/checkpointSessionModel.js";
import User from "../models/userModel.js";
import {
  buildCheckpointAuthPayload,
  getActiveCheckpointSessionForUser,
  getCurrentCheckpointRequirementForUser,
  getCheckpointPolicySummary,
  getCheckpointSessionByToken,
  getPublicCheckpointSession,
  recordCheckpointEvent,
  resendCheckpointCode,
  startCheckpointVerification,
  simulateCheckpointRiskDecision,
  submitCheckpointEvidence,
  verifyPhoneOtpFactor,
} from "../services/checkpoint.service.js";
import {
  getCheckpointSettings,
  getDefaultCheckpointSettings,
  updateCheckpointSettings,
} from "../services/checkpointSettings.service.js";
import {
  cancelActiveCheckpointMandatesForUser,
  cancelCheckpointMandate,
  consumeCheckpointMandate,
  createCheckpointMandate,
  listCheckpointMandates,
  normalizeCheckpointMandateForAdmin,
  resolveMandateUser,
} from "../services/checkpointMandate.service.js";
import generateToken from "../utils/generateToken.js";
import { toPublicUrl } from "../utils/publicUrl.js";
import { sendCheckpointReviewDecisionEmail } from "../services/emailService.js";

const cleanToken = (req) =>
  String(req.params?.token || req.body?.token || req.query?.token || "").trim();

const SESSION_STATUSES = new Set([
  "pending",
  "passed",
  "failed",
  "expired",
  "cancelled",
  "review_required",
]);
const EVENT_CATEGORIES = new Set([
  "auth",
  "admin_route",
  "spam",
  "abuse",
  "checkpoint",
  "client_signal",
  "rate_limit",
  "system",
]);
const EVENT_OUTCOMES = new Set([
  "success",
  "failed",
  "denied",
  "blocked",
  "rate_limited",
  "suspicious",
  "observed",
]);
const EVENT_SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);

const clampInt = (value, fallback, min, max) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const dateFromQuery = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const normalizeUserForAdmin = (user) => {
  if (!user) return null;
  const rawId = user._id || user.id || user;
  if (typeof user !== "object" || user instanceof mongoose.Types.ObjectId) {
    return { _id: String(rawId || "") };
  }
  return {
    _id: String(rawId || ""),
    name: user.name || "",
    nickname: user.nickname || "",
    email: user.email || "",
    phone: user.phone || "",
    avatar: user.avatar || "",
    role: user.role || "",
    isSuperUser: Boolean(user.isSuperUser || user.isSuperAdmin),
  };
};

const normalizeSessionForAdmin = (session = {}) => ({
  _id: String(session._id || ""),
  user: normalizeUserForAdmin(session.user),
  mandate: session.mandate ? String(session.mandate._id || session.mandate) : "",
  type: session.type || "login",
  channel: session.channel || "unknown",
  status: session.status || "pending",
  level: Number(session.level || 1),
  factors: Array.isArray(session.factors) ? session.factors : [],
  evidence: Array.isArray(session.evidence) ? session.evidence : [],
  risk: session.risk || {},
  delivery: {
    method: session.delivery?.method || "",
    targetMasked: session.delivery?.targetMasked || "",
    lastSentAt: session.delivery?.lastSentAt || null,
    sendCount: Number(session.delivery?.sendCount || 0),
    tranId: session.delivery?.tranId || "",
    cost: Number(session.delivery?.cost || 0),
  },
  attempts: Number(session.attempts || 0),
  maxAttempts: Number(session.maxAttempts || 0),
  expiresAt: session.expiresAt || null,
  codeExpiresAt: session.codeExpiresAt || null,
  resendAvailableAt: session.resendAvailableAt || null,
  passedAt: session.passedAt || null,
  failedAt: session.failedAt || null,
  trustExpiresAt: session.trustExpiresAt || null,
  review: {
    decision: session.review?.decision || "",
    note: session.review?.note || "",
    reviewedBy: normalizeUserForAdmin(session.review?.reviewedBy),
    reviewedAt: session.review?.reviewedAt || null,
  },
  request: session.request || {},
  createdAt: session.createdAt || null,
  updatedAt: session.updatedAt || null,
});

const normalizeEventForAdmin = (event = {}) => ({
  _id: String(event._id || ""),
  user: normalizeUserForAdmin(event.user),
  subjectUser: normalizeUserForAdmin(event.subjectUser),
  type: event.type || "",
  category: event.category || "system",
  outcome: event.outcome || "observed",
  severity: event.severity || "low",
  weight: Number(event.weight || 0),
  ip: event.ip || "",
  userAgent: event.userAgent || "",
  deviceId: event.deviceId || "",
  deviceName: event.deviceName || "",
  method: event.method || "",
  path: event.path || "",
  routeGroup: event.routeGroup || "",
  target: event.target || {},
  metadata: event.metadata || {},
  createdAt: event.createdAt || null,
  updatedAt: event.updatedAt || null,
});

const normalizeCurrentMandateForClient = (mandate = {}) => {
  if (!mandate) return null;
  return {
    id: String(mandate._id || mandate.id || ""),
    level: Number(mandate.level || 1),
    reason: mandate.reason || "",
    expiresAt: mandate.expiresAt || null,
    createdAt: mandate.createdAt || null,
  };
};

const findUserIdsByKeyword = async (keyword) => {
  const q = String(keyword || "").trim();
  if (!q) return [];
  const ids = [];
  if (mongoose.isValidObjectId(q)) ids.push(new mongoose.Types.ObjectId(q));

  const rx = new RegExp(escapeRegex(q), "i");
  const users = await User.find({
    $or: [{ name: rx }, { nickname: rx }, { email: rx }, { phone: rx }],
  })
    .select("_id")
    .limit(50)
    .lean();

  users.forEach((user) => ids.push(user._id));
  return Array.from(new Set(ids.map(String))).map((id) => new mongoose.Types.ObjectId(id));
};

const buildCreatedAtRange = ({ days, from, to }) => {
  const range = {};
  const sinceDays = clampInt(days, 0, 0, 365);
  if (sinceDays > 0) {
    range.$gte = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  }

  const fromDate = dateFromQuery(from);
  if (fromDate) range.$gte = fromDate;

  const toDate = dateFromQuery(to);
  if (toDate) range.$lte = toDate;

  return Object.keys(range).length ? range : null;
};

const countMap = (rows = []) =>
  rows.reduce((acc, row) => {
    acc[String(row._id || "unknown")] = row.count || 0;
    return acc;
  }, {});

const levelCountMap = (rows = []) =>
  rows.reduce((acc, row) => {
    acc[`level${row._id || 0}`] = row.count || 0;
    return acc;
  }, {});

export const getCheckpointStatus = asyncHandler(async (req, res) => {
  const token = cleanToken(req);
  if (!token) {
    res.status(400);
    throw new Error("Thiếu checkpoint token.");
  }

  const checkpoint = await getPublicCheckpointSession(token);
  if (checkpoint.status !== "passed") {
    res.json(checkpoint);
    return;
  }

  const session = await getCheckpointSessionByToken(token);
  if (session.expiresAt && session.expiresAt <= new Date()) {
    res.json(checkpoint);
    return;
  }

  const user = await User.findById(session.user);
  if (!user || user.isDeleted) {
    res.json(checkpoint);
    return;
  }

  generateToken(res, user);
  res.json({
    ...checkpoint,
    authenticated: true,
    user: {
      ...buildCheckpointAuthPayload(user),
      checkpointPassed: true,
      checkpointTrustExpiresAt: session.trustExpiresAt?.toISOString?.() || null,
    },
  });
});

export const resendCheckpointOtp = asyncHandler(async (req, res) => {
  const token = cleanToken(req);
  if (!token) {
    res.status(400);
    throw new Error("Thiếu checkpoint token.");
  }

  res.json(await resendCheckpointCode({ token, req }));
});

export const startCheckpointOtp = asyncHandler(async (req, res) => {
  const token = cleanToken(req);
  if (!token) {
    res.status(400);
    throw new Error("Thiếu checkpoint token.");
  }

  res.json(await startCheckpointVerification({ token, req }));
});

export const verifyCheckpointPhone = asyncHandler(async (req, res) => {
  const token = cleanToken(req);
  const code = req.body?.code || req.body?.otp;
  if (!token) {
    res.status(400);
    throw new Error("Thiếu checkpoint token.");
  }

  res.json(await verifyPhoneOtpFactor({ token, code, req, res }));
});

const flattenFiles = (files = {}) => {
  if (Array.isArray(files)) return files;
  return Object.values(files).flat().filter(Boolean);
};

export const uploadCheckpointEvidence = asyncHandler(async (req, res) => {
  const token = cleanToken(req);
  const factor = String(req.body?.factor || "").trim();
  if (!token) {
    res.status(400);
    throw new Error("Thiếu checkpoint token.");
  }
  if (!["cccd_upload", "face_video"].includes(factor)) {
    res.status(400);
    throw new Error("Loại xác minh không hợp lệ.");
  }

  const evidence = flattenFiles(req.files).map((file) => ({
    factor,
    kind: String(file.fieldname || ""),
    url: toPublicUrl(req, `/uploads/checkpoints/${file.filename}`),
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    uploadedAt: new Date(),
  }));

  res.json(
    await submitCheckpointEvidence({
      token,
      factor,
      evidence,
      req,
      res,
    })
  );
});

export const recordClientCheckpointEvent = asyncHandler(async (req, res) => {
  const type = String(req.body?.type || "").trim();
  if (!type) {
    res.status(400);
    throw new Error("Thiếu loại sự kiện checkpoint.");
  }

  await recordCheckpointEvent({
    req,
    user: req.user || null,
    subjectUser: req.user || null,
    type,
    category: "client_signal",
    outcome: req.body?.outcome || "observed",
    severity: req.body?.severity || "low",
    weight: Number(req.body?.weight || 1),
    routeGroup: String(req.body?.routeGroup || ""),
    target: req.body?.target || {},
    metadata: req.body?.metadata || {},
  });

  res.json({ ok: true });
});

export const getCurrentCheckpointRequirement = asyncHandler(async (req, res) => {
  const result = await getCurrentCheckpointRequirementForUser({
    user: req.user,
    req,
    createSession: false,
  });

  res.json({
    ...result,
    mandate: normalizeCurrentMandateForClient(result.mandate),
  });
});

export const startCurrentCheckpoint = asyncHandler(async (req, res) => {
  const result = await getCurrentCheckpointRequirementForUser({
    user: req.user,
    req,
    createSession: true,
  });

  res.status(result.required ? 201 : 200).json({
    ...result,
    mandate: normalizeCurrentMandateForClient(result.mandate),
  });
});

export const getCheckpointPolicy = asyncHandler(async (req, res) => {
  res.json(await getCheckpointPolicySummary());
});

export const getAdminCheckpointOverview = asyncHandler(async (req, res) => {
  const days = clampInt(req.query.days, 30, 1, 180);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sessionMatch = { createdAt: { $gte: since } };
  const eventMatch = { createdAt: { $gte: since } };

  const [
    totalSessions,
    statusRows,
    levelRows,
    deliveryRows,
    riskRows,
    totalEvents,
    categoryRows,
    outcomeRows,
    severityRows,
    latestReviewSessions,
    recentEvents,
    signalSource,
  ] = await Promise.all([
    CheckpointSession.countDocuments(sessionMatch),
    CheckpointSession.aggregate([
      { $match: sessionMatch },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    CheckpointSession.aggregate([
      { $match: sessionMatch },
      { $group: { _id: "$level", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    CheckpointSession.aggregate([
      { $match: sessionMatch },
      { $group: { _id: "$delivery.method", count: { $sum: 1 } } },
    ]),
    CheckpointSession.aggregate([
      { $match: sessionMatch },
      {
        $group: {
          _id: null,
          avgScore: { $avg: "$risk.score" },
          maxScore: { $max: "$risk.score" },
        },
      },
    ]),
    CheckpointEvent.countDocuments(eventMatch),
    CheckpointEvent.aggregate([
      { $match: eventMatch },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    CheckpointEvent.aggregate([
      { $match: eventMatch },
      { $group: { _id: "$outcome", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    CheckpointEvent.aggregate([
      { $match: eventMatch },
      { $group: { _id: "$severity", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    CheckpointSession.find({
      ...sessionMatch,
      status: { $in: ["review_required", "pending"] },
    })
      .sort({ level: -1, "risk.score": -1, createdAt: -1 })
      .limit(8)
      .populate("user", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .populate("review.reviewedBy", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .lean(),
    CheckpointEvent.find(eventMatch)
      .sort({ createdAt: -1 })
      .limit(12)
      .populate("user", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .populate("subjectUser", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .lean(),
    CheckpointSession.find(sessionMatch)
      .sort({ createdAt: -1 })
      .limit(500)
      .select("risk.signals risk.reasons")
      .lean(),
  ]);

  const statusCounts = countMap(statusRows);
  const levelCounts = levelCountMap(levelRows);
  const deliveryCounts = countMap(deliveryRows);
  const eventCategoryCounts = countMap(categoryRows);
  const eventOutcomeCounts = countMap(outcomeRows);
  const eventSeverityCounts = countMap(severityRows);
  const risk = riskRows[0] || {};

  const signalCounts = new Map();
  signalSource.forEach((session) => {
    (session.risk?.signals || []).forEach((signal) => {
      const key = signal.key || signal.reason || "unknown";
      const current = signalCounts.get(key) || {
        key,
        reason: signal.reason || key,
        category: signal.category || "system",
        count: 0,
      };
      current.count += 1;
      signalCounts.set(key, current);
    });
  });

  const topSignals = Array.from(signalCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const policy = await getCheckpointPolicySummary();

  res.json({
    window: {
      days,
      since,
      until: new Date(),
    },
    summary: {
      totalSessions,
      totalEvents,
      pendingSessions: statusCounts.pending || 0,
      reviewRequiredSessions: statusCounts.review_required || 0,
      passedSessions: statusCounts.passed || 0,
      failedSessions:
        (statusCounts.failed || 0) +
        (statusCounts.expired || 0) +
        (statusCounts.cancelled || 0),
      passRate: totalSessions
        ? Math.round(((statusCounts.passed || 0) / totalSessions) * 100)
        : 0,
      avgRiskScore: Math.round(Number(risk.avgScore || 0)),
      maxRiskScore: Math.round(Number(risk.maxScore || 0)),
      level3Sessions: levelCounts.level3 || 0,
    },
    statusCounts,
    levelCounts,
    deliveryCounts,
    eventCategoryCounts,
    eventOutcomeCounts,
    eventSeverityCounts,
    topSignals,
    latestReviewSessions: latestReviewSessions.map(normalizeSessionForAdmin),
    recentEvents: recentEvents.map(normalizeEventForAdmin),
    policy,
  });
});

export const listAdminCheckpointSessions = asyncHandler(async (req, res) => {
  const page = clampInt(req.query.page, 1, 1, 10000);
  const pageSize = clampInt(req.query.pageSize || req.query.limit, 20, 1, 100);
  const status = String(req.query.status || "").trim();
  const channel = String(req.query.channel || "").trim();
  const type = String(req.query.type || "").trim();
  const deliveryMethod = String(req.query.deliveryMethod || "").trim();
  const confidence = String(req.query.confidence || "").trim();
  const keyword = String(req.query.q || req.query.keyword || "").trim();
  const level = Number.parseInt(req.query.level, 10);

  const filter = {};
  if (SESSION_STATUSES.has(status)) filter.status = status;
  if (["web", "app", "unknown"].includes(channel)) filter.channel = channel;
  if (type === "login") filter.type = type;
  if (["email_otp", "zalo_otp"].includes(deliveryMethod)) {
    filter["delivery.method"] = deliveryMethod;
  }
  if (["low", "medium", "high", "missing_factor", "role_bypass"].includes(confidence)) {
    filter["risk.confidence"] = confidence;
  }
  if ([1, 2, 3].includes(level)) filter.level = level;

  const createdAtRange = buildCreatedAtRange({
    days: req.query.days,
    from: req.query.from,
    to: req.query.to,
  });
  if (createdAtRange) filter.createdAt = createdAtRange;

  if (keyword) {
    const rx = new RegExp(escapeRegex(keyword), "i");
    const userIds = await findUserIdsByKeyword(keyword);
    filter.$or = [
      { "request.ip": rx },
      { "request.deviceId": rx },
      { "request.deviceName": rx },
      { "request.userAgent": rx },
      { "request.reason": rx },
      { "delivery.targetMasked": rx },
    ];
    if (userIds.length) filter.$or.push({ user: { $in: userIds } });
  }

  const [total, sessions] = await Promise.all([
    CheckpointSession.countDocuments(filter),
    CheckpointSession.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate("user", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .populate("review.reviewedBy", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .lean(),
  ]);

  res.json({
    sessions: sessions.map(normalizeSessionForAdmin),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

export const listAdminCheckpointEvents = asyncHandler(async (req, res) => {
  const page = clampInt(req.query.page, 1, 1, 10000);
  const pageSize = clampInt(req.query.pageSize || req.query.limit, 30, 1, 100);
  const category = String(req.query.category || "").trim();
  const outcome = String(req.query.outcome || "").trim();
  const severity = String(req.query.severity || "").trim();
  const routeGroup = String(req.query.routeGroup || "").trim();
  const keyword = String(req.query.q || req.query.keyword || "").trim();

  const filter = {};
  if (EVENT_CATEGORIES.has(category)) filter.category = category;
  if (EVENT_OUTCOMES.has(outcome)) filter.outcome = outcome;
  if (EVENT_SEVERITIES.has(severity)) filter.severity = severity;
  if (routeGroup) filter.routeGroup = routeGroup;

  const createdAtRange = buildCreatedAtRange({
    days: req.query.days,
    from: req.query.from,
    to: req.query.to,
  });
  if (createdAtRange) filter.createdAt = createdAtRange;

  if (keyword) {
    const rx = new RegExp(escapeRegex(keyword), "i");
    const userIds = await findUserIdsByKeyword(keyword);
    filter.$or = [
      { type: rx },
      { ip: rx },
      { deviceId: rx },
      { deviceName: rx },
      { userAgent: rx },
      { path: rx },
      { routeGroup: rx },
      { "target.type": rx },
      { "target.id": rx },
    ];
    if (userIds.length) {
      filter.$or.push({ user: { $in: userIds } });
      filter.$or.push({ subjectUser: { $in: userIds } });
    }
  }

  const [total, events] = await Promise.all([
    CheckpointEvent.countDocuments(filter),
    CheckpointEvent.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate("user", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .populate("subjectUser", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .lean(),
  ]);

  res.json({
    events: events.map(normalizeEventForAdmin),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

export const listAdminCheckpointMandates = asyncHandler(async (req, res) => {
  const result = await listCheckpointMandates({
    page: req.query.page,
    pageSize: req.query.pageSize || req.query.limit,
    status: String(req.query.status || "").trim(),
    level: String(req.query.level || "").trim(),
    q: String(req.query.q || req.query.keyword || "").trim(),
  });
  res.json(result);
});

export const createAdminCheckpointMandate = asyncHandler(async (req, res) => {
  const mandate = await createCheckpointMandate({
    userId: req.body?.userId,
    identifier: req.body?.identifier,
    level: req.body?.level,
    reason: req.body?.reason,
    note: req.body?.note,
    expiresInHours: req.body?.expiresInHours,
    expiresAt: req.body?.expiresAt,
    createdBy: req.user?._id || null,
  });

  void recordCheckpointEvent({
    req,
    user: req.user || null,
    subjectUser: mandate?.user || null,
    type: "checkpoint_manual_mandate_created",
    category: "checkpoint",
    outcome: "blocked",
    severity: Number(mandate?.level || 1) >= 3 ? "high" : "medium",
    target: { type: "checkpoint_mandate", id: String(mandate?._id || "") },
    metadata: {
      level: mandate?.level,
      reason: mandate?.reason,
      expiresAt: mandate?.expiresAt,
    },
  });

  res.status(201).json({
    mandate: normalizeCheckpointMandateForAdmin(mandate),
  });
});

export const cancelAdminCheckpointMandate = asyncHandler(async (req, res) => {
  const mandate = await cancelCheckpointMandate({
    id: req.params.id,
    actorId: req.user?._id || null,
    note: String(req.body?.note || "").trim(),
  });

  void recordCheckpointEvent({
    req,
    user: req.user || null,
    subjectUser: mandate?.user || null,
    type: "checkpoint_manual_mandate_cancelled",
    category: "checkpoint",
    outcome: "observed",
    severity: "info",
    target: { type: "checkpoint_mandate", id: String(mandate?._id || "") },
    metadata: {
      level: mandate?.level,
      note: req.body?.note || "",
    },
  });

  res.json({
    mandate: normalizeCheckpointMandateForAdmin(mandate),
  });
});

export const unlockAdminCheckpointSubject = asyncHandler(async (req, res) => {
  const note = String(req.body?.note || "").trim().slice(0, 1000);
  const user = await resolveMandateUser({
    userId: req.body?.userId,
    identifier: req.body?.identifier,
  });

  if (!user || user.isDeleted) {
    res.status(404);
    throw new Error("Không tìm thấy user để mở checkpoint.");
  }

  const settings = await getCheckpointSettings();
  const now = new Date();
  const session = await getActiveCheckpointSessionForUser(user._id);
  let freshSession = null;

  if (session) {
    session.status = "passed";
    session.passedAt = now;
    session.failedAt = null;
    session.codeHash = "";
    session.trustExpiresAt = new Date(
      Date.now() + Number(settings.trustDays || 15) * 24 * 60 * 60 * 1000
    );
    session.expiresAt = new Date(
      Math.max(
        session.expiresAt ? new Date(session.expiresAt).getTime() : 0,
        Date.now() + Number(settings.review?.extendPendingMinutesOnApprove || 10) * 60 * 1000
      )
    );
    session.review = {
      decision: "approved",
      note: note || "Admin mở checkpoint thủ công.",
      reviewedBy: req.user?._id || null,
      reviewedAt: now,
    };
    session.factors.forEach((factor) => {
      factor.status = "passed";
      factor.passedAt = now;
    });
    await session.save();

    if (session.mandate) {
      await consumeCheckpointMandate({
        id: session.mandate,
        sessionId: session._id,
      });
    }

    freshSession = await CheckpointSession.findById(session._id)
      .populate("user", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .populate("review.reviewedBy", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .lean();
  }

  const mandateResult = await cancelActiveCheckpointMandatesForUser({
    userId: user._id,
    actorId: req.user?._id || null,
    note: note || "Admin mở checkpoint cho user.",
  });

  void recordCheckpointEvent({
    req,
    user: req.user || null,
    subjectUser: user,
    type: "checkpoint_admin_unlock_user",
    category: "checkpoint",
    outcome: "success",
    severity: "info",
    target: { type: "user", id: String(user._id || "") },
    metadata: {
      sessionId: freshSession?._id ? String(freshSession._id) : "",
      cancelledMandates: Number(mandateResult?.modifiedCount || 0),
      note,
    },
  });

  const unlocked = Boolean(freshSession || Number(mandateResult?.modifiedCount || 0) > 0);

  if (unlocked && user.email) {
    void sendCheckpointReviewDecisionEmail({
      to: user.email,
      approved: true,
      note,
    }).catch((error) => {
      console.error("[checkpoint] unlock email failed:", error?.message || error);
    });
  }

  res.json({
    ok: true,
    unlocked,
    user: normalizeUserForAdmin(user),
    session: freshSession ? normalizeSessionForAdmin(freshSession) : null,
    cancelledMandates: Number(mandateResult?.modifiedCount || 0),
  });
});

export const searchAdminCheckpointUsers = asyncHandler(async (req, res) => {
  const q = String(req.query.q || req.query.keyword || "").trim();
  const limit = clampInt(req.query.limit, 12, 1, 30);
  if (!q) {
    res.json({ users: [] });
    return;
  }

  const projection = "name nickname email phone avatar role isSuperUser isSuperAdmin";
  const exactId = mongoose.isValidObjectId(q) ? q : "";
  const rx = new RegExp(escapeRegex(q), "i");
  const filters = [
    { name: rx },
    { nickname: rx },
    { email: rx },
    { phone: rx },
  ];
  if (exactId) {
    filters.unshift({ _id: new mongoose.Types.ObjectId(exactId) });
  }

  const users = await User.find({
    isDeleted: { $ne: true },
    $or: filters,
  })
    .select(projection)
    .limit(limit)
    .lean();

  users.sort((a, b) => {
    const aExact = exactId && String(a._id) === exactId ? 1 : 0;
    const bExact = exactId && String(b._id) === exactId ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    const aName = String(a.nickname || a.name || a.email || "");
    const bName = String(b.nickname || b.name || b.email || "");
    return aName.localeCompare(bName, "vi");
  });

  res.json({
    users: users.map(normalizeUserForAdmin),
  });
});

export const getAdminCheckpointSettings = asyncHandler(async (req, res) => {
  const settings = await getCheckpointSettings();
  res.json({
    settings,
    defaults: getDefaultCheckpointSettings(),
  });
});

export const updateAdminCheckpointSettings = asyncHandler(async (req, res) => {
  const settings = await updateCheckpointSettings(req.body || {}, req.user?._id || null);
  void recordCheckpointEvent({
    req,
    user: req.user || null,
    subjectUser: null,
    type: "checkpoint_settings_updated",
    category: "checkpoint",
    outcome: "observed",
    severity: "info",
    target: { type: "checkpoint_settings", id: "checkpoint-engine" },
    metadata: {
      keys: Object.keys(req.body || {}),
    },
  });
  res.json({
    settings,
    defaults: getDefaultCheckpointSettings(),
  });
});

export const simulateAdminCheckpointRisk = asyncHandler(async (req, res) => {
  const counters = req.body?.counters || {};
  const user = req.body?.user || {};
  const intent = String(req.body?.intent || "login").trim() || "login";
  const decision = await simulateCheckpointRiskDecision({
    counters,
    user,
    intent,
  });
  res.json({
    decision,
    simulatedAt: new Date(),
  });
});

export const getAdminCheckpointSessionDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(String(id || ""))) {
    res.status(400);
    throw new Error("Checkpoint session id không hợp lệ.");
  }

  const session = await CheckpointSession.findById(id)
    .populate("user", "name nickname email phone avatar role isSuperUser isSuperAdmin")
    .populate("review.reviewedBy", "name nickname email phone avatar role isSuperUser isSuperAdmin")
    .lean();
  if (!session) {
    res.status(404);
    throw new Error("Không tìm thấy checkpoint session.");
  }

  const related = [];
  if (session.user?._id || session.user) {
    const uid = session.user?._id || session.user;
    related.push({ user: uid }, { subjectUser: uid });
  }
  if (session.request?.deviceId) related.push({ deviceId: session.request.deviceId });
  if (session.request?.ip) related.push({ ip: session.request.ip });

  const events = related.length
    ? await CheckpointEvent.find({ $or: related })
        .sort({ createdAt: -1 })
        .limit(120)
        .populate("user", "name nickname email phone avatar role isSuperUser isSuperAdmin")
        .populate("subjectUser", "name nickname email phone avatar role isSuperUser isSuperAdmin")
        .lean()
    : [];

  res.json({
    session: normalizeSessionForAdmin(session),
    events: events.map(normalizeEventForAdmin),
  });
});

export const getAdminCheckpointSubjectInsight = asyncHandler(async (req, res) => {
  const days = clampInt(req.query.days, 30, 1, 180);
  const userId = String(req.query.userId || "").trim();
  const ip = String(req.query.ip || "").trim();
  const deviceId = String(req.query.deviceId || "").trim();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const scope = [];

  if (userId) {
    if (!mongoose.isValidObjectId(userId)) {
      res.status(400);
      throw new Error("userId không hợp lệ.");
    }
    const oid = new mongoose.Types.ObjectId(userId);
    scope.push({ user: oid }, { subjectUser: oid });
  }
  if (ip) scope.push({ ip });
  if (deviceId) scope.push({ deviceId });
  if (!scope.length) {
    res.status(400);
    throw new Error("Cần truyền userId, ip hoặc deviceId.");
  }

  const eventFilter = { $or: scope, createdAt: { $gte: since } };
  const sessionOr = [];
  if (userId) sessionOr.push({ user: new mongoose.Types.ObjectId(userId) });
  if (ip) sessionOr.push({ "request.ip": ip });
  if (deviceId) sessionOr.push({ "request.deviceId": deviceId });
  const sessionFilter = { $or: sessionOr, createdAt: { $gte: since } };

  const [events, sessions, categoryRows, outcomeRows, severityRows] = await Promise.all([
    CheckpointEvent.find(eventFilter)
      .sort({ createdAt: -1 })
      .limit(160)
      .populate("user", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .populate("subjectUser", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .lean(),
    CheckpointSession.find(sessionFilter)
      .sort({ createdAt: -1 })
      .limit(80)
      .populate("user", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .populate("review.reviewedBy", "name nickname email phone avatar role isSuperUser isSuperAdmin")
      .lean(),
    CheckpointEvent.aggregate([
      { $match: eventFilter },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    CheckpointEvent.aggregate([
      { $match: eventFilter },
      { $group: { _id: "$outcome", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    CheckpointEvent.aggregate([
      { $match: eventFilter },
      { $group: { _id: "$severity", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  const signalCounts = new Map();
  sessions.forEach((session) => {
    (session.risk?.signals || []).forEach((signal) => {
      const key = signal.key || signal.reason || "unknown";
      const current = signalCounts.get(key) || {
        key,
        reason: signal.reason || key,
        category: signal.category || "system",
        count: 0,
      };
      current.count += 1;
      signalCounts.set(key, current);
    });
  });

  res.json({
    window: { days, since, until: new Date() },
    scope: { userId, ip, deviceId },
    summary: {
      events: events.length,
      sessions: sessions.length,
      reviewRequired: sessions.filter((item) => item.status === "review_required").length,
      passed: sessions.filter((item) => item.status === "passed").length,
      failed: sessions.filter((item) => ["failed", "expired", "cancelled"].includes(item.status)).length,
    },
    categoryCounts: countMap(categoryRows),
    outcomeCounts: countMap(outcomeRows),
    severityCounts: countMap(severityRows),
    topSignals: Array.from(signalCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    sessions: sessions.map(normalizeSessionForAdmin),
    events: events.map(normalizeEventForAdmin),
  });
});

export const resolveAdminCheckpointSession = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(String(id || ""))) {
    res.status(400);
    throw new Error("Checkpoint session id không hợp lệ.");
  }

  const action = String(req.body?.action || "").trim();
  const note = String(req.body?.note || "").trim().slice(0, 1000);
  if (!["approve", "reject", "cancel"].includes(action)) {
    res.status(400);
    throw new Error("Hành động checkpoint không hợp lệ.");
  }
  const settings = await getCheckpointSettings();
  if (action === "reject" && settings.review?.requireNoteOnReject !== false && !note) {
    res.status(400);
    throw new Error("Vui lòng nhập ghi chú khi từ chối checkpoint.");
  }

  const session = await CheckpointSession.findById(id);
  if (!session) {
    res.status(404);
    throw new Error("Không tìm thấy checkpoint session.");
  }

  const now = new Date();
  session.codeHash = "";
  session.review = {
    decision:
      action === "approve"
        ? "approved"
        : action === "reject"
        ? "rejected"
        : "cancelled",
    note,
    reviewedBy: req.user?._id || null,
    reviewedAt: now,
  };

  if (action === "approve") {
    session.status = "passed";
    session.passedAt = now;
    session.failedAt = null;
    session.trustExpiresAt = new Date(
      Date.now() + Number(settings.trustDays || 15) * 24 * 60 * 60 * 1000
    );
    session.expiresAt = new Date(Math.max(
      session.expiresAt ? new Date(session.expiresAt).getTime() : 0,
      Date.now() + Number(settings.review?.extendPendingMinutesOnApprove || 10) * 60 * 1000
    ));
    session.factors.forEach((factor) => {
      if (factor.status !== "passed") {
        factor.status = "passed";
        factor.passedAt = now;
      }
    });
    if (session.mandate) {
      await consumeCheckpointMandate({
        id: session.mandate,
        sessionId: session._id,
      });
    }
    await cancelActiveCheckpointMandatesForUser({
      userId: session.user,
      actorId: req.user?._id || null,
      note: note || "Admin mở checkpoint session.",
    });
  } else if (action === "reject") {
    session.status = "failed";
    session.failedAt = now;
    session.factors.forEach((factor) => {
      if (factor.status !== "passed") factor.status = "failed";
    });
  } else {
    session.status = "cancelled";
  }

  await session.save();

  void recordCheckpointEvent({
    req,
    user: req.user || null,
    subjectUser: { _id: session.user },
    type: `checkpoint_admin_${action}`,
    category: "checkpoint",
    outcome: action === "approve" ? "success" : action === "reject" ? "failed" : "observed",
    severity: action === "approve" ? "info" : "medium",
    target: { type: "checkpoint_session", id: String(session._id) },
    metadata: {
      level: session.level,
      score: session.risk?.score || 0,
      note,
    },
  });

  if (["approve", "reject"].includes(action)) {
    const reviewedUser = await User.findById(session.user).select("email").lean();
    if (reviewedUser?.email) {
      void sendCheckpointReviewDecisionEmail({
        to: reviewedUser.email,
        approved: action === "approve",
        note,
      }).catch((error) => {
        console.error("[checkpoint] review decision email failed:", error?.message || error);
      });
    }
  }

  const fresh = await CheckpointSession.findById(session._id)
    .populate("user", "name nickname email phone avatar role isSuperUser isSuperAdmin")
    .populate("review.reviewedBy", "name nickname email phone avatar role isSuperUser isSuperAdmin")
    .lean();

  res.json({ session: normalizeSessionForAdmin(fresh) });
});
