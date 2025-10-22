// services/thumb.service.js
import got from "got";
import * as cheerio from "cheerio";
import LRU from "lru-cache";
import isNonEmpty from "../utils/isNonEmpty.js";

export function ytThumbCandidates(videoId) {
  if (!isNonEmpty(videoId)) return [];
  return [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault_live.jpg`,
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ];
}

export function fbThumbFromId(videoId) {
  if (!isNonEmpty(videoId)) return null;
  // public thì ok, private có thể fail/require login
  return `https://graph.facebook.com/${videoId}/picture?type=large`;
}

const ogCache = new LRU({ max: 500, ttl: 10 * 60 * 1000 }); // 10 phút

export async function fetchOgImage(url) {
  if (!isNonEmpty(url)) return null;
  const key = `og:${url}`;
  if (ogCache.has(key)) return ogCache.get(key);
  try {
    const html = await got(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/123 Safari/537.36",
        "accept-language": "vi,en;q=0.9",
      },
      timeout: { request: 6000 },
      followRedirect: true,
    }).text();
    const $ = cheerio.load(html);
    const og =
      $('meta[property="og:image:secure_url"]').attr("content") ||
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      null;
    if (og) ogCache.set(key, og);
    return og || null;
  } catch {
    return null;
  }
}
