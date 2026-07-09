// backend/controllers/homeController.js
import User from "../models/userModel.js";
import Tournament from "../models/tournamentModel.js";
import Match from "../models/matchModel.js";
import Club from "../models/clubModel.js";
import RatingChange from "../models/ratingChangeModel.js";
import { CACHE_GROUP_IDS } from "../services/cacheGroups.js";
import { createShortTtlCache } from "../utils/shortTtlCache.js";

const PUBLIC_HOME_CACHE_TTL_MS = Math.max(
  5000,
  Number(process.env.PUBLIC_HOME_CACHE_TTL_MS || 15000)
);
const publicHomeCache = createShortTtlCache(PUBLIC_HOME_CACHE_TTL_MS, {
  id: CACHE_GROUP_IDS.publicHome,
  label: "Public home summary",
  category: "public",
  scope: "public",
});

const clampInt = (value, fallback, min, max) => {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const buildClubLocation = (club) => {
  const city = String(club?.city || "").trim();
  const province = String(club?.province || "").trim();
  if (city && province) {
    if (city.toLowerCase() === province.toLowerCase()) return city;
    return `${city}, ${province}`;
  }
  if (city) return city;
  if (province) return province;
  const locationText = String(club?.locationText || "").trim();
  if (locationText) return locationText;
  const address = String(club?.address || "").trim();
  if (address) return address;
  return "";
};

export const getHomeSummary = async (req, res) => {
  try {
    const includeStats = String(req.query.stats || "1") !== "0";
    const includeClubs = String(req.query.clubs || "1") !== "0";
    const clubsLimit = clampInt(req.query.clubsLimit, 6, 1, 24);
    const cacheKey = [
      "home",
      includeStats ? "stats" : "no-stats",
      includeClubs ? "clubs" : "no-clubs",
      clubsLimit,
    ].join(":");
    const cached = publicHomeCache.get(cacheKey);

    if (cached) {
      res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=15");
      res.setHeader("X-PKT-Cache", "HIT");
      return res.json(cached);
    }

    const statsPromise = includeStats
      ? Promise.all([
          User.countDocuments({
            isDeleted: { $ne: true },
            role: { $ne: "admin" },
          }),
          Tournament.countDocuments({ isTest: { $ne: true } }),
          Match.countDocuments({ status: "finished" }),
          Club.countDocuments({ visibility: "public" }),
        ]).then(([players, tournaments, matches, clubs]) => ({
          players,
          tournaments,
          matches,
          clubs,
        }))
      : Promise.resolve(null);

    const clubsPromise = includeClubs
      ? Club.find({ visibility: "public" })
          .sort({ isVerified: -1, "stats.memberCount": -1, updatedAt: -1 })
          .limit(clubsLimit)
          .select(
            "name slug logoUrl coverUrl city province locationText address stats isVerified"
          )
          .lean()
          .then((rows) =>
            rows.map((c) => ({
              id: c._id,
              name: c.name,
              slug: c.slug,
              logoUrl: c.logoUrl || "",
              coverUrl: c.coverUrl || "",
              memberCount: Number(c.stats?.memberCount || 0),
              location: buildClubLocation(c),
              verified: !!c.isVerified,
            }))
          )
      : Promise.resolve([]);

    const [stats, clubs] = await Promise.all([statsPromise, clubsPromise]);

    const payload = {
      stats: stats || undefined,
      clubs: includeClubs ? clubs : undefined,
      asOf: new Date().toISOString(),
    };

    publicHomeCache.set(cacheKey, payload);
    res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=15");
    res.setHeader("X-PKT-Cache", "MISS");
    return res.json(payload);
  } catch (err) {
    console.error("getHomeSummary error:", err);
    return res.status(500).json({ message: "Failed to load home summary" });
  }
};

/* =========================================================================
 * PULSE — dữ liệu "sống" cho trang chủ v2 (Astryx style):
 *  - liveNow: số trận đang live
 *  - todayMatches: số trận đã kết thúc hôm nay
 *  - activeTournaments: số giải đang diễn ra
 *  - weekClimbers: VĐV leo hạng mạnh nhất 7 ngày qua (tổng delta điểm trình)
 * Chỉ đọc, cache ngắn, không bao giờ 500 — lỗi phần nào trả phần đó rỗng.
 * ========================================================================= */
const PULSE_CACHE_TTL_MS = Math.max(
  5000,
  Number(process.env.PUBLIC_HOME_PULSE_TTL_MS || 20000)
);
const pulseCache = createShortTtlCache(PULSE_CACHE_TTL_MS, {
  id: CACHE_GROUP_IDS.publicHome,
  label: "Public home pulse",
  category: "public",
  scope: "public",
});

const safeCount = (promise) =>
  Promise.resolve(promise).catch((e) => {
    console.error("[homePulse] count error:", e?.message || e);
    return 0;
  });

async function computeWeekClimbers(limit = 5) {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await RatingChange.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: "$user",
          delta: { $sum: "$delta" },
          matches: { $sum: 1 },
        },
      },
      { $match: { delta: { $gt: 0.0001 } } },
      { $sort: { delta: -1 } },
      { $limit: Math.max(1, Math.min(10, limit)) },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "u",
        },
      },
      { $unwind: "$u" },
      { $match: { "u.isDeleted": { $ne: true } } },
      {
        $project: {
          _id: 0,
          userId: "$_id",
          delta: { $round: ["$delta", 3] },
          matches: 1,
          nickname: { $ifNull: ["$u.nickname", { $ifNull: ["$u.name", ""] }] },
          avatar: { $ifNull: ["$u.avatar", ""] },
          province: { $ifNull: ["$u.province", ""] },
        },
      },
    ]);
    return rows;
  } catch (e) {
    console.error("[homePulse] weekClimbers error:", e?.message || e);
    return [];
  }
}

export const getHomePulse = async (req, res) => {
  try {
    const cacheKey = "pulse:v1";
    const cached = pulseCache.get(cacheKey);
    if (cached) {
      res.setHeader("Cache-Control", "public, max-age=20, stale-while-revalidate=20");
      res.setHeader("X-PKT-Cache", "HIT");
      return res.json(cached);
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [liveNow, todayMatches, activeTournaments, weekClimbers] =
      await Promise.all([
        safeCount(Match.countDocuments({ status: "live" })),
        safeCount(
          Match.countDocuments({
            status: "finished",
            finishedAt: { $gte: startOfDay },
          })
        ),
        safeCount(
          Tournament.countDocuments({
            status: "ongoing",
            isTest: { $ne: true },
          })
        ),
        computeWeekClimbers(5),
      ]);

    const payload = {
      liveNow,
      todayMatches,
      activeTournaments,
      weekClimbers,
      asOf: new Date().toISOString(),
    };

    pulseCache.set(cacheKey, payload);
    res.setHeader("Cache-Control", "public, max-age=20, stale-while-revalidate=20");
    res.setHeader("X-PKT-Cache", "MISS");
    return res.json(payload);
  } catch (err) {
    console.error("getHomePulse error:", err);
    // Không chặn trang chủ: trả rỗng thay vì 500
    return res.json({
      liveNow: 0,
      todayMatches: 0,
      activeTournaments: 0,
      weekClimbers: [],
      asOf: new Date().toISOString(),
    });
  }
};
