// services/facebookPagePool.service.js
import cron from "node-cron";
import FbToken from "../models/fbTokenModel.js";
import Match from "../models/matchModel.js";

// các trạng thái coi như match đã xong → page sẽ được free (nhưng DELAY 180s)
const DONE_STATUSES = [
  "finished",
  "ended",
  "completed",
  "cancelled",
  "canceled",
  "aborted",
];

const FREE_DELAY_MS = 60 * 3 * 1000;

// ========== DELAY FREE (in-memory) ==========
const _freeTimersByPageId = new Map(); // pageId -> Timeout

function cancelDelayedFree(pageId) {
  if (!pageId) return;
  const t = _freeTimersByPageId.get(String(pageId));
  if (t) {
    clearTimeout(t);
    _freeTimersByPageId.delete(String(pageId));
  }
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
}

function scheduleDelayedFreeByPage(pageId, reason = "free_requested") {
  if (!pageId) return;

  const key = String(pageId);

  // ✅ đã có timer thì thôi (tránh spam cron tạo vô hạn timer)
  if (_freeTimersByPageId.has(key)) return;

  const t = setTimeout(async () => {
    try {
      await freeNowByPage(key);
      console.log("[FB] free page after 180s:", key, "reason=", reason);
    } catch (err) {
      console.error("[FB] delayed free error:", err?.message || err);
    } finally {
      _freeTimersByPageId.delete(key);
    }
  }, FREE_DELAY_MS);

  _freeTimersByPageId.set(key, t);
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
}

/**
 * Giải phóng tất cả page đang bận bởi match này
 * ✅ AUTO DELAY 180s
 */
export async function markFacebookPageFreeByMatch(matchId) {
  if (!matchId) return;

  const pages = await FbToken.find({ busyMatch: matchId, isBusy: true })
    .select("pageId")
    .lean();

  for (const p of pages) {
    scheduleDelayedFreeByPage(p.pageId, `free_by_match:${matchId}`);
  }
}

/**
 * Giải phóng 1 page theo pageId
 * ✅ AUTO DELAY 180s
 */
export async function markFacebookPageFreeByPage(pageId) {
  if (!pageId) return;
  scheduleDelayedFreeByPage(pageId, "free_by_page");
}

/**
 * Giải phóng page theo liveVideoId (trường hợp stop theo live)
 * ✅ AUTO DELAY 180s
 */
export async function markFacebookPageFreeByLive(liveVideoId) {
  if (!liveVideoId) return;

  const pages = await FbToken.find({ busyLiveVideoId: liveVideoId, isBusy: true })
    .select("pageId")
    .lean();

  for (const p of pages) {
    scheduleDelayedFreeByPage(p.pageId, `free_by_live:${liveVideoId}`);
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
        .select("pageId pageName busyMatch busyLiveVideoId")
        .lean();

      if (!busyPages.length) return;

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
      }
    } catch (err) {
      console.error("[FB-CRON] error:", err?.message || err);
    }
  });

  console.log("[FB-CRON] started: */5 * * * * *");
}
