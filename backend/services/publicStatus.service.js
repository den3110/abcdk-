import { getPeakRuntimeMetricsSnapshot } from "./requestMetrics.service.js";
import { getLiveRecordingWorkerHealth } from "./liveRecordingWorkerHealth.service.js";
import { getRecordingStorageHealthSummary } from "./liveRecordingV2Storage.service.js";

const REFRESH_INTERVAL_SECONDS = 30;
const PROBE_TIMEOUT_MS = 2500;

const SERVICE_LABELS = {
  "public-api": "Public API",
  "go-api": "Go API",
  "relay-rtmp": "RTMP Relay",
  scheduler: "Scheduler",
  "recording-export": "Recording Export",
  "ai-commentary-worker": "AI Commentary Worker",
  "general-worker": "General Worker",
  "recording-storage": "Recording Storage",
};

function asNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asNonNegativeInteger(value) {
  const numeric = asNumber(value);
  if (numeric == null || numeric < 0) return null;
  return Math.round(numeric);
}

function asIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function coerceMetric(value, fractionDigits = 1) {
  const numeric = asNumber(value);
  if (numeric == null || numeric < 0) return null;
  return Number(numeric.toFixed(fractionDigits));
}

function buildServiceShape({
  key,
  category,
  status = "unknown",
  uptimeSeconds = null,
  latencyMs = null,
  checkedAt = null,
  detail = "Health status is unavailable right now.",
  meta = {},
}) {
  return {
    key,
    label: SERVICE_LABELS[key] || key,
    category,
    status,
    uptimeSeconds,
    latencyMs,
    checkedAt: asIsoDate(checkedAt) || new Date().toISOString(),
    detail,
    meta,
  };
}

export function resolveConfiguredPort(env, keys, fallback) {
  for (const key of keys) {
    const raw = String(env?.[key] || "").trim();
    if (!raw) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(Math.floor(parsed));
    }
    return raw;
  }

  return String(fallback);
}

function getInternalProbeDefinitions(env = process.env) {
  return [
    {
      key: "go-api",
      category: "api",
      url: `http://127.0.0.1:${resolveConfiguredPort(env, ["BACKEND_GO_PORT"], 8005)}/healthz`,
    },
    {
      key: "relay-rtmp",
      category: "realtime",
      url: `http://127.0.0.1:${resolveConfiguredPort(
        env,
        ["BACKEND_GO_RTMP_PORT", "RTMP_PORT"],
        5002
      )}/healthz`,
    },
    {
      key: "scheduler",
      category: "worker",
      url: `http://127.0.0.1:${resolveConfiguredPort(
        env,
        ["BACKEND_GO_SCHEDULER_PORT"],
        8010
      )}/healthz`,
    },
    {
      key: "recording-export",
      category: "worker",
      url: `http://127.0.0.1:${resolveConfiguredPort(
        env,
        ["BACKEND_GO_RECORDING_EXPORT_PORT"],
        8011
      )}/healthz`,
    },
    {
      key: "ai-commentary-worker",
      category: "worker",
      url: `http://127.0.0.1:${resolveConfiguredPort(
        env,
        ["BACKEND_GO_AI_COMMENTARY_PORT"],
        8012
      )}/healthz`,
    },
    {
      key: "general-worker",
      category: "worker",
      url: `http://127.0.0.1:${resolveConfiguredPort(
        env,
        ["BACKEND_GO_WORKER_GENERAL_PORT"],
        8013
      )}/healthz`,
    },
  ];
}

function extractUptimeSeconds(payload, nowMs = Date.now()) {
  const direct = asNonNegativeInteger(payload?.uptimeSeconds);
  if (direct != null) return direct;

  const startedAt = asIsoDate(payload?.startedAt);
  if (!startedAt) return null;

  const diffMs = nowMs - new Date(startedAt).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Math.round(diffMs / 1000);
}

async function probeHttpService(definition, nowMs = Date.now()) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedMs = Date.now();

  try {
    const response = await fetch(definition.url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedMs;

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }

    if (!response.ok) {
      return buildServiceShape({
        key: definition.key,
        category: definition.category,
        status: "down",
        latencyMs,
        detail:
          response.status >= 500
            ? "Health check returned a server error."
            : `Health check returned HTTP ${response.status}.`,
        meta: {
          httpStatus: response.status,
          reason: "http_error",
        },
      });
    }

    return buildServiceShape({
      key: definition.key,
      category: definition.category,
      status: "operational",
      uptimeSeconds: extractUptimeSeconds(payload, nowMs),
      latencyMs,
      checkedAt: new Date(),
      detail: "Service is responding normally.",
      meta: {},
    });
  } catch (error) {
    const isTimeout =
      error?.name === "AbortError" || /abort/i.test(String(error?.message || ""));

    return buildServiceShape({
      key: definition.key,
      category: definition.category,
      status: "down",
      latencyMs: Date.now() - startedMs,
      detail: isTimeout ? "Health check timed out." : "Health check failed.",
      meta: {
        reason: isTimeout ? "timeout" : "connection_failed",
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildPublicApiService(runtimeSnapshot, generatedAt, telemetryOk = true) {
  const totals = runtimeSnapshot?.totals || {};
  const processInfo = runtimeSnapshot?.process || {};
  const requestRatePerMin = coerceMetric(totals.reqPerMin, 2);
  const apiP95Ms = asNonNegativeInteger(totals.p95Ms);

  return buildServiceShape({
    key: "public-api",
    category: "gateway",
    status: "operational",
    uptimeSeconds: asNonNegativeInteger(processInfo.uptimeSeconds),
    latencyMs: apiP95Ms,
    checkedAt: runtimeSnapshot?.capturedAt || generatedAt,
    detail: telemetryOk
      ? "Public API gateway is responding normally."
      : "Public API gateway is responding, but telemetry is unavailable.",
    meta: {
      telemetryOk,
      requestRatePerMin,
      apiP95Ms,
    },
  });
}

export function mapStorageHealthToStatus(summary) {
  const targets = Array.isArray(summary?.targets) ? summary.targets : [];
  if (!targets.length) return "unknown";

  const healthyTargetCount = Number(summary?.healthyTargetCount || 0);
  const probeableTargetCount = targets.filter((target) => target?.probeable).length;
  const hasDeadTarget = targets.some((target) => target?.status === "dead");

  if (healthyTargetCount > 0 && healthyTargetCount === targets.length) {
    return "operational";
  }

  if (healthyTargetCount === 0 && hasDeadTarget) {
    return "down";
  }

  if (probeableTargetCount === 0) {
    return "unknown";
  }

  return "degraded";
}

function buildRecordingStorageService(storageHealth) {
  const targets = Array.isArray(storageHealth?.targets) ? storageHealth.targets : [];
  const healthyTargetCount = Number(storageHealth?.healthyTargetCount || 0);
  const status = mapStorageHealthToStatus(storageHealth);
  const latencyValues = targets
    .map((target) => asNumber(target?.latencyMs))
    .filter((value) => value != null && value >= 0);
  const averageLatencyMs = latencyValues.length
    ? Math.round(
        latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length
      )
    : null;

  let detail = "Storage health is unavailable right now.";
  if (!targets.length) {
    detail = "Recording storage is not configured.";
  } else if (status === "operational") {
    detail = `All ${targets.length} storage targets are healthy.`;
  } else if (status === "degraded") {
    detail = `${healthyTargetCount} of ${targets.length} storage targets are healthy.`;
  } else if (status === "down") {
    detail = "No storage targets are healthy right now.";
  } else if (status === "unknown") {
    detail = "Storage health cannot be checked right now.";
  }

  return buildServiceShape({
    key: "recording-storage",
    category: "storage",
    status,
    latencyMs: averageLatencyMs,
    checkedAt: storageHealth?.checkedAt || new Date(),
    detail,
    meta: {
      healthyTargetCount,
      deadTargetCount: Number(storageHealth?.deadTargetCount || 0),
      unprobeableTargetCount: Number(storageHealth?.unprobeableTargetCount || 0),
      targetCount: targets.length,
    },
  });
}

function buildRecordingExportService(probeService, workerHealth) {
  const lastHeartbeatAt = asIsoDate(workerHealth?.lastHeartbeatAt);
  const workerStatus = String(workerHealth?.status || "unknown").trim() || "unknown";

  if (probeService.status === "down") {
    return {
      ...probeService,
      detail: "Recording export worker is not responding.",
      meta: {
        workerStatus,
        lastHeartbeatAt,
      },
    };
  }

  if (!workerHealth || workerHealth.ok === false) {
    return {
      ...probeService,
      status: "degraded",
      detail: "Worker heartbeat is unavailable right now.",
      meta: {
        workerStatus: "unknown",
        lastHeartbeatAt,
      },
    };
  }

  if (!workerHealth.alive) {
    const degradedDetail =
      workerStatus === "stale"
        ? "Process responds, but worker heartbeat is stale."
        : "Process responds, but worker heartbeat is offline.";

    return {
      ...probeService,
      status: "degraded",
      detail: degradedDetail,
      meta: {
        workerStatus,
        lastHeartbeatAt,
      },
    };
  }

  return {
    ...probeService,
    status: "operational",
    detail:
      workerStatus === "busy"
        ? "Worker heartbeat is healthy and processing jobs."
        : "Worker heartbeat is healthy and idle.",
    meta: {
      workerStatus,
      lastHeartbeatAt,
    },
  };
}

export function reduceOverallStatus(services = []) {
  const publicApi = services.find((service) => service?.key === "public-api");
  if (!publicApi || publicApi.status !== "operational") {
    return "down";
  }

  const hasNonOperationalDependency = services.some(
    (service) => service?.key !== "public-api" && service?.status !== "operational"
  );

  return hasNonOperationalDependency ? "degraded" : "operational";
}

function buildFallbackRuntimeSnapshot(generatedAt) {
  return {
    capturedAt: generatedAt,
    process: {
      uptimeSeconds: Math.round(process.uptime()),
    },
    totals: {
      reqPerMin: null,
      p95Ms: null,
    },
  };
}

export async function getPublicStatusSnapshot() {
  const generatedAt = new Date().toISOString();

  let runtimeSnapshot = null;
  let telemetryOk = true;
  try {
    runtimeSnapshot = getPeakRuntimeMetricsSnapshot();
  } catch (_) {
    telemetryOk = false;
    runtimeSnapshot = buildFallbackRuntimeSnapshot(generatedAt);
  }

  const definitions = getInternalProbeDefinitions();
  const [probedServices, workerHealth, storageHealth] = await Promise.all([
    Promise.all(definitions.map((definition) => probeHttpService(definition))),
    getLiveRecordingWorkerHealth().catch(() => ({
      ok: false,
      alive: false,
      status: "unknown",
      lastHeartbeatAt: null,
    })),
    getRecordingStorageHealthSummary().catch(() => ({
      healthyTargetCount: 0,
      deadTargetCount: 0,
      unprobeableTargetCount: 0,
      targets: [],
      checkedAt: new Date(),
    })),
  ]);

  const probedByKey = new Map(probedServices.map((service) => [service.key, service]));
  const publicApi = buildPublicApiService(runtimeSnapshot, generatedAt, telemetryOk);
  const services = [
    publicApi,
    probedByKey.get("go-api") ||
      buildServiceShape({ key: "go-api", category: "api" }),
    probedByKey.get("relay-rtmp") ||
      buildServiceShape({ key: "relay-rtmp", category: "realtime" }),
    probedByKey.get("scheduler") ||
      buildServiceShape({ key: "scheduler", category: "worker" }),
    buildRecordingExportService(
      probedByKey.get("recording-export") ||
        buildServiceShape({ key: "recording-export", category: "worker" }),
      workerHealth
    ),
    probedByKey.get("ai-commentary-worker") ||
      buildServiceShape({ key: "ai-commentary-worker", category: "worker" }),
    probedByKey.get("general-worker") ||
      buildServiceShape({ key: "general-worker", category: "worker" }),
    buildRecordingStorageService(storageHealth),
  ];

  return {
    overallStatus: reduceOverallStatus(services),
    generatedAt,
    refreshIntervalSeconds: REFRESH_INTERVAL_SECONDS,
    summary: {
      gatewayUptimeSeconds: publicApi.uptimeSeconds,
      requestRatePerMin: publicApi.meta?.requestRatePerMin ?? null,
      apiP95Ms: publicApi.meta?.apiP95Ms ?? null,
      healthyServiceCount: services.filter(
        (service) => service.status === "operational"
      ).length,
      serviceCount: services.length,
    },
    services,
  };
}
