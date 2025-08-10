import asyncHandler from "express-async-handler";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import mongoose from "mongoose";

/* Tạo đăng ký */
// POST /api/tournaments/:id/registrations
export const createRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { message, player1Id, player2Id } = req.body || {};

  /* ─ 1) Tournament ─ */
  const tour = await Tournament.findById(id);
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  // chuẩn hoá eventType: singles | doubles
  const et = String(tour.eventType || "").toLowerCase(); // "single"/"singles" hoặc "double"/"doubles"
  const isSingles = et === "single" || et === "singles";
  const isDoubles = et === "double" || et === "doubles";

  /* ─ 2) Giới hạn số cặp ─ */
  if (tour.maxPairs && tour.maxPairs > 0) {
    const currentCount = await Registration.countDocuments({ tournament: id });
    if (currentCount >= tour.maxPairs) {
      res.status(400);
      throw new Error("Giải đã đủ số cặp đăng ký");
    }
  }

  /* ─ 3) Khung thời gian đăng ký ─ */
  const now = Date.now();
  const openAt =
    tour.regOpenDate instanceof Date
      ? tour.regOpenDate.getTime()
      : +tour.regOpenDate;
  const deadline =
    tour.registrationDeadline instanceof Date
      ? tour.registrationDeadline.getTime()
      : +tour.registrationDeadline;
  if (!openAt || !deadline || now < openAt || now > deadline) {
    res.status(400);
    throw new Error("Giải chưa mở hoặc đã hết hạn đăng ký");
  }

  /* ─ 4) Validate input theo loại giải ─ */
  if (!player1Id) {
    res.status(400);
    throw new Error("Thiếu VĐV 1");
  }
  if (isSingles) {
    // giải đơn: không cho gửi player2Id
    if (player2Id) {
      res.status(400);
      throw new Error("Giải đơn chỉ cho phép 1 VĐV");
    }
  } else if (isDoubles) {
    if (!player2Id) {
      res.status(400);
      throw new Error("Giải đôi cần 2 VĐV");
    }
    if (String(player1Id) === String(player2Id)) {
      res.status(400);
      throw new Error("Hai VĐV phải khác nhau");
    }
  }

  /* ─ 5) Lấy thông tin user ─ */
  const userIds = isSingles ? [player1Id] : [player1Id, player2Id];
  const users = await User.find({ _id: { $in: userIds } }).select(
    "name phone avatar province"
  );
  if (users.length !== userIds.length) {
    res.status(400);
    throw new Error("Không tìm thấy VĐV hợp lệ");
  }

  // map theo id để lấy đúng thứ tự
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const u1 = byId.get(String(player1Id));
  const u2 = isDoubles ? byId.get(String(player2Id)) : null;

  /* ─ 6) Kiểm tra đã đăng ký ─ */
  const orConds = isSingles
    ? [{ "player1.user": player1Id }, { "player2.user": player1Id }]
    : [
        { "player1.user": { $in: [player1Id, player2Id] } },
        { "player2.user": { $in: [player1Id, player2Id] } },
      ];

  const alreadyReg = await Registration.findOne({
    tournament: id,
    $or: orConds,
  }).lean();

  if (alreadyReg) {
    res.status(400);
    throw new Error(
      isSingles
        ? "VĐV đã đăng ký giải đấu rồi"
        : "Một trong hai VĐV đã đăng ký giải đấu rồi"
    );
  }

  /* ─ 7) Điểm trình mới nhất ─ */
  const scores = await ScoreHistory.aggregate([
    {
      $match: {
        user: {
          $in: userIds.map((x) => new mongoose.Types.ObjectId(String(x))),
        },
      },
    },
    { $sort: { scoredAt: -1 } },
    {
      $group: {
        _id: "$user",
        single: { $first: "$single" },
        double: { $first: "$double" },
      },
    },
  ]);
  const map = Object.fromEntries(scores.map((s) => [String(s._id), s]));
  const key = isDoubles ? "double" : "single";
  const s1 = map[String(player1Id)]?.[key] ?? 0;
  const s2 = isDoubles ? map[String(player2Id)]?.[key] ?? 0 : 0;

  /* ─ 8) Validate điểm trình ─ */
  // cap cá nhân
  if (typeof tour.singleCap === "number" && tour.singleCap > 0) {
    if (s1 > tour.singleCap || (isDoubles && s2 > tour.singleCap)) {
      res.status(400);
      throw new Error("Điểm của 1 VĐV vượt giới hạn");
    }
  }
  // cap tổng đôi (chỉ áp dụng cho đôi)
  if (isDoubles && typeof tour.scoreCap === "number") {
    const gap = Number(tour.scoreGap) || 0;
    if (s1 + s2 > Number(tour.scoreCap) + gap) {
      res.status(400);
      throw new Error("Tổng điểm đôi vượt giới hạn của giải");
    }
  }

  /* ─ 9) Chuẩn hoá player object & lưu ─ */
  const player1 = {
    user: u1._id,
    fullName: u1.name,
    phone: u1.phone,
    avatar: u1.avatar,
    province: u1.province,
    score: s1,
  };
  const player2 = isDoubles
    ? {
        user: u2._id,
        fullName: u2.name,
        phone: u2.phone,
        avatar: u2.avatar,
        province: u2.province,
        score: s2,
      }
    : null;

  const reg = await Registration.create({
    tournament: id,
    message: message || "",
    player1,
    player2,
    createdBy: req.user._id,
  });

  tour.registered = (tour.registered || 0) + 1;
  await tour.save();

  res.status(201).json(reg);
});

/* Lấy danh sách đăng ký */
// controllers/registrationController.js
export const getRegistrations = asyncHandler(async (req, res) => {
  const regs = await Registration.find({ tournament: req.params.id })
    .sort({ createdAt: -1 })
    .lean(); // lấy plain objects để dễ sửa

  const maskPhone = (val) => {
    if (!val) return val;
    const s = String(val);
    if (s.length <= 6) {
      // Trường hợp ngắn bất thường: che gần hết cho an toàn
      const keepHead = Math.min(1, s.length);
      const keepTail = s.length > 2 ? 1 : 0;
      const head = s.slice(0, keepHead);
      const tail = keepTail ? s.slice(-keepTail) : "";
      const stars = "*".repeat(Math.max(0, s.length - keepHead - keepTail));
      return `${head}${stars}${tail}`;
    }
    return `${s.slice(0, 3)}****${s.slice(-3)}`;
  };

  const out = regs.map((r) => ({
    ...r,
    player1: r.player1
      ? { ...r.player1, phone: maskPhone(r.player1.phone) }
      : r.player1,
    player2: r.player2
      ? { ...r.player2, phone: maskPhone(r.player2.phone) }
      : r.player2,
  }));

  res.json(out);
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

/**
 * POST /api/registrations/:regId/cancel
 * Chỉ cho phép: người tạo (createdBy) hoặc 1 trong 2 VĐV trong registration
 * Điều kiện: chưa thanh toán & chưa được xếp vào bất kỳ trận nào
 */
export const cancelRegistration = asyncHandler(async (req, res) => {
  const { regId } = req.params;

  const reg = await Registration.findById(regId).lean();
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  // Quyền huỷ: ưu tiên createdBy; fallback nếu dữ liệu cũ không có createdBy
  const uid = String(req.user?._id || "");
  const isOwner = reg.createdBy ? String(reg.createdBy) === uid : false;
  const isMember = [reg?.player1?.user, reg?.player2?.user]
    .filter(Boolean)
    .map(String)
    .includes(uid);

  if (!isOwner && !isMember) {
    res.status(403);
    throw new Error("Bạn không có quyền huỷ đăng ký này");
  }

  // Chỉ khi chưa thanh toán
  if (reg?.payment?.status === "Paid") {
    res.status(400);
    throw new Error("Đăng ký đã thanh toán, không thể huỷ");
  }

  // Không cho huỷ nếu đã được xếp vào bất kỳ trận nào
  const usedIn = await Match.countDocuments({
    $or: [{ pairA: regId }, { pairB: regId }],
  });
  if (usedIn > 0) {
    res.status(400);
    throw new Error("Đăng ký đã được xếp vào trận đấu, không thể huỷ");
  }

  // Xoá registration
  await Registration.deleteOne({ _id: regId });

  // Giảm counter registered của giải (nếu có)
  if (reg.tournament) {
    const tour = await Tournament.findById(reg.tournament);
    if (tour && typeof tour.registered === "number") {
      tour.registered = Math.max(0, (tour.registered || 0) - 1);
      await tour.save();
    }
  }

  res.json({ ok: true, message: "Đã huỷ đăng ký" });
});
