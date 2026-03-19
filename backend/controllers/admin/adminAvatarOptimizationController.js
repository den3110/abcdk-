import fs from "fs/promises";
import path from "path";
import asyncHandler from "express-async-handler";
import User from "../../models/userModel.js";
import {
  buildPendingUserAvatarOptimizationFilter,
  getQueuedUserAvatarOptimizationCount,
  getUserAvatarOptimizationConfig,
} from "../../services/userAvatarOptimization.service.js";
import {
  getUserAvatarOptimizationJobStatus,
  triggerUserAvatarOptimizationSweep,
} from "../../jobs/userAvatarOptimizationCron.js";
import {
  getOptimizedImageCleanupStatus,
  triggerOptimizedImageCleanupNow,
} from "../../jobs/optimizedImageCleanupCron.js";

const AVATAR_OPTIMIZED_SEGMENT = "/uploads/avatars/optimized/";
const AVATAR_TRASH_ROOT = path.join(process.cwd(), "uploads", "avatars", "_trash");

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function collectDirStats(rootDir) {
  const stats = {
    files: 0,
    dirs: 0,
    totalBytes: 0,
    oldestFileAt: null,
    newestFileAt: null,
  };

  const rootStat = await safeStat(rootDir);
  if (!rootStat?.isDirectory()) {
    return stats;
  }

  async function walk(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        stats.dirs += 1;
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const fileStat = await safeStat(fullPath);
      if (!fileStat?.isFile()) continue;

      stats.files += 1;
      stats.totalBytes += fileStat.size || 0;

      const mtime = fileStat.mtime ? new Date(fileStat.mtime) : null;
      if (!mtime) continue;

      if (!stats.oldestFileAt || mtime < stats.oldestFileAt) {
        stats.oldestFileAt = mtime;
      }
      if (!stats.newestFileAt || mtime > stats.newestFileAt) {
        stats.newestFileAt = mtime;
      }
    }
  }

  await walk(rootDir);
  return stats;
}

function serializeUserSample(user) {
  return {
    _id: String(user?._id || ""),
    name: user?.name || "",
    nickname: user?.nickname || "",
    phone: user?.phone || "",
    avatar: user?.avatar || "",
    avatarOptimization: {
      done: Boolean(user?.avatarOptimization?.done),
      optimizedFor: user?.avatarOptimization?.optimizedFor || "",
      optimizedAt: user?.avatarOptimization?.optimizedAt || null,
    },
    updatedAt: user?.updatedAt || null,
  };
}

export const getAvatarOptimizationStatus = asyncHandler(async (req, res) => {
  const pendingFilter = buildPendingUserAvatarOptimizationFilter();
  const optimizedAvatarRegex = new RegExp(AVATAR_OPTIMIZED_SEGMENT, "i");

  const [
    totalAvatarUsers,
    pendingUsers,
    activeOptimizedUsers,
    queuedUsers,
    pendingSample,
    recentOptimized,
    trash,
  ] = await Promise.all([
    User.countDocuments({ avatar: { $type: "string", $ne: "" } }),
    User.countDocuments(pendingFilter),
    User.countDocuments({
      avatar: {
        $type: "string",
        $regex: optimizedAvatarRegex,
      },
    }),
    Promise.resolve(getQueuedUserAvatarOptimizationCount()),
    User.find(pendingFilter)
      .sort({ updatedAt: -1, _id: 1 })
      .limit(8)
      .select("name nickname phone avatar avatarOptimization updatedAt")
      .lean(),
    User.find({
      avatar: {
        $type: "string",
        $regex: optimizedAvatarRegex,
      },
    })
      .sort({ "avatarOptimization.optimizedAt": -1, updatedAt: -1 })
      .limit(8)
      .select("name nickname phone avatar avatarOptimization updatedAt")
      .lean(),
    collectDirStats(AVATAR_TRASH_ROOT),
  ]);

  const sweepStatus = getUserAvatarOptimizationJobStatus();
  const cleanupStatus = getOptimizedImageCleanupStatus();
  const config = getUserAvatarOptimizationConfig();

  res.json({
    summary: {
      totalAvatarUsers,
      pendingUsers,
      queuedUsers,
      activeOptimizedUsers,
      upToDateUsers: Math.max(0, totalAvatarUsers - pendingUsers),
    },
    jobs: {
      sweep: sweepStatus,
      cleanup: cleanupStatus,
    },
    trash: {
      root: AVATAR_TRASH_ROOT,
      ...trash,
    },
    config: {
      sweep: {
        thresholdBytes: config.thresholdBytes,
        maxDimension: config.maxDimension,
        quality: config.quality,
        minSavedBytes: config.minSavedBytes,
        batchSize: config.batchSize,
        deleteOriginals: config.deleteOriginals,
        cron: sweepStatus.cron,
        bootDelayMs: sweepStatus.bootDelayMs,
        timezone: sweepStatus.timezone,
      },
      cleanup: {
        cron: cleanupStatus.cron,
        timezone: cleanupStatus.timezone,
        optimizedMaxAgeDays: cleanupStatus.optimizedMaxAgeDays,
        avatarTrashMaxAgeDays: cleanupStatus.avatarTrashMaxAgeDays,
      },
    },
    samples: {
      pending: pendingSample.map(serializeUserSample),
      recentOptimized: recentOptimized.map(serializeUserSample),
    },
  });
});

export const runAvatarOptimizationSweepNow = asyncHandler(async (req, res) => {
  const result = triggerUserAvatarOptimizationSweep("manual-admin");
  res.status(result.started ? 202 : 200).json(result);
});

export const runAvatarOptimizationCleanupNow = asyncHandler(async (req, res) => {
  const result = triggerOptimizedImageCleanupNow("manual-admin");
  res.status(result.started ? 202 : 200).json(result);
});
