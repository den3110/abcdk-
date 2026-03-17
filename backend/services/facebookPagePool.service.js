// services/facebookPagePool.service.js
import cron from "node-cron";
import FbToken from "../models/fbTokenModel.js";
import Match from "../models/matchModel.js";
import { getCfgInt } from "./config.service.js";
import { getValidPageToken } from "./fbTokenService.js";
import { getPageLiveState } from "./facebookApi.js";
import { publishFbPageMonitorUpdate } from "./fbPageMonitorEvents.service.js";

// các trạng thái coi như match đã xong → page sẽ được free (nhưng DELAY 180s)
const DONE_STATUSES = [
  "finished",
  "ended",
  "completed",
  "cancelled",
  "canceled",
  "aborted",
];

const SAFE_FREE_DELAY_MS = 60 * 3 * 1000;
const FAST_FREE_DELAY_MS = 45 * 1000;
const STALE_IDLE_FREE_DELAY_MS = 60 * 1000;
const STALE_BUSY_MS = 15 * 60 * 1000;

const CFG_KEYS = {
  safeFreeDelayMs: "LIVE_FB_POOL_SAFE_FREE_DELAY_MS",
  fastFreeDelayMs: "LIVE_FB_POOL_FAST_FREE_DELAY_MS",
  staleIdleFreeDelayMs: "LIVE_FB_POOL_STALE_IDLE_FREE_DELAY_MS",
  staleBusyMs: "LIVE_FB_POOL_STALE_BUSY_MS",
};

const POSITIVE_DEFAULTS = {
  safeFreeDelayMs: SAFE_FREE_DELAY_MS,
  fastFreeDelayMs: FAST_FREE_DELAY_MS,
  staleIdleFreeDelayMs: STALE_IDLE_FREE_DELAY_MS,
  staleBusyMs: STALE_BUSY_MS,
};

function normalizeDelay(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export async function getFacebookPagePoolDelays() {
  const [safeFreeDelayMs, fastFreeDelayMs, staleIdleFreeDelayMs, staleBusyMs] =
    await Promise.all([
      getCfgInt(CFG_KEYS.safeFreeDelayMs, SAFE_FREE_DELAY_MS),
      getCfgInt(CFG_KEYS.fastFreeDelayMs, FAST_FREE_DELAY_MS),
      getCfgInt(CFG_KEYS.staleIdleFreeDelayMs, STALE_IDLE_FREE_DELAY_MS),
      getCfgInt(CFG_KEYS.staleBusyMs, STALE_BUSY_MS),
    ]);

  return {
    safeFreeDelayMs: normalizeDelay(
      safeFreeDelayMs,
      POSITIVE_DEFAULTS.safeFreeDelayMs
    ),
    fastFreeDelayMs: normalizeDelay(
      fastFreeDelayMs,
      POSITIVE_DEFAULTS.fastFreeDelayMs
    ),
    staleIdleFreeDelayMs: normalizeDelay(
      staleIdleFreeDelayMs,
      POSITIVE_DEFAULTS.staleIdleFreeDelayMs
    ),
    staleBusyMs: normalizeDelay(staleBusyMs, POSITIVE_DEFAULTS.staleBusyMs),
  };
}

// ========== DELAY FREE (in-memory) ==========
const _freeTimersByPageId = new Map(); // pageId -> { timeout, dueAt, delayMs, reason }

function toScheduledReleaseSnapshot(entry) {
  if (!entry) return null;
  const dueAt =
    Number.isFinite(entry.dueAt) && entry.dueAt > 0
      ? new Date(entry.dueAt)
      : null;
  return {
    dueAt,
    delayMs:
      Number.isFinite(entry.delayMs) && entry.delayMs >= 0 ? entry.delayMs : 0,
    reason: entry.reason || "free_requested",
  };
}

function cancelDelayedFree(pageId) {
  if (!pageId) return;
  const t = _freeTimersByPageId.get(String(pageId));
  if (t) {
    clearTimeout(t);
    _freeTimersByPageId.delete(String(pageId));
    void publishFbPageMonitorUpdate({
      reason: "page_free_schedule_cancelled",
      pageIds: [pageId],
    });
  }
}

export function cancelScheduledFacebookPageRelease(pageId) {
  cancelDelayedFree(pageId);
}

async function freeNowByPage(pageId) {
  if (!pageId) return;
  await FbToken.updateOne(
    { pageId },
    {
      $set: {
        isBusy: false,
        busyMatch: null,
        busyLiveVideoId: null,
        busySince: null,
      },
    }
  );
  await publishFbPageMonitorUpdate({
    reason: "page_freed_after_delay",
    pageIds: [pageId],
  });
}

function scheduleDelayedFreeByPage(pageId, options = {}) {
  if (!pageId) return;

  const key = String(pageId);
  const normalized =
    typeof options === "string" ? { reason: options } : options || {};
  const reason = normalized.reason || "free_requested";
  const delayMs =
    Number.isFinite(normalized.delayMs) && normalized.delayMs >= 0
      ? normalized.delayMs
      : SAFE_FREE_DELAY_MS;
  const dueAt = Date.now() + delayMs;
  const existing = _freeTimersByPageId.get(key);

  // ✅ đã có timer thì thôi (tránh spam cron tạo vô hạn timer)
  if (existing) {
    if (!normalized.force && existing.dueAt <= dueAt) return;
    clearTimeout(existing.timeout);
    _freeTimersByPageId.delete(key);
  }

  const t = setTimeout(async () => {
    try {
      await freeNowByPage(key);
      console.log("[FB] free page after delay:", key, "delayMs=", delayMs, "reason=", reason);
    } catch (err) {
      console.error("[FB] delayed free error:", err?.message || err);
    } finally {
      _freeTimersByPageId.delete(key);
    }
  }, delayMs);

  _freeTimersByPageId.set(key, {
    timeout: t,
    dueAt,
    delayMs,
    reason,
  });

  void publishFbPageMonitorUpdate({
    reason: `page_free_scheduled:${reason}`,
    pageIds: [key],
  });
}

/**
 * Chọn 1 page rảnh để tạo live
 * - không bận
 * - không needsReauth
 * - có pageToken còn hạn (hoặc never)
 */
export async function pickFreeFacebookPage() {
  const now = new Date();
  const q = {
    isBusy: { $ne: true },
    needsReauth: { $ne: true },
    pageToken: { $exists: true, $ne: "" },
    $or: [
      { pageTokenIsNever: true },
      { pageTokenExpiresAt: { $exists: false } },
      { pageTokenExpiresAt: { $gt: now } },
    ],
  };
  return FbToken.findOne(q).sort({ updatedAt: 1, createdAt: 1 });
}

/**
 * Đánh dấu page đang bận bởi 1 match
 */
export async function markFacebookPageBusy({
  pageId,
  matchId,
  liveVideoId = null,
}) {
  if (!pageId) return;

  // ✅ nếu đang chờ free mà page được dùng lại thì huỷ timer
  cancelDelayedFree(pageId);

  await FbToken.updateOne(
    { pageId },
    {
      $set: {
        isBusy: true,
        busyMatch: matchId || null,
        busyLiveVideoId: liveVideoId || null,
        busySince: new Date(),
      },
    }
  );
  await publishFbPageMonitorUpdate({
    reason: "page_marked_busy",
    pageIds: [pageId],
  });
}

/**
 * Giải phóng tất cả page đang bận bởi match này
 * ✅ AUTO DELAY 180s
 */
export async function markFacebookPageFreeByMatch(matchId, options = {}) {
  if (!matchId) return;
  const delays = await getFacebookPagePoolDelays();
  const delayMs =
    Number.isFinite(options.delayMs) && options.delayMs >= 0
      ? options.delayMs
      : delays.safeFreeDelayMs;

  const pages = await FbToken.find({ busyMatch: matchId, isBusy: true })
    .select("pageId")
    .lean();

  for (const p of pages) {
    scheduleDelayedFreeByPage(p.pageId, {
      ...options,
      delayMs,
      reason: options.reason || `free_by_match:${matchId}`,
    });
  }
}

export function getScheduledFacebookPageRelease(pageId) {
  if (!pageId) return null;
  return toScheduledReleaseSnapshot(_freeTimersByPageId.get(String(pageId)));
}

export function listScheduledFacebookPageReleases() {
  const out = [];
  for (const [pageId, entry] of _freeTimersByPageId.entries()) {
    out.push({
      pageId,
      ...toScheduledReleaseSnapshot(entry),
    });
  }
  return out;
}

/**
 * Giải phóng 1 page theo pageId
 * ✅ AUTO DELAY 180s
 */
export async function markFacebookPageFreeByPage(pageId, options = {}) {
  if (!pageId) return;
  const delays = await getFacebookPagePoolDelays();
  const delayMs =
    Number.isFinite(options.delayMs) && options.delayMs >= 0
      ? options.delayMs
      : delays.safeFreeDelayMs;
  scheduleDelayedFreeByPage(pageId, {
    ...options,
    delayMs,
    reason: options.reason || "free_by_page",
  });
}

/**
 * Giải phóng page theo liveVideoId (trường hợp stop theo live)
 * ✅ AUTO DELAY 180s
 */
export async function markFacebookPageFreeByLive(liveVideoId, options = {}) {
  if (!liveVideoId) return;
  const delays = await getFacebookPagePoolDelays();
  const delayMs =
    Number.isFinite(options.delayMs) && options.delayMs >= 0
      ? options.delayMs
      : delays.safeFreeDelayMs;

  const pages = await FbToken.find({ busyLiveVideoId: liveVideoId, isBusy: true })
    .select("pageId")
    .lean();

  for (const p of pages) {
    scheduleDelayedFreeByPage(p.pageId, {
      ...options,
      delayMs,
      reason: options.reason || `free_by_live:${liveVideoId}`,
    });
  }
}

/* ============================================================
 * CRON: mỗi 5s quét page đang bận → nếu match DONE thì gọi free
 * (nhưng free sẽ tự DELAY 180s ở các hàm phía trên)
 * ========================================================== */
let _fbBusyCronStarted = false;

export function startFacebookBusyCron() {
  if (_fbBusyCronStarted) return;
  _fbBusyCronStarted = true;

  cron.schedule("*/5 * * * * *", async () => {
    try {
      const busyPages = await FbToken.find({
        isBusy: true,
        busyMatch: { $ne: null },
      })
        .select("pageId pageName busyMatch busyLiveVideoId busySince")
        .lean();

      if (!busyPages.length) return;
      const delays = await getFacebookPagePoolDelays();

      const matchIds = busyPages
        .map((p) => p.busyMatch)
        .filter(Boolean)
        .map((id) => id.toString());

      const matches = await Match.find({ _id: { $in: matchIds } })
        .select("status facebookLive")
        .lean();

      const matchMap = new Map();
      for (const m of matches) matchMap.set(m._id.toString(), m);

      for (const page of busyPages) {
        const label = `${page.pageName || ""} (${page.pageId})`;
        const matchIdStr = page.busyMatch?.toString();
        const m = matchIdStr ? matchMap.get(matchIdStr) : null;

        // match bị xoá / không còn → cũng DELAY 180s rồi free
        if (!m) {
          await markFacebookPageFreeByPage(page.pageId);
          console.log("[FB-CRON] schedule free (match không còn):", label);
          continue;
        }

        // match đã xong → DELAY 180s rồi free
        if (DONE_STATUSES.includes(m.status)) {
          await markFacebookPageFreeByPage(page.pageId);
          console.log(
            "[FB-CRON] schedule free (match finish):",
            label,
            "→ match=",
            matchIdStr
          );
          continue;
        }

        // match vẫn chạy nhưng match đang ghi page khác → DELAY 180s rồi free page cũ
        const matchPageId = m.facebookLive?.pageId;
        if (matchPageId && matchPageId !== page.pageId) {
          await markFacebookPageFreeByPage(page.pageId);
          console.log(
            "[FB-CRON] schedule free (match chuyển page):",
            label,
            "→ match page:",
            matchPageId
          );
          continue;
        }

        const busySinceMs = page.busySince
          ? new Date(page.busySince).getTime()
          : 0;
        const isStaleBusy =
          Number.isFinite(busySinceMs) &&
          busySinceMs > 0 &&
          Date.now() - busySinceMs >= delays.staleBusyMs;

        if (!isStaleBusy) continue;

        try {
          const pageAccessToken = await getValidPageToken(page.pageId);
          const state = await getPageLiveState({
            pageId: page.pageId,
            pageAccessToken,
          });

          if (!state.busy) {
            await markFacebookPageFreeByPage(page.pageId, {
              delayMs: delays.staleIdleFreeDelayMs,
              force: true,
              reason: `stale_idle:${matchIdStr || "unknown"}`,
            });
            console.log(
              "[FB-CRON] schedule fast free (stale + graph idle):",
              label,
              "â†’ match=",
              matchIdStr
            );
          }
        } catch (graphErr) {
          console.warn(
            "[FB-CRON] stale page probe failed:",
            label,
            graphErr?.message || graphErr
          );
        }
      }
    } catch (err) {
      console.error("[FB-CRON] error:", err?.message || err);
    }
  });

  console.log("[FB-CRON] started: */5 * * * * *");
}

export const FACEBOOK_PAGE_POOL_DELAYS = {
  SAFE_FREE_DELAY_MS,
  FAST_FREE_DELAY_MS,
  STALE_IDLE_FREE_DELAY_MS,
  STALE_BUSY_MS,
};
