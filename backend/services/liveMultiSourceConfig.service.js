import AppSetting from "../models/appSettingModel.js";
import { CACHE_GROUP_IDS } from "./cacheGroups.js";
import { registerCacheGroup } from "./cacheRegistry.service.js";

const APP_SETTING_KEY = "liveMultiSourcePlayback";

const cacheState = {
  loaded: false,
  value: null,
  updatedAt: null,
  hits: 0,
  misses: 0,
  lastHitAt: null,
  lastMissAt: null,
  lastSetAt: null,
  lastClearAt: null,
};

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

function normalizeDelaySeconds(value, fallback = 60) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(15, Math.min(600, Math.floor(numeric)));
}

function normalizeManifestName(value, fallback = "live-manifest.json") {
  const normalized = asTrimmed(value).replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!normalized) return fallback;
  if (normalized.includes("..") || normalized.includes("\\")) return fallback;
  return normalized;
}

function normalizePublicBaseUrl(value) {
  const normalized = asTrimmed(value).replace(/\/+$/, "");
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeTargets(targets = []) {
  const seen = new Set();
  return (Array.isArray(targets) ? targets : [])
    .map((target) => ({
      id: asTrimmed(target?.id),
      publicBaseUrl: normalizePublicBaseUrl(target?.publicBaseUrl),
    }))
    .filter((target) => {
      if (!target.id || seen.has(target.id)) return false;
      seen.add(target.id);
      return true;
    });
}

function buildEnvDefaults() {
  return {
    enabled: parseBool(process.env.LIVE_MULTI_SOURCE_ENABLED, false),
    delaySeconds: normalizeDelaySeconds(process.env.LIVE_SERVER2_DELAY_SECONDS, 60),
    manifestName: normalizeManifestName(
      process.env.LIVE_SERVER2_MANIFEST_NAME,
      "live-manifest.json"
    ),
    globalPublicBaseUrl: normalizePublicBaseUrl(
      process.env.LIVE_RECORDING_PUBLIC_CDN_BASE_URL
    ),
    targets: [],
  };
}

function normalizeStoredConfig(value = {}) {
  return {
    enabled:
      typeof value?.enabled === "boolean" ? value.enabled : undefined,
    delaySeconds:
      value?.delaySeconds == null
        ? undefined
        : normalizeDelaySeconds(value.delaySeconds, 60),
    manifestName:
      value?.manifestName == null
        ? undefined
        : normalizeManifestName(value.manifestName, "live-manifest.json"),
    globalPublicBaseUrl:
      value?.globalPublicBaseUrl == null
        ? undefined
        : normalizePublicBaseUrl(value.globalPublicBaseUrl),
    targets: normalizeTargets(value?.targets),
  };
}

function buildEffectiveConfig(raw = null) {
  const defaults = buildEnvDefaults();
  const normalized = normalizeStoredConfig(raw || {});
  return {
    enabled:
      typeof normalized.enabled === "boolean"
        ? normalized.enabled
        : defaults.enabled,
    delaySeconds:
      normalized.delaySeconds != null
        ? normalized.delaySeconds
        : defaults.delaySeconds,
    manifestName: normalized.manifestName || defaults.manifestName,
    globalPublicBaseUrl:
      normalized.globalPublicBaseUrl || defaults.globalPublicBaseUrl || "",
    targets: normalized.targets,
  };
}

function setCacheValue(raw) {
  cacheState.loaded = true;
  cacheState.value = normalizeStoredConfig(raw || {});
  cacheState.updatedAt = new Date();
  cacheState.lastSetAt = new Date();
}

function getStats() {
  return {
    entries: cacheState.loaded ? 1 : 0,
    ttlMs: null,
    hits: cacheState.hits,
    misses: cacheState.misses,
    lastHitAt: cacheState.lastHitAt,
    lastMissAt: cacheState.lastMissAt,
    lastSetAt: cacheState.lastSetAt,
    lastClearAt: cacheState.lastClearAt,
    updatedAt: cacheState.updatedAt,
  };
}

export function clearLiveMultiSourceConfigCache() {
  cacheState.loaded = false;
  cacheState.value = null;
  cacheState.updatedAt = new Date();
  cacheState.lastClearAt = new Date();
}

registerCacheGroup({
  id: CACHE_GROUP_IDS.liveMultiSourceConfig,
  label: "Live multi-source config",
  category: "config",
  scope: "internal",
  kind: "singleton",
  ttlMs: null,
  getStats,
  clear: clearLiveMultiSourceConfigCache,
});

export function getLiveMultiSourceConfigSync() {
  if (cacheState.loaded) {
    cacheState.hits += 1;
    cacheState.lastHitAt = new Date();
    return buildEffectiveConfig(cacheState.value);
  }

  cacheState.misses += 1;
  cacheState.lastMissAt = new Date();
  return buildEffectiveConfig(null);
}

export async function loadLiveMultiSourceConfig() {
  const doc = await AppSetting.findOne({ key: APP_SETTING_KEY }).lean();
  setCacheValue(doc?.value || null);
  return getLiveMultiSourceConfigSync();
}

export async function getLiveMultiSourceConfig() {
  if (!cacheState.loaded) {
    await loadLiveMultiSourceConfig();
  }
  return getLiveMultiSourceConfigSync();
}

export async function saveLiveMultiSourceConfig(value = {}) {
  const normalized = normalizeStoredConfig(value);
  const doc = await AppSetting.findOneAndUpdate(
    { key: APP_SETTING_KEY },
    { $set: { key: APP_SETTING_KEY, value: normalized } },
    { upsert: true, new: true }
  ).lean();
  setCacheValue(doc?.value || normalized);
  return getLiveMultiSourceConfigSync();
}

export function getLiveMultiSourceTargetPublicBaseUrlSync(
  storageTargetId = "",
  envFallback = ""
) {
  const config = getLiveMultiSourceConfigSync();
  const targetId = asTrimmed(storageTargetId);
  const targetOverride = config.targets.find((target) => target.id === targetId);
  if (targetOverride?.publicBaseUrl) return targetOverride.publicBaseUrl;
  if (config.globalPublicBaseUrl) return config.globalPublicBaseUrl;
  return normalizePublicBaseUrl(envFallback);
}

export function isLiveMultiSourceEnabledSync() {
  return Boolean(getLiveMultiSourceConfigSync().enabled);
}

export function getLiveServer2DelaySecondsSync() {
  return getLiveMultiSourceConfigSync().delaySeconds;
}

export function getLiveServer2ManifestNameSync() {
  return getLiveMultiSourceConfigSync().manifestName;
}
