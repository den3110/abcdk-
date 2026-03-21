export function createShortTtlCache(ttlMs = 2000) {
  const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0
    ? Math.floor(Number(ttlMs))
    : 2000;
  const store = new Map();

  function get(key) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return null;

    const entry = store.get(normalizedKey);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      store.delete(normalizedKey);
      return null;
    }

    return entry.value;
  }

  function set(key, value) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return value;

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
  }

  return {
    get,
    set,
    del,
    clear,
  };
}
