import IORedis from "ioredis";

let fbVodDriveMonitorPublisher = null;
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const REDIS_CHANNEL =
  process.env.FB_VOD_MONITOR_EVENTS_CHANNEL || "fb-vod-monitor-events";
let redisPublisher = null;

let fbVodDriveMonitorMeta = {
  realtimeMode: "event-driven",
  lastEventAt: null,
  lastEventReason: "bootstrap",
  lastEventMode: "event",
  lastPublishAt: null,
  lastPublishMode: "event",
  lastReconcileAt: null,
};

function normalizeMatchIds(matchIds) {
  if (!Array.isArray(matchIds)) return [];
  return Array.from(
    new Set(
      matchIds
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  );
}

function normalizePayload(payload = {}) {
  return {
    reason: String(payload.reason || "unknown_event").trim() || "unknown_event",
    matchIds: normalizeMatchIds(payload.matchIds),
    mode: payload.mode === "reconcile" ? "reconcile" : "event",
    at:
      payload.at instanceof Date && Number.isFinite(payload.at.getTime())
        ? payload.at
        : new Date(),
  };
}

export function registerFbVodDriveMonitorPublisher(publisher) {
  fbVodDriveMonitorPublisher =
    typeof publisher === "function" ? publisher : null;
}

export function getFbVodDriveMonitorEventsChannel() {
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
        "[fb-vod-monitor-events] redis publish error:",
        error?.message || error
      );
    });
  }
  return redisPublisher;
}

export function setFbVodDriveMonitorMeta(payload = {}) {
  const normalized = normalizePayload(payload);
  fbVodDriveMonitorMeta = {
    ...fbVodDriveMonitorMeta,
    realtimeMode: "event-driven",
    lastPublishAt: normalized.at,
    lastPublishMode: normalized.mode,
  };
  if (normalized.mode === "reconcile") {
    fbVodDriveMonitorMeta.lastReconcileAt = normalized.at;
  } else {
    fbVodDriveMonitorMeta.lastEventAt = normalized.at;
    fbVodDriveMonitorMeta.lastEventReason = normalized.reason;
    fbVodDriveMonitorMeta.lastEventMode = normalized.mode;
  }
  return { ...fbVodDriveMonitorMeta };
}

export function getFbVodDriveMonitorMeta() {
  return { ...fbVodDriveMonitorMeta };
}

export async function publishFbVodDriveMonitorUpdate(payload = {}) {
  const normalized = normalizePayload(payload);
  setFbVodDriveMonitorMeta(normalized);
  if (typeof fbVodDriveMonitorPublisher === "function") {
    try {
      await fbVodDriveMonitorPublisher(normalized);
      return true;
    } catch (error) {
      console.warn(
        "[fb-vod-monitor-events] publish failed:",
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
      "[fb-vod-monitor-events] redis publish failed:",
      error?.message || error
    );
    return false;
  }
}
