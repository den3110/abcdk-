import asyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";

const userIsAdmin = (user) =>
  Boolean(
    user?.isAdmin ||
      user?.role === "admin" ||
      (Array.isArray(user?.roles) && user.roles.includes("admin"))
  );

export const canScoreMatch = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const m = await Match.findById(id).select("_id referee status");
  if (!m) {
    res.status(404);
    throw new Error("Match not found");
  }

  const isReferee = m.referee && String(m.referee) === String(req.user._id);
  const isAdmin = userIsAdmin(req.user);

  if (!isReferee && !isAdmin) {
    res.status(403);
    throw new Error("Not your match");
  }
  // console.log("m.status", m.status);
  if (m.status === "finished") {
    res.status(400);
    throw new Error("Trận đấu đã kết thúc");
  }

  req._match = m;
  next();
});

export const ownOrAdmin = asyncHandler(async (req, res, next) => {
  const m = await Match.findById(req.params.id).select("_id referee status");
  if (!m) {
    res.status(404);
    throw new Error("Match not found");
  }
  if (String(m.referee) !== String(req.user._id) && req.user.role !== "admin") {
    res.status(403);
    throw new Error("Not allowed");
  }
  req._match = m;
  next();
});

export default canScoreMatch;
