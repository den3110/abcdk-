function asTrimmed(value) {
  return String(value || "").trim();
}

function parseBool(value, fallback = false) {
  const normalized = asTrimmed(value).toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeMinLevel(value) {
  const normalized = asTrimmed(value).toLowerCase();
  return ["info", "warn", "error"].includes(normalized) ? normalized : "info";
}

function normalizeSmartMode(value) {
  const normalized = asTrimmed(value).toLowerCase();
  return ["smart", "primary", "observer", "hybrid"].includes(normalized)
    ? normalized
    : "smart";
}

function normalizeBaseUrl(value) {
  const normalized = asTrimmed(value).replace(/\/+$/, "");
  if (!normalized) return "";
  try {
    return new URL(normalized).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

let observerRuntimeSettings = {};

export function setObserverRuntimeSettings(settings = {}) {
  observerRuntimeSettings = {
    enabled: settings?.enabled !== false,
    httpAccessEnabled: settings?.httpAccessEnabled !== false,
    smartMode: normalizeSmartMode(settings?.smartMode),
    primaryLogEnabled: settings?.primaryLogEnabled !== false,
    minLevel: normalizeMinLevel(settings?.minLevel),
    successSampleRate: clampNumber(settings?.successSampleRate, 1, 0, 1),
    batchSize: Math.floor(clampNumber(settings?.batchSize, 100, 1, 1000)),
    flushIntervalMs: Math.floor(
      clampNumber(settings?.flushIntervalMs, 5000, 500, 60000)
    ),
    maxPendingEvents: Math.floor(
      clampNumber(settings?.maxPendingEvents, 2000, 100, 50000)
    ),
    timeoutMs: Math.floor(clampNumber(settings?.timeoutMs, 4000, 500, 30000)),
    primaryBatchSize: Math.floor(
      clampNumber(settings?.primaryBatchSize, 100, 1, 1000)
    ),
    primaryFlushIntervalMs: Math.floor(
      clampNumber(settings?.primaryFlushIntervalMs, 5000, 500, 60000)
    ),
    primaryMaxPendingEvents: Math.floor(
      clampNumber(settings?.primaryMaxPendingEvents, 5000, 100, 100000)
    ),
    primaryRetentionDays: Math.floor(
      clampNumber(settings?.primaryRetentionDays, 14, 1, 365)
    ),
    primaryQueueBurstThreshold: Math.floor(
      clampNumber(settings?.primaryQueueBurstThreshold, 3000, 100, 100000)
    ),
    burstReqPerMinuteThreshold: Math.floor(
      clampNumber(settings?.burstReqPerMinuteThreshold, 1200, 10, 100000)
    ),
    burstP95MsThreshold: Math.floor(
      clampNumber(settings?.burstP95MsThreshold, 1500, 50, 60000)
    ),
    burst5xxPerMinuteThreshold: Math.floor(
      clampNumber(settings?.burst5xxPerMinuteThreshold, 30, 1, 10000)
    ),
    burstCooldownMs: Math.floor(
      clampNumber(settings?.burstCooldownMs, 300000, 10000, 3600000)
    ),
    runtimePushEnabled: settings?.runtimePushEnabled !== false,
    runtimePushIntervalMs: Math.floor(
      clampNumber(settings?.runtimePushIntervalMs, 15000, 5000, 300000)
    ),
    nightlySyncEnabled: settings?.nightlySyncEnabled !== false,
    nightlySyncStartHour: Math.floor(
      clampNumber(settings?.nightlySyncStartHour, 1, 0, 23)
    ),
    nightlySyncEndHour: Math.floor(
      clampNumber(settings?.nightlySyncEndHour, 5, 0, 23)
    ),
    nightlySyncIntervalMs: Math.floor(
      clampNumber(settings?.nightlySyncIntervalMs, 600000, 60000, 86400000)
    ),
    nightlySyncLimit: Math.floor(
      clampNumber(settings?.nightlySyncLimit, 500, 1, 500)
    ),
    nightlySyncLookbackHours: Math.floor(
      clampNumber(settings?.nightlySyncLookbackHours, 24, 1, 168)
    ),
    aiAdvisorEnabled: settings?.aiAdvisorEnabled !== false,
    aiAdvisorTimeoutMs: Math.floor(
      clampNumber(settings?.aiAdvisorTimeoutMs, 8000, 1000, 60000)
    ),
    aiAdvisorMinIntervalMs: Math.floor(
      clampNumber(settings?.aiAdvisorMinIntervalMs, 300000, 60000, 3600000)
    ),
  };
}

export function getObserverSourceName() {
  return (
    asTrimmed(process.env.OBSERVER_SOURCE_NAME) ||
    asTrimmed(process.env.SERVICE_NAME) ||
    "pickletour-api"
  );
}

export function getObserverApiKey() {
  return asTrimmed(process.env.OBSERVER_API_KEY);
}

export function getObserverReadApiKey() {
  return asTrimmed(process.env.OBSERVER_READ_API_KEY) || getObserverApiKey();
}

export function getObserverReadProxyConfig() {
  const sinkCfg = getObserverSinkConfig();
  const readApiKey = getObserverReadApiKey();

  return {
    enabled: Boolean(sinkCfg.baseUrl && readApiKey),
    baseUrl: sinkCfg.baseUrl,
    readApiKey,
    timeoutMs: sinkCfg.timeoutMs,
    sourceName: sinkCfg.sourceName,
  };
}

export function getObserverSinkConfig() {
  const baseUrl = normalizeBaseUrl(process.env.OBSERVER_BASE_URL);
  const apiKey = getObserverApiKey();
  const explicitlyEnabled = parseBool(process.env.OBSERVER_SINK_ENABLED, false);
  const runtime = observerRuntimeSettings || {};
  const enabled =
    runtime.enabled !== false && (explicitlyEnabled || Boolean(baseUrl && apiKey));

  return {
    enabled,
    baseUrl,
    apiKey,
    sourceName: getObserverSourceName(),
    timeoutMs:
      runtime.timeoutMs || parsePositiveInt(process.env.OBSERVER_TIMEOUT_MS, 4000),
    batchSize:
      runtime.batchSize || parsePositiveInt(process.env.OBSERVER_BATCH_SIZE, 100),
    flushIntervalMs:
      runtime.flushIntervalMs ||
      parsePositiveInt(process.env.OBSERVER_FLUSH_INTERVAL_MS, 5000),
    maxPendingEvents:
      runtime.maxPendingEvents ||
      parsePositiveInt(process.env.OBSERVER_MAX_PENDING_EVENTS, 2000),
    httpAccessEnabled: runtime.httpAccessEnabled !== false,
    smartMode: normalizeSmartMode(
      runtime.smartMode || process.env.OBSERVER_LOG_SMART_MODE
    ),
    primaryLogEnabled:
      runtime.primaryLogEnabled !== false &&
      parseBool(process.env.OBSERVER_PRIMARY_LOG_ENABLED, true),
    minLevel: normalizeMinLevel(runtime.minLevel || process.env.OBSERVER_MIN_LEVEL),
    successSampleRate: clampNumber(runtime.successSampleRate, 1, 0, 1),
    primaryBatchSize:
      runtime.primaryBatchSize ||
      parsePositiveInt(process.env.OBSERVER_PRIMARY_BATCH_SIZE, 100),
    primaryFlushIntervalMs:
      runtime.primaryFlushIntervalMs ||
      parsePositiveInt(process.env.OBSERVER_PRIMARY_FLUSH_INTERVAL_MS, 5000),
    primaryMaxPendingEvents:
      runtime.primaryMaxPendingEvents ||
      parsePositiveInt(process.env.OBSERVER_PRIMARY_MAX_PENDING_EVENTS, 5000),
    primaryRetentionDays:
      runtime.primaryRetentionDays ||
      parsePositiveInt(process.env.OBSERVER_PRIMARY_RETENTION_DAYS, 14),
    primaryQueueBurstThreshold:
      runtime.primaryQueueBurstThreshold ||
      parsePositiveInt(process.env.OBSERVER_PRIMARY_QUEUE_BURST_THRESHOLD, 3000),
    burstReqPerMinuteThreshold:
      runtime.burstReqPerMinuteThreshold ||
      parsePositiveInt(process.env.OBSERVER_BURST_REQ_PER_MINUTE_THRESHOLD, 1200),
    burstP95MsThreshold:
      runtime.burstP95MsThreshold ||
      parsePositiveInt(process.env.OBSERVER_BURST_P95_MS_THRESHOLD, 1500),
    burst5xxPerMinuteThreshold:
      runtime.burst5xxPerMinuteThreshold ||
      parsePositiveInt(process.env.OBSERVER_BURST_5XX_PER_MINUTE_THRESHOLD, 30),
    burstCooldownMs:
      runtime.burstCooldownMs ||
      parsePositiveInt(process.env.OBSERVER_BURST_COOLDOWN_MS, 300000),
    runtimePushEnabled:
      runtime.runtimePushEnabled !== false &&
      parseBool(process.env.OBSERVER_RUNTIME_PUSH_ENABLED, true),
    runtimePushIntervalMs:
      runtime.runtimePushIntervalMs ||
      parsePositiveInt(process.env.OBSERVER_RUNTIME_PUSH_INTERVAL_MS, 15000),
    nightlySyncEnabled:
      runtime.nightlySyncEnabled !== false &&
      parseBool(process.env.OBSERVER_NIGHTLY_SYNC_ENABLED, true),
    nightlySyncStartHour:
      runtime.nightlySyncStartHour ??
      parsePositiveInt(process.env.OBSERVER_NIGHTLY_SYNC_START_HOUR, 1),
    nightlySyncEndHour:
      runtime.nightlySyncEndHour ??
      parsePositiveInt(process.env.OBSERVER_NIGHTLY_SYNC_END_HOUR, 5),
    nightlySyncIntervalMs:
      runtime.nightlySyncIntervalMs ||
      parsePositiveInt(process.env.OBSERVER_NIGHTLY_SYNC_INTERVAL_MS, 600000),
    nightlySyncLimit:
      runtime.nightlySyncLimit ||
      parsePositiveInt(process.env.OBSERVER_NIGHTLY_SYNC_LIMIT, 500),
    nightlySyncLookbackHours:
      runtime.nightlySyncLookbackHours ||
      parsePositiveInt(process.env.OBSERVER_NIGHTLY_SYNC_LOOKBACK_HOURS, 24),
    aiAdvisorEnabled:
      runtime.aiAdvisorEnabled !== false &&
      parseBool(process.env.OBSERVER_AI_ADVISOR_ENABLED, true),
    aiAdvisorTimeoutMs:
      runtime.aiAdvisorTimeoutMs ||
      parsePositiveInt(process.env.OBSERVER_AI_ADVISOR_TIMEOUT_MS, 8000),
    aiAdvisorMinIntervalMs:
      runtime.aiAdvisorMinIntervalMs ||
      parsePositiveInt(process.env.OBSERVER_AI_ADVISOR_MIN_INTERVAL_MS, 300000),
  };
}

export function getObserverCollectorConfig() {
  return {
    apiKey: getObserverApiKey(),
    readApiKey: getObserverReadApiKey(),
    eventTtlDays: parsePositiveInt(process.env.OBSERVER_EVENT_TTL_DAYS, 7),
    runtimeTtlDays: parsePositiveInt(process.env.OBSERVER_RUNTIME_TTL_DAYS, 14),
    backupTtlDays: parsePositiveInt(process.env.OBSERVER_BACKUP_TTL_DAYS, 60),
  };
}

export function buildExpireAt(ttlDays, now = new Date()) {
  const safeDays = parsePositiveInt(ttlDays, 7);
  return new Date(now.getTime() + safeDays * 24 * 60 * 60 * 1000);
}

export function isObserverInternalPath(url = "") {
  return /^\/api\/observer(?:\/|$)/i.test(String(url || "").trim());
}
