// controllers/regInviteController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";

import RegInvite from "../models/regInviteModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Ranking from "../models/rankingModel.js";
import { notifyNewPair } from "../services/telegram/telegramNotifyRegistration.js";

/* ----------------- Utils ----------------- */
const oid = (x) => new mongoose.Types.ObjectId(String(x));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const normET = (et) => {
  const s = String(et || "").toLowerCase();
  if (s === "single" || s === "singles") return "single";
  if (s === "double" || s === "doubles") return "double";
  if (s === "mix" || s === "mixed") return "mix";
  return "double";
};

const rankingFieldFor = (eventType) => {
  const et = String(eventType || "").toLowerCase();
  if (et === "single") return "single";
  if (et === "double") return "double";
  if (et === "mix" || et === "mixed") return "mix";
  return null;
};

/**
 * Lấy điểm BXH ưu tiên theo loại giải:
 * - field theo eventType (single/double/mix)
 * - fallback: points
 * Trả về number hoặc null nếu chưa có.
 */
async function getRankingScore(userId, eventType) {
  if (!userId) return null;
  const r = await Ranking.findOne({ user: userId })
    .select("single double mix points")
    .lean();
  if (!r) return null;
  const key = rankingFieldFor(eventType);
  const byET = key ? r[key] : null;
  const candidates = [byET, r?.points];
  const hit = candidates.find((x) => Number.isFinite(Number(x)));
  return hit != null ? Number(hit) : null;
}

/** Ưu tiên: rankScore -> pfScore -> userScore */
function preferScore(rankScore, pfScore, userScore) {
  const cands = [rankScore, pfScore, userScore];
  const hit = cands.find((x) => Number.isFinite(Number(x)));
  return num(hit);
}

async function latestScoresMap(userIds) {
  if (!userIds.length) return new Map();
  const rows = await ScoreHistory.aggregate([
    { $match: { user: { $in: userIds.map(oid) } } },
    { $sort: { scoredAt: -1 } },
    {
      $group: {
        _id: "$user",
        single: { $first: "$single" },
        double: { $first: "$double" },
      },
    },
  ]);
  return new Map(
    rows.map((r) => [
      String(r._id),
      { single: r.single ?? 0, double: r.double ?? 0 },
    ])
  );
}

async function alreadyRegistered(tourId, userIds) {
  if (!userIds.length) return false;
  const exist = await Registration.findOne({
    tournament: tourId,
    $or: [
      { "player1.user": { $in: userIds } },
      { "player2.user": { $in: userIds } },
    ],
  }).lean();
  return !!exist;
}

function inRegWindow(tour) {
  const now = Date.now();
  const openAt =
    tour.regOpenDate instanceof Date
      ? tour.regOpenDate.getTime()
      : +tour.regOpenDate;
  const deadline =
    tour.registrationDeadline instanceof Date
      ? tour.registrationDeadline.getTime()
      : +tour.registrationDeadline;
  return !!openAt && !!deadline && now >= openAt && now <= deadline;
}

/* ---------- Validate giống createRegistration (preflight) ---------- */
/**
 * Trả về:
 *  {
 *    ok: boolean,
 *    s1: number, s2: number,          // điểm lấy từ ScoreHistory để validate cap/xếp loại
 *    reason, message                  // nếu !ok
 *  }
 *
 * Semantics:
 *  - scoreCap = 0  => KHÔNG GIỚI HẠN tổng đôi (bỏ check pair cap)
 *  - singleCap = 0 => KHÔNG GIỚI HẠN từng VĐV (bỏ check single cap)
 */
async function preflightChecks({ tour, eventType, p1UserId, p2UserId }) {
  const isSingle = eventType === "single";
  const ids = [p1UserId, p2UserId].filter(Boolean).map(String);

  // (1) Khung thời gian
  if (!inRegWindow(tour)) {
    return {
      ok: false,
      reason: "closed",
      message: "Giải chưa mở hoặc đã hết hạn đăng ký",
    };
  }

  // (2) Full chỗ
  if (Number(tour.maxPairs) > 0) {
    const cnt = await Registration.countDocuments({ tournament: tour._id });
    if (cnt >= Number(tour.maxPairs)) {
      return {
        ok: false,
        reason: "full",
        message: "Giải đã đủ số cặp đăng ký",
      };
    }
  }

  // (3) Duplicate đã đăng ký
  if (await alreadyRegistered(tour._id, ids)) {
    return {
      ok: false,
      reason: "duplicate",
      message: "VĐV đã đăng ký giải đấu rồi",
    };
  }

  // (4) Tính điểm để kiểm tra cap từ ScoreHistory (không liên quan snapshot)
  const map = await latestScoresMap(ids);
  const key = eventType === "double" ? "double" : "single";
  const s1 = map.get(String(p1UserId))?.[key] ?? 0;
  const s2 = isSingle ? 0 : map.get(String(p2UserId))?.[key] ?? 0;

  // Bật/tắt cap theo giá trị > 0
  const singleCap = Number(tour.singleCap);
  const singleCapEnabled = Number.isFinite(singleCap) && singleCap > 0;

  const pairCap = Number(tour.scoreCap);
  const pairCapEnabled = Number.isFinite(pairCap) && pairCap > 0;
  const gap = Number(tour.scoreGap) || 0;

  if (singleCapEnabled) {
    if (s1 > singleCap || (!isSingle && s2 > singleCap)) {
      return {
        ok: false,
        reason: "single_cap_exceeded",
        message: "Điểm của 1 VĐV vượt giới hạn",
      };
    }
  }

  if (!isSingle && pairCapEnabled) {
    if (s1 + s2 > pairCap + gap) {
      return {
        ok: false,
        reason: "pair_cap_exceeded",
        message: "Tổng điểm đôi vượt giới hạn",
      };
    }
  }

  return { ok: true, s1, s2 };
}

/* ---------- Finalize nếu đủ xác nhận ---------- */
async function finalizeIfReady(invite) {
  if (!invite || invite.status !== "pending") return invite;

  const isSingle = invite.eventType === "single";
  const okP1 = invite.confirmations.p1 === "accepted";
  const okP2 = isSingle ? true : invite.confirmations.p2 === "accepted";
  if (!okP1 || !okP2) return invite;

  const tour = await Tournament.findById(invite.tournament);
  if (!tour) {
    invite.status = "declined";
    invite.failReason = "tournament_not_found";
    return invite.save();
  }

  // re-validate trước khi chốt (CAP/duplicate/time window)
  const pf = await preflightChecks({
    tour,
    eventType: invite.eventType,
    p1UserId: invite.player1.user,
    p2UserId: invite.player2?.user,
  });
  if (!pf.ok) {
    invite.status = "declined";
    invite.failReason = pf.reason || "preflight_failed";
    return invite.save();
  }

  // lấy user & điểm BXH (ưu tiên BXH khi snapshot Registration)
  const [u1, u2] = await Promise.all([
    invite.player1.user
      ? User.findById(invite.player1.user).lean()
      : Promise.resolve(null),
    invite.player2?.user
      ? User.findById(invite.player2.user).lean()
      : Promise.resolve(null),
  ]);

  const [rank1, rank2] = await Promise.all([
    getRankingScore(invite.player1.user, invite.eventType),
    isSingle
      ? Promise.resolve(null)
      : getRankingScore(invite.player2?.user, invite.eventType),
  ]);

  const p1Score = preferScore(rank1, pf.s1, u1?.score);
  const p2Score = isSingle ? null : preferScore(rank2, pf.s2, u2?.score);

  const reg = await Registration.create({
    tournament: tour._id,
    message: "", // có thể bổ sung
    player1: {
      user: u1?._id || null,
      fullName: invite.player1.fullName || u1?.name || "",
      phone: invite.player1.phone || u1?.phone || "",
      avatar: invite.player1.avatar || u1?.avatar || "",
      score: num(p1Score),
    },
    player2: isSingle
      ? null
      : {
          user: u2?._id || null,
          fullName: invite.player2?.fullName || u2?.name || "",
          phone: invite.player2?.phone || u2?.phone || "",
          avatar: invite.player2?.avatar || u2?.avatar || "",
          score: num(p2Score),
        },
    createdBy: invite.createdBy,
  });

  invite.status = "finalized";
  invite.registrationId = reg._id;
  await invite.save();

  // tăng đếm an toàn
  await Tournament.updateOne({ _id: tour._id }, { $inc: { registered: 1 } });

  return invite;
}

/* ================== Controllers ================== */

/** Tạo lời mời đăng ký (user gửi lời mời cho chính mình +/ hoặc partner) */
/** Đồng bộ counter "registration_code" để không bị thấp hơn max(code) đã có */
async function ensureRegCodeCounterIsNotBehind() {
  // Lấy max(code) hiện có trong registrations
  const agg = await Registration.aggregate([
    { $match: { code: { $type: "number" } } },
    { $group: { _id: null, maxCode: { $max: "$code" } } },
    { $project: { _id: 0, maxCode: 1 } },
  ]);
  const maxExisting = Number(agg?.[0]?.maxCode || 0);
  const base = Math.max(9999, maxExisting);

  // Nâng counter nếu đang thấp hơn base
  const counters = mongoose.connection.collection("counters");
  await counters.updateOne(
    { _id: "registration_code", seq: { $lt: base } },
    { $set: { seq: base } },
    { upsert: true }
  );
}

/** Tạo Registration với retry nếu gặp duplicate key ở field code */
async function createRegistrationWithRetry(payload, maxTry = 3) {
  let lastErr;
  for (let i = 0; i < maxTry; i++) {
    try {
      return await Registration.create(payload);
    } catch (e) {
      const isDup =
        e?.code === 11000 &&
        (e?.keyPattern?.code || "code" in (e?.keyValue || {}));
      if (isDup) {
        // đồng bộ counter rồi thử lại
        await ensureRegCodeCounterIsNotBehind();
        await new Promise((r) => setTimeout(r, 10));
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  const err = new Error(
    "Không cấp được mã đăng ký duy nhất. Vui lòng thử lại sau ít phút."
  );
  err.status = 503;
  throw err;
}

export const createRegistrationInvite = asyncHandler(async (req, res) => {
  const { id } = req.params; // tournamentId
  const { player1Id, player2Id, message = "" } = req.body || {};

  // người gửi (để lấy _id & quyền)
  const me = await User.findById(req.user._id)
    .select("_id phone nickname role roles isAdmin")
    .lean();

  // quyền admin
  const isAdmin =
    !!req.user?.isAdmin ||
    req.user?.role === "admin" ||
    (Array.isArray(req.user?.roles) && req.user.roles.includes("admin"));

  // tournament
  const tour = await Tournament.findById(id);
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  const eventType = normET(tour.eventType);
  const isSingle = eventType === "single";
  const isDouble = eventType === "double";

  // ====== VALIDATE cơ bản ======
  if (!player1Id) {
    res.status(400);
    throw new Error("Thiếu VĐV 1");
  }
  if (isDouble && !player2Id) {
    res.status(400);
    throw new Error("Giải đôi cần 2 VĐV");
  }
  if (isDouble && String(player1Id) === String(player2Id)) {
    res.status(400);
    throw new Error("Hai VĐV phải khác nhau");
  }

  // ✅ BẮT BUỘC VĐV1 LÀ CHÍNH USER (trừ admin)
  if (!isAdmin && String(player1Id) !== String(req.user._id)) {
    res.status(403);
    throw new Error("VĐV 1 phải là chính bạn (tài khoản đang đăng nhập).");
  }

  // lấy user snapshots (kèm cccd/cccdStatus + dob/birthYear)
  const ids = isDouble ? [player1Id, player2Id] : [player1Id];
  const users = await User.find({ _id: { $in: ids } })
    .select(
      "_id name nickname phone avatar province score cccd cccdStatus dob dateOfBirth birthYear"
    )
    .lean();

  if (users.length !== ids.length) {
    res.status(400);
    throw new Error("Không tìm thấy VĐV hợp lệ");
  }
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const u1 = byId.get(String(player1Id));
  const u2 = isDouble ? byId.get(String(player2Id)) : null;

  // ====== NHÁNH ADMIN: tạo trực tiếp, bỏ qua mọi kiểm tra ======
  if (isAdmin) {
    const [rank1, rank2] = await Promise.all([
      getRankingScore(u1._id, eventType),
      isSingle ? Promise.resolve(null) : getRankingScore(u2._id, eventType),
    ]);

    const s1 = preferScore(rank1, null, u1?.score);
    const s2 = isSingle ? null : preferScore(rank2, null, u2?.score);

    const snap = (u, score) => ({
      user: u._id,
      phone: u.phone || "",
      fullName: u.name || u.nickname || "",
      nickName: u.nickname || "",
      avatar: u.avatar || "",
      province: u.province || "",
      score: num(score),
    });

    const reg = await createRegistrationWithRetry({
      tournament: tour._id,
      eventType,
      player1: snap(u1, s1),
      player2: isSingle ? null : snap(u2, s2),
      message,
      createdBy: me._id,
      payment: { status: "Unpaid" },
      meta: { createdByAdmin: true },
    });

    notifyNewPair({
      tournamentId: tour._id,
      reg: typeof reg.toObject === "function" ? reg.toObject() : reg,
    }).catch((e) => console.error("[tele] notify new pair (admin) failed:", e));

    return res.status(201).json({
      mode: "direct_by_admin",
      registration: reg,
      message:
        "Đã tạo đăng ký trực tiếp bởi admin (bỏ qua kiểm tra KYC/độ tuổi/phạm vi).",
    });
  }

  // ====== NHÁNH USER THƯỜNG ======

  // 1) Check phạm vi tỉnh (nếu bật)
  const scope = tour.scoringScope || {};
  if (
    scope.type === "provinces" &&
    Array.isArray(scope.provinces) &&
    scope.provinces.length
  ) {
    const norm = (s) =>
      String(s || "")
        .trim()
        .toLowerCase();
    const allow = new Set(scope.provinces.map(norm));
    const bad = [];
    if (!allow.has(norm(u1?.province))) bad.push("VĐV 1");
    if (isDouble && !allow.has(norm(u2?.province))) bad.push("VĐV 2");

    if (bad.length) {
      const list = scope.provinces.join(", ");
      res.status(403);
      throw new Error(
        bad.length === 1
          ? `${bad[0]} không thuộc phạm vi tỉnh được phép (${list}).`
          : `${bad.join(" và ")} không thuộc phạm vi tỉnh được phép (${list}).`
      );
    }
  }

  // 2) Giới hạn độ tuổi (nếu bật)
  const ar = tour.ageRestriction || {};
  if (ar.enabled) {
    const refDate = tour.startDate ? new Date(tour.startDate) : new Date();
    const clamp = (n, lo, hi) =>
      Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.floor(n))) : n;
    const minAge = clamp(ar.minAge ?? 0, 0, 100);
    const maxAge = clamp(ar.maxAge ?? 100, 0, 120);

    const getAge = (u) => {
      const dob = u?.dob || u?.dateOfBirth;
      const by = u?.birthYear;
      if (dob) {
        const d = new Date(dob);
        if (!Number.isNaN(d.getTime())) {
          let age = refDate.getFullYear() - d.getFullYear();
          const m = refDate.getMonth() - d.getMonth();
          if (m < 0 || (m === 0 && refDate.getDate() < d.getDate())) age--;
          return age;
        }
      }
      if (Number.isFinite(Number(by))) {
        return refDate.getFullYear() - Number(by);
      }
      return null; // thiếu dữ liệu tuổi
    };

    const a1 = getAge(u1);
    const a2 = isSingle ? null : getAge(u2);

    const needAgeP1 = a1 == null;
    const needAgeP2 = isDouble ? a2 == null : false;

    if (needAgeP1 || needAgeP2) {
      const baseMsg =
        needAgeP1 && needAgeP2
          ? "VĐV 1 và VĐV 2 cần cập nhật năm sinh/ngày sinh để kiểm tra độ tuổi."
          : needAgeP1
          ? "VĐV 1 cần cập nhật năm sinh/ngày sinh để kiểm tra độ tuổi."
          : "VĐV 2 cần cập nhật năm sinh/ngày sinh để kiểm tra độ tuổi.";
      if (needAgeP1 && !needAgeP2) {
        return res
          .status(412)
          .json({
            message: baseMsg,
            userId: u1._id,
            slot: "p1",
            code: "NEED_DOB",
          });
      }
      if (!needAgeP1 && needAgeP2) {
        return res
          .status(412)
          .json({
            message: baseMsg,
            userId: u2._id,
            slot: "p2",
            code: "NEED_DOB",
          });
      }
      return res.status(412).json({
        message: baseMsg,
        targets: [
          { userId: u1._id, slot: "p1" },
          { userId: u2._id, slot: "p2" },
        ],
        code: "NEED_DOB",
      });
    }

    const outP1 = a1 < minAge || a1 > maxAge;
    const outP2 = isDouble ? a2 < minAge || a2 > maxAge : false;

    if (outP1 || outP2) {
      const rangeMsg = `Tuổi yêu cầu từ ${minAge}–${maxAge}.`;
      if (outP1 && !outP2) {
        return res
          .status(412)
          .json({
            message: `VĐV 1 không nằm trong giới hạn độ tuổi. ${rangeMsg}`,
            userId: u1._id,
            slot: "p1",
            code: "AGE_OUT_OF_RANGE",
          });
      }
      if (!outP1 && outP2) {
        return res
          .status(412)
          .json({
            message: `VĐV 2 không nằm trong giới hạn độ tuổi. ${rangeMsg}`,
            userId: u2._id,
            slot: "p2",
            code: "AGE_OUT_OF_RANGE",
          });
      }
      return res.status(412).json({
        message: `VĐV 1 và VĐV 2 không nằm trong giới hạn độ tuổi. ${rangeMsg}`,
        targets: [
          { userId: u1._id, slot: "p1" },
          { userId: u2._id, slot: "p2" },
        ],
        code: "AGE_OUT_OF_RANGE",
      });
    }
  }

  // 3) Yêu cầu KYC (nếu giải bật). Mặc định requireKyc=true.
  const requireKyc = tour.requireKyc !== false;
  if (requireKyc) {
    const isKycVerified = (u) =>
      !!u?.cccd && String(u?.cccdStatus || "").toLowerCase() === "verified";

    const needKycP1 = !isKycVerified(u1);
    const needKycP2 = isDouble ? !isKycVerified(u2) : false;

    if (needKycP1 || needKycP2) {
      const baseMsg =
        needKycP1 && needKycP2
          ? "VĐV 1 và VĐV 2 cần hoàn tất KYC (đã xác minh) trước khi đăng ký."
          : needKycP1
          ? "VĐV 1 cần hoàn tất KYC (đã xác minh) trước khi đăng ký."
          : "VĐV 2 cần hoàn tất KYC (đã xác minh) trước khi đăng ký.";

      if (needKycP1 && !needKycP2) {
        return res
          .status(412)
          .json({
            message: baseMsg,
            userId: u1._id,
            slot: "p1",
            code: "KYC_REQUIRED",
          });
      }
      if (!needKycP1 && needKycP2) {
        return res
          .status(412)
          .json({
            message: baseMsg,
            userId: u2._id,
            slot: "p2",
            code: "KYC_REQUIRED",
          });
      }
      return res.status(412).json({
        message: baseMsg,
        targets: [
          { userId: u1._id, slot: "p1" },
          { userId: u2._id, slot: "p2" },
        ],
        code: "KYC_REQUIRED",
      });
    }
  }

  // 4) Preflight checks
  const pf = await preflightChecks({
    tour,
    eventType,
    p1UserId: u1?._id,
    p2UserId: u2?._id,
  });
  if (!pf.ok) {
    res.status(400);
    throw new Error(pf.message || "Không thể tạo đăng ký");
  }

  // 5) Tạo Registration trực tiếp
  const [rank1, rank2] = await Promise.all([
    getRankingScore(u1._id, eventType),
    isSingle ? Promise.resolve(null) : getRankingScore(u2._id, eventType),
  ]);

  const p1Score = preferScore(rank1, pf.s1, u1?.score);
  const p2Score = isSingle ? null : preferScore(rank2, pf.s2, u2?.score);

  const snap = (u, score) => ({
    user: u._id,
    phone: u.phone || "",
    fullName: u.name || u.nickname || "",
    nickName: u.nickname || "",
    avatar: u.avatar || "",
    province: u.province || "",
    score: num(score),
  });

  const reg = await createRegistrationWithRetry({
    tournament: tour._id,
    eventType,
    player1: snap(u1, p1Score),
    player2: isSingle ? null : snap(u2, p2Score),
    message,
    createdBy: me._id,
    payment: { status: "Unpaid" },
    meta: { autoByKyc: requireKyc === true, ageChecked: !!ar.enabled },
  });

  notifyNewPair({
    tournamentId: tour._id,
    reg: typeof reg.toObject === "function" ? reg.toObject() : reg,
  }).catch((e) => console.error("[tele] notify new pair (user) failed:", e));

  return res.status(201).json({
    mode: requireKyc ? "direct_by_kyc" : "direct",
    registration: reg,
    message: isSingle ? "Đã tạo đăng ký." : "Đã tạo đăng ký cho cả 2 VĐV.",
  });
});

/** Danh sách lời mời mà TÔI cần phản hồi (global, không theo giải) */
export const listMyInvites = asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id)
    .select("_id phone nickname")
    .lean();
  if (!me) return res.json([]);

  const meMatchP1 = {
    $or: [
      { "player1.user": me._id },
      ...(me.phone ? [{ "player1.phone": me.phone }] : []),
      ...(me.nickname ? [{ "player1.nickname": me.nickname }] : []),
    ],
  };
  const meMatchP2 = {
    $or: [
      { "player2.user": me._id },
      ...(me.phone ? [{ "player2.phone": me.phone }] : []),
      ...(me.nickname ? [{ "player2.nickname": me.nickname }] : []),
    ],
  };

  const invites = await RegInvite.find({
    status: "pending",
    $or: [
      { $and: [meMatchP1, { "confirmations.p1": "pending" }] },
      { $and: [meMatchP2, { "confirmations.p2": "pending" }] },
    ],
  })
    .populate("tournament", "name image eventType startDate location")
    .lean();

  res.json(invites);
});

/** Phản hồi lời mời (accept / decline) */
export const respondInvite = asyncHandler(async (req, res) => {
  const { id } = req.params; // inviteId
  const { action } = req.body; // 'accept' | 'decline'
  if (!["accept", "decline"].includes(action)) {
    res.status(400);
    throw new Error("Invalid action");
  }

  const me = await User.findById(req.user._id)
    .select("_id phone nickname")
    .lean();
  const invite = await RegInvite.findById(id);
  if (!invite || invite.status !== "pending") {
    res.status(404);
    throw new Error("Invite not found");
  }

  // xác định tôi là p1 hay p2
  const iAmP1 =
    String(invite.player1.user || "") === String(me._id) ||
    (!!me.phone && invite.player1.phone === me.phone) ||
    (!!me.nickname && invite.player1.nickname === me.nickname);

  const iAmP2 =
    invite.player2 &&
    (String(invite.player2.user || "") === String(me._id) ||
      (!!me.phone && invite.player2.phone === me.phone) ||
      (!!me.nickname && invite.player2.nickname === me.nickname));

  if (!iAmP1 && !iAmP2) {
    res.status(403);
    throw new Error("Bạn không phải người được mời");
  }

  const next = action === "accept" ? "accepted" : "declined";
  if (iAmP1) invite.confirmations.p1 = next;
  if (iAmP2) invite.confirmations.p2 = next;

  if (next === "declined") {
    invite.status = "declined";
    invite.failReason = "user_declined";
    await invite.save();
    return res.json({ ok: true, invite });
  }

  await invite.save();
  const after = await finalizeIfReady(invite);
  res.json({ ok: true, invite: after });
});
