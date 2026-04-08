import { getPeakRuntimeMetricsSnapshot } from "./requestMetrics.service.js";
import { getObserverSinkConfig } from "./observerConfig.service.js";

let pendingEvents = [];
let flushTimer = null;
let flushInFlight = null;
let runtimeTimer = null;

function cloneConfig() {
  return getObserverSinkConfig();
}

function trimPendingEvents(maxPendingEvents) {
  if (pendingEvents.length <= maxPendingEvents) return;
  pendingEvents = pendingEvents.slice(-maxPendingEvents);
}

async function postObserverPayload(path, payload) {
  const cfg = cloneConfig();
  if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey) return { ok: false, skipped: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const response = await fetch(`${cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pkt-observer-key": cfg.apiKey,
        "x-pkt-observer-forwarded": "1",
        "x-pkt-observer-source": cfg.sourceName,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
      };
    }

    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function flushObserverEventsNow() {
  const cfg = cloneConfig();
  if (!cfg.enabled || !pendingEvents.length) return;
  if (flushInFlight) return flushInFlight;

  const batch = pendingEvents.splice(0, cfg.batchSize);
  flushInFlight = postObserverPayload("/api/observer/ingest/events", {
    source: cfg.sourceName,
    events: batch,
  })
    .then((result) => {
      if (!result?.ok) {
        pendingEvents = batch.concat(pendingEvents);
        trimPendingEvents(cfg.maxPendingEvents);
      }
      return result;
    })
    .finally(() => {
      flushInFlight = null;
    });

  return flushInFlight;
}

function ensureFlushTimer() {
  const cfg = cloneConfig();
  if (!cfg.enabled || flushTimer) return;
  flushTimer = setInterval(() => {
    void flushObserverEventsNow();
  }, cfg.flushIntervalMs);
}

export function publishObserverEvent(event = {}) {
  const cfg = cloneConfig();
  if (!cfg.enabled) return;

  pendingEvents.push({
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
    occurredAt: event.occurredAt || new Date().toISOString(),
    payload:
      event.payload && typeof event.payload === "object" ? event.payload : {},
  });

  trimPendingEvents(cfg.maxPendingEvents);
  ensureFlushTimer();
  if (pendingEvents.length >= cfg.batchSize) {
    void flushObserverEventsNow();
  }
}

export async function publishObserverBackupSnapshot(snapshot = {}) {
  const cfg = cloneConfig();
  if (!cfg.enabled) return { ok: false, skipped: true };

  return postObserverPayload("/api/observer/ingest/backups", {
    source: cfg.sourceName,
    snapshot,
  });
}

export async function publishObserverRuntimeSnapshot() {
  const cfg = cloneConfig();
  if (!cfg.enabled || !cfg.runtimePushEnabled) {
    return { ok: false, skipped: true };
  }

  const [
    { getLiveRecordingExportQueueSnapshot },
    { getLiveRecordingWorkerHealth },
  ] = await Promise.all([
    import("./liveRecordingV2Queue.service.js"),
    import("./liveRecordingWorkerHealth.service.js"),
  ]);

  const [exportQueue, recordingWorker] = await Promise.all([
    getLiveRecordingExportQueueSnapshot().catch((error) => ({
      ok: false,
      message: error?.message || "Failed to load export queue snapshot",
    })),
    getLiveRecordingWorkerHealth().catch((error) => ({
      ok: false,
      alive: false,
      status: "error",
      message: error?.message || "Failed to load recording worker health",
    })),
  ]);

  const snapshot = {
    capturedAt: new Date().toISOString(),
    runtime: getPeakRuntimeMetricsSnapshot(),
    recordingExport: {
      queue: exportQueue,
      worker: recordingWorker,
    },
  };

  return postObserverPayload("/api/observer/ingest/runtime", {
    source: cfg.sourceName,
    snapshot,
  });
}

export function startObserverRuntimePublisher() {
  const cfg = cloneConfig();
  if (!cfg.enabled || !cfg.runtimePushEnabled || runtimeTimer) return;
  runtimeTimer = setInterval(() => {
    void publishObserverRuntimeSnapshot();
  }, cfg.runtimePushIntervalMs);
  void publishObserverRuntimeSnapshot();
}

export async function shutdownObserverSink() {
  if (runtimeTimer) {
    clearInterval(runtimeTimer);
    runtimeTimer = null;
  }
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushObserverEventsNow().catch(() => {});
}
