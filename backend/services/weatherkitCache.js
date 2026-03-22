// src/services/weatherkitCache.js
import { fetchWeatherFromApple } from "./weatherkitClient.js";
import { CACHE_GROUP_IDS } from "./cacheGroups.js";
import { registerCacheGroup } from "./cacheRegistry.service.js";

// cache đơn giản trong RAM
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;
const cacheStats = {
  hits: 0,
  misses: 0,
  lastHitAt: null,
  lastMissAt: null,
  lastSetAt: null,
  lastClearAt: null,
};

function pruneExpired() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (!value || value.expiredAt <= now) cache.delete(key);
  }
}

export function clearWeatherCache() {
  cache.clear();
  cacheStats.lastClearAt = new Date();
}

function getWeatherCacheStats() {
  pruneExpired();
  return {
    entries: cache.size,
    ttlMs: TTL_MS,
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    lastHitAt: cacheStats.lastHitAt,
    lastMissAt: cacheStats.lastMissAt,
    lastSetAt: cacheStats.lastSetAt,
    lastClearAt: cacheStats.lastClearAt,
    updatedAt: new Date(),
  };
}

registerCacheGroup({
  id: CACHE_GROUP_IDS.weatherKit,
  label: "WeatherKit responses",
  category: "public",
  scope: "internal",
  kind: "map-ttl",
  ttlMs: TTL_MS,
  getStats: getWeatherCacheStats,
  clear: clearWeatherCache,
});

/**
 * Lấy weather có cache 5 phút
 */
export async function getWeatherCached({
  lat,
  lon,
  lang = "en",
  timezone = "Asia/Bangkok",
}) {
  const key = `${lat},${lon}:${lang}:${timezone}`;
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && hit.expiredAt > now) {
    cacheStats.hits += 1;
    cacheStats.lastHitAt = new Date();
    return hit.data;
  }

  cacheStats.misses += 1;
  cacheStats.lastMissAt = new Date();

  const data = await fetchWeatherFromApple({ lat, lon, lang, timezone });

  cache.set(key, {
    data,
    expiredAt: now + TTL_MS,
  });
  cacheStats.lastSetAt = new Date();

  return data;
}
