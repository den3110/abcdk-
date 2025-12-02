// src/services/weatherkitCache.js
import { fetchWeatherFromApple } from "./weatherkitClient.js";

// cache đơn giản trong RAM
const cache = new Map();

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
    return hit.data;
  }

  const data = await fetchWeatherFromApple({ lat, lon, lang, timezone });

  cache.set(key, {
    data,
    expiredAt: now + 5 * 60  * 1000, // 5 phút
  });

  return data;
}
