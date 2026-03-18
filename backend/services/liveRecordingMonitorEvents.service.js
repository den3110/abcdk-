import IORedis from "ioredis";

let liveRecordingMonitorPublisher = null;
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const REDIS_CHANNEL =
  process.env.LIVE_RECORDING_MONITOR_EVENTS_CHANNEL ||
  "live-recording-monitor-events";
let redisPublisher = null;

let liveRecordingMonitorMeta = {
  realtimeMode: "event-driven",
  lastEventAt: null,
  lastEventReason: "bootstrap",
  lastEventMode: "event",
  lastPublishAt: null,
  lastPublishMode: "event",
  lastReconcileAt: null,
};

function normalizeRecordingIds(recordingIds) {
  if (!Array.isArray(recordingIds)) return [];
  return Array.from(
    new Set(
      recordingIds
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  );
}

function normalizePayload(payload = {}) {
  return {
    reason: String(payload.reason || "unknown_event").trim() || "unknown_event",
    recordingIds: normalizeRecordingIds(payload.recordingIds),
    mode: payload.mode === "reconcile" ? "reconcile" : "event",
    at:
      payload.at instanceof Date && Number.isFinite(payload.at.getTime())
        ? payload.at
        : new Date(),
  };
}

export function registerLiveRecordingMonitorPublisher(publisher) {
  liveRecordingMonitorPublisher =
    typeof publisher === "function" ? publisher : null;
}

export function getLiveRecordingMonitorEventsChannel() {
  return REDIS_CHANNEL;
}

function getRedisPublisher() {
  if (!REDIS_URL) return null;
  if (!redisPublisher) {
    redisPublisher = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    redisPublisher.on("error", (error) => {
      console.warn(
        "[live-recording-monitor-events] redis publish error:",
        error?.message || error
      );
    });
  }
  return redisPublisher;
}

export function setLiveRecordingMonitorMeta(payload = {}) {
  const normalized = normalizePayload(payload);
  liveRecordingMonitorMeta = {
    ...liveRecordingMonitorMeta,
    realtimeMode: "event-driven",
    lastPublishAt: normalized.at,
    lastPublishMode: normalized.mode,
  };
  if (normalized.mode === "reconcile") {
    liveRecordingMonitorMeta.lastReconcileAt = normalized.at;
  } else {
    liveRecordingMonitorMeta.lastEventAt = normalized.at;
    liveRecordingMonitorMeta.lastEventReason = normalized.reason;
    liveRecordingMonitorMeta.lastEventMode = normalized.mode;
  }
  return { ...liveRecordingMonitorMeta };
}

export function getLiveRecordingMonitorMeta() {
  return { ...liveRecordingMonitorMeta };
}

export async function publishLiveRecordingMonitorUpdate(payload = {}) {
  const normalized = normalizePayload(payload);
  setLiveRecordingMonitorMeta(normalized);
  if (typeof liveRecordingMonitorPublisher === "function") {
    try {
      await liveRecordingMonitorPublisher(normalized);
      return true;
    } catch (error) {
      console.warn(
        "[live-recording-monitor-events] publish failed:",
        error?.message || error
      );
      return false;
    }
  }
  const redis = getRedisPublisher();
  if (!redis) return false;
  try {
    await redis.publish(
      REDIS_CHANNEL,
      JSON.stringify({
        ...normalized,
        at: normalized.at.toISOString(),
      })
    );
    return true;
  } catch (error) {
    console.warn(
      "[live-recording-monitor-events] redis publish failed:",
      error?.message || error
    );
    return false;
  }
}
