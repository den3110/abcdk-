// src/controllers/notifyController.js
// 🆕 Đổi import: dùng Hub đa-sự-kiện + broadcast toàn hệ thống
import {
  publishNotification,
  EVENTS,
  CATEGORY,
} from "../services/notifications/notificationHub.js";
// ⚠️ Nếu bạn để broadcastToAllTokens trong notificationService cũ, giữ nguyên path dưới.
//    Nếu file ở src/services/notificationService.js thì sửa lại path cho đúng dự án của bạn.
import { agenda } from "../jobs/agenda.js";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";
import {
  createPushDispatch,
  markPushDispatchFailed,
  markPushDispatchJob,
} from "../services/pushDispatchService.js";

const ADMIN_GLOBAL_BROADCAST_JOB = "notify.admin.global-broadcast";

// POST /api/events/match/:matchId/start-soon
// body: { label?: string, eta?: string }  // ví dụ: label="R1#3 • Sân 2 • 10:30", eta="15′"
export async function notifyMatchStartSoon(req, res) {
  try {
    const { matchId } = req.params;
    const { label, eta } = req.body || {};
    if (!matchId) return res.status(400).json({ message: "matchId required" });

    const out = await publishNotification(EVENTS.MATCH_START_SOON, {
      matchId,
      // 🆕 để Subscription hoạt động theo topic "match"
      topicType: "match",
      topicId: matchId,
      category: CATEGORY.SCHEDULE,
      label,
      eta,
    });

    res.json({ ok: true, event: EVENTS.MATCH_START_SOON, ...out });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

// POST /api/events/tournament-created
// body: { tournamentId, orgId }
export async function notifyTournamentCreated(req, res) {
  try {
    const { tournamentId, orgId } = req.body || {};
    if (!tournamentId)
      return res.status(400).json({ message: "tournamentId required" });

    const out = await publishNotification(EVENTS.TOURNAMENT_CREATED, {
      tournamentId,
      orgId,
      // 🆕 Subscription theo org (followers org nhận)
      topicType: "org",
      topicId: orgId ?? null,
      // không set category để không lọc hẹp nếu bạn chưa dùng categories[]
    });

    res.json({ ok: true, event: EVENTS.TOURNAMENT_CREATED, ...out });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

// POST /api/events/tournament/:tournamentId/schedule-updated
// Quyền: admin || owner (createdBy) || managers của giải
export async function notifyTournamentScheduleUpdated(req, res) {
  try {
    const tournamentId = req.params?.tournamentId || req.body?.tournamentId;
    if (!tournamentId)
      return res.status(400).json({ message: "tournamentId required" });

    const t = await Tournament.findById(tournamentId)
      .select("createdBy managers")
      .lean();
    if (!t) return res.status(404).json({ message: "Tournament not found" });

    const uid = String(req.user?._id || "");
    const isAdmin =
      req.user?.isAdmin ||
      req.user?.role === "admin" ||
      (Array.isArray(req.user?.roles) && req.user.roles.includes("admin"));

    const isOwner = String(t.createdBy) === uid;
    const isManager =
      Array.isArray(t.managers) &&
      t.managers.some((m) => String(m?.user ?? m?._id ?? m) === uid);

    if (!isAdmin && !isOwner && !isManager) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const out = await publishNotification(EVENTS.TOURNAMENT_SCHEDULE_UPDATED, {
      tournamentId,
      // 🆕 Subscription theo tournament
      topicType: "tournament",
      topicId: tournamentId,
      category: CATEGORY.SCHEDULE,
    });

    res.json({ ok: true, event: EVENTS.TOURNAMENT_SCHEDULE_UPDATED, ...out });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

// POST /api/events/global/broadcast
// body:
// {
//   scope?: "all" | "subscribers", // 🆕 default "all": gửi tới mọi token; "subscribers": chỉ ai sub "global"
//   title, body, url?,
//   platform?, minVersion?, maxVersion?,
//   badge?, ttl?
// }

export async function notifyGlobalBroadcast(req, res) {
  let dispatch = null;
  try {
    const {
      scope = "all",
      title,
      body,
      url,
      platform, // 'ios' | 'android' | undefined
      minVersion, // "1.2.0.10" (tuỳ appVersion của bạn)
      maxVersion,
      badge,
      ttl,
    } = req.body || {};

    if (!title || !body) {
      return res.status(400).json({ message: "title & body are required" });
    }

    const filters = { platform, minVersion, maxVersion };
    dispatch = await createPushDispatch({
      sourceKind: "admin_broadcast",
      eventName: EVENTS.SYSTEM_BROADCAST,
      triggeredBy: req.user?._id || null,
      payload: { title, body, url, badge, ttl },
      target: {
        scope,
        topicType: scope === "subscribers" ? "global" : "",
        topicId: scope === "subscribers" ? "global" : "",
        filters,
      },
      context: {
        scope,
        platform,
        minVersion,
        maxVersion,
      },
      status: "queued",
    });

    const job = agenda.create(ADMIN_GLOBAL_BROADCAST_JOB, {
      dispatchId: String(dispatch._id),
      scope,
      title,
      body,
      url,
      platform,
      minVersion,
      maxVersion,
      badge,
      ttl,
      triggeredBy: req.user?._id ? String(req.user._id) : null,
    });
    await job.save();
    await markPushDispatchJob(dispatch._id, {
      jobName: ADMIN_GLOBAL_BROADCAST_JOB,
      jobId: job?.attrs?._id ? String(job.attrs._id) : "",
    });

    return res.status(202).json({
      ok: true,
      scope,
      event: EVENTS.SYSTEM_BROADCAST,
      dispatchId: String(dispatch._id),
      status: "queued",
    });
  } catch (e) {
    if (dispatch?._id) {
      await markPushDispatchFailed(dispatch._id, {
        note: e?.message || "admin_global_broadcast_enqueue_failed",
      });
    }
    return res.status(500).json({ message: e.message });
  }
}


// Gửi thông báo tới DUY NHẤT 1 user (mọi device của user đó).
export async function notifyUserBroadcast(req, res) {
  try {
    const {
      userId,
      title,
      body,
      url,
      badge,
      ttl,
    } = req.body || {};

    if (!userId) {
      return res.status(400).json({ message: "userId required" });
    }
    if (!title || !body) {
      return res
        .status(400)
        .json({ message: "title & body are required" });
    }

    // check định dạng 24-char ObjectId đơn giản cho sạch lỗi
    if (!/^[0-9a-fA-F]{24}$/.test(String(userId))) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    // đảm bảo user tồn tại
    const user = await User.findById(userId).select("_id").lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Chọn event: nếu bạn có EVENTS.USER_DIRECT_BROADCAST thì dùng, không thì fallback SYSTEM_BROADCAST
    const event =
      EVENTS.USER_DIRECT_BROADCAST || EVENTS.SYSTEM_BROADCAST;

    // 🧩 Cách 1 (recommend): đi qua notificationHub với topicType "user"
    // → bạn handle trong notificationHub: topicType === "user" thì lấy tokens theo userId rồi bắn push
    const out = await publishNotification(
      event,
      {
        scope: "user",
        userId: String(userId),
        topicType: "user",
        topicId: String(userId),
        category: CATEGORY.SYSTEM, // hoặc CATEGORY.DIRECT nếu bạn có
        title,
        body,
        url,
        badge,
        ttl,
      },
      {
        badge,
        ttl,
        dispatchMeta: {
          sourceKind: "admin_direct",
          triggeredBy: req.user?._id || null,
          userId: String(userId),
        },
      }
    );

    return res.json({
      ok: true,
      target: "user",
      userId: String(userId),
      event,
      ...out,
    });

    // 🔧 Nếu bạn không muốn đi qua Hub mà muốn gọi thẳng service theo token
    // thì có thể tự implement 1 hàm kiểu broadcastToUserTokens(userId, payload, opts)
    // trong notificationService và gọi ở đây.
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}
