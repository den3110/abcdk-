import os from "os";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const HEARTBEAT_KEY =
  process.env.LIVE_RECORDING_WORKER_HEALTH_KEY ||
  "live-recording-worker:health";
const HEARTBEAT_TTL_SECONDS = Math.max(
  10,
  Number(process.env.LIVE_RECORDING_WORKER_HEALTH_TTL_SECONDS) || 30
);
const HEARTBEAT_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.LIVE_RECORDING_WORKER_HEALTH_INTERVAL_MS) || 10_000
);

let redisClient = null;

function getRedisClient() {
  if (!redisClient) {
    redisClient = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    redisClient.on("error", (error) => {
      console.warn(
        "[live-recording-worker-health] redis error:",
        error?.message || error
      );
    });
  }
  return redisClient;
}

function sanitizeText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function buildPayload(payload = {}) {
  return {
    workerName:
      sanitizeText(payload.workerName) || "live-recording-export-worker",
    queueName: sanitizeText(payload.queueName),
    hostname: sanitizeText(payload.hostname) || os.hostname(),
    pid: Number(payload.pid) || process.pid,
    startedAt:
      sanitizeText(payload.startedAt) || new Date().toISOString(),
    status: sanitizeText(payload.status) || "idle",
    currentJobId: sanitizeText(payload.currentJobId),
    currentRecordingId: sanitizeText(payload.currentRecordingId),
    currentJobStartedAt: sanitizeText(payload.currentJobStartedAt),
    lastHeartbeatAt: new Date().toISOString(),
    lastCompletedAt: sanitizeText(payload.lastCompletedAt),
    lastFailedAt: sanitizeText(payload.lastFailedAt),
    lastFailedReason: sanitizeText(payload.lastFailedReason),
  };
}

export function getLiveRecordingWorkerHeartbeatConfig() {
  return {
    redisUrl: REDIS_URL,
    key: HEARTBEAT_KEY,
    ttlSeconds: HEARTBEAT_TTL_SECONDS,
    intervalMs: HEARTBEAT_INTERVAL_MS,
  };
}

export async function publishLiveRecordingWorkerHeartbeat(payload = {}) {
  const client = getRedisClient();
  const body = JSON.stringify(buildPayload(payload));
  await client.set(HEARTBEAT_KEY, body, "EX", HEARTBEAT_TTL_SECONDS);
  return true;
}

export async function clearLiveRecordingWorkerHeartbeat() {
  const client = getRedisClient();
  await client.del(HEARTBEAT_KEY);
  return true;
}

export async function getLiveRecordingWorkerHealth() {
  const client = getRedisClient();
  const [raw, ttlSeconds] = await Promise.all([
    client.get(HEARTBEAT_KEY),
    client.ttl(HEARTBEAT_KEY),
  ]);

  if (!raw) {
    return {
      ok: true,
      alive: false,
      status: "offline",
      ttlSeconds,
      lastHeartbeatAt: null,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      heartbeatTtlSeconds: HEARTBEAT_TTL_SECONDS,
      worker: null,
    };
  }

  let worker = null;
  try {
    worker = JSON.parse(raw);
  } catch (_) {
    worker = null;
  }

  const lastHeartbeatAt = worker?.lastHeartbeatAt || null;
  const alive =
    Boolean(lastHeartbeatAt) &&
    Date.now() - new Date(lastHeartbeatAt).getTime() <
      HEARTBEAT_TTL_SECONDS * 1000;

  return {
    ok: true,
    alive,
    status: alive ? worker?.status || "idle" : "stale",
    ttlSeconds,
    lastHeartbeatAt,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    heartbeatTtlSeconds: HEARTBEAT_TTL_SECONDS,
    worker,
  };
}
