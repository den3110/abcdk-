const cacheRegistry = new Map();

function asFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeMeta(entry = {}) {
  return {
    id: String(entry.id || "").trim(),
    label: String(entry.label || entry.id || "").trim(),
    category: String(entry.category || "misc").trim(),
    scope: String(entry.scope || "internal").trim(),
    kind: String(entry.kind || "cache").trim(),
    ttlMs: entry.ttlMs == null ? null : asFiniteNumber(entry.ttlMs, null),
  };
}

function normalizeStats(raw = {}, entry = {}) {
  const stats = raw && typeof raw === "object" ? raw : {};
  return {
    ...normalizeMeta(entry),
    entries: Math.max(0, asFiniteNumber(stats.entries, 0)),
    hits: Math.max(0, asFiniteNumber(stats.hits, 0)),
    misses: Math.max(0, asFiniteNumber(stats.misses, 0)),
    lastHitAt: toIsoString(stats.lastHitAt),
    lastMissAt: toIsoString(stats.lastMissAt),
    lastSetAt: toIsoString(stats.lastSetAt),
    lastClearAt: toIsoString(stats.lastClearAt),
    updatedAt: toIsoString(stats.updatedAt) || new Date().toISOString(),
  };
}

export function registerCacheGroup(entry = {}) {
  const meta = normalizeMeta(entry);
  if (!meta.id) {
    throw new Error("registerCacheGroup requires a non-empty id");
  }
  if (typeof entry.getStats !== "function") {
    throw new Error(`Cache group '${meta.id}' must provide getStats()`);
  }
  if (typeof entry.clear !== "function") {
    throw new Error(`Cache group '${meta.id}' must provide clear()`);
  }

  cacheRegistry.set(meta.id, {
    ...entry,
    ...meta,
    registeredAt: new Date(),
  });

  return cacheRegistry.get(meta.id);
}

export function getRegisteredCacheGroup(cacheId) {
  return cacheRegistry.get(String(cacheId || "").trim()) || null;
}

export function listRegisteredCacheGroups() {
  return Array.from(cacheRegistry.values());
}

export async function getCacheRegistrySummary() {
  const groups = await Promise.all(
    listRegisteredCacheGroups().map(async (entry) => {
      const stats = await Promise.resolve(entry.getStats());
      return normalizeStats(stats, entry);
    })
  );

  groups.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.label.localeCompare(b.label);
  });

  const totals = groups.reduce(
    (acc, group) => {
      acc.groups += 1;
      acc.entries += group.entries;
      acc.hits += group.hits;
      acc.misses += group.misses;
      if (group.entries > 0) acc.activeGroups += 1;
      return acc;
    },
    { groups: 0, entries: 0, hits: 0, misses: 0, activeGroups: 0 }
  );

  return {
    groups,
    totals,
    updatedAt: new Date().toISOString(),
  };
}

export async function clearCacheGroup(cacheId) {
  const entry = getRegisteredCacheGroup(cacheId);
  if (!entry) return null;

  await Promise.resolve(entry.clear());
  const stats = await Promise.resolve(entry.getStats());
  return normalizeStats(stats, entry);
}

export async function clearCacheGroups(cacheIds = []) {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(cacheIds) ? cacheIds : [cacheIds])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  const cleared = [];
  for (const cacheId of normalizedIds) {
    const result = await clearCacheGroup(cacheId);
    if (result) cleared.push(result);
  }
  return cleared;
}

export async function clearAllCacheGroups() {
  return clearCacheGroups(listRegisteredCacheGroups().map((entry) => entry.id));
}
