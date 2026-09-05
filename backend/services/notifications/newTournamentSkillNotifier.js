// services/notifications/newTournamentSkillNotifier.js
// Gửi push "giải mới hợp trình" tới VĐV có điểm trình nằm trong khoảng của giải.
import User from "../../models/userModel.js";
import { publishNotification, EVENTS, CATEGORY } from "./notificationHub.js";

const RATING_BAND = 0.6; // biên độ điểm trình quanh mốc mục tiêu
const MAX_AUDIENCE = 3000; // trần số VĐV để tránh spam quá rộng

/**
 * @param {object} tournament - Tournament doc (đã .lean() hoặc mongoose doc)
 */
export async function notifyNewTournamentBySkill(tournament) {
  try {
    if (!tournament?._id) return { skipped: "no_tournament" };

    const isSingle = tournament.eventType === "single";
    // scoreCap là tổng điểm CẶP (đôi) → mỗi VĐV ≈ scoreCap/2
    const cap = isSingle
      ? Number(tournament.singleCap || 0)
      : Number(tournament.scoreCap || 0);
    if (!cap || cap <= 0) return { skipped: "no_cap" };

    const targetPer = isSingle ? cap : cap / 2;
    const lo = Math.max(0, targetPer - RATING_BAND);
    const hi = targetPer + RATING_BAND;
    const ratingField = isSingle
      ? "localRatings.singles"
      : "localRatings.doubles";

    const candidates = await User.find({
      [ratingField]: { $gte: lo, $lte: hi },
      isPushNotificationEnabled: { $ne: false },
      "notificationPrefs.tournamentMuteAll": { $ne: true },
    })
      .select("_id")
      .limit(MAX_AUDIENCE)
      .lean();

    const userIds = candidates.map((u) => String(u._id));
    if (!userIds.length) return { skipped: "no_candidates" };

    const result = await publishNotification(EVENTS.TOURNAMENT_MATCH_SKILL, {
      tournamentId: String(tournament._id),
      directUserIds: userIds,
      overrideAudience: userIds,
      category: CATEGORY.SYSTEM,
    });

    return { ok: true, candidates: userIds.length, result };
  } catch (e) {
    console.error(
      "[notifyNewTournamentBySkill] failed:",
      e?.message || e,
      { tournamentId: String(tournament?._id || "") }
    );
    return { error: e?.message || "failed" };
  }
}
