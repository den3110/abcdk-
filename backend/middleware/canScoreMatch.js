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

  // referee giờ là ARRAY<ObjectId>
  const m = await Match.findById(id).select("_id referee status");
  if (!m) {
    res.status(404);
    throw new Error("Match not found");
  }

  const uid = String(req.user?._id || "");
  const isAdmin = userIsAdmin(req.user);

  // Chuẩn hoá về mảng (phòng trường hợp dữ liệu cũ còn kiểu đơn)
  const refs = Array.isArray(m.referee)
    ? m.referee
    : (m.referee ? [m.referee] : []);

  const isReferee = refs.some((r) => String(r) === uid);

  if (!isReferee && !isAdmin) {
    res.status(403);
    throw new Error("Not your match");
  }

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

  const uid = String(req.user?._id || "");
  const isAdmin = req.user?.role === "admin";

  // referee giờ là ARRAY<ObjectId>; vẫn hỗ trợ dữ liệu cũ (1 ObjectId)
  const refs = Array.isArray(m.referee) ? m.referee : (m.referee ? [m.referee] : []);
  const isReferee = refs.some((r) => String(r) === uid);

  if (!isReferee && !isAdmin) {
    res.status(403);
    throw new Error("Not allowed");
  }

  req._match = m;
  next();
});

export default canScoreMatch;
