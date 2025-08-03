// controllers/profileController.js
import asyncHandler from "express-async-handler";
import RatingHistory from "../models/ratingHistoryModel.js";
import Match from "../models/matchModel.js"; // giả định đã có

// GET /api/users/:id/ratings
export const getRatingHistory = asyncHandler(async (req, res) => {
  const list = await RatingHistory.find({ user: req.params.id })
    .sort({ date: -1 })
    .select("date ratingSingle ratingDouble note");
  res.json(list);
});

// GET /api/users/:id/matches
export const getMatchHistory = asyncHandler(async (req, res) => {
  const matches = await Match.find({ "teams.playerIds": req.params.id }) // hoặc logic khác
    .sort({ dateTime: -1 })
    .select(
      "_id dateTime tournament team1 score team2 video"
    )
    .lean();
  res.json(matches);
});
