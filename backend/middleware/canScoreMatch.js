import asyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";

const canScoreMatch = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const m = await Match.findById(id).select("_id referee status");
  if (!m) {
    res.status(404);
    throw new Error("Match not found");
  }
  if (String(m.referee) !== String(req.user._id)) {
    res.status(403);
    throw new Error("Not your match");
  }
  if (m.status === "finished") {
    res.status(400);
    throw new Error("Match already finished");
  }
  req._match = m;
  next();
});

export default canScoreMatch;
