// backend/controllers/homeController.js
import User from "../models/userModel.js";
import Tournament from "../models/tournamentModel.js";
import Match from "../models/matchModel.js";
import Club from "../models/clubModel.js";

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

    const statsPromise = includeStats
      ? Promise.all([
          User.countDocuments({
            isDeleted: { $ne: true },
            role: { $ne: "admin" },
          }),
          Tournament.countDocuments({}),
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

    return res.json({
      stats: stats || undefined,
      clubs: includeClubs ? clubs : undefined,
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    console.error("getHomeSummary error:", err);
    return res.status(500).json({ message: "Failed to load home summary" });
  }
};
