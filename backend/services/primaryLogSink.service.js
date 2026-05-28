import PrimaryLogEvent from "../models/primaryLogEventModel.js";
import {
  getObserverSinkConfig,
  getObserverSourceName,
} from "./observerConfig.service.js";

let pendingPrimaryEvents = [];
let primaryFlushTimer = null;
let primaryFlushInFlight = null;
let primaryDroppedEvents = 0;

function toDateOrNow(value) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function buildExpireAt(days, now = new Date()) {
  const safeDays = Math.max(1, Math.min(Number(days) || 14, 365));
  return new Date(now.getTime() + safeDays * 24 * 60 * 60 * 1000);
}

function trimPendingPrimaryEvents(maxPendingEvents) {
  if (pendingPrimaryEvents.length <= maxPendingEvents) return;
  primaryDroppedEvents += pendingPrimaryEvents.length - maxPendingEvents;
  pendingPrimaryEvents = pendingPrimaryEvents.slice(-maxPendingEvents);
}

function normalizePrimaryLogDoc(event = {}, options = {}) {
  const cfg = getObserverSinkConfig();
  const occurredAt = toDateOrNow(event.occurredAt);
  return {
    source: event.source || cfg.sourceName || getObserverSourceName(),
    category: event.category || "generic",
    type: event.type || "event",
    level: event.level || "info",
    requestId: event.requestId || "",
    method: event.method || "",
    path: event.path || "",
    url: event.url || "",
    statusCode: event.statusCode ?? null,
    durationMs: event.durationMs ?? null,
    ip: event.ip || "",
    tags: Array.isArray(event.tags) ? event.tags : [],
    occurredAt,
    receivedAt: options.receivedAt ? toDateOrNow(options.receivedAt) : new Date(),
    archivedFromObserver: options.archivedFromObserver === true,
    observerEventId: options.observerEventId || event.id || event._id || "",
    routingMode: options.routingMode || event.routingMode || "primary",
    expireAt: buildExpireAt(cfg.primaryRetentionDays, occurredAt),
    payload:
      event.payload && typeof event.payload === "object"
        ? {
            ...event.payload,
            primaryDroppedEvents: primaryDroppedEvents || undefined,
          }
        : { primaryDroppedEvents: primaryDroppedEvents || undefined },
  };
}

async function flushPrimaryLogEventsNow(options = {}) {
  const cfg = getObserverSinkConfig();
  if (!options.force && !cfg.primaryLogEnabled) return;
  if (!pendingPrimaryEvents.length) return;
  if (primaryFlushInFlight) return primaryFlushInFlight;

  const batch = pendingPrimaryEvents.splice(0, cfg.primaryBatchSize);
  primaryFlushInFlight = PrimaryLogEvent.insertMany(batch, { ordered: false })
    .then((docs) => ({ ok: true, inserted: docs.length }))
    .catch((error) => {
      if (error?.code === 11000 || Array.isArray(error?.writeErrors)) {
        return {
          ok: true,
          inserted: Number(error?.insertedDocs?.length || 0),
          duplicates: true,
        };
      }

      pendingPrimaryEvents = batch.concat(pendingPrimaryEvents);
      trimPendingPrimaryEvents(cfg.primaryMaxPendingEvents);
      return {
        ok: false,
        error: error?.message || String(error),
      };
    })
    .finally(() => {
      primaryFlushInFlight = null;
    });

  return primaryFlushInFlight;
}

function ensurePrimaryFlushTimer() {
  const cfg = getObserverSinkConfig();
  if (!cfg.primaryLogEnabled || primaryFlushTimer) return;
  primaryFlushTimer = setInterval(() => {
    void flushPrimaryLogEventsNow();
  }, cfg.primaryFlushIntervalMs);
}

export function publishPrimaryLogEvent(event = {}, options = {}) {
  const cfg = getObserverSinkConfig();
  if (!cfg.primaryLogEnabled) return;

  pendingPrimaryEvents.push(normalizePrimaryLogDoc(event, options));
  trimPendingPrimaryEvents(cfg.primaryMaxPendingEvents);
  ensurePrimaryFlushTimer();

  if (pendingPrimaryEvents.length >= cfg.primaryBatchSize) {
    void flushPrimaryLogEventsNow();
  }
}

export async function insertPrimaryLogEventsFromObserver(items = []) {
  if (!Array.isArray(items) || !items.length) {
    return { ok: true, inserted: 0 };
  }

  const docs = items.map((item) =>
    normalizePrimaryLogDoc(item, {
      archivedFromObserver: true,
      observerEventId: item.id || item._id || item.observerEventId || "",
      routingMode: "observer_nightly_sync",
      receivedAt: item.receivedAt,
    })
  );

  try {
    const inserted = await PrimaryLogEvent.insertMany(docs, { ordered: false });
    return { ok: true, inserted: inserted.length };
  } catch (error) {
    if (error?.code === 11000 || Array.isArray(error?.writeErrors)) {
      return {
        ok: true,
        inserted: Number(error?.insertedDocs?.length || 0),
        duplicates: true,
      };
    }

    throw error;
  }
}

export function getPrimaryLogSinkStats() {
  return {
    pending: pendingPrimaryEvents.length,
    dropped: primaryDroppedEvents,
    flushInFlight: Boolean(primaryFlushInFlight),
  };
}

export function restartPrimaryLogSink() {
  if (primaryFlushTimer) {
    clearInterval(primaryFlushTimer);
    primaryFlushTimer = null;
  }
  if (pendingPrimaryEvents.length) {
    ensurePrimaryFlushTimer();
    void flushPrimaryLogEventsNow();
  }
}

export async function shutdownPrimaryLogSink() {
  if (primaryFlushTimer) {
    clearInterval(primaryFlushTimer);
    primaryFlushTimer = null;
  }
  await flushPrimaryLogEventsNow({ force: true }).catch(() => {});
}
