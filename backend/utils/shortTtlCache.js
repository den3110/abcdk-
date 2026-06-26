import { registerCacheGroup } from "../services/cacheRegistry.service.js";

export function createShortTtlCache(ttlMs = 2000, options = {}) {
  const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0
    ? Math.floor(Number(ttlMs))
    : 2000;
  const inflightTtl = Number.isFinite(Number(options.inflightTtlMs)) &&
    Number(options.inflightTtlMs) > 0
    ? Math.floor(Number(options.inflightTtlMs))
    : Math.max(30_000, Math.min(ttl, 120_000));
  const store = new Map();
  const inflight = new Map();
  let generation = 0;
  const stats = {
    hits: 0,
    misses: 0,
    loads: 0,
    waits: 0,
    lastHitAt: null,
    lastMissAt: null,
    lastWaitAt: null,
    lastSetAt: null,
    lastClearAt: null,
  };

  function now() {
    return new Date();
  }

  function normalizeKey(key) {
    return String(key || "").trim();
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
    const normalizedKey = normalizeKey(key);
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
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) return value;

    stats.lastSetAt = now();
    store.set(normalizedKey, {
      value,
      expiresAt: Date.now() + ttl,
    });

    return value;
  }

  function del(key) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) return false;
    generation += 1;
    const pending = inflight.get(normalizedKey);
    if (pending) {
      pending.reject(new Error("cache entry deleted while loading"));
      inflight.delete(normalizedKey);
    }
    return store.delete(normalizedKey);
  }

  function clear() {
    generation += 1;
    store.clear();
    for (const pending of inflight.values()) {
      pending.reject(new Error("cache cleared while loading"));
    }
    inflight.clear();
    stats.lastClearAt = now();
  }

  function beginLoad(key) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) return { status: "bypass" };

    const cached = get(normalizedKey);
    if (cached) {
      return { status: "hit", value: cached };
    }

    const pending = inflight.get(normalizedKey);
    if (pending) {
      stats.waits += 1;
      stats.lastWaitAt = now();
      return { status: "wait", promise: pending.promise };
    }

    stats.loads += 1;
    const loadGeneration = generation;
    let settled = false;
    let resolvePromise;
    let rejectPromise;
    let timer = null;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }).finally(() => {
      if (timer) clearTimeout(timer);
      const current = inflight.get(normalizedKey);
      if (current?.promise === promise) inflight.delete(normalizedKey);
    });
    promise.catch(() => {});

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    const entry = {
      promise,
      resolve: (value) => {
        if (generation === loadGeneration) {
          set(normalizedKey, value);
        }
        settle(resolvePromise, value);
      },
      reject: (error) => {
        settle(rejectPromise, error);
      },
    };

    timer = setTimeout(() => {
      const current = inflight.get(normalizedKey);
      if (current?.promise === promise) {
        inflight.delete(normalizedKey);
        entry.reject(new Error("cache load timeout"));
      }
    }, inflightTtl);

    inflight.set(normalizedKey, entry);
    return {
      status: "miss",
      promise,
      resolve: entry.resolve,
      reject: entry.reject,
    };
  }

  async function getOrLoad(key, loader) {
    const slot = beginLoad(key);
    if (slot.status === "hit") return { value: slot.value, state: "HIT" };
    if (slot.status === "wait") return { value: await slot.promise, state: "WAIT" };
    if (slot.status === "bypass") {
      return { value: await loader(), state: "BYPASS" };
    }

    try {
      const value = await loader();
      slot.resolve(value);
      return { value, state: "MISS" };
    } catch (error) {
      slot.reject(error);
      throw error;
    }
  }

  function getStats() {
    pruneExpired();
    return {
      entries: store.size,
      inflight: inflight.size,
      ttlMs: ttl,
      hits: stats.hits,
      misses: stats.misses,
      loads: stats.loads,
      waits: stats.waits,
      lastHitAt: stats.lastHitAt,
      lastMissAt: stats.lastMissAt,
      lastWaitAt: stats.lastWaitAt,
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
    beginLoad,
    getOrLoad,
    getStats,
  };
}
