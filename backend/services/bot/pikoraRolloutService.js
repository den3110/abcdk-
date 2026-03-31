import { getCfgJSON, setCfg } from "../config.service.js";

export const PIKORA_V7_ROLLOUT_CONFIG_KEY = "PIKORA_V7_ROLLOUT";

const DEFAULT_CONFIG = {
  enabled: true,
  surfaces: ["web", "mobile"],
  allowLiveRetrieval: false,
  cohortPercentage: 100,
  allowlistUserIds: [],
  allowlistRoles: ["admin"],
};

function asTrimmed(value, maxLength = 96) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function uniqueList(values = [], limit = 32, maxLength = 96) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((item) => asTrimmed(item, maxLength))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function normalizeSurfaces(values = []) {
  const next = uniqueList(values, 4, 16)
    .map((item) => item.toLowerCase())
    .filter((item) => ["web", "mobile"].includes(item));
  return next.length ? next : [...DEFAULT_CONFIG.surfaces];
}

function normalizeRoles(values = []) {
  return uniqueList(values, 12, 48).map((item) => item.toLowerCase());
}

function clampPercentage(value, fallback = 100) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.min(100, Math.round(next)));
}

export function normalizePikoraRolloutConfig(input = {}) {
  return {
    enabled: input?.enabled !== false,
    surfaces: normalizeSurfaces(input?.surfaces || DEFAULT_CONFIG.surfaces),
    allowLiveRetrieval: Boolean(input?.allowLiveRetrieval),
    cohortPercentage: clampPercentage(
      input?.cohortPercentage,
      DEFAULT_CONFIG.cohortPercentage,
    ),
    allowlistUserIds: uniqueList(input?.allowlistUserIds, 64, 96),
    allowlistRoles: normalizeRoles(
      input?.allowlistRoles?.length
        ? input.allowlistRoles
        : DEFAULT_CONFIG.allowlistRoles,
    ),
  };
}

export function getDefaultPikoraRolloutConfig() {
  return { ...DEFAULT_CONFIG };
}

export async function getPikoraRolloutConfig() {
  const stored = await getCfgJSON(
    PIKORA_V7_ROLLOUT_CONFIG_KEY,
    DEFAULT_CONFIG,
  );
  return normalizePikoraRolloutConfig(stored);
}

export async function updatePikoraRolloutConfig(input = {}, updatedBy = "") {
  const normalized = normalizePikoraRolloutConfig(input);
  await setCfg({
    key: PIKORA_V7_ROLLOUT_CONFIG_KEY,
    value: JSON.stringify(normalized),
    updatedBy,
  });
  return normalized;
}

function hashToPercent(seed) {
  let hash = 0;
  const text = asTrimmed(seed, 256) || "pikora-default";
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash % 100;
}

function normalizeRolesFromInput(values = []) {
  return new Set(
    uniqueList(values, 16, 48).map((item) => item.toLowerCase()),
  );
}

export async function resolvePikoraRolloutDecision({
  surface = "web",
  userId = null,
  roles = [],
  cohortId = "",
} = {}) {
  const config = await getPikoraRolloutConfig();
  const normalizedSurface = surface === "mobile" ? "mobile" : "web";
  const roleSet = normalizeRolesFromInput(roles);
  const normalizedUserId = asTrimmed(userId, 96);
  const normalizedCohortId = asTrimmed(cohortId, 128);
  const allowlistedRole = config.allowlistRoles.some((role) => roleSet.has(role));
  const allowlistedUser = normalizedUserId
    ? config.allowlistUserIds.includes(normalizedUserId)
    : false;
  const surfaceAllowed = config.surfaces.includes(normalizedSurface);
  const cohortSeed =
    normalizedUserId ||
    normalizedCohortId ||
    `${normalizedSurface}:anonymous`;
  const cohortBucket = hashToPercent(cohortSeed);
  const cohortAllowed = cohortBucket < config.cohortPercentage;
  const enabled =
    surfaceAllowed &&
    (allowlistedRole || allowlistedUser || (config.enabled && cohortAllowed));

  return {
    config,
    surface: normalizedSurface,
    enabled,
    surfaceAllowed,
    allowlistedRole,
    allowlistedUser,
    cohortBucket,
    cohortAllowed,
    allowLiveRetrieval: Boolean(config.allowLiveRetrieval && enabled),
  };
}
