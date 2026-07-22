import { listLiveFeed, searchLiveFeed } from "../services/liveFeed.service.js";
import { CACHE_GROUP_IDS } from "../services/cacheGroups.js";
import { createShortTtlCache } from "../utils/shortTtlCache.js";
import {
  buildCacheKey,
  sendCachedJsonWithLoader,
} from "../utils/httpResponseCache.js";

const LIVE_FEED_CACHE_TTL_MS = Math.max(
  10_000,
  Number(process.env.LIVE_FEED_CACHE_TTL_MS || 120_000),
);

const liveFeedCache = createShortTtlCache(LIVE_FEED_CACHE_TTL_MS, {
  id: CACHE_GROUP_IDS.liveFeed,
  label: "Live feed",
  category: "public",
  scope: "public",
});

function buildLiveFeedParams(req, { search = false } = {}) {
  return {
    q: req.query.q || req.query.keyword || "",
    matchId: req.query.matchId || "",
    tournamentId: req.query.tournamentId || "",
    mode: req.query.mode || "all",
    source: req.query.source || "all",
    replayState: req.query.replayState || "all",
    sort: req.query.sort || "smart",
    ...(search
      ? { limit: req.query.limit || 8 }
      : { page: req.query.page || 1, limit: req.query.limit || 8 }),
  };
}

export async function getPublicLiveFeed(req, res) {
  try {
    const params = buildLiveFeedParams(req);
    const cacheKey = buildCacheKey("live-feed:list", params);
    await sendCachedJsonWithLoader(
      res,
      liveFeedCache,
      cacheKey,
      LIVE_FEED_CACHE_TTL_MS,
      () => listLiveFeed(params),
    );
  } catch (error) {
    console.error("getPublicLiveFeed error:", error);
    res.status(500).json({ error: error.message });
  }
}

export async function searchPublicLiveFeed(req, res) {
  try {
    const params = buildLiveFeedParams(req, { search: true });
    const cacheKey = buildCacheKey("live-feed:search", params);
    await sendCachedJsonWithLoader(
      res,
      liveFeedCache,
      cacheKey,
      LIVE_FEED_CACHE_TTL_MS,
      () => searchLiveFeed(params),
    );
  } catch (error) {
    console.error("searchPublicLiveFeed error:", error);
    res.status(500).json({ error: error.message });
  }
}
