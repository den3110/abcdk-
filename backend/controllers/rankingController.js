import Ranking from "../models/rankingModel.js";
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import mongoose from "mongoose";

export const getRankings = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page ?? 0, 10) || 0;
  const limit = parseInt(req.query.limit ?? 10, 10) || 10;

  /*— 1. Lọc user theo keyword (nếu có) —*/
  const userFilter = req.query.keyword
    ? { nickname: { $regex: req.query.keyword, $options: "i" } }
    : {};

  /*— 2. Lấy toàn bộ _id rồi chỉ giữ ObjectId hợp lệ —*/
  const rawIds = await User.find(userFilter).distinct("_id"); // có thể lẫn UUID
  const objIds = rawIds.filter((id) => mongoose.isValidObjectId(id));

  /*— 3. Xây filter ranking chính xác —*/
  let rankingFilter = {};
  if (req.query.keyword) {
    // có tìm keyword nhưng không trúng ai ⇒ trả list rỗng
    if (objIds.length === 0) {
      return res.json({ docs: [], totalPages: 0, page });
    }
    rankingFilter = { user: { $in: objIds } };
  }

  /*— 4. Paginate & trả kết quả —*/
  const total = await Ranking.countDocuments(rankingFilter);

  const docs = await Ranking.find(rankingFilter)
    .populate("user", "nickname gender province avatar verified createdAt")
    .sort({ double: -1 })
    .skip(page * limit)
    .limit(limit);

  res.json({
    docs,
    totalPages: Math.ceil(total / limit),
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
