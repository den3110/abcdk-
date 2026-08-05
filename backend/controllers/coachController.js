// controllers/coachController.js
// Danh sách HLV public: user role=coach + coachProfile.isPublic, join Ranking
// sort theo max(double, single) desc. Trả kèm bio, phone, province, avatar.
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";

const escapeRegex = (s = "") => String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

// GET /api/coaches?q=&province=&sort=rating&cursor=&limit=
export const listCoaches = asyncHandler(async (req, res) => {
  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || 20, 1),
    50,
  );
  const q = String(req.query.q || "").trim();
  const province = String(req.query.province || "").trim();
  const sort = String(req.query.sort || "rating");
  const cursor = decodeCursor(req.query.cursor);

  const userMatch = {
    isCoach: true,
    isDeleted: { $ne: true },
    "coachProfile.isPublic": { $ne: false },
  };
  if (province) userMatch.province = province;
  if (q) {
    const re = new RegExp(escapeRegex(q), "i");
    userMatch.$or = [{ name: re }, { nickname: re }];
  }

  const pipeline = [
    { $match: userMatch },
    {
      $lookup: {
        from: "rankings",
        localField: "_id",
        foreignField: "user",
        as: "ranking",
      },
    },
    { $unwind: { path: "$ranking", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        single: { $ifNull: ["$ranking.single", 0] },
        double: { $ifNull: ["$ranking.double", 0] },
        reputation: { $ifNull: ["$ranking.reputation", 0] },
        tierColor: "$ranking.tierColor",
        tierLabel: "$ranking.tierLabel",
        maxRating: {
          $max: [
            { $ifNull: ["$ranking.double", 0] },
            { $ifNull: ["$ranking.single", 0] },
          ],
        },
      },
    },
  ];

  // Cursor sort trên (maxRating desc, _id desc) — tie-break bằng _id để stable
  if (sort === "rating") {
    if (cursor?.payload?.lastRating != null && cursor?.payload?.lastId) {
      pipeline.push({
        $match: {
          $or: [
            { maxRating: { $lt: Number(cursor.payload.lastRating) } },
            {
              maxRating: Number(cursor.payload.lastRating),
              _id: { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) },
            },
          ],
        },
      });
    }
    pipeline.push({ $sort: { maxRating: -1, _id: -1 } });
  } else {
    // Sort mặc định theo createdAt (mới lên trước)
    if (cursor?.payload?.lastId) {
      pipeline.push({
        $match: {
          _id: { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) },
        },
      });
    }
    pipeline.push({ $sort: { _id: -1 } });
  }

  pipeline.push({ $limit: limit + 1 });
  pipeline.push({
    $project: {
      _id: 1,
      name: 1,
      nickname: 1,
      avatar: 1,
      bio: 1,
      phone: 1,
      gender: 1,
      province: 1,
      single: 1,
      double: 1,
      reputation: 1,
      tierColor: 1,
      tierLabel: 1,
      coachProfile: 1,
      maxRating: 1,
    },
  });

  const docs = await User.aggregate(pipeline);
  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor(
          sort === "rating"
            ? { lastRating: last.maxRating, lastId: String(last._id) }
            : { lastId: String(last._id) },
        )
      : null;

  res.json({ items, nextCursor, hasMore });
});

// GET /api/coaches/provinces — list các tỉnh có HLV để filter dropdown
export const listCoachProvinces = asyncHandler(async (req, res) => {
  const provinces = await User.distinct("province", {
    isCoach: true,
    isDeleted: { $ne: true },
    "coachProfile.isPublic": { $ne: false },
    province: { $exists: true, $ne: "" },
  });
  res.json({ items: provinces.filter(Boolean).sort() });
});
