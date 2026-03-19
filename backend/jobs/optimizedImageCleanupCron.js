import fs from "fs/promises";
import path from "path";
import cron from "node-cron";
import { DateTime } from "luxon";

const DEFAULT_TZ = process.env.CRON_TZ || "Asia/Ho_Chi_Minh";
const CLEANUP_CRON = process.env.OPTIMIZED_IMAGE_CLEANUP_CRON || "25 4 * * *";
const OPTIMIZED_MAX_AGE_DAYS = Math.max(
  1,
  Number.parseInt(process.env.OPTIMIZED_IMAGE_MAX_AGE_DAYS || "30", 10) || 30
);
const OPTIMIZED_ROOT = path.join(process.cwd(), "uploads", "optimized");
const AVATAR_TRASH_ROOT = path.join(
  process.cwd(),
  "uploads",
  "avatars",
  "_trash"
);
const AVATAR_TRASH_MAX_AGE_DAYS = Math.max(
  1,
  Number.parseInt(process.env.USER_AVATAR_TRASH_MAX_AGE_DAYS || "30", 10) || 30
);
const TARGET_DIRS = [
  {
    dir: path.join(OPTIMIZED_ROOT, "tournaments"),
    maxAgeDays: OPTIMIZED_MAX_AGE_DAYS,
  },
  {
    dir: path.join(OPTIMIZED_ROOT, "rankings"),
    maxAgeDays: OPTIMIZED_MAX_AGE_DAYS,
  },
  {
    dir: AVATAR_TRASH_ROOT,
    maxAgeDays: AVATAR_TRASH_MAX_AGE_DAYS,
  },
];

let running = false;
let lastStartedAt = null;
let lastFinishedAt = null;
let lastReason = "";
let lastResult = null;
let lastError = "";
let lastDurationMs = 0;

function ts(tz = DEFAULT_TZ) {
  const now = DateTime.now().setZone(tz);
  return {
    iso: now.toISO(),
    local: now.toFormat("yyyy-LL-dd HH:mm:ss ZZZZ"),
    tz,
  };
}

function snapshotStatus() {
  return {
    running,
    cron: CLEANUP_CRON,
    timezone: DEFAULT_TZ,
    optimizedMaxAgeDays: OPTIMIZED_MAX_AGE_DAYS,
    avatarTrashMaxAgeDays: AVATAR_TRASH_MAX_AGE_DAYS,
    lastStartedAt,
    lastFinishedAt,
    lastReason,
    lastResult,
    lastError,
    lastDurationMs,
  };
}

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function cleanupDir(dirPath, cutoffMs, stats, keepDir = true) {
  const dirStat = await safeStat(dirPath);
  if (!dirStat?.isDirectory()) return;

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await cleanupDir(fullPath, cutoffMs, stats, false);
      continue;
    }

    if (!entry.isFile()) continue;

    const fileStat = await safeStat(fullPath);
    if (!fileStat?.isFile()) continue;

    stats.scanned += 1;
    if (fileStat.mtimeMs >= cutoffMs) continue;

    try {
      await fs.unlink(fullPath);
      stats.removed += 1;
      stats.reclaimedBytes += fileStat.size || 0;
    } catch (error) {
      console.warn(
        "[optimized-cleanup] unlink failed:",
        fullPath,
        error?.message || error
      );
    }
  }

  if (keepDir) return;

  try {
    const remaining = await fs.readdir(dirPath);
    if (!remaining.length) {
      await fs.rmdir(dirPath);
      stats.removedDirs += 1;
    }
  } catch {
    // ignore
  }
}

export async function cleanupOptimizedImageDirs() {
  const stats = {
    scanned: 0,
    removed: 0,
    removedDirs: 0,
    reclaimedBytes: 0,
  };

  for (const target of TARGET_DIRS) {
    const cutoffMs = Date.now() - target.maxAgeDays * 24 * 60 * 60 * 1000;
    await cleanupDir(target.dir, cutoffMs, stats, true);
  }

  return stats;
}

async function runCleanup(reason) {
  if (running) {
    return {
      started: false,
      reason,
      status: snapshotStatus(),
    };
  }

  running = true;
  lastReason = String(reason || "manual");
  lastStartedAt = new Date();
  lastError = "";

  try {
    const result = await cleanupOptimizedImageDirs();
    lastFinishedAt = new Date();
    lastDurationMs = Math.max(
      0,
      lastFinishedAt.getTime() - lastStartedAt.getTime()
    );
    lastResult = result;
    running = false;
    return {
      started: true,
      reason,
      result,
      status: snapshotStatus(),
    };
  } catch (error) {
    lastFinishedAt = new Date();
    lastDurationMs = Math.max(
      0,
      lastFinishedAt.getTime() - lastStartedAt.getTime()
    );
    lastResult = null;
    lastError = error?.message || String(error || "");
    running = false;
    return {
      started: true,
      reason,
      error: lastError,
      status: snapshotStatus(),
    };
  }
}

export function getOptimizedImageCleanupStatus() {
  return snapshotStatus();
}

export function triggerOptimizedImageCleanupNow(reason = "manual-api") {
  if (running) {
    return {
      started: false,
      reason,
      status: snapshotStatus(),
    };
  }

  void runCleanup(reason).then((outcome) => {
    const logTs = ts();
    if (outcome?.error) {
      console.error(
        `[optimized-cleanup][${reason}] error @ ${logTs.local}:`,
        outcome.error
      );
      return;
    }

    const result = outcome?.result || {};
    console.log(
      `[optimized-cleanup][${reason}] ok @ ${logTs.local} - scanned=${result.scanned || 0}, removed=${result.removed || 0}, removedDirs=${result.removedDirs || 0}, reclaimedBytes=${result.reclaimedBytes || 0}`
    );
  });

  return {
    started: true,
    reason,
    status: snapshotStatus(),
  };
}

export function startOptimizedImageCleanupCron() {
  const bootTs = ts();
  console.log(
    `[optimized-cleanup][boot] starting @ ${bootTs.local} (${bootTs.tz}) cron="${CLEANUP_CRON}" optimizedMaxAgeDays=${OPTIMIZED_MAX_AGE_DAYS} avatarTrashMaxAgeDays=${AVATAR_TRASH_MAX_AGE_DAYS}`
  );

  void runCleanup("boot-run").then((outcome) => {
    const result = outcome?.result || {};
    const doneTs = ts();
    if (outcome?.error) {
      console.error(
        `[optimized-cleanup][boot-run] error @ ${doneTs.local}:`,
        outcome.error
      );
      return;
    }
    console.log(
      `[optimized-cleanup][boot-run] ok @ ${doneTs.local} - scanned=${result.scanned || 0}, removed=${result.removed || 0}, removedDirs=${result.removedDirs || 0}, reclaimedBytes=${result.reclaimedBytes || 0}`
    );
  });

  cron.schedule(
    CLEANUP_CRON,
    async () => {
      const outcome = await runCleanup("tick");
      const result = outcome?.result || {};
      const tickTs = ts();
      if (outcome?.error) {
        console.error(
          `[optimized-cleanup][tick] error @ ${tickTs.local}:`,
          outcome.error
        );
        return;
      }
      console.log(
        `[optimized-cleanup][tick] ok @ ${tickTs.local} - scanned=${result.scanned || 0}, removed=${result.removed || 0}, removedDirs=${result.removedDirs || 0}, reclaimedBytes=${result.reclaimedBytes || 0}`
      );
    },
    { timezone: DEFAULT_TZ }
  );
}
