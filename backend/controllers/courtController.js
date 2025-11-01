// controllers/courtController.js (ví dụ)
import Court from "../models/courtModel.js";

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

    // ✅ đảm bảo isBreak luôn là object để FE không bị văng
    if (court.currentMatch) {
      court.currentMatch.isBreak = normalizeBreak(court.currentMatch.isBreak);
    }

    res.json(court);
  } catch (error) {
    console.error("Error getting court:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get court info",
      error: error.message,
    });
  }
};
