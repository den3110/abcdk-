import mongoose from "mongoose";
import PushDispatch from "../models/pushDispatchModel.js";
import PushToken from "../models/pushTokenModel.js";
import { getIO } from "../socket/index.js";

const MAX_SAMPLE_FAILURES = 20;
const WATCH_ROOM = "push-monitor:watchers";

function toObjectIdOrNull(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(String(value))
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

function asDate(value = new Date()) {
  return value instanceof Date ? value : new Date(value);
}

function asBoundaryDate(value, mode = "start") {
  const date = asDate(value);
  if (!Number.isNaN(date.getTime()) && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (mode === "end") {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }
  }
  return date;
}

function pickDefined(source = {}, keys = []) {
  return keys.reduce((acc, key) => {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") {
      acc[key] = value;
    }
    return acc;
  }, {});
}

export function sanitizeDispatchPayload(payload = {}, opts = {}) {
  return {
    title: String(payload?.title || "").trim(),
    body: String(payload?.body || "").trim(),
    url: String(payload?.url || payload?.data?.url || "").trim(),
    badge:
      opts?.badge == null || opts?.badge === ""
        ? null
        : Number.isFinite(Number(opts.badge))
        ? Number(opts.badge)
        : null,
    ttl:
      opts?.ttl == null || opts?.ttl === ""
        ? null
        : Number.isFinite(Number(opts.ttl))
        ? Number(opts.ttl)
        : null,
  };
}

export function sanitizeDispatchContext(ctx = {}) {
  return {
    ...pickDefined(ctx, [
      "matchId",
      "tournamentId",
      "ticketId",
      "userId",
      "orgId",
      "registrationId",
      "topicType",
      "topicId",
      "category",
      "phase",
      "scope",
      "platform",
      "minVersion",
      "maxVersion",
      "label",
      "eta",
    ]),
    directUserIds: Array.isArray(ctx?.directUserIds)
      ? ctx.directUserIds.map(String).slice(0, 50)
      : undefined,
  };
}

function sanitizeTarget(target = {}) {
  const filters =
    target?.filters && typeof target.filters === "object" ? { ...target.filters } : {};
  Object.keys(filters).forEach((key) => {
    if (filters[key] == null || filters[key] === "") delete filters[key];
  });

  return {
    scope: String(target?.scope || "").trim(),
    topicType: String(target?.topicType || "").trim(),
    topicId: target?.topicId == null ? "" : String(target.topicId),
    userId: target?.userId == null ? "" : String(target.userId),
    filters,
    audienceCount: Number(target?.audienceCount || 0),
  };
}

function normalizePlatformValue(value) {
  const platform = String(value || "").trim().toLowerCase();
  return platform || "unknown";
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.filter(Boolean).map(String)));
}

function maskToken(token) {
  if (!token || typeof token !== "string") return "";
  if (token.length <= 12) return token;
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function mergeErrorBreakdown(base = {}, next = {}) {
  const out = { ...(base || {}) };
  Object.entries(next || {}).forEach(([key, value]) => {
    out[key] = Number(out[key] || 0) + Number(value || 0);
  });
  return out;
}

function mergeByPlatform(base = {}, next = {}) {
  const out = { ...(base || {}) };
  Object.entries(next || {}).forEach(([platform, stats]) => {
    const current = out[platform] || {};
    out[platform] = {
      tokens: Number(current.tokens || 0) + Number(stats?.tokens || 0),
      ticketOk: Number(current.ticketOk || 0) + Number(stats?.ticketOk || 0),
      ticketError: Number(current.ticketError || 0) + Number(stats?.ticketError || 0),
      receiptOk: Number(current.receiptOk || 0) + Number(stats?.receiptOk || 0),
      receiptError:
        Number(current.receiptError || 0) + Number(stats?.receiptError || 0),
      disabledTokens:
        Number(current.disabledTokens || 0) + Number(stats?.disabledTokens || 0),
    };
  });
  return out;
}

function mergeSampleFailures(base = [], next = []) {
  const out = [];
  const seen = new Set();
  [...(base || []), ...(next || [])].forEach((item) => {
    const key = [
      item?.stage || "",
      item?.platform || "",
      item?.error || "",
      item?.message || "",
      item?.token || "",
    ].join("|");
    if (!key || seen.has(key) || out.length >= MAX_SAMPLE_FAILURES) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

function normalizeSummary(summary = {}) {
  const byPlatform = mergeByPlatform({}, summary?.byPlatform || {});
  const platforms =
    Array.isArray(summary?.platforms) && summary.platforms.length
      ? uniqueStrings(summary.platforms)
      : uniqueStrings(Object.keys(byPlatform));

  return {
    tokens: Number(summary?.tokens || 0),
    ticketOk: Number(summary?.ticketOk || 0),
    ticketError: Number(summary?.ticketError || 0),
    receiptOk: Number(summary?.receiptOk || 0),
    receiptError: Number(summary?.receiptError || 0),
    disabledTokens: Number(summary?.disabledTokens || 0),
    errorBreakdown: { ...(summary?.errorBreakdown || {}) },
    byPlatform,
    platforms,
  };
}

function addSummary(base = {}, next = {}) {
  const a = normalizeSummary(base);
  const b = normalizeSummary(next);
  return {
    tokens: a.tokens + b.tokens,
    ticketOk: a.ticketOk + b.ticketOk,
    ticketError: a.ticketError + b.ticketError,
    receiptOk: a.receiptOk + b.receiptOk,
    receiptError: a.receiptError + b.receiptError,
    disabledTokens: a.disabledTokens + b.disabledTokens,
    errorBreakdown: mergeErrorBreakdown(a.errorBreakdown, b.errorBreakdown),
    byPlatform: mergeByPlatform(a.byPlatform, b.byPlatform),
    platforms: uniqueStrings([...(a.platforms || []), ...(b.platforms || [])]),
  };
}

async function emitPushMonitorUpdate(payload = {}) {
  let io = null;
  try {
    io = getIO();
  } catch (_) {
    return;
  }

  io.to(WATCH_ROOM).emit("push-monitor:update", {
    ts: new Date().toISOString(),
    ...payload,
  });
}

export async function createPushDispatch({
  sourceKind,
  eventName,
  triggeredBy = null,
  payload = {},
  target = {},
  context = {},
  status = "queued",
  queueJobName = "",
  queueJobId = "",
  note = "",
} = {}) {
  const doc = await PushDispatch.create({
    sourceKind,
    eventName,
    triggeredBy: toObjectIdOrNull(triggeredBy),
    payload: sanitizeDispatchPayload(payload, payload),
    target: sanitizeTarget(target),
    context: sanitizeDispatchContext(context),
    status,
    queueJobName: String(queueJobName || ""),
    queueJobId: String(queueJobId || ""),
    note: String(note || ""),
    startedAt: status === "running" ? new Date() : null,
    lastProgressAt: status === "running" ? new Date() : null,
  });

  await emitPushMonitorUpdate({
    dispatchId: String(doc._id),
    status: doc.status,
    sourceKind: doc.sourceKind,
    eventName: doc.eventName,
    reason: "created",
  });

  return doc;
}

export async function patchPushDispatch(dispatchId, patch = {}) {
  if (!dispatchId) return null;
  const update = { ...patch };
  if (update.triggeredBy !== undefined) {
    update.triggeredBy = toObjectIdOrNull(update.triggeredBy);
  }
  if (update.payload) update.payload = sanitizeDispatchPayload(update.payload, update.payload);
  if (update.target) update.target = sanitizeTarget(update.target);
  if (update.context) update.context = sanitizeDispatchContext(update.context);
  if (update.summary) update.summary = normalizeSummary(update.summary);
  if (update.sampleFailures) {
    update.sampleFailures = mergeSampleFailures([], update.sampleFailures);
  }
  const doc = await PushDispatch.findByIdAndUpdate(dispatchId, { $set: update }, { new: true });
  return doc;
}

export async function markPushDispatchRunning(dispatchId, patch = {}) {
  const now = new Date();
  const doc = await patchPushDispatch(dispatchId, {
    status: "running",
    startedAt: patch?.startedAt || now,
    lastProgressAt: now,
    ...patch,
  });
  if (doc) {
    await emitPushMonitorUpdate({
      dispatchId: String(doc._id),
      status: doc.status,
      sourceKind: doc.sourceKind,
      eventName: doc.eventName,
      reason: "running",
    });
  }
  return doc;
}

export async function markPushDispatchSkipped(dispatchId, patch = {}) {
  const now = new Date();
  const doc = await patchPushDispatch(dispatchId, {
    status: "skipped",
    completedAt: patch?.completedAt || now,
    lastProgressAt: now,
    ...patch,
  });
  if (doc) {
    await emitPushMonitorUpdate({
      dispatchId: String(doc._id),
      status: doc.status,
      sourceKind: doc.sourceKind,
      eventName: doc.eventName,
      reason: "skipped",
    });
  }
  return doc;
}

export async function markPushDispatchCompleted(dispatchId, patch = {}) {
  const now = new Date();
  const doc = await patchPushDispatch(dispatchId, {
    status: "completed",
    completedAt: patch?.completedAt || now,
    lastProgressAt: now,
    ...patch,
  });
  if (doc) {
    await emitPushMonitorUpdate({
      dispatchId: String(doc._id),
      status: doc.status,
      sourceKind: doc.sourceKind,
      eventName: doc.eventName,
      reason: "completed",
    });
  }
  return doc;
}

export async function markPushDispatchFailed(dispatchId, patch = {}) {
  const now = new Date();
  const doc = await patchPushDispatch(dispatchId, {
    status: "failed",
    failedAt: patch?.failedAt || now,
    lastProgressAt: now,
    ...patch,
  });
  if (doc) {
    await emitPushMonitorUpdate({
      dispatchId: String(doc._id),
      status: doc.status,
      sourceKind: doc.sourceKind,
      eventName: doc.eventName,
      reason: "failed",
    });
  }
  return doc;
}

export async function updatePushDispatchProgress(dispatchId, patch = {}) {
  if (!dispatchId) return null;
  const current = await PushDispatch.findById(dispatchId)
    .select("summary sampleFailures progress target")
    .lean();
  if (!current) return null;

  const nextSummary = patch?.accumulateSummary
    ? addSummary(current.summary || {}, patch.accumulateSummary || {})
    : patch?.summary
    ? normalizeSummary(patch.summary)
    : current.summary || normalizeSummary({});

  const nextFailures = patch?.sampleFailures
    ? mergeSampleFailures(current.sampleFailures || [], patch.sampleFailures)
    : current.sampleFailures || [];

  const progress = {
    totalTokens: Number(
      patch?.progress?.totalTokens ?? current?.progress?.totalTokens ?? 0
    ),
    processedTokens: Number(
      patch?.progress?.processedTokens ?? current?.progress?.processedTokens ?? 0
    ),
    processedBatches: Number(
      patch?.progress?.processedBatches ?? current?.progress?.processedBatches ?? 0
    ),
    totalBatches: Number(
      patch?.progress?.totalBatches ?? current?.progress?.totalBatches ?? 0
    ),
  };

  const target = {
    ...(current?.target || {}),
    ...(patch?.target || {}),
  };

  const doc = await patchPushDispatch(dispatchId, {
    summary: nextSummary,
    sampleFailures: nextFailures,
    progress,
    target,
    lastProgressAt: new Date(),
    ...(patch?.note ? { note: patch.note } : {}),
  });

  if (doc) {
    await emitPushMonitorUpdate({
      dispatchId: String(doc._id),
      status: doc.status,
      sourceKind: doc.sourceKind,
      eventName: doc.eventName,
      reason: "progress",
    });
  }
  return doc;
}

export function buildSendSummary({
  rows = [],
  ticketResults = [],
  receiptResults = [],
  disabledTokens = 0,
} = {}) {
  const rowMap = new Map();
  const byPlatform = {};
  const errorBreakdown = {};
  const sampleFailures = [];
  let ticketOk = 0;
  let ticketError = 0;
  let receiptOk = 0;
  let receiptError = 0;

  rows.forEach((row) => {
    const token = typeof row === "string" ? row : row?.token;
    if (!token) return;
    rowMap.set(token, row);
    const platform = normalizePlatformValue(typeof row === "string" ? "" : row?.platform);
    byPlatform[platform] = byPlatform[platform] || {
      tokens: 0,
      ticketOk: 0,
      ticketError: 0,
      receiptOk: 0,
      receiptError: 0,
      disabledTokens: 0,
    };
    byPlatform[platform].tokens += 1;
  });

  const receiptOwnerMap = new Map();
  ticketResults.forEach((result) => {
    const platform = normalizePlatformValue(rowMap.get(result?.token)?.platform);
    byPlatform[platform] = byPlatform[platform] || {
      tokens: 0,
      ticketOk: 0,
      ticketError: 0,
      receiptOk: 0,
      receiptError: 0,
      disabledTokens: 0,
    };

    if (result?.ticket?.status === "ok") {
      ticketOk += 1;
      byPlatform[platform].ticketOk += 1;
      if (result?.ticket?.id) {
        receiptOwnerMap.set(result.ticket.id, {
          token: result.token,
          platform,
        });
      }
      return;
    }

    ticketError += 1;
    byPlatform[platform].ticketError += 1;
    const errorKey =
      String(result?.ticket?.details?.error || result?.ticket?.message || "ticket_error") ||
      "ticket_error";
    errorBreakdown[errorKey] = Number(errorBreakdown[errorKey] || 0) + 1;
    if (sampleFailures.length < MAX_SAMPLE_FAILURES) {
      sampleFailures.push({
        stage: "ticket",
        token: maskToken(result?.token),
        platform,
        error: errorKey,
        message: String(result?.ticket?.message || ""),
      });
    }
  });

  receiptResults.forEach((pack) => {
    Object.entries(pack || {}).forEach(([receiptId, receipt]) => {
      const owner = receiptOwnerMap.get(receiptId) || {};
      const platform = normalizePlatformValue(owner.platform);
      byPlatform[platform] = byPlatform[platform] || {
        tokens: 0,
        ticketOk: 0,
        ticketError: 0,
        receiptOk: 0,
        receiptError: 0,
        disabledTokens: 0,
      };

      if (receipt?.status === "ok") {
        receiptOk += 1;
        byPlatform[platform].receiptOk += 1;
        return;
      }

      receiptError += 1;
      byPlatform[platform].receiptError += 1;
      const errorKey =
        String(receipt?.details?.error || receipt?.message || "receipt_error") ||
        "receipt_error";
      errorBreakdown[errorKey] = Number(errorBreakdown[errorKey] || 0) + 1;
      if (sampleFailures.length < MAX_SAMPLE_FAILURES) {
        sampleFailures.push({
          stage: "receipt",
          token: maskToken(owner?.token),
          platform,
          error: errorKey,
          message: String(receipt?.message || ""),
        });
      }
    });
  });

  if (disabledTokens > 0) {
    const current = Number(errorBreakdown.DeviceNotRegistered || 0);
    errorBreakdown.DeviceNotRegistered = current + Number(disabledTokens || 0);
  }

  const platforms = uniqueStrings(Object.keys(byPlatform));

  return {
    summary: {
      tokens: rows.length,
      ticketOk,
      ticketError,
      receiptOk,
      receiptError,
      disabledTokens: Number(disabledTokens || 0),
      errorBreakdown,
      byPlatform,
      platforms,
    },
    sampleFailures,
  };
}

export function buildPushDispatchTracker({
  dispatchId,
  onProgress,
  onResolvedAudience,
} = {}) {
  return {
    dispatchId,
    async onResolvedAudience(payload = {}) {
      await onResolvedAudience?.(payload);
    },
    async onProgress(payload = {}) {
      await onProgress?.(payload);
    },
  };
}

function buildDateRange(from, to) {
  const createdAt = {};
  if (from) createdAt.$gte = asBoundaryDate(from, "start");
  if (to) createdAt.$lte = asBoundaryDate(to, "end");
  return Object.keys(createdAt).length ? createdAt : null;
}

export async function getPushDispatchSummary() {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    running,
    queued,
    last24hStats,
    last7dStats,
    tokenAgg,
    tokenVersionAgg,
    recentFailures,
    inactive7d,
    inactive30d,
    recentRunning,
  ] =
    await Promise.all([
      PushDispatch.countDocuments({ status: "running" }),
      PushDispatch.countDocuments({ status: "queued" }),
      PushDispatch.aggregate([
        { $match: { createdAt: { $gte: last24h } } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
      PushDispatch.aggregate([
        { $match: { createdAt: { $gte: last7d } } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
      PushToken.aggregate([
        {
          $group: {
            _id: "$platform",
            total: { $sum: 1 },
            enabled: {
              $sum: { $cond: [{ $eq: ["$enabled", true] }, 1, 0] },
            },
            disabled: {
              $sum: { $cond: [{ $eq: ["$enabled", false] }, 1, 0] },
            },
            active24h: {
              $sum: {
                $cond: [{ $gte: ["$lastActiveAt", last24h] }, 1, 0],
              },
            },
            active7d: {
              $sum: {
                $cond: [{ $gte: ["$lastActiveAt", last7d] }, 1, 0],
              },
            },
          },
        },
      ]),
      PushToken.aggregate([
        {
          $match: {
            appVersion: { $nin: [null, ""] },
          },
        },
        {
          $group: {
            _id: {
              appVersion: "$appVersion",
              platform: "$platform",
            },
            total: { $sum: 1 },
            enabled: {
              $sum: { $cond: [{ $eq: ["$enabled", true] }, 1, 0] },
            },
          },
        },
        { $sort: { total: -1 } },
        { $limit: 20 },
      ]),
      PushToken.aggregate([
        {
          $match: {
            enabled: false,
            lastError: { $nin: [null, ""] },
          },
        },
        {
          $group: {
            _id: "$lastError",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      PushToken.countDocuments({
        enabled: true,
        $or: [{ lastActiveAt: { $lt: last7d } }, { lastActiveAt: null }],
      }),
      PushToken.countDocuments({
        enabled: true,
        $or: [{ lastActiveAt: { $lt: last30d } }, { lastActiveAt: null }],
      }),
      PushDispatch.find({ status: { $in: ["queued", "running"] } })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("sourceKind eventName status payload.title summary.tokens progress createdAt")
        .lean(),
    ]);

  const tokenTotals = {
    total: 0,
    enabled: 0,
    disabled: 0,
    active24h: 0,
    active7d: 0,
    byPlatform: {},
    byVersion: [],
    inactive: {
      olderThan7d: Number(inactive7d || 0),
      olderThan30d: Number(inactive30d || 0),
    },
  };
  tokenAgg.forEach((row) => {
    const platform = normalizePlatformValue(row?._id);
    tokenTotals.total += Number(row?.total || 0);
    tokenTotals.enabled += Number(row?.enabled || 0);
    tokenTotals.disabled += Number(row?.disabled || 0);
    tokenTotals.active24h += Number(row?.active24h || 0);
    tokenTotals.active7d += Number(row?.active7d || 0);
    tokenTotals.byPlatform[platform] = {
      total: Number(row?.total || 0),
      enabled: Number(row?.enabled || 0),
      disabled: Number(row?.disabled || 0),
      active24h: Number(row?.active24h || 0),
      active7d: Number(row?.active7d || 0),
    };
  });
  tokenTotals.byVersion = tokenVersionAgg.map((row) => ({
    appVersion: String(row?._id?.appVersion || "unknown"),
    platform: normalizePlatformValue(row?._id?.platform),
    total: Number(row?.total || 0),
    enabled: Number(row?.enabled || 0),
  }));

  const mapStats = (rows = []) =>
    rows.reduce(
      (acc, item) => {
        acc.total += Number(item?.count || 0);
        acc[item?._id || "unknown"] = Number(item?.count || 0);
        return acc;
      },
      { total: 0 }
    );

  return {
    generatedAt: now.toISOString(),
    dispatches: {
      running,
      queued,
      last24h: mapStats(last24hStats),
      last7d: mapStats(last7dStats),
    },
    tokens: tokenTotals,
    topTokenErrors: recentFailures.map((item) => ({
      error: String(item?._id || "unknown"),
      count: Number(item?.count || 0),
    })),
    runningDispatches: recentRunning.map((item) => ({
      _id: String(item._id),
      sourceKind: item.sourceKind,
      eventName: item.eventName,
      status: item.status,
      title: item?.payload?.title || "",
      tokens: Number(item?.summary?.tokens || 0),
      progress: item.progress || {},
      createdAt: item.createdAt,
    })),
  };
}

export async function listPushDispatches({
  page = 1,
  limit = 50,
  status,
  sourceKind,
  eventName,
  platform,
  from,
  to,
} = {}) {
  const query = {};
  if (status) query.status = String(status);
  if (sourceKind) query.sourceKind = String(sourceKind);
  if (eventName) query.eventName = String(eventName);
  if (platform) query["summary.platforms"] = normalizePlatformValue(platform);
  const createdAt = buildDateRange(from, to);
  if (createdAt) query.createdAt = createdAt;

  const normalizedPage = Math.max(1, Number(page || 1));
  const normalizedLimit = Math.min(100, Math.max(1, Number(limit || 50)));
  const skip = (normalizedPage - 1) * normalizedLimit;

  const [items, total] = await Promise.all([
    PushDispatch.find(query)
      .populate("triggeredBy", "name fullName nickname nickName email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(normalizedLimit)
      .lean(),
    PushDispatch.countDocuments(query),
  ]);

  return {
    items: items.map((item) => ({
      ...item,
      _id: String(item._id),
      triggeredBy: item.triggeredBy
        ? {
            _id: String(item.triggeredBy._id),
            name:
              item.triggeredBy.nickname ||
              item.triggeredBy.nickName ||
              item.triggeredBy.fullName ||
              item.triggeredBy.name ||
              item.triggeredBy.email ||
              "",
          }
        : null,
    })),
    total,
    page: normalizedPage,
    pages: Math.max(1, Math.ceil(total / normalizedLimit)),
  };
}

export async function getPushDispatchById(id) {
  const item = await PushDispatch.findById(id)
    .populate("triggeredBy", "name fullName nickname nickName email")
    .lean();
  if (!item) return null;
  return {
    ...item,
    _id: String(item._id),
    triggeredBy: item.triggeredBy
      ? {
          _id: String(item.triggeredBy._id),
          name:
            item.triggeredBy.nickname ||
            item.triggeredBy.nickName ||
            item.triggeredBy.fullName ||
            item.triggeredBy.name ||
            item.triggeredBy.email ||
            "",
        }
      : null,
  };
}

export async function markPushDispatchJob(dispatchId, { jobName, jobId } = {}) {
  return patchPushDispatch(dispatchId, {
    queueJobName: String(jobName || ""),
    queueJobId: String(jobId || ""),
  });
}
