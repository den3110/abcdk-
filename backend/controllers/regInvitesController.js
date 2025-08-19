// controllers/regInviteController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import RegInvite from "../models/regInviteModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";

/* ----------------- Utils ----------------- */
const oid = (x) => new mongoose.Types.ObjectId(String(x));
const normET = (et) => {
  const s = String(et || "").toLowerCase();
  if (s === "single" || s === "singles") return "single";
  if (s === "double" || s === "doubles") return "double";
  return "double";
};

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
  if (tour.maxPairs && tour.maxPairs > 0) {
    const cnt = await Registration.countDocuments({ tournament: tour._id });
    if (cnt >= tour.maxPairs) {
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

  // (4) Điểm trình
  const noPointCap = Number(tour.scoreCap) === 0; // mở cap => bỏ qua mọi check điểm
  let s1 = 0,
    s2 = 0;
  if (!noPointCap) {
    const map = await latestScoresMap(ids);
    const key = eventType === "double" ? "double" : "single";
    s1 = map.get(String(p1UserId))?.[key] ?? 0;
    s2 = isSingle ? 0 : map.get(String(p2UserId))?.[key] ?? 0;

    if (typeof tour.singleCap === "number" && tour.singleCap > 0) {
      if (s1 > tour.singleCap || (!isSingle && s2 > tour.singleCap)) {
        return {
          ok: false,
          reason: "single_cap_exceeded",
          message: "Điểm của 1 VĐV vượt giới hạn",
        };
      }
    }
    if (!isSingle && Number(tour.scoreCap) > 0) {
      const gap = Number(tour.scoreGap) || 0;
      if (s1 + s2 > Number(tour.scoreCap) + gap) {
        return {
          ok: false,
          reason: "pair_cap_exceeded",
          message: "Tổng điểm đôi vượt giới hạn",
        };
      }
    }
  }

  return { ok: true, s1, s2, noPointCap };
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

  // re-validate trước khi chốt
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

  // snapshot users
  const u1 = invite.player1.user
    ? await User.findById(invite.player1.user).lean()
    : null;
  const u2 = invite.player2?.user
    ? await User.findById(invite.player2.user).lean()
    : null;

  const reg = await Registration.create({
    tournament: tour._id,
    message: "", // có thể bổ sung
    player1: {
      user: u1?._id || null,
      fullName: invite.player1.fullName || u1?.name || "",
      phone: invite.player1.phone || u1?.phone || "",
      avatar: invite.player1.avatar || u1?.avatar || "",
      score: pf.noPointCap ? 0 : pf.s1,
    },
    player2: isSingle
      ? null
      : {
          user: u2?._id || null,
          fullName: invite.player2?.fullName || u2?.name || "",
          phone: invite.player2?.phone || u2?.phone || "",
          avatar: invite.player2?.avatar || u2?.avatar || "",
          score: pf.noPointCap ? 0 : pf.s2,
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
export const createRegistrationInvite = asyncHandler(async (req, res) => {
  const { id } = req.params; // tournamentId
  const { player1Id, player2Id, message = "" } = req.body || {};

  // lấy thông tin người gửi (để so phone/nickname auto-accept khi không phải admin)
  const me = await User.findById(req.user._id)
    .select("_id phone nickname")
    .lean();

  // check quyền admin từ token
  const isAdmin =
    !!req.user?.isAdmin ||
    req.user?.role === "admin" ||
    (Array.isArray(req.user?.roles) && req.user.roles.includes("admin"));

  const tour = await Tournament.findById(id);
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  const eventType = normET(tour.eventType);
  const isSingle = eventType === "single";
  const isDouble = eventType === "double";

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

  // lấy user snapshots
  const ids = isDouble ? [player1Id, player2Id] : [player1Id];
  const users = await User.find({ _id: { $in: ids } })
    .select("_id name phone avatar nickname score")
    .lean();
  if (users.length !== ids.length) {
    res.status(400);
    throw new Error("Không tìm thấy VĐV hợp lệ");
  }
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const u1 = byId.get(String(player1Id));
  const u2 = isDouble ? byId.get(String(player2Id)) : null;

  // preflight để tránh case chắc chắn fail (đã đăng ký, full slot, v.v.)
  const pf = await preflightChecks({
    tour,
    eventType,
    p1UserId: u1?._id,
    p2UserId: u2?._id,
  });
  if (!pf.ok) {
    res.status(400);
    throw new Error(pf.message || "Không thể tạo lời mời");
  }

  // ====== ⛳ ADMIN: tạo Registration trực tiếp (auto-approve) ======
  if (isAdmin) {
    const snap = (u, score) => ({
      user: u._id,
      phone: u.phone || "",
      fullName: u.name || "",
      nickName: u.nickname || "",
      avatar: u.avatar || "",
      score: pf?.noPointCap ? 0 : Number(score ?? u.score ?? 0),
    });

    const reg = await Registration.create({
      tournament: tour._id,
      player1: snap(u1, pf?.s1),
      player2: isSingle ? null : snap(u2, pf?.s2),
      message,
      createdBy: me._id,
      payment: { status: "Unpaid" },
    });

    return res.status(201).json({
      mode: "direct_by_admin",
      registration: reg,
      message: "Đã tạo đăng ký (admin — auto approve)",
    });
  }

  // ====== 👤 USER THƯỜNG: flow invite như cũ (auto-accept cho người gửi nếu trùng) ======
  const creatorIsP1 =
    String(me._id) === String(u1._id) ||
    (!!me.phone && me.phone === (u1.phone || "")) ||
    (!!me.nickname && me.nickname === (u1.nickname || ""));
  const creatorIsP2 =
    isDouble &&
    (String(me._id) === String(u2._id) ||
      (!!me.phone && me.phone === (u2.phone || "")) ||
      (!!me.nickname && me.nickname === (u2.nickname || "")));

  const invite = await RegInvite.create({
    tournament: tour._id,
    eventType,
    player1: {
      user: u1._id,
      phone: u1.phone || "",
      nickname: u1.nickname || "",
      fullName: u1.name || "",
      avatar: u1.avatar || "",
      score: pf.noPointCap ? 0 : pf.s1,
    },
    player2: isSingle
      ? null
      : {
          user: u2._id,
          phone: u2.phone || "",
          nickname: u2.nickname || "",
          fullName: u2.name || "",
          avatar: u2.avatar || "",
          score: pf.noPointCap ? 0 : pf.s2,
        },
    createdBy: me._id,
    confirmations: {
      p1: creatorIsP1 ? "accepted" : "pending",
      p2: isSingle ? "pending" : creatorIsP2 ? "accepted" : "pending",
    },
  });

  const after = await finalizeIfReady(invite);
  res.status(201).json({ invite: after, message });
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
