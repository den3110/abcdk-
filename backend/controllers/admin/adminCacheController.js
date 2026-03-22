import asyncHandler from "express-async-handler";
import {
  clearAllCacheGroups,
  clearCacheGroup,
  getCacheRegistrySummary,
} from "../../services/cacheRegistry.service.js";

function buildProcessInfo() {
  const memory = process.memoryUsage();
  return {
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    rssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
    heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
    heapTotalMb: Number((memory.heapTotal / 1024 / 1024).toFixed(1)),
  };
}

export const getCacheSummary = asyncHandler(async (_req, res) => {
  const summary = await getCacheRegistrySummary();
  return res.json({
    ok: true,
    ...summary,
    process: buildProcessInfo(),
  });
});

export const clearCacheGroupById = asyncHandler(async (req, res) => {
  const cacheId = String(req.params.cacheId || "").trim();
  if (!cacheId) {
    return res.status(400).json({ ok: false, message: "cacheId is required" });
  }

  const cleared = await clearCacheGroup(cacheId);
  if (!cleared) {
    return res.status(404).json({ ok: false, message: "Cache group not found" });
  }

  return res.json({
    ok: true,
    cleared,
    updatedAt: new Date().toISOString(),
  });
});

export const clearAllCacheGroupsHttp = asyncHandler(async (_req, res) => {
  const cleared = await clearAllCacheGroups();
  return res.json({
    ok: true,
    count: cleared.length,
    cleared,
    updatedAt: new Date().toISOString(),
  });
});
