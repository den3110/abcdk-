import Ranking from "../models/rankingModel.js";
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import mongoose from "mongoose";

export const getRankings = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page ?? 0, 10) || 0, 0);
  const limit = Math.min(parseInt(req.query.limit ?? 10, 10) || 10, 100);
  const keyword = (req.query.keyword || "").trim();

  // 1) Nếu có keyword, lấy _id user role='user' khớp nickname
  let userIdsFilter = null;
  if (keyword) {
    const rawIds = await User.find(
      { role: "user", nickname: { $regex: keyword, $options: "i" } },
      { _id: 1 }
    ).lean();

    const ids = rawIds
      .map((d) => d?._id)
      .filter((id) => mongoose.isValidObjectId(id));

    if (ids.length === 0) {
      return res.json({ docs: [], totalPages: 0, page });
    }
    userIdsFilter = ids;
  }

  // 2) Match cơ bản cho Ranking
  const matchStage = {
    ...(userIdsFilter ? { user: { $in: userIdsFilter } } : {}),
  };

  // 3) Đếm số user hợp lệ để tính totalPages
  const countAgg = await Ranking.aggregate([
    { $match: matchStage },
    { $match: { user: { $type: "objectId" } } },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "userDoc",
        pipeline: [{ $match: { role: "user" } }, { $project: { _id: 1 } }],
      },
    },
    { $unwind: { path: "$userDoc", preserveNullAndEmptyArrays: false } },
    { $group: { _id: "$user" } },
    { $count: "n" },
  ]);
  const totalUniqueUsers = countAgg[0]?.n || 0;

  // 4) Sắp xếp ưu tiên uy tín -> points -> double -> single
  const sortPref = {
    reputation: -1,
    points: -1,
    double: -1,
    single: -1,
    updatedAt: -1,
    _id: 1,
  };

  // 5) Lấy docs trang hiện tại
  const docsAgg = await Ranking.aggregate([
    { $match: matchStage },
    { $match: { user: { $type: "objectId" } } },

    // đảm bảo có giá trị để sort
    {
      $addFields: {
        reputation: { $ifNull: ["$reputation", 0] },
        points: { $ifNull: ["$points", 0] },
        single: { $ifNull: ["$single", 0] },
        double: { $ifNull: ["$double", 0] },
      },
    },

    // nếu (lý thuyết) có nhiều bản/1 user, chọn bản "đẹp" nhất theo sortPref
    { $sort: sortPref },
    { $group: { _id: "$user", doc: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$doc" } },

    // join sang users và CHỈ giữ role='user'
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "user",
        pipeline: [
          { $match: { role: "user" } },
          {
            $project: {
              nickname: 1,
              gender: 1,
              province: 1,
              avatar: 1,
              verified: 1,
              createdAt: 1,
              cccdStatus: 1,
            },
          },
        ],
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: false } },

    // lấy lần chấm gần nhất để biết tự chấm hay không
    {
      $lookup: {
        from: "assessments",
        let: { uid: "$user._id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
          { $sort: { scoredAt: -1 } },
          { $limit: 1 },
          { $project: { scorer: 1, "meta.selfScored": 1, scoredAt: 1 } },
        ],
        as: "latest",
      },
    },
    { $addFields: { latest: { $arrayElemAt: ["$latest", 0] } } },
    {
      $addFields: {
        isSelfScoredLatest: {
          $cond: [
            {
              $or: [
                { $eq: ["$latest.meta.selfScored", true] },
                { $eq: ["$latest.scorer", "$user._id"] },
              ],
            },
            true,
            false,
          ],
        },
      },
    },

    // sort hiển thị cuối cùng đúng ưu tiên
    { $sort: sortPref },

    // paginate
    { $skip: page * limit },
    { $limit: limit },

    // project bớt field
    {
      $project: {
        user: 1,
        single: 1,
        double: 1,
        mix: 1,
        points: 1,
        reputation: 1,
        isSelfScoredLatest: 1,
        updatedAt: 1,
      },
    },
  ]);

  res.json({
    docs: docsAgg,
    totalPages: Math.ceil(totalUniqueUsers / limit),
    page,
  });
});

/* GET điểm kèm user (dùng trong danh sách) */
export const getUsersWithRank = asyncHandler(async (req, res) => {
  const pageSize = 10;
  const page = Number(req.query.page) || 1;

  const keyword = req.query.keyword
    ? { name: { $regex: req.query.keyword, $options: "i" } }
    : {};
  const role = req.query.role ? { role: req.query.role } : {};

  const filter = { ...keyword, ...role };

  const total = await User.countDocuments(filter);
  const users = await User.find(filter)
    .limit(pageSize)
    .skip(pageSize * (page - 1))
    .lean();

  // map điểm từ Ranking
  const ids = users
    .map((u) => u._id)
    .filter((id) => mongoose.isValidObjectId(id));

  let map = {};
  if (ids.length > 0) {
    const ranks = await Ranking.find({ user: { $in: ids } })
      .select("user single double")
      .lean();
    map = ranks.reduce((acc, r) => {
      acc[r.user.toString()] = r;
      return acc;
    }, {});
  }

  const isProd = process.env.NODE_ENV === "production";

  // Prefer headers từ reverse proxy để lấy scheme/host chuẩn
  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    req.protocol ||
    "http";
  const host = req.headers["x-forwarded-host"] || req.get("host"); // ví dụ: admin.pickletour.vn
  const origin = `${proto}://${host}`;

  const isAbsUrl = (s) => /^https?:\/\//i.test(s || "");
  const toAbsUrl = (p) => {
    if (!p) return p;
    if (isAbsUrl(p)) return p;
    return `${origin}${p.startsWith("/") ? "" : "/"}${p}`;
  };

  const list = users.map((u) => {
    // chỉ chạm vào cccdImages trong môi trường production
    const cccdImages = isProd
      ? {
          front: toAbsUrl(u?.cccdImages?.front || ""),
          back: toAbsUrl(u?.cccdImages?.back || ""),
        }
      : u?.cccdImages || { front: "", back: "" };

    return {
      ...u,
      cccdImages,
      single: map[u._id?.toString()]?.single ?? 0,
      double: map[u._id?.toString()]?.double ?? 0,
    };
  });

  res.json({ users: list, total, pageSize });
});
export const updateRanking = asyncHandler(async (req, res) => {
  const { single, double } = req.body;
  const { id: userId } = req.params;

  // 1️⃣ Validate dữ liệu
  if (single == null || double == null) {
    res.status(400);
    throw new Error("Thiếu điểm");
  }
  if (!mongoose.isValidObjectId(userId)) {
    res.status(400);
    throw new Error("userId không hợp lệ");
  }

  // 2️⃣ Kiểm tra user tồn tại
  const userExists = await User.exists({ _id: userId });
  if (!userExists) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }

  // 3️⃣ Tạo hoặc cập nhật Ranking
  const rank = await Ranking.findOneAndUpdate(
    { user: userId },
    { single, double, updatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  await ScoreHistory.create({
    user: req.params.id,
    scorer: req.user._id,
    single,
    double,
    note,
  });

  // 4️⃣ Trả kết quả
  res.json({
    message: "Đã cập nhật điểm",
    user: userId,
    single: rank.single,
    double: rank.double,
  });
});

export async function getLeaderboard(req, res) {
  const list = await Ranking.aggregate([
    {
      $lookup: {
        from: "assessments",
        let: { uid: "$user" },
        pipeline: [
          { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
          { $sort: { scoredAt: -1 } },
          { $limit: 1 },
          { $project: { scorer: 1, "meta.selfScored": 1 } },
        ],
        as: "latest",
      },
    },
    { $addFields: { latest: { $arrayElemAt: ["$latest", 0] } } },
    {
      $addFields: {
        isSelfScoredLatest: {
          $cond: [
            {
              $or: [
                { $eq: ["$latest.meta.selfScored", true] },
                { $eq: ["$latest.scorer", "$user"] },
              ],
            },
            true,
            false,
          ],
        },
      },
    },
    // sort theo yêu cầu: reputation trước, rồi points, rồi điểm
    {
      $sort: {
        reputation: -1,
        points: -1,
        double: -1,
        single: -1,
        lastUpdated: -1,
      },
    },
    {
      $project: {
        user: 1,
        single: 1,
        double: 1,
        points: 1,
        reputation: 1,
        isSelfScoredLatest: 1,
        lastUpdated: 1,
      },
    },
  ]);
  res.json(list);
}
