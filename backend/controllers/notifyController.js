// src/controllers/notifyController.js
import { broadcastToAllTokens, emitNotification } from "../services/notificationService.js";
import Tournament from "../models/tournamentModel.js";

// POST /api/events/match/:matchId/start-soon
export async function notifyMatchStartSoon(req, res) {
  try {
    const { matchId } = req.params;
    if (!matchId) return res.status(400).json({ message: "matchId required" });

    const out = await emitNotification("MATCH_START_SOON", { matchId });
    res.json(out);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

// POST /api/events/tournament-created  { tournamentId, orgId }
export async function notifyTournamentCreated(req, res) {
  try {
    const { tournamentId, orgId } = req.body || {};
    if (!tournamentId) return res.status(400).json({ message: "tournamentId required" });

    const out = await emitNotification("TOURNAMENT_CREATED", { tournamentId, orgId });
    res.json(out);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

// POST /api/events/tournament/:tournamentId/schedule-updated
// Quyền: admin || owner (createdBy) || managers của giải
export async function notifyTournamentScheduleUpdated(req, res) {
  try {
    const tournamentId = req.params?.tournamentId || req.body?.tournamentId;
    if (!tournamentId) return res.status(400).json({ message: "tournamentId required" });

    const t = await Tournament.findById(tournamentId).select("createdBy managers").lean();
    if (!t) return res.status(404).json({ message: "Tournament not found" });

    const uid = String(req.user?._id || "");
    const isAdmin =
      req.user?.isAdmin ||
      req.user?.role === "admin" ||
      (Array.isArray(req.user?.roles) && req.user.roles.includes("admin"));

    const isOwner = String(t.createdBy) === uid;
    const isManager =
      Array.isArray(t.managers) &&
      t.managers.some((m) => String((m?.user ?? m?._id ?? m)) === uid);

    if (!isAdmin && !isOwner && !isManager) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const out = await emitNotification("TOURNAMENT_SCHEDULE_UPDATED", { tournamentId });
    res.json(out);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

// POST /api/events/global/broadcast
// body: { title, body, url?, platform?, minVersion?, maxVersion?, badge?, ttl?, dryRun? }
export async function notifyGlobalBroadcast(req, res) {
  try {
    const {
      title,
      body,
      url,
      platform,     // 'ios' | 'android' | undefined
      minVersion,   // "1.2.0.10" (tuỳ cách bạn build appVersion)
      maxVersion,
      badge,
      ttl,
      dryRun,       // nếu true: chỉ trả về ước tính (chưa implement queue -> gửi thật luôn)
    } = req.body || {};

    if (!title || !body) {
      return res.status(400).json({ message: "title & body are required" });
    }

    const filters = { platform, minVersion, maxVersion };
    const payload = {
      title,
      body,
      data: url ? { url } : {}, // deep-link theo hook của bạn
    };
    const sendOpts = { badge, ttl };

    // (Tuỳ chọn) bạn có thể thêm chế độ dryRun chỉ đếm số token sẽ nhận:
    // Ở bản tối giản, mình gửi luôn (không dry-run thật).
    const out = await broadcastToAllTokens(filters, payload, sendOpts);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}