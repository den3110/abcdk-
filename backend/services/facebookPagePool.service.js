// services/facebookPagePool.service.js
import cron from "node-cron";
import FbToken from "../models/fbTokenModel.js";
import Match from "../models/matchModel.js"; // đổi đúng path model Match của bạn

// các trạng thái coi như match đã xong → page phải rảnh
const DONE_STATUSES = [
  "finished",
  "ended",
  "completed",
  "cancelled",
  "canceled",
  "aborted",
];

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
 */
export async function markFacebookPageFreeByMatch(matchId) {
  if (!matchId) return;
  await FbToken.updateMany(
    { busyMatch: matchId },
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

/**
 * Giải phóng 1 page theo pageId
 */
export async function markFacebookPageFreeByPage(pageId) {
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

/**
 * Giải phóng page theo liveVideoId (trường hợp stop theo live)
 */
export async function markFacebookPageFreeByLive(liveVideoId) {
  if (!liveVideoId) return;
  await FbToken.updateMany(
    { busyLiveVideoId: liveVideoId },
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

/* ============================================================
 * CRON: mỗi 5s quét page đang bận → nếu match đã finish thì free
 * ========================================================== */
let _fbBusyCronStarted = false;

export function startFacebookBusyCron() {
  if (_fbBusyCronStarted) return;
  _fbBusyCronStarted = true;

  // */5 * * * * *  = chạy mỗi 5 giây
  cron.schedule("*/5 * * * * *", async () => {
    try {
      // lấy các page đang bận và có match
      const busyPages = await FbToken.find({
        isBusy: true,
        busyMatch: { $ne: null },
      })
        .select("pageId pageName busyMatch busyLiveVideoId")
        .lean();

      if (!busyPages.length) return;

      // gom matchId để query 1 lần
      const matchIds = busyPages
        .map((p) => p.busyMatch)
        .filter(Boolean)
        .map((id) => id.toString());

      const matches = await Match.find({ _id: { $in: matchIds } })
        .select("status facebookLive")
        .lean();

      const matchMap = new Map();
      for (const m of matches) {
        matchMap.set(m._id.toString(), m);
      }

      for (const page of busyPages) {
        const label = `${page.pageName || ""} (${page.pageId})`;
        const matchIdStr = page.busyMatch?.toString();
        const m = matchIdStr ? matchMap.get(matchIdStr) : null;

        // match bị xoá / không còn → free page
        if (!m) {
          await markFacebookPageFreeByPage(page.pageId);
          console.log("[FB-CRON] free page (match không còn):", label);
          continue;
        }

        // match đã xong → free page
        if (DONE_STATUSES.includes(m.status)) {
          await markFacebookPageFreeByPage(page.pageId);
          console.log(
            "[FB-CRON] free page (match finish):",
            label,
            "→ match=",
            matchIdStr
          );
          continue;
        }

        // match vẫn chạy nhưng match đang ghi page khác → free page cũ
        const matchPageId = m.facebookLive?.pageId;
        if (matchPageId && matchPageId !== page.pageId) {
          await markFacebookPageFreeByPage(page.pageId);
          console.log(
            "[FB-CRON] free page (match chuyển sang page khác):",
            label,
            "→ match page:",
            matchPageId
          );
          continue;
        }

        // có thể bổ sung timeout: nếu bận quá lâu thì free
        // ví dụ > 2h mà match chưa finish → free để tránh kẹt
        // ...
      }
    } catch (err) {
      console.error("[FB-CRON] error:", err?.message || err);
    }
  });

  console.log("[FB-CRON] started: */5 * * * * *");
}
