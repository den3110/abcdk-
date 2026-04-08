import asyncHandler from "express-async-handler";
import ObserverEvent from "../models/observerEventModel.js";
import ObserverRuntimeSnapshot from "../models/observerRuntimeSnapshotModel.js";
import ObserverBackupSnapshot from "../models/observerBackupSnapshotModel.js";
import {
  buildExpireAt,
  getObserverCollectorConfig,
  getObserverSourceName,
} from "../services/observerConfig.service.js";

function asTrimmed(value) {
  return String(value || "").trim();
}

function toDateOrNow(value) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function toPositiveInt(value, fallback, { min = 1, max = 500 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.floor(numeric);
  if (rounded < min) return fallback;
  return Math.min(rounded, max);
}

function normalizeLevel(value, fallback = "info") {
  const normalized = asTrimmed(value).toLowerCase();
  if (!normalized) return fallback;
  if (["debug", "info", "warn", "error"].includes(normalized)) return normalized;
  return fallback;
}

function normalizeStatusCode(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
}

function normalizeDurationMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function buildSource(req, explicitSource = "") {
  return (
    asTrimmed(explicitSource) ||
    asTrimmed(req.headers["x-pkt-observer-source"]) ||
    getObserverSourceName()
  );
}

export const ingestObserverEvents = asyncHandler(async (req, res) => {
  const collectorCfg = getObserverCollectorConfig();
  const source = buildSource(req, req.body?.source);
  const incoming = Array.isArray(req.body?.events)
    ? req.body.events
    : req.body?.event
    ? [req.body.event]
    : [];

  const limitedEvents = incoming.slice(0, 500);
  const docs = limitedEvents
    .map((event) => {
      const occurredAt = toDateOrNow(event?.occurredAt || event?.ts);
      return {
        source,
        category: asTrimmed(event?.category) || "generic",
        type: asTrimmed(event?.type) || "event",
        level: normalizeLevel(event?.level),
        requestId: asTrimmed(event?.requestId),
        method: asTrimmed(event?.method).toUpperCase(),
        path: asTrimmed(event?.path),
        url: asTrimmed(event?.url),
        statusCode: normalizeStatusCode(event?.statusCode),
        durationMs: normalizeDurationMs(event?.durationMs),
        ip: asTrimmed(event?.ip),
        tags: Array.isArray(event?.tags)
          ? event.tags.map((item) => asTrimmed(item)).filter(Boolean).slice(0, 12)
          : [],
        occurredAt,
        receivedAt: new Date(),
        expireAt: buildExpireAt(collectorCfg.eventTtlDays, occurredAt),
        payload:
          event?.payload && typeof event.payload === "object"
            ? event.payload
            : {},
      };
    })
    .filter((event) => event.category && event.type);

  if (docs.length) {
    await ObserverEvent.insertMany(docs, { ordered: false });
  }

  return res.json({
    ok: true,
    source,
    accepted: docs.length,
  });
});

export const ingestObserverRuntimeSnapshot = asyncHandler(async (req, res) => {
  const collectorCfg = getObserverCollectorConfig();
  const source = buildSource(req, req.body?.source);
  const snapshot =
    req.body?.snapshot && typeof req.body.snapshot === "object"
      ? req.body.snapshot
      : {};
  const capturedAt = toDateOrNow(snapshot?.capturedAt || req.body?.capturedAt);

  const doc = await ObserverRuntimeSnapshot.create({
    source,
    capturedAt,
    receivedAt: new Date(),
    expireAt: buildExpireAt(collectorCfg.runtimeTtlDays, capturedAt),
    totals:
      snapshot?.runtime?.totals && typeof snapshot.runtime.totals === "object"
        ? snapshot.runtime.totals
        : snapshot?.totals && typeof snapshot.totals === "object"
        ? snapshot.totals
        : {},
    hotPaths:
      snapshot?.runtime?.hotPaths && typeof snapshot.runtime.hotPaths === "object"
        ? snapshot.runtime.hotPaths
        : snapshot?.hotPaths && typeof snapshot.hotPaths === "object"
        ? snapshot.hotPaths
        : {},
    process:
      snapshot?.runtime?.process && typeof snapshot.runtime.process === "object"
        ? snapshot.runtime.process
        : snapshot?.process && typeof snapshot.process === "object"
        ? snapshot.process
        : {},
    endpoints: Array.isArray(snapshot?.runtime?.endpoints)
      ? snapshot.runtime.endpoints.slice(0, 50)
      : Array.isArray(snapshot?.endpoints)
      ? snapshot.endpoints.slice(0, 50)
      : [],
    recordingExport:
      snapshot?.recordingExport && typeof snapshot.recordingExport === "object"
        ? snapshot.recordingExport
        : {},
    payload: snapshot,
  });

  return res.json({
    ok: true,
    source,
    id: String(doc._id),
  });
});

export const ingestObserverBackupSnapshot = asyncHandler(async (req, res) => {
  const collectorCfg = getObserverCollectorConfig();
  const source = buildSource(req, req.body?.source);
  const snapshot =
    req.body?.snapshot && typeof req.body.snapshot === "object"
      ? req.body.snapshot
      : req.body || {};
  const capturedAt = toDateOrNow(snapshot?.capturedAt || snapshot?.finishedAt);

  const doc = await ObserverBackupSnapshot.create({
    source,
    scope: asTrimmed(snapshot?.scope) || "generic",
    backupType: asTrimmed(snapshot?.backupType || snapshot?.type),
    status: asTrimmed(snapshot?.status).toLowerCase() || "unknown",
    capturedAt,
    receivedAt: new Date(),
    expireAt: buildExpireAt(collectorCfg.backupTtlDays, capturedAt),
    sizeBytes: Number.isFinite(Number(snapshot?.sizeBytes))
      ? Number(snapshot.sizeBytes)
      : null,
    durationMs: Number.isFinite(Number(snapshot?.durationMs))
      ? Number(snapshot.durationMs)
      : null,
    manifestUrl: asTrimmed(snapshot?.manifestUrl),
    checksum: asTrimmed(snapshot?.checksum),
    note: asTrimmed(snapshot?.note),
    payload: snapshot,
  });

  return res.json({
    ok: true,
    source,
    id: String(doc._id),
  });
});

export const getObserverSummary = asyncHandler(async (req, res) => {
  const source = asTrimmed(req.query?.source);
  const recentMinutes = toPositiveInt(req.query?.minutes, 60, {
    min: 5,
    max: 24 * 60,
  });
  const since = new Date(Date.now() - recentMinutes * 60 * 1000);
  const eventQuery = {
    ...(source ? { source } : {}),
    occurredAt: { $gte: since },
  };
  const runtimeQuery = source ? { source } : {};
  const backupQuery = source ? { source } : {};

  const [
    eventsAgg,
    totalRecentEvents,
    errorRecentEvents,
    latestRuntime,
    latestBackups,
  ] = await Promise.all([
    ObserverEvent.aggregate([
      { $match: eventQuery },
      {
        $group: {
          _id: { category: "$category", level: "$level", type: "$type" },
          count: { $sum: 1 },
          latestAt: { $max: "$occurredAt" },
        },
      },
      { $sort: { count: -1, latestAt: -1 } },
      { $limit: 25 },
    ]),
    ObserverEvent.countDocuments(eventQuery),
    ObserverEvent.countDocuments({ ...eventQuery, level: "error" }),
    ObserverRuntimeSnapshot.findOne(runtimeQuery)
      .sort({ capturedAt: -1, _id: -1 })
      .lean(),
    ObserverBackupSnapshot.find(backupQuery)
      .sort({ capturedAt: -1, _id: -1 })
      .limit(10)
      .lean(),
  ]);
  const backupSummary = latestBackups.map((item) => ({
    id: String(item._id),
    source: item.source,
    scope: item.scope,
    backupType: item.backupType,
    status: item.status,
    capturedAt: item.capturedAt,
    sizeBytes: item.sizeBytes,
    manifestUrl: item.manifestUrl,
    note: item.note,
  }));

  return res.json({
    ok: true,
    source: source || null,
    windowMinutes: recentMinutes,
    events: {
      totalRecentEvents,
      errorRecentEvents,
      buckets: eventsAgg.map((item) => ({
        category: item?._id?.category || "",
        level: item?._id?.level || "",
        type: item?._id?.type || "",
        count: Number(item?.count || 0),
        latestAt: item?.latestAt || null,
      })),
    },
    runtime: latestRuntime
      ? {
          id: String(latestRuntime._id),
          source: latestRuntime.source,
          capturedAt: latestRuntime.capturedAt,
          totals: latestRuntime.totals || {},
          process: latestRuntime.process || {},
          hotPaths: latestRuntime.hotPaths || {},
          recordingExport: latestRuntime.recordingExport || {},
        }
      : null,
    backups: backupSummary,
    updatedAt: new Date(),
  });
});

export const listObserverEvents = asyncHandler(async (req, res) => {
  const source = asTrimmed(req.query?.source);
  const category = asTrimmed(req.query?.category);
  const type = asTrimmed(req.query?.type);
  const level = normalizeLevel(req.query?.level, "");
  const limit = toPositiveInt(req.query?.limit, 100, { min: 1, max: 500 });

  const query = {
    ...(source ? { source } : {}),
    ...(category ? { category } : {}),
    ...(type ? { type } : {}),
    ...(level ? { level } : {}),
  };

  const rows = await ObserverEvent.find(query)
    .sort({ occurredAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  return res.json({
    ok: true,
    items: rows.map((row) => ({
      id: String(row._id),
      source: row.source,
      category: row.category,
      type: row.type,
      level: row.level,
      requestId: row.requestId,
      method: row.method,
      path: row.path,
      url: row.url,
      statusCode: row.statusCode,
      durationMs: row.durationMs,
      ip: row.ip,
      tags: row.tags || [],
      occurredAt: row.occurredAt,
      receivedAt: row.receivedAt,
      payload: row.payload || {},
    })),
  });
});

export const listObserverRuntimeSnapshots = asyncHandler(async (req, res) => {
  const source = asTrimmed(req.query?.source);
  const limit = toPositiveInt(req.query?.limit, 20, { min: 1, max: 100 });
  const rows = await ObserverRuntimeSnapshot.find(source ? { source } : {})
    .sort({ capturedAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  return res.json({
    ok: true,
    items: rows.map((row) => ({
      id: String(row._id),
      source: row.source,
      capturedAt: row.capturedAt,
      receivedAt: row.receivedAt,
      totals: row.totals || {},
      hotPaths: row.hotPaths || {},
      process: row.process || {},
      endpoints: row.endpoints || [],
      recordingExport: row.recordingExport || {},
    })),
  });
});

export const listObserverBackupSnapshots = asyncHandler(async (req, res) => {
  const source = asTrimmed(req.query?.source);
  const scope = asTrimmed(req.query?.scope);
  const status = asTrimmed(req.query?.status).toLowerCase();
  const limit = toPositiveInt(req.query?.limit, 50, { min: 1, max: 200 });

  const query = {
    ...(source ? { source } : {}),
    ...(scope ? { scope } : {}),
    ...(status ? { status } : {}),
  };

  const rows = await ObserverBackupSnapshot.find(query)
    .sort({ capturedAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  return res.json({
    ok: true,
    items: rows.map((row) => ({
      id: String(row._id),
      source: row.source,
      scope: row.scope,
      backupType: row.backupType,
      status: row.status,
      capturedAt: row.capturedAt,
      receivedAt: row.receivedAt,
      sizeBytes: row.sizeBytes,
      durationMs: row.durationMs,
      manifestUrl: row.manifestUrl,
      checksum: row.checksum,
      note: row.note,
      payload: row.payload || {},
    })),
  });
});
