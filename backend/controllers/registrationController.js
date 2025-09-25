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
import Ranking from "../models/rankingModel.js";
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
  const et = String(tour.eventType || "").toLowerCase();
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
    // cần thêm cccdStatus/cccd để kiểm tra xác thực
    "name nickname phone avatar province cccd cccdStatus"
  );
  if (users.length !== userIds.length) {
    res.status(400);
    throw new Error("Không tìm thấy VĐV hợp lệ");
  }

  // map theo id để lấy đúng thứ tự
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const u1 = byId.get(String(player1Id));
  const u2 = isDoubles ? byId.get(String(player2Id)) : null;

  /* ─ 6) YÊU CẦU: CCCD đã xác thực ─ */
  // const notVerified = [];
  // if (u1?.cccdStatus !== "verified") notVerified.push("VĐV 1");
  // if (isDoubles && ( u2?.cccdStatus !== "verified"))
  //   notVerified.push("VĐV 2");
  // if (notVerified.length) {
  //   // dùng 412 để FE phân biệt điều kiện tiên quyết

  //   // bạn có thể đổi message nếu muốn FE match code riêng
  //   throw new Error(
  //     notVerified.length === 1
  //       ? `${notVerified[0]} cần xác thực CCCD trước khi đăng ký`
  //       : `${notVerified.join(" và ")} cần xác thực CCCD trước khi đăng ký`
  //   );
  // }

  /* ─ 7) Kiểm tra đã đăng ký ─ */
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

  /* ─ 8) Điểm trình mới nhất ─ */
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

  /* ─ 9) Validate điểm trình ─ */
  const noPointCap = Number(tour.scoreCap) === 0;

  if (!noPointCap) {
    if (typeof tour.singleCap === "number" && tour.singleCap > 0) {
      if (s1 > tour.singleCap || (isDoubles && s2 > tour.singleCap)) {
        res.status(400);
        throw new Error("Điểm của 1 VĐV vượt giới hạn");
      }
    }

    if (isDoubles && Number(tour.scoreCap) > 0) {
      const gap = Number(tour.scoreGap) || 0;
      if (s1 + s2 > Number(tour.scoreCap) + gap) {
        res.status(400);
        throw new Error("Tổng điểm đôi vượt giới hạn của giải");
      }
    }
  }

  /* ─ 10) Chuẩn hoá player object & lưu ─ */
  const player1 = {
    user: u1._id,
    fullName: u1.name || u1.nickname, // fallback tránh rỗng
    phone: u1.phone,
    avatar: u1.avatar,
    province: u1.province,
    score: s1,
  };
  const player2 = isDoubles
    ? {
        user: u2._id,
        fullName: u2.name || u2.nickname,
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

  await Tournament.updateOne(
    { _id: id },
    { $inc: { registered: 1 }, $set: { updatedAt: new Date() } }
  );

  res.status(201).json(reg);
});

/* Lấy danh sách đăng ký */
// controllers/registrationController.js
export const getRegistrations = asyncHandler(async (req, res) => {
  const tourId = req.params.id;
  const meId = req.user?._id ? String(req.user._id) : "";

  // 0) Quyền xem full số: admin hoặc quản lý giải
  const isAdmin =
    Boolean(req.user?.isAdmin) ||
    req.user?.role === "admin" ||
    (Array.isArray(req.user?.roles) && req.user.roles.includes("admin"));

  let canSeeFullPhone = false;
  if (isAdmin) {
    canSeeFullPhone = true;
  } else if (tourId && meId) {
    const [t, isMgr] = await Promise.all([
      Tournament.findById(tourId).select("_id createdBy").lean(),
      TournamentManager.exists({ tournament: tourId, user: meId }),
    ]);
    if (t && String(t.createdBy) === meId) canSeeFullPhone = true;
    if (isMgr) canSeeFullPhone = true;
  }

  // 1) lấy registrations
  const regs = await Registration.find({ tournament: tourId })
    .sort({ createdAt: -1 })
    .lean();

  // 1.1) Gán mã đăng ký cho bản thiếu
  const missing = regs.filter((r) => r.code == null);
  if (missing.length) {
    const maxDoc = await Registration.findOne({ code: { $type: "number" } })
      .sort({ code: -1 })
      .select("code")
      .lean();

    let next = Math.max(9999, Number(maxDoc?.code ?? 9999));
    missing.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    for (const r of missing) {
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      const upd = await Registration.updateOne(
        { _id: r._id, $or: [{ code: { $exists: false } }, { code: null }] },
        { $set: { code: next } }
      );
      if (upd.modifiedCount > 0) {
        r.code = next;
      } else {
        // eslint-disable-next-line no-await-in-loop
        const fresh = await Registration.findById(r._id).select("code").lean();
        if (fresh?.code != null) r.code = fresh.code;
      }
    }
  }

  // 2) gom userId từ player1/2
  const uids = new Set();
  for (const r of regs) {
    if (r?.player1?.user) uids.add(String(r.player1.user));
    if (r?.player2?.user) uids.add(String(r.player2.user));
  }

  // 3) query User: lấy thêm verified & cccdStatus
  const users = await User.find({ _id: { $in: [...uids] } })
    .select(
      "_id avatar fullName name nickName nickname phone verified cccdStatus"
    )
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  // Helper quyết định trạng thái xác thực cuối cùng (ưu tiên cccdStatus)
  const finalKycStatusOf = (u) => {
    const c = String(u?.cccdStatus || "").toLowerCase();
    if (["verified", "pending", "rejected"].includes(c)) return c;
    // cccdStatus = 'unverified' hoặc không có -> fallback verified legacy
    const v = String(u?.verified || "").toLowerCase(); // 'verified' | 'pending'
    if (v === "verified") return "verified";
    if (v === "pending") return "pending";
    return "unverified";
  };

  // 4) helper ẩn số (tùy quyền)
  const maskPhone = (val) => {
    if (!val) return val;
    const s = String(val);
    if (canSeeFullPhone) return s;

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

  // 5) hợp nhất từ User + gán kycStatus
  const enrichPlayer = (pl) => {
    if (!pl) return pl;
    const u = userById.get(String(pl.user));

    const nickFromUser =
      (u?.nickName && String(u.nickName).trim()) ||
      (u?.nickname && String(u.nickname).trim()) ||
      "";
    const fullNameFromUser =
      (u?.fullName && String(u.fullName).trim()) ||
      (u?.name && String(u.name).trim()) ||
      "";

    const phoneSource = u?.phone ?? pl.phone ?? "";
    const maskedPhone = maskPhone(phoneSource);

    // ✅ Trạng thái xác thực cuối cùng
    const kycStatus = finalKycStatusOf(u);
    const isVerified = kycStatus === "verified";

    return {
      ...pl,
      avatar: u?.avatar ?? pl?.avatar ?? null,
      fullName: fullNameFromUser || pl.fullName || "",
      nickName:
        nickFromUser ||
        (pl.nickName && String(pl.nickName).trim()) ||
        (pl.nickname && String(pl.nickname).trim()) ||
        "",
      phone: maskedPhone,

      // 👇 Thêm các field để FE dùng hiển thị badge
      cccdStatus: u?.cccdStatus || "unverified",
      verifiedLegacy: u?.verified || "pending",
      kycStatus, // 'verified' | 'pending' | 'rejected' | 'unverified'
      isVerified, // boolean nhanh gọn
    };
  };

  // 6) build output
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

// Helper: lấy rank cho list userId -> Map(userIdStr -> snapshot)
async function getRanksMap(userIds = []) {
  const ids = userIds.filter(Boolean).map(String);
  if (!ids.length) return new Map();

  const rows = await Ranking.find({ user: { $in: ids } })
    .select("user single double points reputation updatedAt")
    .lean();

  const m = new Map();
  for (const r of rows) {
    m.set(String(r.user), {
      single: Number(r?.single ?? 0),
      double: Number(r?.double ?? 0),
      points: Number(r?.points ?? 0),
      reputation: Number(r?.reputation ?? 0),
      updatedAt: r?.updatedAt || null,
    });
  }
  return m;
}

// Lấy score hiện tại cho user theo loại giải (single/double).
async function getCurrentScore(userId, eventType) {
  const isSingles =
    String(eventType || "").toLowerCase() === "single" ||
    String(eventType || "").toLowerCase() === "singles";
  const field = isSingles ? "single" : "double";

  // 1) Ưu tiên lịch sử chấm điểm mới nhất
  const sh = await ScoreHistory.findOne({
    user: userId,
    [field]: { $ne: null },
  })
    .sort({ scoredAt: -1, createdAt: -1, _id: -1 })
    .select(field)
    .lean();

  if (sh && typeof sh[field] === "number") return sh[field];

  // 2) Fallback sang Ranking nếu không có lịch sử
  const r = await Ranking.findOne({ user: userId }).select(field).lean();
  if (r && typeof r[field] === "number") return r[field];

  // 3) Không có gì cả → 0
  return 0;
}

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

  // --- Quyền: admin hoặc manager của giải ---
  const authedUserId = req.user?._id || req.user?.id;
  if (!authedUserId) {
    res.status(401);
    throw new Error("Chưa đăng nhập");
  }

  const isAdmin =
    req.user?.isAdmin === true ||
    req.user?.role === "admin" ||
    (Array.isArray(req.user?.roles) &&
      (req.user.roles.includes("admin") ||
        req.user.roles.includes("superadmin")));

  if (!(isAdmin || (await isTourManager(authedUserId, tour)))) {
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

  // Lấy user và tính score hiện tại
  const user = await User.findById(userId)
    .select("name nickname phone avatar")
    .lean();
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy User");
  }

  const newScore = await getCurrentScore(user._id, tour.eventType);

  // Không cho 2 VĐV trùng nhau theo userId
  const otherUserId =
    slot === "p1"
      ? reg.player2?.user?.toString?.()
      : reg.player1?.user?.toString?.();
  if (otherUserId && String(otherUserId) === String(user._id)) {
    res.status(400);
    throw new Error("Hai VĐV trong cùng 1 cặp không thể là cùng một người");
  }

  // Nếu không đổi người: (tuỳ chọn) bạn có muốn refresh score luôn không?
  const currentUserId =
    slot === "p1"
      ? reg.player1?.user?.toString?.()
      : reg.player2?.user?.toString?.();
  if (currentUserId && String(currentUserId) === String(user._id)) {
    // 👉 Nếu muốn cập nhật score cả khi không đổi người, uncomment khối sau:
    if (slot === "p1") reg.player1.score = newScore;
    else reg.player2.score = newScore;
    await reg.save();
    return res.json({ message: "Không có thay đổi", registration: reg });
  }

  // --- Tạo subdoc đúng playerSchema và GÁN SCORE MỚI ---
  const subdoc = {
    user: user._id,
    phone: user.phone || "", // playerSchema.required
    fullName: user.name || user.nickname || "", // playerSchema.required
    nickName: user.nickname || "",
    avatar: user.avatar || "",
    score: newScore, // ⬅️ CẬP NHẬT SCORE TẠI ĐÂY
  };

  if (slot === "p1") reg.player1 = subdoc;
  else reg.player2 = subdoc;

  await reg.save();
  res.json({ message: "Đã thay VĐV", registration: reg });
});

const { ObjectId } = mongoose.Types;

const escapeRegExp = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ====== SEARCH (GET /api/tournaments/:id/registrations/search?q=...) ======
export const searchRegistrations = async (req, res, next) => {
  try {
    const { id } = req.params; // tournament id
    let rawQ = String(req.query.q ?? "").trim();
    const limit = Math.min(Number(req.query.limit ?? 200), 500);

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Tournament id không hợp lệ" });
    }

    // Helper
    const escapeRegExp = (s = "") =>
      String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // === Nếu không có q: trả tất cả trong giải (giới hạn limit) ===
    if (!rawQ) {
      const results = await Registration.aggregate([
        { $match: { tournament: new ObjectId(id) } },

        // Join user cho player1 & player2
        {
          $lookup: {
            from: "users",
            localField: "player1.user",
            foreignField: "_id",
            as: "u1",
          },
        },
        { $unwind: { path: "$u1", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "users",
            localField: "player2.user",
            foreignField: "_id",
            as: "u2",
          },
        },
        { $unwind: { path: "$u2", preserveNullAndEmptyArrays: true } },

        // Trả player mixed để UI hiển thị
        {
          $addFields: {
            player1Mixed: {
              user: "$player1.user",
              phone: { $ifNull: ["$u1.phone", "$player1.phone"] },
              fullName: {
                $ifNull: [
                  "$u1.fullName",
                  { $ifNull: ["$u1.name", "$player1.fullName"] },
                ],
              },
              nickName: {
                $ifNull: [
                  "$u1.nickname",
                  { $ifNull: ["$u1.nickName", "$player1.nickName"] },
                ],
              },
              avatar: { $ifNull: ["$u1.avatar", "$player1.avatar"] },
              score: "$player1.score",
            },
            player2Mixed: {
              $cond: [
                { $ifNull: ["$player2", false] },
                {
                  user: "$player2.user",
                  phone: { $ifNull: ["$u2.phone", "$player2.phone"] },
                  fullName: {
                    $ifNull: [
                      "$u2.fullName",
                      { $ifNull: ["$u2.name", "$player2.fullName"] },
                    ],
                  },
                  nickName: {
                    $ifNull: [
                      "$u2.nickname",
                      { $ifNull: ["$u2.nickName", "$player2.nickName"] },
                    ],
                  },
                  avatar: { $ifNull: ["$u2.avatar", "$player2.avatar"] },
                  score: "$player2.score",
                },
                null,
              ],
            },
          },
        },

        {
          $project: {
            _id: 1,
            tournament: 1,
            createdBy: 1,
            createdAt: 1,
            code: 1,
            checkinAt: 1,
            payment: 1,
            player1: "$player1Mixed",
            player2: "$player2Mixed",
            // giữ snapshot nếu cần
            player1Snapshot: "$player1",
            player2Snapshot: "$player2",
          },
        },
        { $sort: { createdAt: -1 } },
        { $limit: limit },
      ]).collation({ locale: "vi", strength: 1 });

      return res.json(results);
    }

    // === Có q: build điều kiện tìm kiếm theo từng VĐV (tên & nickname) ===

    // exact phrase nếu có ngoặc kép
    const quoted = /^["“].*["”]$/.test(rawQ);
    if (quoted) rawQ = rawQ.replace(/^["“]|["”]$/g, "").trim();

    // tokens & chế độ
    const tokens = rawQ.split(/\s+/).filter(Boolean);
    const tokensLen = tokens.length;
    const exactMode = quoted || tokensLen >= 2;

    const qUpper = rawQ.toUpperCase();
    const qDigits = (rawQ.match(/\d/g) || []).join("");

    // phone
    const phoneRegex = qDigits.length >= 6 ? new RegExp(qDigits) : null;

    // code
    const codeExact = /^\d+$/.test(rawQ) ? Number(rawQ) : undefined;
    const codePrefixRegex =
      qDigits.length >= 2 ? new RegExp("^" + escapeRegExp(qDigits)) : null;

    // short5
    const short5Prefix =
      !exactMode && tokensLen === 1
        ? new RegExp("^" + escapeRegExp(tokens[0].toUpperCase()))
        : null;

    // regex token
    const tokenPrefixRegexes = tokens.map(
      (t) => new RegExp("(?:^|\\s)" + escapeRegExp(t), "i")
    );
    const tokenAnyRegexes = tokens.map((t) => new RegExp(escapeRegExp(t), "i"));

    const pipeline = [
      { $match: { tournament: new ObjectId(id) } },

      // Join user cho player1 & player2
      {
        $lookup: {
          from: "users",
          localField: "player1.user",
          foreignField: "_id",
          as: "u1",
        },
      },
      { $unwind: { path: "$u1", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "player2.user",
          foreignField: "_id",
          as: "u2",
        },
      },
      { $unwind: { path: "$u2", preserveNullAndEmptyArrays: true } },

      // Các field chuẩn hoá để so sánh
      {
        $addFields: {
          n1: {
            $toUpper: {
              $trim: {
                input: {
                  $ifNull: ["$u1.fullName", { $ifNull: ["$u1.name", ""] }],
                },
                chars: " ",
              },
            },
          },
          n1Nick: {
            $toUpper: {
              $ifNull: ["$u1.nickname", { $ifNull: ["$u1.nickName", ""] }],
            },
          },
          n2: {
            $toUpper: {
              $trim: {
                input: {
                  $ifNull: ["$u2.fullName", { $ifNull: ["$u2.name", ""] }],
                },
                chars: " ",
              },
            },
          },
          n2Nick: {
            $toUpper: {
              $ifNull: ["$u2.nickname", { $ifNull: ["$u2.nickName", ""] }],
            },
          },

          // fallback phone: user > snapshot
          p1Phone: { $ifNull: ["$u1.phone", "$player1.phone"] },
          p2Phone: { $ifNull: ["$u2.phone", "$player2.phone"] },

          _idStr: { $toString: "$_id" },
          codeStr: { $toString: "$code" },
        },
      },
      {
        $addFields: {
          short5: {
            $toUpper: {
              $substrCP: [
                "$_idStr",
                { $subtract: [{ $strLenCP: "$_idStr" }, 5] },
                5,
              ],
            },
          },
        },
      },

      // ====== HIT FLAGS / SCORES (theo TỪNG VĐV) ======
      {
        $addFields: {
          exactNameHit: {
            $or: [
              { $eq: ["$n1", qUpper] },
              { $eq: ["$n1Nick", qUpper] },
              { $eq: ["$n2", qUpper] },
              { $eq: ["$n2Nick", qUpper] },
            ],
          },

          tokenPrefixHits: {
            $add: [
              0,
              ...tokenPrefixRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n1", regex: rx } }, 1, 0],
              })),
              ...tokenPrefixRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n1Nick", regex: rx } }, 1, 0],
              })),
              ...tokenPrefixRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n2", regex: rx } }, 1, 0],
              })),
              ...tokenPrefixRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n2Nick", regex: rx } }, 1, 0],
              })),
            ],
          },

          tokenAnyHits: {
            $add: [
              0,
              ...tokenAnyRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n1", regex: rx } }, 1, 0],
              })),
              ...tokenAnyRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n1Nick", regex: rx } }, 1, 0],
              })),
              ...tokenAnyRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n2", regex: rx } }, 1, 0],
              })),
              ...tokenAnyRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n2Nick", regex: rx } }, 1, 0],
              })),
            ],
          },

          codeOrPhoneHit: {
            $or: [
              ...(Number.isFinite(codeExact)
                ? [{ $eq: ["$code", codeExact] }]
                : []),
              ...(codePrefixRegex
                ? [
                    {
                      $regexMatch: {
                        input: "$codeStr",
                        regex: codePrefixRegex,
                      },
                    },
                  ]
                : []),
              ...(phoneRegex
                ? [
                    { $regexMatch: { input: "$p1Phone", regex: phoneRegex } },
                    { $regexMatch: { input: "$p2Phone", regex: phoneRegex } },
                  ]
                : []),
              ...(short5Prefix
                ? [{ $regexMatch: { input: "$short5", regex: short5Prefix } }]
                : []),
            ],
          },
        },
      },

      // Lọc theo chế độ
      {
        $match: exactMode
          ? {
              $or: [
                { exactNameHit: true },
                { codeOrPhoneHit: true },
                ...(tokensLen
                  ? [{ tokenPrefixHits: { $gte: tokensLen } }]
                  : []),
              ],
            }
          : {
              $or: [
                { codeOrPhoneHit: true },
                { exactNameHit: true },
                { tokenPrefixHits: { $gt: 0 } },
                { tokenAnyHits: { $gt: 0 } },
              ],
            },
      },

      // Xếp hạng
      {
        $addFields: {
          rank: {
            $switch: {
              branches: [
                { case: "$codeOrPhoneHit", then: 0 },
                { case: "$exactNameHit", then: 1 },
                ...(tokensLen
                  ? [
                      {
                        case: { $gte: ["$tokenPrefixHits", tokensLen] },
                        then: 2,
                      },
                    ]
                  : []),
                { case: { $gt: ["$tokenAnyHits", 0] }, then: 3 },
              ],
              default: 9,
            },
          },
        },
      },

      { $sort: { rank: 1, createdAt: -1 } },
      { $limit: limit },

      // Trả player mixed (gộp user + snapshot)
      {
        $addFields: {
          player1Mixed: {
            user: "$player1.user",
            phone: { $ifNull: ["$u1.phone", "$player1.phone"] },
            fullName: {
              $ifNull: [
                "$u1.fullName",
                { $ifNull: ["$u1.name", "$player1.fullName"] },
              ],
            },
            nickName: {
              $ifNull: [
                "$u1.nickname",
                { $ifNull: ["$u1.nickName", "$player1.nickName"] },
              ],
            },
            avatar: { $ifNull: ["$u1.avatar", "$player1.avatar"] },
            score: "$player1.score",
          },
          player2Mixed: {
            $cond: [
              { $ifNull: ["$player2", false] },
              {
                user: "$player2.user",
                phone: { $ifNull: ["$u2.phone", "$player2.phone"] },
                fullName: {
                  $ifNull: [
                    "$u2.fullName",
                    { $ifNull: ["$u2.name", "$player2.fullName"] },
                  ],
                },
                nickName: {
                  $ifNull: [
                    "$u2.nickname",
                    { $ifNull: ["$u2.nickName", "$player2.nickName"] },
                  ],
                },
                avatar: { $ifNull: ["$u2.avatar", "$player2.avatar"] },
                score: "$player2.score",
              },
              null,
            ],
          },
        },
      },

      {
        $project: {
          _id: 1,
          tournament: 1,
          createdBy: 1,
          createdAt: 1,
          code: 1,
          checkinAt: 1,
          payment: 1,

          player1: "$player1Mixed",
          player2: "$player2Mixed",

          player1Snapshot: "$player1",
          player2Snapshot: "$player2",
        },
      },
    ];

    const results = await Registration.aggregate(pipeline).collation({
      locale: "vi",
      strength: 1, // ignore case + accents cho so sánh thường; (regex vẫn phân biệt dấu)
    });

    return res.json(results);
  } catch (err) {
    return next(err);
  }
};
