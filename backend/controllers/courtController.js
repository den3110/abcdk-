// controllers/courtController.js (ví dụ)
import Court from "../models/courtModel.js";
import { createShortTtlCache } from "../utils/shortTtlCache.js";
import { enrichCourtsWithManualAssignment } from "../services/courtManualAssignment.service.js";
import { CACHE_GROUP_IDS } from "../services/cacheGroups.js";

const COURT_DETAILS_CACHE_TTL_MS = Math.max(
  1000,
  Number(process.env.COURT_DETAILS_CACHE_TTL_MS || 2000)
);
const courtDetailsCache = createShortTtlCache(COURT_DETAILS_CACHE_TTL_MS, {
  id: CACHE_GROUP_IDS.courtDetails,
  label: "Court detail payload",
  category: "live",
  scope: "public",
});

// giống cái normalize trong matchModel để tránh case isBreak = false
const BREAK_DEFAULT = {
  active: false,
  afterGame: null,
  note: "",
  startedAt: null,
  expectedResumeAt: null,
};
const normalizeBreak = (val) => {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return { ...BREAK_DEFAULT };
  }
  return {
    active: !!val.active,
    afterGame:
      typeof val.afterGame === "number"
        ? val.afterGame
        : BREAK_DEFAULT.afterGame,
    note: typeof val.note === "string" ? val.note : BREAK_DEFAULT.note,
    startedAt: val.startedAt ? new Date(val.startedAt) : null,
    expectedResumeAt: val.expectedResumeAt
      ? new Date(val.expectedResumeAt)
      : null,
  };
};

export const getCourtById = async (req, res) => {
  try {
    const { courtId } = req.params;
    const cached = courtDetailsCache.get(courtId);
    if (cached) {
      res.setHeader("Cache-Control", "public, max-age=2, stale-while-revalidate=5");
      res.setHeader("X-PKT-Cache", "HIT");
      return res.json(cached);
    }

    const court = await Court.findById(courtId)
      .populate("tournament", "name status")
      .populate("bracket", "name type")
      .populate({
        path: "currentMatch",
        // ✅ lấy thêm isBreak
        select: "status labelKey code court courtLabel facebookLive isBreak",
        populate: [
          {
            path: "pairA",
            populate: {
              path: "player1.user player2.user",
              select: "name",
            },
          },
          {
            path: "pairB",
            populate: {
              path: "player1.user player2.user",
              select: "name",
            },
          },
        ],
      })
      .lean();

    if (!court) {
      return res.status(404).json({
        success: false,
        message: "Court not found",
      });
    }

    let payload = court;

    const [decoratedCourt] = await enrichCourtsWithManualAssignment([court]);
    if (decoratedCourt) {
      payload = {
        ...court,
        manualAssignment: decoratedCourt.manualAssignment,
        nextMatch: decoratedCourt.nextMatch || null,
        remainingCount: decoratedCourt.remainingCount || 0,
        listEnabled: !!decoratedCourt.listEnabled,
      };
    }

    // ✅ đảm bảo isBreak luôn là object để FE không bị văng
    if (payload.currentMatch) {
      payload.currentMatch.isBreak = normalizeBreak(payload.currentMatch.isBreak);
    }

    courtDetailsCache.set(courtId, payload);
    res.setHeader("Cache-Control", "public, max-age=2, stale-while-revalidate=5");
    res.setHeader("X-PKT-Cache", "MISS");
    res.json(payload);
  } catch (error) {
    console.error("Error getting court:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get court info",
      error: error.message,
    });
  }
};
