import {
  createBracketStory,
  getLatestBracketStory,
} from "../../services/bracketStory.service.js";

export async function getAdminBracketStory(req, res) {
  try {
    const data = await getLatestBracketStory(req.params.id);
    res.json(data);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.message || "Không thể tải AI Bracket Story",
    });
  }
}

export async function generateAdminBracketStory(req, res) {
  try {
    const data = await createBracketStory({
      tournamentId: req.params.id,
      actorId: req.user?._id || req.user?.id || null,
    });
    res.status(201).json(data);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.message || "Không thể tạo AI Bracket Story",
    });
  }
}
