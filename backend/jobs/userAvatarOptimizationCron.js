import cron from "node-cron";
import { DateTime } from "luxon";
import { runPendingUserAvatarOptimizationSweep } from "../services/userAvatarOptimization.service.js";

const DEFAULT_TZ = process.env.CRON_TZ || "Asia/Ho_Chi_Minh";
const CRON_EXPR = process.env.USER_AVATAR_OPTIMIZE_CRON || "40 4 * * *";
const BOOT_DELAY_MS = Math.max(
  0,
  Number.parseInt(process.env.USER_AVATAR_OPTIMIZE_BOOT_DELAY_MS || "45000", 10) ||
    45000
);

let running = false;
let lastStartedAt = null;
let lastFinishedAt = null;
let lastReason = "";
let lastResult = null;
let lastError = "";
let lastDurationMs = 0;

function stamp(tz = DEFAULT_TZ) {
  const now = DateTime.now().setZone(tz);
  return `${now.toFormat("yyyy-LL-dd HH:mm:ss ZZZZ")} (${tz})`;
}

function snapshotStatus() {
  return {
    running,
    cron: CRON_EXPR,
    timezone: DEFAULT_TZ,
    bootDelayMs: BOOT_DELAY_MS,
    lastStartedAt,
    lastFinishedAt,
    lastReason,
    lastResult,
    lastError,
    lastDurationMs,
  };
}

async function runSweep(reason) {
  if (running) {
    console.log(`[avatar-optimize][${reason}] skip because a previous sweep is still running`);
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
    const startedAt = Date.now();
    const result = await runPendingUserAvatarOptimizationSweep();
    lastFinishedAt = new Date();
    lastDurationMs = Math.max(0, Date.now() - startedAt);
    lastResult = result;
    running = false;
    console.log(
      `[avatar-optimize][${reason}] ok @ ${stamp()} scanned=${result.scanned}, optimized=${result.optimized}, skipped=${result.skipped}, archivedOriginals=${result.archivedOriginals}, savedBytes=${result.savedBytes}`
    );
    return {
      started: true,
      reason,
      result,
      status: snapshotStatus(),
    };
  } catch (error) {
    lastFinishedAt = new Date();
    lastDurationMs = lastStartedAt
      ? Math.max(0, lastFinishedAt.getTime() - lastStartedAt.getTime())
      : 0;
    lastResult = null;
    lastError = error?.message || String(error || "");
    running = false;
    console.error(`[avatar-optimize][${reason}] error @ ${stamp()}:`, error);
    return {
      started: true,
      reason,
      error: lastError,
      status: snapshotStatus(),
    };
  }
}

export function getUserAvatarOptimizationJobStatus() {
  return snapshotStatus();
}

export function triggerUserAvatarOptimizationSweep(reason = "manual-api") {
  if (running) {
    return {
      started: false,
      reason,
      status: snapshotStatus(),
    };
  }

  void runSweep(reason);
  return {
    started: true,
    reason,
    status: snapshotStatus(),
  };
}

export function startUserAvatarOptimizationCron() {
  console.log(
    `[avatar-optimize][boot] cron="${CRON_EXPR}" bootDelayMs=${BOOT_DELAY_MS} tz=${DEFAULT_TZ}`
  );

  setTimeout(() => {
    runSweep("boot-run");
  }, BOOT_DELAY_MS);

  cron.schedule(
    CRON_EXPR,
    () => {
      runSweep("tick");
    },
    { timezone: DEFAULT_TZ }
  );
}
