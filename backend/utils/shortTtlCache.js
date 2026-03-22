import { registerCacheGroup } from "../services/cacheRegistry.service.js";

export function createShortTtlCache(ttlMs = 2000, options = {}) {
  const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0
    ? Math.floor(Number(ttlMs))
    : 2000;
  const store = new Map();
  const stats = {
    hits: 0,
    misses: 0,
    lastHitAt: null,
    lastMissAt: null,
    lastSetAt: null,
    lastClearAt: null,
  };

  function now() {
    return new Date();
  }

  function pruneExpired() {
    const nowTs = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.expiresAt <= nowTs) {
        store.delete(key);
      }
    }
  }

  function get(key) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) {
      stats.misses += 1;
      stats.lastMissAt = now();
      return null;
    }

    const entry = store.get(normalizedKey);
    if (!entry) {
      stats.misses += 1;
      stats.lastMissAt = now();
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      store.delete(normalizedKey);
      stats.misses += 1;
      stats.lastMissAt = now();
      return null;
    }

    stats.hits += 1;
    stats.lastHitAt = now();
    return entry.value;
  }

  function set(key, value) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return value;

    stats.lastSetAt = now();
    store.set(normalizedKey, {
      value,
      expiresAt: Date.now() + ttl,
    });

    return value;
  }

  function del(key) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return false;
    return store.delete(normalizedKey);
  }

  function clear() {
    store.clear();
    stats.lastClearAt = now();
  }

  function getStats() {
    pruneExpired();
    return {
      entries: store.size,
      ttlMs: ttl,
      hits: stats.hits,
      misses: stats.misses,
      lastHitAt: stats.lastHitAt,
      lastMissAt: stats.lastMissAt,
      lastSetAt: stats.lastSetAt,
      lastClearAt: stats.lastClearAt,
      updatedAt: now(),
    };
  }

  if (options && typeof options === "object" && options.id) {
    registerCacheGroup({
      id: options.id,
      label: options.label,
      category: options.category,
      scope: options.scope,
      kind: options.kind || "short-ttl",
      ttlMs: ttl,
      getStats,
      clear,
    });
  }

  return {
    get,
    set,
    del,
    clear,
    getStats,
  };
}
