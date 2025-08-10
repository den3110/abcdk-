import Ranking from "../models/rankingModel.js";
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import mongoose from "mongoose";

export const getRankings = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page ?? 0, 10) || 0, 0);
  const limit = Math.min(parseInt(req.query.limit ?? 10, 10) || 10, 100);
  const keyword = (req.query.keyword || "").trim();

  // 1) Nếu có keyword, chỉ lấy _id các user có role='user' khớp nickname
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

  // 2) Match cơ bản cho bảng ranking
  const matchStage = {
    ...(userIdsFilter ? { user: { $in: userIdsFilter } } : {}),
  };

  // 3) Đếm số user hợp lệ (role='user') để tính totalPages
  const countAgg = await Ranking.aggregate([
    { $match: matchStage },
    { $match: { user: { $type: "objectId" } } },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "userDoc",
        pipeline: [
          { $match: { role: "user" } }, // chỉ lấy user role='user'
          { $project: { _id: 1 } },
        ],
      },
    },
    { $unwind: { path: "$userDoc", preserveNullAndEmptyArrays: false } },
    { $group: { _id: "$user" } },
    { $count: "n" },
  ]);

  const totalUniqueUsers = countAgg[0]?.n || 0;

  // 4) Lấy dữ liệu trang hiện tại (mỗi user 1 ranking)
  const docsAgg = await Ranking.aggregate([
    { $match: matchStage },
    { $match: { user: { $type: "objectId" } } },

    // sắp xếp trước để chọn bản ghi "đẹp" nhất cho mỗi user
    { $sort: { double: -1, updatedAt: -1, _id: 1 } },

    // gom theo user -> mỗi user lấy 1 doc
    { $group: { _id: "$user", doc: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$doc" } },

    // join sang users và CHỈ giữ user có role='user'
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

    // sort hiển thị cuối
    { $sort: { double: -1, updatedAt: -1, _id: 1 } },

    // paginate
    { $skip: page * limit },
    { $limit: limit },
  ]);

  res.json({
    docs: docsAgg,
    totalPages: Math.ceil(totalUniqueUsers / limit),
    page,
  });
});

/* GET điểm kèm user  (dùng trong danh sách) */
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

  /* gắn điểm từ Ranking */
  const ids = users
    .map((u) => u._id)
    .filter((id) => mongoose.isValidObjectId(id)); // ✅ chỉ lấy ObjectId hợp lệ

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

  const list = users.map((u) => ({
    ...u,
    single: map[u._id?.toString()]?.single ?? 0,
    double: map[u._id?.toString()]?.double ?? 0,
  }));

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
