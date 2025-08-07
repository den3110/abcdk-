import asyncHandler from "express-async-handler";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";

/* Tạo đăng ký */
// POST /api/tournaments/:id/registrations
export const createRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { message, player1Id, player2Id } = req.body;

  /* ───── 1. Lấy giải ───── */
  const tour = await Tournament.findById(id);
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  /* ───── 2. Kiểm tra khung thời gian ───── */
  const now = Date.now();
  if (now < tour.regOpenDate || now > tour.registrationDeadline) {
    res.status(400);
    throw new Error("Giải chưa mở hoặc đã hết hạn đăng ký");
  }

  /* ───── 3. Lấy thông tin 2 VĐV ───── */
  const users = await User.find({
    _id: { $in: [player1Id, player2Id] },
  }).select("name phone avatar province");
  if (users.length !== 2) {
    res.status(400);
    throw new Error("Không tìm thấy VĐV hoặc bị trùng");
  }

  /* ───── 4. Kiểm tra đã đăng ký chưa ───── */
  const alreadyReg = await Registration.findOne({
    tournament: id,
    $or: [
      { "player1.user": { $in: [player1Id, player2Id] } },
      { "player2.user": { $in: [player1Id, player2Id] } },
    ],
  }).lean();

  if (alreadyReg) {
    res.status(400);
    throw new Error("Một trong hai VĐV đã đăng ký giải đấu rồi");
  }

  /* ───── 5. Lấy điểm trình mới nhất ───── */
  const scores = await ScoreHistory.aggregate([
    { $match: { user: { $in: users.map((u) => u._id) } } },
    { $sort: { scoredAt: -1 } },
    {
      $group: {
        _id: "$user",
        single: { $first: "$single" },
        double: { $first: "$double" },
      },
    },
  ]);

  const map = Object.fromEntries(scores.map((s) => [s._id.toString(), s]));
  const key = tour.eventType === "double" ? "double" : "single";
  const s1 = map[player1Id]?.[key] ?? 0;
  const s2 = map[player2Id]?.[key] ?? 0;

  /* ───── 6. Validate điểm trình ───── */
  if (s1 > tour.singleCap || s2 > tour.singleCap) {
    res.status(400);
    throw new Error("Điểm của 1 VĐV vượt giới hạn");
  }
  if (s1 + s2 > tour.scoreCap + tour.scoreGap) {
    res.status(400);
    throw new Error("Tổng điểm đôi vượt giới hạn của giải");
  }

  /* ───── 7. Chuẩn hoá player object và lưu ───── */
  const [u1, u2] = users;
  const player1 = {
    user: u1._id,
    fullName: u1.name,
    phone: u1.phone,
    avatar: u1.avatar,
    province: u1.province,
    score: s1,
  };
  const player2 = {
    user: u2._id,
    fullName: u2.name,
    phone: u2.phone,
    avatar: u2.avatar,
    province: u2.province,
    score: s2,
  };

  const reg = await Registration.create({
    tournament: id,
    message,
    player1,
    player2,
  });

  tour.registered += 1;
  await tour.save();

  res.status(201).json(reg);
});

/* Lấy danh sách đăng ký */
export const getRegistrations = asyncHandler(async (req, res) => {
  const regs = await Registration.find({ tournament: req.params.id }).sort({
    createdAt: -1,
  });
  res.json(regs);
});

/* Cập nhật trạng thái lệ phí */
export const updatePaymentStatus = asyncHandler(async (req, res) => {
  const { regId } = req.params;
  const { status } = req.body; // 'Đã nộp' | 'Chưa nộp'

  const reg = await Registration.findById(regId);
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  reg.payment.status = status;
  reg.payment.paidAt = status === "Đã nộp" ? new Date() : undefined;
  await reg.save();

  res.json(reg);
});

/* Check‑in */
export const checkinRegistration = asyncHandler(async (req, res) => {
  const { regId } = req.params;
  const reg = await Registration.findById(regId);
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  reg.checkinAt = new Date();
  await reg.save();

  res.json(reg);
});


