import AppSetting from "../models/appSettingModel.js";
import { CACHE_GROUP_IDS } from "./cacheGroups.js";
import { registerCacheGroup } from "./cacheRegistry.service.js";

const APP_SETTING_KEY = "liveRecordingStorageTargets";
const DEFAULT_RECORDING_TARGET_ID = "default";

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

function parsePositiveInteger(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  return null;
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

function normalizeStorageTarget(target = {}, index = 0) {
  const id =
    asTrimmed(target?.id) || `${DEFAULT_RECORDING_TARGET_ID}_${index + 1}`;

  return {
    id,
    label: asTrimmed(target?.label) || id,
    accountName: asTrimmed(target?.accountName),
    endpoint: asTrimmed(target?.endpoint),
    accessKeyId: asTrimmed(target?.accessKeyId),
    secretAccessKey: asTrimmed(target?.secretAccessKey),
    bucketName: asTrimmed(target?.bucketName || target?.bucket),
    publicBaseUrl: normalizePublicBaseUrl(
      target?.publicBaseUrl || target?.cdnBaseUrl
    ),
    capacityBytes:
      parsePositiveInteger(
        target?.capacityBytes || target?.capacity || target?.maxBytes
      ) || null,
    enabled: target?.enabled !== false,
  };
}

function normalizeTargets(targets = []) {
  const seen = new Set();
  return (Array.isArray(targets) ? targets : [])
    .map((target, index) => normalizeStorageTarget(target, index))
    .filter((target) => {
      if (!target.id || seen.has(target.id)) return false;
      seen.add(target.id);
      return true;
    });
}

function parseExplicitTargetsFromEnv() {
  const raw = asTrimmed(
    process.env.R2_RECORDINGS_TARGETS_JSON || process.env.R2_RECORDINGS_TARGETS
  );
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn(
        "[live-recording-r2-config] R2_RECORDINGS_TARGETS_JSON must be a JSON array."
      );
      return [];
    }
    return normalizeTargets(parsed);
  } catch (error) {
    console.warn(
      "[live-recording-r2-config] Failed to parse R2_RECORDINGS_TARGETS_JSON:",
      error?.message || error
    );
    return [];
  }
}

function buildFallbackTargetFromEnv() {
  const endpoint =
    asTrimmed(process.env.R2_RECORDINGS_ENDPOINT) ||
    asTrimmed(process.env.R2_ENDPOINT);
  const accessKeyId =
    asTrimmed(process.env.R2_RECORDINGS_ACCESS_KEY_ID) ||
    asTrimmed(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey =
    asTrimmed(process.env.R2_RECORDINGS_SECRET_ACCESS_KEY) ||
    asTrimmed(process.env.R2_SECRET_ACCESS_KEY);
  const bucketName =
    asTrimmed(process.env.R2_RECORDINGS_BUCKET_NAME) ||
    asTrimmed(process.env.R2_BUCKET_NAME);

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }

  return normalizeStorageTarget(
    {
      id: DEFAULT_RECORDING_TARGET_ID,
      label: asTrimmed(process.env.R2_RECORDINGS_TARGET_LABEL) || "default",
      accountName: asTrimmed(process.env.R2_RECORDINGS_ACCOUNT_NAME),
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucketName,
      publicBaseUrl: process.env.LIVE_RECORDING_PUBLIC_CDN_BASE_URL || "",
      capacityBytes:
        parsePositiveInteger(process.env.R2_RECORDINGS_STORAGE_TOTAL_BYTES) ||
        parsePositiveInteger(process.env.R2_STORAGE_TOTAL_BYTES),
      enabled: true,
    },
    0
  );
}

function buildEnvDefaults() {
  const explicitTargets = parseExplicitTargetsFromEnv();
  if (explicitTargets.length) {
    return { source: "env", targets: explicitTargets };
  }

  const fallbackTarget = buildFallbackTargetFromEnv();
  return {
    source: "env",
    targets: fallbackTarget ? [fallbackTarget] : [],
  };
}

function normalizeStoredConfig(value = {}) {
  return {
    targets: normalizeTargets(value?.targets),
  };
}

function buildEffectiveConfig(raw = null) {
  const defaults = buildEnvDefaults();
  const normalized = normalizeStoredConfig(raw || {});
  if (normalized.targets.length > 0) {
    return {
      source: "db",
      targets: normalized.targets,
    };
  }
  return defaults;
}

function isRuntimeUsableTarget(target = {}) {
  return Boolean(
    target?.enabled !== false &&
      asTrimmed(target?.endpoint) &&
      asTrimmed(target?.accessKeyId) &&
      asTrimmed(target?.secretAccessKey) &&
      asTrimmed(target?.bucketName)
  );
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

export function clearLiveRecordingStorageTargetsConfigCache() {
  cacheState.loaded = false;
  cacheState.value = null;
  cacheState.updatedAt = new Date();
  cacheState.lastClearAt = new Date();
}

registerCacheGroup({
  id: CACHE_GROUP_IDS.liveRecordingStorageTargetsConfig,
  label: "Live recording storage targets config",
  category: "config",
  scope: "internal",
  kind: "singleton",
  ttlMs: null,
  getStats,
  clear: clearLiveRecordingStorageTargetsConfigCache,
});

export function getLiveRecordingStorageTargetsConfigSync() {
  if (cacheState.loaded) {
    cacheState.hits += 1;
    cacheState.lastHitAt = new Date();
    return buildEffectiveConfig(cacheState.value);
  }

  cacheState.misses += 1;
  cacheState.lastMissAt = new Date();
  return buildEffectiveConfig(null);
}

export function getRuntimeRecordingStorageTargetsSync() {
  return getLiveRecordingStorageTargetsConfigSync().targets.filter(
    isRuntimeUsableTarget
  );
}

export async function loadLiveRecordingStorageTargetsConfig() {
  const doc = await AppSetting.findOne({ key: APP_SETTING_KEY }).lean();
  setCacheValue(doc?.value || null);
  return getLiveRecordingStorageTargetsConfigSync();
}

export async function getLiveRecordingStorageTargetsConfig() {
  if (!cacheState.loaded) {
    await loadLiveRecordingStorageTargetsConfig();
  }
  return getLiveRecordingStorageTargetsConfigSync();
}

export async function saveLiveRecordingStorageTargetsConfig(value = {}) {
  const normalized = normalizeStoredConfig(value || {});
  const doc = await AppSetting.findOneAndUpdate(
    { key: APP_SETTING_KEY },
    { $set: { key: APP_SETTING_KEY, value: normalized } },
    { upsert: true, new: true }
  ).lean();
  setCacheValue(doc?.value || normalized);
  return getLiveRecordingStorageTargetsConfigSync();
}
