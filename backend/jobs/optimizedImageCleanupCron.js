import fs from "fs/promises";
import path from "path";
import cron from "node-cron";
import { DateTime } from "luxon";

const DEFAULT_TZ = process.env.CRON_TZ || "Asia/Ho_Chi_Minh";
const CLEANUP_CRON = process.env.OPTIMIZED_IMAGE_CLEANUP_CRON || "25 4 * * *";
const MAX_AGE_DAYS = Math.max(
  1,
  Number.parseInt(process.env.OPTIMIZED_IMAGE_MAX_AGE_DAYS || "30", 10) || 30
);
const OPTIMIZED_ROOT = path.join(process.cwd(), "uploads", "optimized");
const TARGET_DIRS = [
  path.join(OPTIMIZED_ROOT, "tournaments"),
  path.join(OPTIMIZED_ROOT, "rankings"),
];

function ts(tz = DEFAULT_TZ) {
  const now = DateTime.now().setZone(tz);
  return {
    iso: now.toISO(),
    local: now.toFormat("yyyy-LL-dd HH:mm:ss ZZZZ"),
    tz,
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
  const cutoffMs = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const stats = {
    scanned: 0,
    removed: 0,
    removedDirs: 0,
    reclaimedBytes: 0,
  };

  for (const dir of TARGET_DIRS) {
    await cleanupDir(dir, cutoffMs, stats, true);
  }

  return stats;
}

export function startOptimizedImageCleanupCron() {
  const bootTs = ts();
  console.log(
    `[optimized-cleanup][boot] starting @ ${bootTs.local} (${bootTs.tz}) cron="${CLEANUP_CRON}" maxAgeDays=${MAX_AGE_DAYS}`
  );

  (async () => {
    try {
      const result = await cleanupOptimizedImageDirs();
      const doneTs = ts();
      console.log(
        `[optimized-cleanup][boot-run] ok @ ${doneTs.local} — scanned=${result.scanned}, removed=${result.removed}, removedDirs=${result.removedDirs}, reclaimedBytes=${result.reclaimedBytes}`
      );
    } catch (error) {
      const errTs = ts();
      console.error(
        `[optimized-cleanup][boot-run] error @ ${errTs.local}:`,
        error
      );
    }
  })();

  cron.schedule(
    CLEANUP_CRON,
    async () => {
      try {
        const result = await cleanupOptimizedImageDirs();
        const tickTs = ts();
        console.log(
          `[optimized-cleanup][tick] ok @ ${tickTs.local} — scanned=${result.scanned}, removed=${result.removed}, removedDirs=${result.removedDirs}, reclaimedBytes=${result.reclaimedBytes}`
        );
      } catch (error) {
        const errTs = ts();
        console.error(
          `[optimized-cleanup][tick] error @ ${errTs.local}:`,
          error
        );
      }
    },
    { timezone: DEFAULT_TZ }
  );
}
