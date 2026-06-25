function normalizeForCache(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForCache(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        const item = value[key];
        if (item === undefined) return acc;
        acc[key] = normalizeForCache(item);
        return acc;
      }, {});
  }
  return value;
}

export function ttlSeconds(ttlMs) {
  return Math.max(1, Math.floor(Number(ttlMs || 0) / 1000));
}

export function buildCacheKey(scope, parts = {}) {
  return `${scope}:${JSON.stringify(normalizeForCache(parts))}`;
}

export function getRequestUserCacheVary(req) {
  const user = req?.user || {};
  const role = String(user.role || "").trim().toLowerCase();
  const roles = Array.isArray(user.roles)
    ? user.roles.map((item) => String(item || "").trim().toLowerCase()).sort()
    : [];

  return {
    userId: String(user._id || user.id || ""),
    role,
    roles,
    isAdmin: user.isAdmin === true,
    isSuperUser: user.isSuperUser === true,
    isSuperAdmin: user.isSuperAdmin === true,
    rankingSearchLimit:
      typeof user.rankingSearchLimit === "number" ? user.rankingSearchLimit : null,
    rankingSearchUnlimited: user.rankingSearchUnlimited === true,
  };
}

export function setJsonCacheHeaders(res, ttlMs, state = "MISS", visibility = "public") {
  const seconds = ttlSeconds(ttlMs);
  res.setHeader(
    "Cache-Control",
    `${visibility}, max-age=${seconds}, stale-while-revalidate=${seconds}`,
  );
  res.setHeader("X-PKT-Cache", state);
}

export function sendCachedJson(res, cache, key, ttlMs, visibility = "public") {
  const cached = cache.get(key);
  if (!cached) return false;
  setJsonCacheHeaders(res, ttlMs, "HIT", visibility);
  res.json(cached);
  return true;
}

export function cacheAndSendJson(
  res,
  cache,
  key,
  payload,
  ttlMs,
  visibility = "public",
) {
  cache.set(key, payload);
  setJsonCacheHeaders(res, ttlMs, "MISS", visibility);
  return res.json(payload);
}
