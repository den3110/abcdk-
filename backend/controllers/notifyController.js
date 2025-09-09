// src/controllers/notifyController.js
// 🆕 Đổi import: dùng Hub đa-sự-kiện + broadcast toàn hệ thống
import {
  publishNotification,
  EVENTS,
  CATEGORY,
} from "../services/notifications/notificationHub.js";
// ⚠️ Nếu bạn để broadcastToAllTokens trong notificationService cũ, giữ nguyên path dưới.
//    Nếu file ở src/services/notificationService.js thì sửa lại path cho đúng dự án của bạn.
import { broadcastToAllTokens } from "../services/notifications/notificationService.js";
import Tournament from "../models/tournamentModel.js";

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

    // 🆕 mode 1: gửi cho người đã subscribe topic "global"
    if (scope === "subscribers") {
      const out = await publishNotification(EVENTS.SYSTEM_BROADCAST, {
        topicType: "global",
        topicId: null, // null cho "global"
        category: CATEGORY.SYSTEM,
        title,
        body,
        url,
      });
      return res.json({
        ok: true,
        scope,
        event: EVENTS.SYSTEM_BROADCAST,
        ...out,
      });
    }

    // mode 2 (mặc định): broadcast tới TẤT CẢ token trong DB (lọc theo platform/version)
    const filters = { platform, minVersion, maxVersion };
    const payload = {
      title,
      body,
      data: url ? { url } : {}, // deep-link
    };
    const sendOpts = { badge, ttl };

    const out = await broadcastToAllTokens(filters, payload, sendOpts);
    return res.json({ ok: true, scope, ...out });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}
