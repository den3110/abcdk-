import asyncHandler from "express-async-handler";
import { buildLiveAppBootstrapForUser } from "../services/liveAppAccess.service.js";
import { createShortTtlCache } from "../utils/shortTtlCache.js";
import { CACHE_GROUP_IDS } from "../services/cacheGroups.js";

const LIVE_APP_BOOTSTRAP_CACHE_TTL_MS = Math.max(
  3000,
  Number(process.env.LIVE_APP_BOOTSTRAP_CACHE_TTL_MS || 15000)
);
const liveAppBootstrapCache = createShortTtlCache(
  LIVE_APP_BOOTSTRAP_CACHE_TTL_MS,
  {
    id: CACHE_GROUP_IDS.liveAppBootstrap,
    label: "Live app bootstrap",
    category: "live-app",
    scope: "private",
  }
);

export const getLiveAppBootstrap = asyncHandler(async (req, res) => {
  const userId = String(req.user?._id || req.user?.id || "").trim();
  const cacheKey = userId ? `bootstrap:${userId}` : "";
  let bootstrap = cacheKey ? liveAppBootstrapCache.get(cacheKey) : null;

  if (!bootstrap) {
    bootstrap = await buildLiveAppBootstrapForUser(req.user);
    if (cacheKey && bootstrap?.authenticated) {
      liveAppBootstrapCache.set(cacheKey, bootstrap);
    }
    res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=15");
    res.setHeader("X-PKT-Cache", "MISS");
  } else {
    res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=15");
    res.setHeader("X-PKT-Cache", "HIT");
  }

  if (!bootstrap.authenticated) {
    return res.status(401).json(bootstrap);
  }
  return res.json(bootstrap);
});
