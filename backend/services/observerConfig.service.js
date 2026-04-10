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

function normalizeBaseUrl(value) {
  const normalized = asTrimmed(value).replace(/\/+$/, "");
  if (!normalized) return "";
  try {
    return new URL(normalized).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
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
  const enabled =
    explicitlyEnabled || Boolean(baseUrl && apiKey);

  return {
    enabled,
    baseUrl,
    apiKey,
    sourceName: getObserverSourceName(),
    timeoutMs: parsePositiveInt(process.env.OBSERVER_TIMEOUT_MS, 4000),
    batchSize: parsePositiveInt(process.env.OBSERVER_BATCH_SIZE, 100),
    flushIntervalMs: parsePositiveInt(
      process.env.OBSERVER_FLUSH_INTERVAL_MS,
      5000
    ),
    maxPendingEvents: parsePositiveInt(
      process.env.OBSERVER_MAX_PENDING_EVENTS,
      2000
    ),
    runtimePushEnabled: parseBool(
      process.env.OBSERVER_RUNTIME_PUSH_ENABLED,
      true
    ),
    runtimePushIntervalMs: parsePositiveInt(
      process.env.OBSERVER_RUNTIME_PUSH_INTERVAL_MS,
      15000
    ),
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
