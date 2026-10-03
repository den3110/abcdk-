// jobs/eventLiveNotifyJob.js
// Định kỳ dò kênh YouTube; khi có luồng MỚI bắt đầu LIVE -> auto-push cho toàn
// bộ user (chống spam bằng cooldown). Dùng detectLiveNow (rẻ quota).
import { agenda } from "./agenda.js";
import {
  detectLiveNow,
  getAutoNotifyEvents,
} from "../services/eventLiveStreams.service.js";
import EventLiveNotifyState from "../models/eventLiveNotifyStateModel.js";
import {
  createPushDispatch,
  markPushDispatchJob,
} from "../services/pushDispatchService.js";
import { EVENTS } from "../services/notifications/notificationHub.js";

export const EVENT_LIVE_AUTO_NOTIFY_JOB = "event-live.auto-notify";
const ADMIN_GLOBAL_BROADCAST_JOB = "notify.admin.global-broadcast";
const BASE_URL = "https://pickletour.vn/live/event";

/** URL trang xem của 1 giải theo slug ("" = giải mặc định). */
const liveUrlFor = (slug) => (slug ? `${BASE_URL}/${slug}` : BASE_URL);

/** Đọc trạng thái auto-push của 1 giải (slug="" dùng field cũ ở cấp gốc để
 *  tương thích dữ liệu đã lưu trước đây). */
function readSlugState(state, slug) {
  if (!slug) {
    return {
      liveIds: state.liveIds || [],
      lastAutoPushAt: state.lastAutoPushAt || null,
    };
  }
  const s = (state.bySlug && state.bySlug[slug]) || {};
  return { liveIds: s.liveIds || [], lastAutoPushAt: s.lastAutoPushAt || null };
}

/** Ghi lại trạng thái auto-push của 1 giải. */
function writeSlugState(state, slug, patch) {
  if (!slug) {
    if (patch.liveIds !== undefined) state.liveIds = patch.liveIds;
    if (patch.lastAutoPushAt !== undefined)
      state.lastAutoPushAt = patch.lastAutoPushAt;
    if (patch.lastPushedIds !== undefined)
      state.lastPushedIds = patch.lastPushedIds;
    return;
  }
  const next = { ...(state.bySlug || {}) };
  next[slug] = { ...(next[slug] || {}), ...patch };
  state.bySlug = next;
  state.markModified("bySlug");
}

agenda.define(EVENT_LIVE_AUTO_NOTIFY_JOB, async (job, done) => {
  try {
    const events = await getAutoNotifyEvents();
    if (!events.length) return done();

    let state = await EventLiveNotifyState.findById("state");
    if (!state) state = new EventLiveNotifyState({ _id: "state" });

    const now = Date.now();

    for (const cfg of events) {
      const slug = cfg.slug || "";
      try {
        const res = await detectLiveNow(cfg);
        const currentIds = (res.live || []).map((f) => f.videoId).filter(Boolean);

        const prevState = readSlugState(state, slug);
        const prev = new Set(prevState.liveIds || []);
        const newIds = currentIds.filter((id) => !prev.has(id));

        const cooldownMs = (cfg.autoNotifyCooldownMinutes || 180) * 60 * 1000;
        const lastAt = prevState.lastAutoPushAt
          ? new Date(prevState.lastAutoPushAt).getTime()
          : 0;
        const cooldownOk = now - lastAt >= cooldownMs;

        // Luôn cập nhật ảnh chụp luồng LIVE hiện tại cho giải này
        writeSlugState(state, slug, { liveIds: currentIds });

        if (newIds.length > 0 && currentIds.length > 0 && cooldownOk) {
          const courtCount = new Set(
            (res.live || []).map((f) => f.courtKey ?? f.courtLabel ?? f.videoId),
          ).size;
          const eventName = cfg.eventName || res.eventName || "Giải đấu";
          const url = liveUrlFor(slug);
          const title = `🔴 ${eventName} đang trực tiếp!`;
          const body =
            courtCount > 1
              ? `Đang có ${courtCount} sân phát trực tiếp — xem ngay trên PickleTour! 🎾`
              : `Trận đấu đang diễn ra — xem trực tiếp ngay trên PickleTour! 🎾`;

          const dispatch = await createPushDispatch({
            sourceKind: "event_live_auto",
            eventName: EVENTS.SYSTEM_BROADCAST,
            triggeredBy: null,
            payload: { title, body, url },
            target: { scope: "all", topicType: "", topicId: "", filters: {} },
            context: { scope: "all", source: "event-live-auto-notify" },
            status: "queued",
          });

          const bjob = agenda.create(ADMIN_GLOBAL_BROADCAST_JOB, {
            dispatchId: String(dispatch._id),
            scope: "all",
            title,
            body,
            url,
            triggeredBy: null,
          });
          await bjob.save();
          await markPushDispatchJob(dispatch._id, {
            jobName: ADMIN_GLOBAL_BROADCAST_JOB,
            jobId: bjob?.attrs?._id ? String(bjob.attrs._id) : "",
          });

          writeSlugState(state, slug, {
            lastAutoPushAt: new Date(now),
            lastPushedIds: currentIds,
          });
          console.log(
            `[event-live] auto-push (${slug || "default"}): ${courtCount} sân LIVE, ${newIds.length} luồng mới -> broadcast`,
          );
        }
      } catch (e) {
        console.error(
          `[event-live] auto-notify error (${slug || "default"}):`,
          e?.message,
        );
      }
    }

    await state.save();
    done();
  } catch (e) {
    console.error("[event-live] auto-notify error:", e?.message);
    done(e);
  }
});
