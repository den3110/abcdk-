// controllers/courtController.js
import Court from "../models/courtModel.js";

/**
 * GET /api/courts/:courtId
 * Lấy thông tin sân bao gồm currentMatch
 */
export const getCourtById = async (req, res) => {
  try {
    const { courtId } = req.params;

    const court = await Court.findById(courtId)
      .populate("tournament", "name status")
      .populate("bracket", "name type")
      .populate({
        path: "currentMatch",
        populate: [
          {
            path: "pairA",
            populate: { path: "player1.user player2.user", select: "name" },
          },
          {
            path: "pairB",
            populate: { path: "player1.user player2.user", select: "name" },
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
