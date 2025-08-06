// controllers/profileController.js
import asyncHandler from "express-async-handler";
import Match from "../models/matchModel.js"; // giả định đã có
import ScoreHistory from "../models/scoreHistoryModel.js";

/**
 * GET /api/score-history/:id?page=1
 * Trả về lịch sử chấm điểm của một user (id = VĐV)
 * Mặc định pageSize = 10; nếu không cần phân trang, bỏ toàn bộ phần `page/pageSize`.
 */
export const getRatingHistory = asyncHandler(async (req, res) => {
  const pageSize = 10;
  const page = Number(req.query.page) || 1;

  const filter = { user: req.params.id };
  const total = await ScoreHistory.countDocuments(filter);

  const list = await ScoreHistory.find(filter)
    .sort({ scoredAt: -1 }) // mới nhất trước
    .skip(pageSize * (page - 1))
    .limit(pageSize)
    .select("scoredAt single double note") // trường mong muốn
    .populate("scorer", "name email"); // nếu muốn biết ai chấm

  res.json({ history: list, total, pageSize });
});

// GET /api/users/:id/matches
export const getMatchHistory = asyncHandler(async (req, res) => {
  const matches = await Match.find({ "teams.playerIds": req.params.id }) // hoặc logic khác
    .sort({ dateTime: -1 })
    .select("_id dateTime tournament team1 score team2 video")
    .lean();
  res.json(matches);
});
