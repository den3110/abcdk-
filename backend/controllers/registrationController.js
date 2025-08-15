import asyncHandler from "express-async-handler";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import { canManageTournament } from "../utils/tournamentAuth.js";
import expressAsyncHandler from "express-async-handler";
import TournamentManager from "../models/tournamentManagerModel.js";

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
  // UPDATE: nếu scoreCap === 0 => KHÔNG giới hạn theo điểm (bỏ qua mọi check điểm)
  const noPointCap = Number(tour.scoreCap) === 0;

  if (!noPointCap) {
    // cap cá nhân (nếu được set > 0)
    if (typeof tour.singleCap === "number" && tour.singleCap > 0) {
      if (s1 > tour.singleCap || (isDoubles && s2 > tour.singleCap)) {
        res.status(400);
        throw new Error("Điểm của 1 VĐV vượt giới hạn");
      }
    }

    // cap tổng đôi (chỉ áp dụng cho đôi và khi scoreCap > 0)
    if (isDoubles && Number(tour.scoreCap) > 0) {
      const gap = Number(tour.scoreGap) || 0;
      if (s1 + s2 > Number(tour.scoreCap) + gap) {
        res.status(400);
        throw new Error("Tổng điểm đôi vượt giới hạn của giải");
      }
    }
  }
  // END UPDATE

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

  // có thể dùng $inc để tránh race condition khi load nặng
  await Tournament.updateOne(
    { _id: id },
    { $inc: { registered: 1 }, $set: { updatedAt: new Date() } }
  );

  res.status(201).json(reg);
});

/* Lấy danh sách đăng ký */
// controllers/registrationController.js
export const getRegistrations = asyncHandler(async (req, res) => {
  // 1) lấy registrations (lean để mutate nhẹ)
  const regs = await Registration.find({ tournament: req.params.id })
    .sort({ createdAt: -1 })
    .lean();

  // 2) gom userId từ player1/2 để query 1 lần
  const uids = new Set();
  for (const r of regs) {
    if (r?.player1?.user) uids.add(String(r.player1.user));
    if (r?.player2?.user) uids.add(String(r.player2.user));
  }

  // 3) query User, chỉ lấy field cần thiết
  const users = await User.find({ _id: { $in: [...uids] } })
    .select("nickName nickname phone avatar fullName") // nickName/nickname là field có thể có
    .lean();

  const userById = new Map(users.map((u) => [String(u._id), u]));

  // 4) helper ẩn số
  const maskPhone = (val) => {
    if (!val) return val;
    const s = String(val);
    if (s.length <= 6) {
      const keepHead = Math.min(1, s.length);
      const keepTail = s.length > 2 ? 1 : 0;
      const head = s.slice(0, keepHead);
      const tail = keepTail ? s.slice(-keepTail) : "";
      const stars = "*".repeat(Math.max(0, s.length - keepHead - keepTail));
      return `${head}${stars}${tail}`;
    }
    return `${s.slice(0, 3)}****${s.slice(-3)}`;
  };

  // 5) hợp nhất nickName (chỉ bổ sung nếu thiếu)
  const enrichPlayer = (pl) => {
    if (!pl) return pl;
    const u = userById.get(String(pl.user));
    const nick = pl.nickName || pl.nickname || u?.nickName || u?.nickname || "";
    // Không đụng fullName/phone nếu snapshot đã có; chỉ mask phone để trả về FE
    return {
      ...pl,
      nickName: nick,
      phone: maskPhone(pl.phone),
    };
  };

  const out = regs.map((r) => ({
    ...r,
    player1: enrichPlayer(r.player1),
    player2: enrichPlayer(r.player2),
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

/**
 * PATCH /api/registrations/:id/payment
 * body: { status: 'Paid' | 'Unpaid' }
 */
export const updateRegistrationPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["Paid", "Unpaid"].includes(status)) {
    res.status(400);
    throw new Error("Invalid status");
  }

  const reg = await Registration.findById(id).lean();
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  const allowed = await canManageTournament(req.user, reg.tournament);
  if (!allowed) {
    res.status(403);
    throw new Error("Forbidden");
  }

  const update = {
    "payment.status": status,
    "payment.paidAt": status === "Paid" ? new Date() : null,
  };

  await Registration.updateOne({ _id: id }, { $set: update });
  res.json({
    message: "Payment updated",
    status,
    paidAt: update["payment.paidAt"],
  });
});

/**
 * DELETE /api/registrations/:id
 * - Chủ sở hữu (createdBy) được xoá đăng ký của mình
 * - Admin hoặc Manager của giải có thể xoá bất kỳ đăng ký nào
 */
export const deleteRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const reg = await Registration.findById(id);
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  const isOwner = String(reg.createdBy || "") === String(req.user?._id || "");
  const allowedManager = await canManageTournament(req.user, reg.tournament);

  if (!isOwner && !allowedManager) {
    res.status(403);
    throw new Error("Forbidden");
  }

  await reg.deleteOne();
  res.json({ message: "Registration deleted" });
});

/* Check quyền: owner → legacy managers (nếu có) → TournamentManager */
async function isTourManager(userId, tour) {
  if (!tour || !userId) return false;

  // 1) Chủ giải
  if (String(tour.createdBy) === String(userId)) return true;

  // 2) Legacy: nếu doc có mảng managers (để tương thích dữ liệu cũ)
  if (Array.isArray(tour.managers) && tour.managers.length) {
    const ok = tour.managers.some((m) => {
      const mid =
        typeof m === "object" && m !== null ? m.user ?? m._id ?? m : m;
      return String(mid) === String(userId);
    });
    if (ok) return true;
  }

  // 3) Bảng liên kết TournamentManager (hiện tại)
  const exists = await TournamentManager.exists({
    tournament: tour._id,
    user: userId,
  });
  return !!exists;
}

/* Snapshot user → subdoc player */
function toPlayerSubdoc(u) {
  const score =
    typeof u.score === "number"
      ? u.score
      : typeof u.skillScore === "number"
      ? u.skillScore
      : 0;

  return {
    user: u._id,
    phone: u.phone || "",
    fullName: u.fullName || u.name || u.displayName || "",
    nickName: u.nickName || u.nickname || "",
    avatar: u.avatar || u.photo || u.photoURL || "",
    score, // snapshot tại thời điểm thay
  };
}

/**
 * PATCH /api/registrations/:regId/manager/replace-player
 * body: { slot: 'p1'|'p2', userId }
 */
export const managerReplacePlayer = expressAsyncHandler(async (req, res) => {
  const { regId } = req.params;
  const { slot, userId } = req.body || {};

  if (!["p1", "p2"].includes(slot)) {
    res.status(400);
    throw new Error("slot phải là 'p1' hoặc 'p2'");
  }
  if (!userId) {
    res.status(400);
    throw new Error("Thiếu userId");
  }

  const reg = await Registration.findById(regId);
  if (!reg) {
    res.status(404);
    throw new Error("Không tìm thấy đăng ký");
  }

  const tour = await Tournament.findById(reg.tournament).select(
    "eventType createdBy managers"
  );
  if (!tour) {
    res.status(404);
    throw new Error("Không tìm thấy giải đấu");
  }

  // Lưu ý: middleware auth có thể set req.user._id hoặc req.user.id
  const authedUserId = req.user?._id || req.user?.id;
  if (!(await isTourManager(authedUserId, tour))) {
    res.status(403);
    throw new Error("Bạn không có quyền thay VĐV cho đăng ký này");
  }

  // Validate theo loại giải
  const evType = String(tour.eventType || "").toLowerCase();
  const isSingles = evType === "single" || evType === "singles";
  if (isSingles && slot === "p2") {
    res.status(400);
    throw new Error("Giải đơn chỉ có VĐV 1 (p1)");
  }

  const user = await User.findById(userId).select(
    "fullName nickName nickname phone avatar score skillScore name displayName photo photoURL"
  );
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy User");
  }

  // Không cho 2 VĐV trùng nhau theo userId
  const otherUserId =
    slot === "p1"
      ? reg.player2?.user?.toString?.()
      : reg.player1?.user?.toString?.();
  if (otherUserId && String(otherUserId) === String(user._id)) {
    res.status(400);
    throw new Error("Hai VĐV trong cùng 1 cặp không thể là cùng một người");
  }

  // Nếu không đổi gì thì thôi
  const currentUserId =
    slot === "p1"
      ? reg.player1?.user?.toString?.()
      : reg.player2?.user?.toString?.();
  if (currentUserId && String(currentUserId) === String(user._id)) {
    return res.json({ message: "Không có thay đổi", registration: reg });
  }

  // Thay thế snapshot subdoc
  const newSubdoc = toPlayerSubdoc(user);
  if (slot === "p1") reg.player1 = newSubdoc;
  else reg.player2 = newSubdoc;

  await reg.save();
  res.json({ message: "Đã thay VĐV", registration: reg });
});
