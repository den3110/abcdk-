import asyncHandler from "express-async-handler";
import RatingChange from "../models/ratingChangeModel.js";
import User from "../models/userModel.js";
import {
  applyRatingForMatch,
  recomputeTournamentRatings,
  recomputeUserRatings,
} from "../services/ratingEngine.js";

/** Áp dụng rating cho 1 match ngay lập tức chưa dùng */
export const applyMatchRating = asyncHandler(async (req, res) => {
  const { matchId } = req.params;
  const out = await applyRatingForMatch(matchId);
  res.json(out);
});

/** Recompute theo tournament */
export const recomputeTournament = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  const out = await recomputeTournamentRatings(tournamentId);
  res.json(out);
});

/** Recompute theo user */
export const recomputeUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const out = await recomputeUserRatings(userId);
  res.json(out);
});

/** Lấy rating & history của user */
export const getUserRating = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const user = await User.findById(userId).select(
    "name nickname localRatings avatar"
  );
  if (!user) return res.status(404).json({ message: "User not found" });

  const history = await RatingChange.find({ user: userId })
    .populate({
      path: "match",
      select: "labelKey tournament bracket finishedAt",
    })
    .sort({ createdAt: -1 })
    .limit(200);

  res.json({
    user: {
      _id: user._id,
      name: user.name,
      nickname: user.nickname,
      avatar: user.avatar,
      localRatings: user.localRatings || {},
    },
    history,
  });
});
