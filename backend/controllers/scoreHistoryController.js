import asyncHandler from "express-async-handler";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Ranking from "../models/rankingModel.js";

/* ===== GET /admin/score-history?user=...&page=1 ===== */
export const listScoreHistory = asyncHandler(async (req, res) => {
  const pageSize = 10;
  const page = Number(req.query.page) || 1;
  const filter = {};

  if (req.query.user) filter.user = req.query.user; // lọc theo VĐV

  const total = await ScoreHistory.countDocuments(filter);
  const history = await ScoreHistory.find(filter)
    .sort({ scoredAt: -1 })
    .limit(pageSize)
    .skip(pageSize * (page - 1))
    .populate("scorer", "name email") // lấy tên người chấm
    .lean();

  res.json({ history, total, pageSize });
});

/* ===== POST /admin/score-history =====
   body { userId, single, double, note }
   -> tạo bản ghi + cập nhật bảng Ranking hiện tại
*/
export const createScoreHistory = asyncHandler(async (req, res) => {
  const { userId, single, double, note = "" } = req.body;

  if (single == null || double == null) throw new Error("Thiếu điểm");

  const history = await ScoreHistory.create({
    user: userId,
    scorer: req.user._id, // lấy từ middleware protect
    single,
    double,
    note,
  });

  // cập nhật bảng Ranking
  let rank = await Ranking.findOne({ user: userId });
  if (!rank) {
    rank = new Ranking({ user: userId, single, double });
  } else {
    rank.single = single;
    rank.double = double;
    rank.updatedAt = Date.now();
  }
  await rank.save();

  res.status(201).json({ message: "Đã lưu lịch sử chấm điểm", history });
});
