// jobs/eventLiveNotifyJob.js
// Định kỳ dò kênh YouTube; khi có luồng MỚI bắt đầu LIVE -> auto-push cho toàn
// bộ user (chống spam bằng cooldown). Dùng detectLiveNow (rẻ quota).
import { agenda } from "./agenda.js";
import {
  detectLiveNow,
  getEventLiveConfig,
} from "../services/eventLiveStreams.service.js";
import EventLiveNotifyState from "../models/eventLiveNotifyStateModel.js";
import {
  createPushDispatch,
  markPushDispatchJob,
} from "../services/pushDispatchService.js";
import { EVENTS } from "../services/notifications/notificationHub.js";

export const EVENT_LIVE_AUTO_NOTIFY_JOB = "event-live.auto-notify";
const ADMIN_GLOBAL_BROADCAST_JOB = "notify.admin.global-broadcast";
const LIVE_URL = "https://pickletour.vn/live/event";

agenda.define(EVENT_LIVE_AUTO_NOTIFY_JOB, async (job, done) => {
  try {
    const cfg = await getEventLiveConfig();
    if (!cfg.enabled || !cfg.autoNotify || !cfg.youtubeChannel) return done();

    const res = await detectLiveNow();
    const currentIds = (res.live || []).map((f) => f.videoId).filter(Boolean);

    let state = await EventLiveNotifyState.findById("state");
    if (!state) state = new EventLiveNotifyState({ _id: "state" });

    const prev = new Set(state.liveIds || []);
    const newIds = currentIds.filter((id) => !prev.has(id));
    state.liveIds = currentIds; // luôn cập nhật ảnh chụp hiện tại

    const cooldownMs = (cfg.autoNotifyCooldownMinutes || 180) * 60 * 1000;
    const now = Date.now();
    const lastAt = state.lastAutoPushAt
      ? new Date(state.lastAutoPushAt).getTime()
      : 0;
    const cooldownOk = now - lastAt >= cooldownMs;

    if (newIds.length > 0 && currentIds.length > 0 && cooldownOk) {
      const courtCount = new Set(
        (res.live || []).map((f) => f.courtKey ?? f.courtLabel ?? f.videoId),
      ).size;
      const eventName = cfg.eventName || res.eventName || "Giải đấu";
      const title = `🔴 ${eventName} đang trực tiếp!`;
      const body =
        courtCount > 1
          ? `Đang có ${courtCount} sân phát trực tiếp — xem ngay trên PickleTour! 🎾`
          : `Trận đấu đang diễn ra — xem trực tiếp ngay trên PickleTour! 🎾`;

      const dispatch = await createPushDispatch({
        sourceKind: "event_live_auto",
        eventName: EVENTS.SYSTEM_BROADCAST,
        triggeredBy: null,
        payload: { title, body, url: LIVE_URL },
        target: { scope: "all", topicType: "", topicId: "", filters: {} },
        context: { scope: "all", source: "event-live-auto-notify" },
        status: "queued",
      });

      const bjob = agenda.create(ADMIN_GLOBAL_BROADCAST_JOB, {
        dispatchId: String(dispatch._id),
        scope: "all",
        title,
        body,
        url: LIVE_URL,
        triggeredBy: null,
      });
      await bjob.save();
      await markPushDispatchJob(dispatch._id, {
        jobName: ADMIN_GLOBAL_BROADCAST_JOB,
        jobId: bjob?.attrs?._id ? String(bjob.attrs._id) : "",
      });

      state.lastAutoPushAt = new Date(now);
      state.lastPushedIds = currentIds;
      console.log(
        `[event-live] auto-push: ${courtCount} sân LIVE, ${newIds.length} luồng mới -> broadcast`,
      );
    }

    await state.save();
    done();
  } catch (e) {
    console.error("[event-live] auto-notify error:", e?.message);
    done(e);
  }
});
