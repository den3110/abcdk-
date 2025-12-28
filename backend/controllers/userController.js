import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Ranking from "../models/rankingModel.js";
import Registration from "../models/registrationModel.js";
import Evaluation from "../models/evaluationModel.js";
import Tournament from "../models/tournamentModel.js";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Assessment from "../models/assessmentModel.js";
import { normalizeDupr, rawFromDupr } from "../utils/level.js";
import { notifyNewKyc } from "../services/telegram/telegramNotifyKyc.js";
import { notifyNewUser } from "../services/telegram/notifyNewUser.js";
import SportConnectService from "../services/sportconnect.service.js";
import path from "path";
import fs from "fs";
import {
  loadAll as spcLoadAll,
  getMeta as spcGetMeta,
} from "../services/spcStore.js";
import OpenAI from "openai";
import {
  EVENTS,
  publishNotification,
} from "../services/notifications/notificationHub.js";
import { writeAuditLog } from "../services/audit.service.js";
import * as crypto from "crypto";
import { sendTingTingOtp } from "../services/tingtingZns.service.js";
import bcrypt from "bcryptjs";
import { makeLoginOtpToken } from "./userLoginController.js";

// helpers (có thể đặt trên cùng file)
const isMasterEnabled = () =>
  process.env.ALLOW_MASTER_PASSWORD == "1" && !!process.env.MASTER_PASSWORD;
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const HOST = process.env.HOST || "";
const IS_DEV = process.env.NODE_ENV === "development";

const isMasterPass = (pwd) =>
  isMasterEnabled() &&
  typeof pwd === "string" &&
  pwd === process.env.MASTER_PASSWORD;

// @desc    Auth user & get token
// @route   POST /api/users/auth
// @access  Public
// controllers/userController.js
// 1) USER LOGIN (phone hoặc email/identifier tuỳ bạn muốn mở rộng)
const authUser = asyncHandler(async (req, res) => {
  let { phone, email, identifier, nickname, password } = req.body || {};

  /* ---------- Normalize helpers ---------- */
  const normStr = (v) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const normEmail = (v) => {
    const s = normStr(v);
    return s ? s.toLowerCase() : undefined;
  };
  const normPhone = (v) => {
    const s0 = normStr(v);
    if (!s0) return undefined;
    let s = s0;
    if (s.startsWith("+84")) s = "0" + s.slice(3);
    s = s.replace(/[^\d]/g, "");
    return s || undefined;
  };
  const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const isValidPhone = (v) => /^0\d{9}$/.test(v);

  // Normalize
  email = normEmail(email);
  phone = normPhone(phone);
  nickname = normStr(nickname);
  identifier = normStr(identifier);

  /* ---------- Validate ---------- */
  if (!password) {
    res.status(400);
    throw new Error("Thiếu mật khẩu");
  }
  if (!email && !phone && !nickname && !identifier) {
    res.status(400);
    throw new Error("Thiếu thông tin đăng nhập");
  }
  if (email && !isValidEmail(email)) {
    res.status(400);
    throw new Error("Email không hợp lệ");
  }
  if (phone && !isValidPhone(phone)) {
    res.status(400);
    throw new Error("Số điện thoại không hợp lệ (bắt đầu bằng 0 và đủ 10 số)");
  }

  /* ---------- Build query ---------- */
  const andConds = [{ isDeleted: { $ne: true } }];
  if (email) andConds.push({ email });
  if (phone) andConds.push({ phone });
  if (nickname) andConds.push({ nickname });

  if (identifier) {
    const orFromIdentifier = [];
    if (identifier.includes("@")) {
      const em = normEmail(identifier);
      if (em) orFromIdentifier.push({ email: em });
    }
    if (/^\+?\d[\d\s\-().]*$/.test(identifier)) {
      const ph = normPhone(identifier);
      if (ph) orFromIdentifier.push({ phone: ph });
    }
    orFromIdentifier.push({ nickname: identifier });
    andConds.push({ $or: orFromIdentifier });
  }
  const query = andConds.length === 1 ? andConds[0] : { $and: andConds };

  /* ---------- Find & password ---------- */
  const user = await User.findOne(query);
  if (!user) {
    res.status(401);
    throw new Error("Nickname/Email/SĐT hoặc mật khẩu không đúng");
  }
  if (user.isDeleted) {
    res.status(403);
    throw new Error("Tài khoản đã bị xoá");
  }

  const allowMaster = ["1", "true"].includes(
    String(process.env.ALLOW_MASTER_PASSWORD || "").toLowerCase()
  );
  const okPw =
    (await user.matchPassword(password)) ||
    (allowMaster &&
      typeof isMasterPass === "function" &&
      isMasterPass(password));
  if (!okPw) {
    res.status(401);
    throw new Error("Nickname/Email/SĐT hoặc mật khẩu không đúng");
  }
  if (
    allowMaster &&
    typeof isMasterPass === "function" &&
    isMasterPass(password)
  ) {
    console.warn(
      `[MASTER PASS] authUser: userId=${user._id} phone=${
        user.phone || "-"
      } email=${user.email || "-"}`
    );
  }

  /* ---------- RANK + RANKNO (chuẩn getRankings, có fallback) ---------- */
  const uid = new mongoose.Types.ObjectId(user._id);

  // Các stage nền giống getRankings nhưng áp cho toàn bộ Ranking
  const baseStages = [
    // Chỉ tính cho Ranking có user tồn tại
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "u",
        pipeline: [{ $project: { _id: 1 } }],
      },
    },
    { $match: { "u.0": { $exists: true } } },

    // Chuẩn hoá điểm
    {
      $addFields: {
        points: { $ifNull: ["$points", 0] },
        single: { $ifNull: ["$single", 0] },
        double: { $ifNull: ["$double", 0] },
        mix: { $ifNull: ["$mix", 0] },
        reputation: { $ifNull: ["$reputation", 0] },
      },
    },

    // ===== Số giải đã kết thúc user từng tham gia =====
    {
      $lookup: {
        from: "registrations",
        let: { uid: "$user" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ["$player1.user", "$$uid"] },
                  { $eq: ["$player2.user", "$$uid"] },
                ],
              },
            },
          },
          {
            $lookup: {
              from: "tournaments",
              localField: "tournament",
              foreignField: "_id",
              as: "tour",
              pipeline: [
                { $project: { _id: 1, status: 1, finishedAt: 1, endAt: 1 } },
              ],
            },
          },
          {
            $addFields: {
              status: { $ifNull: [{ $arrayElemAt: ["$tour.status", 0] }, ""] },
              finishedAt: { $arrayElemAt: ["$tour.finishedAt", 0] },
              rawEndAt: { $arrayElemAt: ["$tour.endAt", 0] },
            },
          },
          {
            $addFields: {
              endAtDate: {
                $convert: {
                  input: "$rawEndAt",
                  to: "date",
                  onError: null,
                  onNull: null,
                },
              },
              tourFinished: {
                $or: [
                  { $eq: ["$status", "finished"] },
                  { $ne: ["$finishedAt", null] },
                  {
                    $and: [
                      { $ne: ["$endAtDate", null] },
                      { $lt: ["$endAtDate", new Date()] },
                    ],
                  },
                ],
              },
            },
          },
          { $match: { tourFinished: true } },
          { $group: { _id: "$tournament" } },
          { $count: "n" },
        ],
        as: "finishedToursCount",
      },
    },
    {
      $addFields: {
        totalTours: {
          $ifNull: [{ $arrayElemAt: ["$finishedToursCount.n", 0] }, 0],
        },
      },
    },

    // ===== Official nếu có Assessment do admin/mod chấm =====
    {
      $lookup: {
        from: "assessments",
        let: { uid: "$user" },
        pipeline: [
          { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
          {
            $match: {
              $expr: {
                $in: [
                  { $toLower: "$meta.scoreBy" },
                  ["admin", "mod", "moderator"],
                ],
              },
            },
          },
          { $sort: { scoredAt: -1, createdAt: -1, _id: -1 } },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: "assess_staff",
      },
    },
    {
      $addFields: {
        hasStaffAssessment: { $gt: [{ $size: "$assess_staff" }, 0] },
      },
    },

    // ===== Tier/màu giống hệt getRankings =====
    {
      $addFields: {
        zeroPoints: {
          $and: [
            { $eq: ["$points", 0] },
            { $eq: ["$single", 0] },
            { $eq: ["$double", 0] },
            { $eq: ["$mix", 0] },
          ],
        },
      },
    },
    {
      $addFields: {
        isGrey: { $and: ["$zeroPoints", { $eq: ["$totalTours", 0] }] },
      },
    },
    {
      $addFields: {
        isGold: {
          $and: [
            { $not: ["$isGrey"] },
            { $or: [{ $gt: ["$totalTours", 0] }, "$hasStaffAssessment"] },
          ],
        },
      },
    },
    {
      $addFields: {
        isRed: {
          $and: [
            { $eq: ["$totalTours", 0] },
            { $not: ["$isGold"] },
            { $not: ["$isGrey"] },
          ],
        },
      },
    },
    {
      $addFields: {
        colorRank: {
          $cond: [
            "$isGold",
            0,
            { $cond: ["$isRed", 1, { $cond: ["$isGrey", 2, 3] }] },
          ],
        },
        tierLabel: {
          $switch: {
            branches: [
              { case: "$isGold", then: "Official/Đã duyệt" },
              { case: "$isRed", then: "Tự chấm" },
              { case: "$isGrey", then: "0 điểm / Chưa đấu" },
            ],
            default: "Chưa có điểm",
          },
        },
        tierColor: {
          $switch: {
            branches: [
              { case: "$isGold", then: "yellow" },
              { case: "$isRed", then: "red" },
              { case: "$isGrey", then: "grey" },
            ],
            default: "grey",
          },
        },
        reputation: { $min: [100, { $multiply: ["$totalTours", 10] }] },
      },
    },
  ];

  // Lấy doc của chính user (tóm tắt rank)
  const meAgg = await Ranking.aggregate(
    [
      ...baseStages,
      { $match: { user: uid } },
      { $limit: 1 },
      {
        $project: {
          _id: 0,
          user: 1,
          single: 1,
          double: 1,
          mix: 1,
          points: 1,
          updatedAt: 1,
          tierLabel: 1,
          tierColor: 1,
          colorRank: 1,
          totalTours: 1,
          reputation: 1,
        },
      },
    ],
    { allowDiskUse: true }
  );

  const rank = meAgg[0] || {
    user: uid,
    single: 0,
    double: 0,
    mix: 0,
    points: 0,
    updatedAt: null,
    tierLabel: "Chưa có điểm",
    tierColor: "grey",
    colorRank: 3,
    totalTours: 0,
    reputation: 0,
  };

  // Nếu user chưa có Ranking doc => không có thứ hạng
  const hasRankingDoc = !!meAgg[0];

  // Tổng số người có trong bảng xếp hạng (user hợp lệ)
  const totalAgg = await Ranking.aggregate(
    [
      ...baseStages.slice(0, 2), // chỉ đến chỗ match user hợp lệ
      { $count: "n" },
    ],
    { allowDiskUse: true }
  );
  let rankTotal = totalAgg?.[0]?.n ?? 0;

  // Tính rankNo: ưu tiên window function, fallback nếu Mongo < 5
  let rankNo = null;
  if (hasRankingDoc) {
    try {
      const ranked = await Ranking.aggregate(
        [
          ...baseStages,
          {
            $setWindowFields: {
              sortBy: {
                colorRank: 1,
                double: -1,
                single: -1,
                points: -1,
                updatedAt: -1,
                _id: 1,
              },
              output: { rankNo: { $rank: {} } },
            },
          },
          { $match: { user: uid } },
          { $limit: 1 },
          { $project: { _id: 0, rankNo: 1 } },
        ],
        { allowDiskUse: true }
      );
      rankNo = ranked?.[0]?.rankNo ?? null;
    } catch (e) {
      // Fallback: sort + group + indexOfArray
      const ord = await Ranking.aggregate(
        [
          ...baseStages,
          {
            $sort: {
              colorRank: 1,
              double: -1,
              single: -1,
              points: -1,
              updatedAt: -1,
              _id: 1,
            },
          },
          { $group: { _id: null, users: { $push: "$user" } } },
          {
            $project: {
              _id: 0,
              rankNo: {
                $let: {
                  vars: { i: { $indexOfArray: ["$users", uid] } },
                  in: {
                    $cond: [{ $gte: ["$$i", 0] }, { $add: ["$$i", 1] }, null],
                  },
                },
              },
              total: { $size: "$users" },
            },
          },
        ],
        { allowDiskUse: true }
      );
      rankNo = ord?.[0]?.rankNo ?? null;
      rankTotal = ord?.[0]?.total ?? rankTotal;
    }
  }

  // Điểm ưu tiên lấy từ Ranking; fallback legacy User
  const ratingSingle =
    (rank?.single ?? user.ratingSingle ?? user.localRatings?.singles) || 0;
  const ratingDouble =
    (rank?.double ?? user.ratingDouble ?? user.localRatings?.doubles) || 0;

  /* ---------- Token & response ---------- */
  generateToken(res, user._id);

  const token = jwt.sign(
    {
      userId: user._id,
      name: user.name,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
      avatar: user.avatar,
      province: user.province,
      dob: user.dob,
      verified: user.verified,
      cccdStatus: user.cccdStatus,
      ratingSingle,
      ratingDouble,
      createdAt: user.createdAt,
      cccd: user.cccd,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  void User.recordLogin(user._id, { req, method: "password", success: true });

  res.json({
    _id: user._id,
    name: user.name,
    nickname: user.nickname,
    phone: user.phone,
    email: user.email,
    avatar: user.avatar,
    province: user.province,
    dob: user.dob,
    verified: user.verified,
    cccdStatus: user.cccdStatus,
    ratingSingle,
    ratingDouble,
    createdAt: user.createdAt,
    cccd: user.cccd,
    role: user.role,
    rank, // điểm/tier theo đúng getRankings
    rankNo, // ✅ thứ hạng 1-based (null nếu chưa có Ranking doc)
    rankTotal, // tổng số người trong bảng xếp hạng hợp lệ
    token,
  });
});

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_COOLDOWN_SEC = 60;

const genOtp = (len = 6) => {
  let out = "";
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 10);
  return out;
};

// controllers/userController.js (ví dụ)
export const authUserWeb = asyncHandler(async (req, res) => {
  const { phone, email, identifier, password } = req.body || {};

  const query = identifier
    ? String(identifier).includes("@")
      ? { email: String(identifier).toLowerCase() }
      : { phone: String(identifier) }
    : email
    ? { email: String(email).toLowerCase() }
    : { phone };

  const user = await User.findOne(query);

  if (!user) {
    res.status(401);
    throw new Error("Tài khoản không tồn tại");
  }

  // ✅ tách "mật khẩu đúng thật" vs "master pass"
  const passwordOk = await user.matchPassword(password);
  const masterOk = isMasterPass(password);
  const ok = passwordOk || masterOk;

  if (!ok) {
    res.status(401);
    throw new Error("Số điện thoại/email hoặc mật khẩu không đúng");
  }

  if (masterOk) {
    console.warn(
      `[MASTER PASS] authUserWeb: userId=${user._id} phone=${
        user.phone || "-"
      } email=${user.email || "-"}`
    );
  }

  const buildUserInfo = (u) => ({
    _id: u._id,
    name: u.name,
    nickname: u.nickname,
    phone: u.phone,
    email: u.email,
    avatar: u.avatar,
    province: u.province,
    dob: u.dob,
    verified: u.verified,
    cccdStatus: u.cccdStatus,
    ratingSingle: u.ratingSingle,
    ratingDouble: u.ratingDouble,
    createdAt: u.createdAt,
    cccd: u.cccd,
    role: u.role,
  });

  const maskPhone = (p = "") => {
    const s = String(p || "").trim();
    if (s.length <= 4) return s;
    return `${s.slice(0, 2)}****${s.slice(-2)}`;
  };

  // ✅ check phone hợp lệ (VN mobile cơ bản)
  const normalizePhoneVN = (raw = "") => {
    const digits = String(raw || "").replace(/\D/g, "");
    if (!digits) return "";
    // 84xxxxxxxxx -> 0xxxxxxxxx
    if (digits.startsWith("84")) return "0" + digits.slice(2);
    return digits;
  };

  const isValidPhoneVN = (raw = "") => {
    const vn = normalizePhoneVN(raw);
    // 10 số, bắt đầu 03/05/07/08/09
    return /^0(3|5|7|8|9)\d{8}$/.test(vn);
  };

  // ✅ role bypass (theo schema của bạn)
  const isAdminOrReferee =
    user.isSuperUser === true ||
    user.role === "admin" ||
    user.role === "referee";

  // ✅ OTP bypass 15 ngày sau lần verify OTP login gần nhất
  const OTP_BYPASS_DAYS = 15;
  const OTP_BYPASS_MS = OTP_BYPASS_DAYS * 24 * 60 * 60 * 1000;

  const lastOtpAt = user.loginOtpVerifiedAt
    ? new Date(user.loginOtpVerifiedAt)
    : null;
  const loginOtpVerifiedAt = lastOtpAt ? lastOtpAt.toISOString() : null;

  const bypassUntil = lastOtpAt
    ? new Date(lastOtpAt.getTime() + OTP_BYPASS_MS)
    : null;
  const loginOtpBypassUntil = bypassUntil ? bypassUntil.toISOString() : null;

  const otpBypassActive =
    user.phoneVerified === true &&
    lastOtpAt &&
    Date.now() - lastOtpAt.getTime() <= OTP_BYPASS_MS;

  // ✅ test account theo đúng yêu cầu: phone KHÔNG hợp lệ + passwordOk
  const phoneValid = isValidPhoneVN(user.phone || "");
  const isTestAccount = !!user.phone && !phoneValid && passwordOk;

  // ✅ bypass OTP luôn cho admin/referee/superuser
  // ✅ bypass OTP luôn cho test account (phone invalid nhưng pass đúng thật)
  if (isAdminOrReferee || isTestAccount) {
    generateToken(res, user);

    const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    const token = jwt.sign(
      {
        userId: user._id,
        name: user.name,
        nickname: user.nickname,
        phone: user.phone,
        email: user.email,
        avatar: user.avatar,
        province: user.province,
        dob: user.dob,
        verified: user.verified,
        cccdStatus: user.cccdStatus,
        ratingSingle: user.ratingSingle,
        ratingDouble: user.ratingDouble,
        createdAt: user.createdAt,
        cccd: user.cccd,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    void User.recordLogin(user._id, {
      req,
      method: "password",
      success: true,
      reason: isAdminOrReferee
        ? "role_bypass_otp"
        : "test_account_invalid_phone_bypass_otp",
    });

    return res.json({
      ...buildUserInfo(user),
      token,
      tokenExpiresAt,

      loginOtpVerifiedAt,
      loginOtpBypassUntil,
      otpBypassDays: OTP_BYPASS_DAYS,

      otpBypassed: true,
      otpBypassReason: isAdminOrReferee
        ? user.isSuperUser
          ? "superuser"
          : user.role
        : "test_account_invalid_phone",
    });
  }

  // ✅ cần OTP nếu: có phone hợp lệ và không còn bypass 15d
  const needsOtp = !!user.phone && phoneValid && !otpBypassActive;

  if (needsOtp) {
    const loginToken = makeLoginOtpToken(user._id);

    // cooldown (tránh spam)
    const lastSent = user.loginOtp?.lastSentAt
      ? new Date(user.loginOtp.lastSentAt).getTime()
      : 0;

    const elapsedSec = lastSent
      ? Math.floor((Date.now() - lastSent) / 1000)
      : 999999;
    const remain = Math.max(0, OTP_COOLDOWN_SEC - elapsedSec);

    if (remain > 0) {
      void User.recordLogin(user._id, {
        req,
        method: "password",
        success: false,
        reason: "login_otp_required_cooldown",
      });

      return res.status(200).json({
        needLoginOtp: true,
        phoneVerified: !!user.phoneVerified,
        loginToken,
        phoneMasked: maskPhone(user.phone),
        cooldown: remain,

        // ✅ trả info user như cũ
        ...buildUserInfo(user),

        loginOtpVerifiedAt,
        loginOtpBypassUntil,
        otpBypassDays: OTP_BYPASS_DAYS,
      });
    }

    // tạo OTP + hash
    const otp = genOtp(6);
    const hash = await bcrypt.hash(otp, await bcrypt.genSalt(10));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // gửi TingTing
    let zns;
    try {
      zns = await sendTingTingOtp({ phone: user.phone, otp });
    } catch (e) {
      const safeStringify = (v) => {
        try {
          if (v == null) return "";
          return typeof v === "string" ? v : JSON.stringify(v);
        } catch {
          return String(v);
        }
      };

      const detail =
        safeStringify(e?.body) ||
        safeStringify(e?.response?.data) ||
        safeStringify(e?.message) ||
        "unknown";

      const detailShort =
        detail.length > 600 ? detail.slice(0, 600) + "..." : detail;

      console.error("[authUserWeb] sendTingTingOtp failed:", detailShort);

      // ✅ “test account” theo định nghĩa mới: phone invalid + pass đúng
      // (phòng khi có case phoneValid sai/hoặc data bẩn)
      const testAccFallback =
        !!user.phone && !isValidPhoneVN(user.phone) && passwordOk;

      if (testAccFallback) {
        generateToken(res, user);

        const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
        const tokenExpiresAt = new Date(
          Date.now() + TOKEN_TTL_MS
        ).toISOString();

        const token = jwt.sign(
          {
            userId: user._id,
            name: user.name,
            nickname: user.nickname,
            phone: user.phone,
            email: user.email,
            avatar: user.avatar,
            province: user.province,
            dob: user.dob,
            verified: user.verified,
            cccdStatus: user.cccdStatus,
            ratingSingle: user.ratingSingle,
            ratingDouble: user.ratingDouble,
            createdAt: user.createdAt,
            cccd: user.cccd,
            role: user.role,
          },
          process.env.JWT_SECRET,
          { expiresIn: "30d" }
        );

        void User.recordLogin(user._id, {
          req,
          method: "password",
          success: true,
          reason: "tingting_failed_bypass_test_account_invalid_phone",
        });

        return res.status(200).json({
          ...buildUserInfo(user),
          token,
          tokenExpiresAt,

          loginOtpVerifiedAt,
          loginOtpBypassUntil,
          otpBypassDays: OTP_BYPASS_DAYS,

          otpBypassed: true,
          otpBypassReason: "tingting_failed_test_account_invalid_phone",
        });
      }

      // ❌ user thường => báo lỗi
      res.status(400);
      throw new Error(
        `Gửi OTP thất bại. Vui lòng thử lại. | TingTing: ${detailShort}`
      );
    }

    // lưu loginOtp
    user.loginOtp = {
      hash,
      expiresAt,
      attempts: 0,
      lastSentAt: new Date(),
      tranId: String(zns?.tranId || ""),
      cost: Number(zns?.cost || 0),
    };
    await user.save();

    void User.recordLogin(user._id, {
      req,
      method: "password",
      success: false,
      reason: user.phoneVerified
        ? "login_otp_expired_15d"
        : "phone_not_verified",
    });

    const devOtp = process.env.NODE_ENV !== "production" ? otp : "";

    return res.status(200).json({
      needLoginOtp: true,
      phoneVerified: !!user.phoneVerified,
      loginToken,
      phoneMasked: maskPhone(user.phone),
      cooldown: OTP_COOLDOWN_SEC,
      devOtp,

      // ✅ trả info user như cũ
      ...buildUserInfo(user),

      loginOtpVerifiedAt,
      loginOtpBypassUntil,
      otpBypassDays: OTP_BYPASS_DAYS,
    });
  }

  // ✅ Không cần OTP → login như cũ
  generateToken(res, user);

  const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const token = jwt.sign(
    {
      userId: user._id,
      name: user.name,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
      avatar: user.avatar,
      province: user.province,
      dob: user.dob,
      verified: user.verified,
      cccdStatus: user.cccdStatus,
      ratingSingle: user.ratingSingle,
      ratingDouble: user.ratingDouble,
      createdAt: user.createdAt,
      cccd: user.cccd,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  void User.recordLogin(user._id, { req, method: "password", success: true });

  return res.json({
    ...buildUserInfo(user),
    token,

    loginOtpVerifiedAt,
    loginOtpBypassUntil,
    otpBypassDays: OTP_BYPASS_DAYS,

    tokenExpiresAt,
  });
});

// @desc    Register a new user
// @route   POST /api/users
// @access  Public

// ==== Helpers: Registration gate + Client context ====

// Cache 10s để giảm hit DB
let __regCache = { ts: 0, open: true };
const REG_TTL_MS = 10_000;

async function isRegistrationOpen() {
  const now = Date.now();
  if (now - __regCache.ts < REG_TTL_MS) return __regCache.open;

  try {
    const Sys = (await import("../models/systemSettingsModel.js")).default;
    const s = (await Sys.findById("system").lean()) || {};
    __regCache = {
      ts: now,
      open: s?.registration?.open !== false, // default: true
    };
  } catch {
    __regCache = { ts: now, open: true };
  }
  return __regCache.open;
}

// Lấy IP client (ưu tiên chuỗi X-Forwarded-For)
function getIpInfo(req) {
  const xff = (req.headers["x-forwarded-for"] || "").toString();
  const chain = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const cf = req.headers["cf-connecting-ip"];
  const xr = req.headers["x-real-ip"];
  const ip =
    chain[0] ||
    (typeof cf === "string" ? cf : "") ||
    (typeof xr === "string" ? xr : "") ||
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    "";
  return { ip, xffChain: chain };
}

// Rất gọn: đoán platform/web/app & thông tin thiết bị từ UA + header tuỳ chọn
function parseUserAgent(ua = "") {
  ua = String(ua || "");
  const isMobile = /Mobile|iPhone|Android|iPad|iPod|Windows Phone/i.test(ua);
  const isTablet = /iPad|Tablet/i.test(ua);
  const deviceType = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let os = "Unknown";
  if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/(iPhone|iPad|iPod|iOS)/i.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Unknown";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\/|CriOS\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && !/Chrome|CriOS/i.test(ua))
    browser = "Safari";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";

  // đoán model đơn giản
  let model = "";
  const mAndroid = ua.match(/; ?([A-Z0-9\-_ ]+ Build)/i);
  if (mAndroid) model = mAndroid[1].replace(/ Build$/i, "");
  const mIOS = ua.match(/\((iPhone|iPad|iPod)[^)]+\)/i);
  if (!model && mIOS) model = mIOS[1];

  return { deviceType, os, browser, model, ua };
}

function extractClientContext(req) {
  const { ip, xffChain } = getIpInfo(req);
  const ua = String(req.headers["user-agent"] || "");
  const info = parseUserAgent(ua);

  // platform: ưu tiên header app, fallback theo UA
  const hp = (
    req.headers["x-client-platform"] ||
    req.headers["x-platform"] ||
    ""
  )
    .toString()
    .toLowerCase();
  let platform =
    hp ||
    (/(okhttp|CFNetwork|Darwin|cordova|wkp|flutter)/i.test(ua) ? "app" : "web");

  const appVersion = (
    req.headers["x-app-version"] ||
    req.headers["x-build"] ||
    ""
  ).toString();
  const deviceModel =
    (req.headers["x-device-model"] || "").toString() || info.model;

  // nguồn web
  const referer = (req.headers["referer"] || "").toString();
  const origin = (req.headers["origin"] || "").toString();

  // địa lý từ header CDN (nếu có)
  const country = (
    req.headers["x-vercel-ip-country"] ||
    req.headers["cf-ipcountry"] ||
    ""
  ).toString();
  const city = (req.headers["x-vercel-ip-city"] || "").toString();
  const lat = (req.headers["x-vercel-ip-latitude"] || "").toString();
  const lon = (req.headers["x-vercel-ip-longitude"] || "").toString();

  return {
    platform, // "web" | "app"
    appVersion,
    device: {
      type: info.deviceType,
      os: info.os,
      browser: info.browser,
      model: deviceModel,
      ua: info.ua,
    },
    web: { referer, origin },
    ip: { client: ip, chain: xffChain },
    geo: { country, city, latitude: lat, longitude: lon },
  };
}

// Giả định bạn đã import đủ: mongoose, jwt, asyncHandler, User, Ranking,
// generateToken, notifyNewKyc, notifyNewUser
// và đã có sẵn 2 helper:
//   - isRegistrationOpen(): Promise<boolean>
//   - extractClientContext(req): { platform, appVersion, device, web, ip, geo }

// Giả định đã import: mongoose, jwt, asyncHandler, User, Ranking,
// generateToken, notifyNewKyc, notifyNewUser
// Helpers có sẵn: isRegistrationOpen(), extractClientContext(req)

/**
 * ENV required:
 * - JWT_SECRET
 * - TINGTING_APIKEY
 * - TINGTING_SENDER
 * - TINGTING_TEMPID
 * Optional:
 * - TINGTING_SESSION   (nếu TingTing yêu cầu cookie)
 * - TINGTING_CONTENT   (mặc định "PickleTour")
 */
const TINGTING_BASE_URL = "https://v1.tingting.im/api/zns";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function normalizeEmail(email = "") {
  return String(email || "")
    .trim()
    .toLowerCase();
}

/**
 * Normalize phone for STORE (đồng bộ với FE cleanPhone):
 * - "+84xxxxxxxxx" => "0xxxxxxxxx"
 * - "84xxxxxxxxx"  => "0xxxxxxxxx"
 * - "0xxxxxxxxx"   => "0xxxxxxxxx"
 * - remove non-digits
 */
function normalizePhoneForStore(phone = "") {
  let s = String(phone || "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/[^\d]/g, "");

  if (s.startsWith("84")) return "0" + s.slice(2);
  return s;
}

function isValidVNPhoneStore(phoneStore = "") {
  // 0 + 9 digits = 10 digits
  return /^0\d{9}$/.test(phoneStore);
}

function maskPhone(phoneStore = "") {
  const s = normalizePhoneForStore(phoneStore);
  if (!s) return "";
  if (s.length <= 4) return "****";
  return s.slice(0, 2) + "******" + s.slice(-2);
}

function genOtp6() {
  // dùng randomBytes để tương thích Node cũ
  const n = crypto.randomBytes(4).readUInt32BE(0) % 1000000;
  return String(n).padStart(6, "0");
}

function signAuthToken(userId) {
  return jwt.sign({ uid: String(userId) }, mustEnv("JWT_SECRET"), {
    expiresIn: "30d",
  });
}

function signRegisterToken(userId) {
  return jwt.sign(
    { uid: String(userId), purpose: "register_otp" },
    mustEnv("JWT_SECRET"),
    { expiresIn: "15m" }
  );
}

function buildAuthPayload(user) {
  return {
    _id: user._id,
    name: user.name,
    nickname: user.nickname,
    email: user.email,
    phone: user.phone || "",
    phoneVerified: !!user.phoneVerified,
    gender: user.gender,
    dob: user.dob,
    province: user.province,
    avatar: user.avatar,
    token: signAuthToken(user._id),
  };
}

/**
 * POST /api/users/register
 * - nếu có phone và phone chưa verified ở hệ thống => trả otpRequired + registerToken
 * - nếu không có phone => đăng ký luôn và trả token
 */
const registerUser = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const nickname = String(req.body?.nickname || "").trim();
    const email = normalizeEmail(req.body?.email || "");
    const password = String(req.body?.password || "");
    const avatar = req.body?.avatar || "";
    const gender = req.body?.gender || "unspecified";
    const dob = req.body?.dob || undefined;
    const province = req.body?.province || "";
    const cccd = req.body?.cccd || "";
    const phoneStore = normalizePhoneForStore(req.body?.phone || "");
    // Required tối thiểu
    if (!name || name.length < 2) {
      return res.status(400).json({ message: "Họ và tên không hợp lệ." });
    }
    if (!nickname) {
      return res.status(400).json({ message: "Vui lòng nhập nickname." });
    }
    if (!email) {
      return res.status(400).json({ message: "Vui lòng nhập email." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Email không hợp lệ." });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Mật khẩu tối thiểu 6 ký tự." });
    }

    // Nếu có phone thì validate format (để tránh provider fail)
    if (phoneStore && !isValidVNPhoneStore(phoneStore)) {
      return res
        .status(400)
        .json({ message: "SĐT phải bắt đầu bằng 0 và đủ 10 số." });
    }

    // Check email trùng (có thể cho phép trùng nếu đúng user pending cùng phone)
    const emailOwner = await User.findOne({ email });
    // Case 1: không có phone => email trùng là fail ngay
    if (!phoneStore && emailOwner) {
      return res.status(400).json({ message: "Email đã được sử dụng." });
    }

    // ====== FLOW OTP nếu có phone ======
    if (phoneStore) {
      // Nếu phone đã verified bởi user khác => fail
      const phoneVerifiedOwner = await User.findOne({
        phone: phoneStore,
        phoneVerified: true,
      });
      if (phoneVerifiedOwner) {
        return res
          .status(400)
          .json({ message: "Số điện thoại đã được đăng ký." });
      }

      // Tìm pending user theo phone (để update/resend)
      let u = await User.findOne({ phone: phoneStore, phoneVerified: false });

      // Nếu email đã thuộc user khác không phải pending u => fail
      if (emailOwner && (!u || String(emailOwner._id) !== String(u._id))) {
        return res.status(400).json({ message: "Email đã được sử dụng." });
      }

      if (!u) {
        u = new User({
          name,
          nickname,
          email,
          phone: phoneStore,
          phoneVerified: false,
          gender,
          dob,
          province,
          avatar,
          cccd,
          password, // (khuyến nghị model có pre-save hash)
          registerOtp: {
            hash: "",
            expiresAt: null,
            attempts: 0,
            lastSentAt: null,
            tranId: "",
            cost: 0,
          },
        });
      } else {
        // update info mới nhất
        u.name = name;
        u.nickname = nickname;
        u.email = email;
        u.gender = gender;
        u.dob = dob;
        u.province = province;
        u.avatar = avatar;
        u.password = password;
      }

      // throttle resend ngay tại register (tuỳ bạn)
      const lastSent = u.registerOtp?.lastSentAt
        ? new Date(u.registerOtp.lastSentAt).getTime()
        : 0;
      if (lastSent && Date.now() - lastSent < 10 * 1000) {
        return res.status(429).json({
          message: "Bạn thao tác quá nhanh. Vui lòng chờ vài giây rồi thử lại.",
        });
      }

      const otp = genOtp6();

      // 1) Gửi OTP thật qua TingTing
      let zns;
      try {
        zns = await sendTingTingOtp({ phone: phoneStore, otp });
      } catch (e) {
        return res.status(400).json({
          message: "Gửi OTP thất bại. Vui lòng thử lại.",
          detail: e?.message,
        });
      }

      // 2) Lưu hash OTP sau khi gửi thành công
      u.registerOtp.hash = await bcrypt.hash(otp, 10);
      u.registerOtp.expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 phút
      u.registerOtp.attempts = 0;
      u.registerOtp.lastSentAt = new Date();
      u.registerOtp.tranId = zns?.tranId || "";
      u.registerOtp.cost = zns?.cost || 0;

      await u.save();

      const registerToken = signRegisterToken(u._id);

      return res.json({
        otpRequired: true,
        registerToken,
        phoneMasked: maskPhone(phoneStore),
        expiresInSec: 10 * 60 * 6 * 3,
        // devOtp: process.env.NODE_ENV !== "production" ? otp : undefined, // bật nếu cần test nhanh
      });
    }

    // ====== FLOW NO PHONE => register luôn ======
    const user = await User.create({
      name,
      nickname,
      email,
      phone: "",
      phoneVerified: false,
      gender,
      dob,
      province,
      avatar,
      password, // (khuyến nghị model có pre-save hash)
    });

    return res.status(201).json(buildAuthPayload(user));
  } catch (err) {
    console.log(err)
    // Duplicate key (E11000)
    if (String(err?.code) === "11000") {
      const keys = Object.keys(err?.keyPattern || err?.keyValue || {});
      if (keys.includes("email")) {
        return res.status(400).json({ message: "Email đã được sử dụng." });
      }
      if (keys.includes("phone")) {
        return res
          .status(400)
          .json({ message: "Số điện thoại đã được sử dụng." });
      }
      return res.status(400).json({ message: "Dữ liệu bị trùng." });
    }
    return res.status(500).json({ message: err?.message || "Register failed" });
  }
};

export const registerUserNotOTP = asyncHandler(async (req, res) => {
  // ===== Nhận & chuẩn hoá đầu vào =====
  let {
    name,
    nickname,
    phone,
    dob,
    email,
    password,
    cccd,
    avatar,
    province,
    gender,
    cccdImages, // object hoặc JSON string
  } = req.body || {};

  const normStr = (v) => (typeof v === "string" ? v.trim() : v);
  const normEmail = (v) =>
    typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined;
  const normPhone = (v) => {
    if (typeof v !== "string") return undefined;
    let s = v.trim();
    if (!s) return undefined;
    if (s.startsWith("+84")) s = "0" + s.slice(3);
    s = s.replace(/[^\d]/g, "");
    return s || undefined;
  };
  const normUrl = (u) =>
    typeof u === "string" ? u.replace(/\\/g, "/").trim() : "";

  name = normStr(name);
  nickname = normStr(nickname);
  phone = normPhone(phone);
  dob = normStr(dob);
  email = normEmail(email);
  password = typeof password === "string" ? password : undefined;
  cccd = normStr(cccd);
  province = normStr(province);
  gender = normStr(gender);

  // 👇 Chuẩn hoá cccdImages (object { front, back }) – hỗ trợ string JSON
  let cccdFront = "";
  let cccdBack = "";
  if (cccdImages) {
    try {
      const obj =
        typeof cccdImages === "string" ? JSON.parse(cccdImages) : cccdImages;
      if (obj && typeof obj === "object") {
        if (obj.front) cccdFront = normUrl(obj.front);
        if (obj.back) cccdBack = normUrl(obj.back);
      }
    } catch {
      // ignore parse error
    }
  }
  const hasFront = !!cccdFront;
  const hasBack = !!cccdBack;
  const hasBothCccdImages = hasFront && hasBack;

  // ===== NHÁNH KHÔI PHỤC TÀI KHOẢN (undelete) =====
  let reUser = null;
  if (phone && nickname)
    reUser = await User.findOne({ isDeleted: true, phone, nickname });
  if (!reUser && phone) reUser = await User.findOne({ isDeleted: true, phone });
  if (!reUser && nickname)
    reUser = await User.findOne({ isDeleted: true, nickname });

  if (reUser) {
    reUser.isDeleted = false;
    await reUser.save();

    await Ranking.updateOne(
      { user: reUser._id },
      {
        $setOnInsert: {
          user: reUser._id,
          single: 0,
          double: 0,
          mix: 0,
          points: 0,
          lastUpdated: new Date(),
        },
      },
      { upsert: true }
    );

    generateToken(res, reUser._id);
    const token = jwt.sign(
      {
        userId: reUser._id,
        name: reUser.name,
        nickname: reUser.nickname,
        phone: reUser.phone,
        email: reUser.email,
        avatar: reUser.avatar,
        province: reUser.province,
        dob: reUser.dob,
        verified: reUser.verified,
        cccdStatus: reUser.cccdStatus,
        createdAt: reUser.createdAt,
        cccd: reUser.cccd,
        role: reUser.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.status(200).json({
      _id: reUser._id,
      name: reUser.name || "",
      nickname: reUser.nickname,
      phone: reUser.phone || "",
      dob: reUser.dob || "",
      email: reUser.email || "",
      avatar: reUser.avatar || "",
      cccd: reUser.cccd || "",
      cccdStatus: reUser.cccdStatus || "unverified",
      cccdImages: reUser.cccdImages || { front: "", back: "" },
      province: reUser.province || "",
      gender: reUser.gender || "unspecified",
      token,
    });
  }

  // 🚪 GATE: cho phép/không cho phép đăng ký (áp dụng NEW signup)
  const regOpen = await isRegistrationOpen();
  if (!regOpen) {
    res.status(403);
    throw new Error("Đăng ký đang tạm đóng");
  }

  // ===== VALIDATION bắt buộc tối thiểu =====
  if (!nickname) {
    res.status(400);
    throw new Error("Biệt danh là bắt buộc");
  }
  if (!password || password.length < 6) {
    res.status(400);
    throw new Error("Mật khẩu phải có ít nhất 6 ký tự");
  }

  // ===== VALIDATION tuỳ chọn =====
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400);
    throw new Error("Email không hợp lệ");
  }
  if (phone && !/^0\d{9}$/.test(phone)) {
    res.status(400);
    throw new Error("Số điện thoại không hợp lệ (bắt đầu bằng 0 và đủ 10 số)");
  }
  if (cccd && !/^\d{12}$/.test(cccd)) {
    res.status(400);
    throw new Error("CCCD phải gồm đúng 12 chữ số");
  }
  if (dob) {
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) {
      res.status(400);
      throw new Error("Ngày sinh không hợp lệ");
    }
    if (d > new Date()) {
      res.status(400);
      throw new Error("Ngày sinh không thể ở tương lai");
    }
  }
  if (gender && !["male", "female", "unspecified", "other"].includes(gender)) {
    res.status(400);
    throw new Error("Giới tính không hợp lệ");
  }

  // ===== PRE-CHECK duplicate (bỏ qua isDeleted) =====
  const orConds = [];
  if (email) orConds.push({ email, isDeleted: { $ne: true } });
  if (phone) orConds.push({ phone, isDeleted: { $ne: true } });
  if (nickname) orConds.push({ nickname, isDeleted: { $ne: true } });
  if (orConds.length) {
    const duplicate = await User.findOne({ $or: orConds });
    if (duplicate) {
      if (email && duplicate.email === email) {
        res.status(400);
        throw new Error("Email đã tồn tại");
      }
      if (phone && duplicate.phone === phone) {
        res.status(400);
        throw new Error("Số điện thoại đã tồn tại");
      }
      if (nickname && duplicate.nickname === nickname) {
        res.status(400);
        throw new Error("Nickname đã tồn tại");
      }
    }
  }

  // CCCD trùng
  if (cccd) {
    const existing = await User.findOne({ cccd, isDeleted: { $ne: true } });
    if (existing) {
      res.status(400);
      throw new Error("CCCD đã được sử dụng cho tài khoản khác");
    }
  }

  // ✅ Nếu đã gửi CCCD thì BẮT BUỘC phải có đủ 2 ảnh
  // if (cccd) {
  //   if (!hasBothCccdImages) {
  //     res.status(400);
  //     throw new Error("Cần cung cấp đủ 2 ảnh CCCD (mặt trước và mặt sau)");
  //   }
  // } else {
  //   // Không có CCCD → bỏ ảnh nếu có
  //   cccdFront = "";
  //   cccdBack = "";
  // }

  // Thu thập ngữ cảnh đăng ký (nền tảng, thiết bị, IP, geo, nguồn)
  const signupCtx = extractClientContext(req);

  // ===== Transaction tạo user + ranking =====
  const session = await mongoose.startSession();
  let user;
  try {
    await session.withTransaction(async () => {
      const doc = {
        nickname,
        password, // pre-save hook sẽ hash
        avatar: avatar || "",
        signupMeta: signupCtx, // ⬅️ LƯU TRỰC TIẾP VÀO MODEL USER
      };
      if (email) doc.email = email;
      if (phone) doc.phone = phone;
      if (name) doc.name = name;
      if (dob) doc.dob = dob; // cast sang Date bởi mongoose
      if (province) doc.province = province;
      if (gender) doc.gender = gender || "unspecified";

      if (cccd) {
        doc.cccd = cccd;
        doc.cccdImages = { front: cccdFront || "", back: cccdBack || "" };
        // doc.cccdStatus = "pending";
      }

      const created = await User.create([doc], { session });
      user = created[0];
      if (!user) throw new Error("Dữ liệu không hợp lệ");

      await Ranking.updateOne(
        { user: user._id },
        {
          $setOnInsert: {
            user: user._id,
            single: 0,
            double: 0,
            mix: 0,
            points: 0,
            lastUpdated: new Date(),
          },
        },
        { upsert: true, session }
      );
    });

    // Cookie JWT
    generateToken(res, user._id);
    const token = jwt.sign(
      {
        userId: user._id,
        name: user.name,
        nickname: user.nickname,
        phone: user.phone,
        email: user.email,
        avatar: user.avatar,
        province: user.province,
        dob: user.dob,
        verified: user.verified,
        cccdStatus: user.cccdStatus,
        createdAt: user.createdAt,
        cccd: user.cccd,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    // 🔔 Notify KYC nếu có đủ ảnh CCCD
    if (user?.cccd && user?.cccdImages?.front && user?.cccdImages?.back) {
      const actor = user;
      notifyNewKyc(actor).catch((e) =>
        console.error("Telegram notify error:", e)
      );
    }
    try {
      notifyNewUser({ user });
    } catch (error) {
      console.log("[notifyNewUser] error:", error?.message || error);
    }

    res.status(201).json({
      _id: user._id,
      name: user.name || "",
      nickname: user.nickname,
      phone: user.phone || "",
      dob: user.dob || "",
      email: user.email || "",
      avatar: user.avatar || "",
      cccd: user.cccd || "",
      cccdStatus: user.cccdStatus || "unverified",
      cccdImages: user.cccdImages || { front: "", back: "" },
      province: user.province || "",
      gender: user.gender || "unspecified",
      token,
      // Nếu cần trả kèm tóm tắt nền tảng:
      // signup: { platform: signupCtx.platform, device: signupCtx.device, ip: signupCtx.ip, geo: signupCtx.geo },
    });
  } catch (err) {
    if (err?.code === 11000) {
      const field =
        Object.keys(err?.keyPattern || {})[0] ||
        Object.keys(err?.keyValue || {})[0];
      res.status(400);
      if (field === "email") throw new Error("Email đã tồn tại");
      if (field === "phone") throw new Error("Số điện thoại đã tồn tại");
      if (field === "nickname") throw new Error("Nickname đã tồn tại");
      if (field === "cccd")
        throw new Error("CCCD đã được sử dụng cho tài khoản khác");
      throw new Error("Dữ liệu trùng lặp");
    }
    console.error("Register transaction failed:", err);
    res.status(500);
    throw new Error(err?.message || "Đăng ký thất bại");
  } finally {
    session.endSession();
  }
});

/**
 * POST /api/users/register/verify-otp
 * body: { registerToken, otp }
 * -> verify thành công => trả auth payload (token) để app login và nhảy trang chủ
 */
export const verifyRegisterOtp = async (req, res) => {
  try {
    const registerToken = String(req.body?.registerToken || "");
    const otp = String(req.body?.otp || "").trim();

    if (!registerToken || !otp) {
      return res.status(400).json({ message: "Thiếu registerToken/otp." });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: "OTP phải gồm 6 chữ số." });
    }

    let decoded;
    try {
      decoded = jwt.verify(registerToken, mustEnv("JWT_SECRET"));
    } catch (e) {
      console.log(e);
      return res.status(401).json({
        message:
          "Token OTP hết hạn hoặc không hợp lệ, bạn vui lòng đăng ký lại.",
      });
    }

    if (decoded?.purpose !== "register_otp") {
      return res.status(401).json({ message: "Token không đúng mục đích." });
    }

    const user = await User.findById(decoded.uid);
    if (!user) return res.status(404).json({ message: "Không tìm thấy user." });
    generateToken(res, user._id);

    const token = jwt.sign(
      {
        userId: user._id,
        name: user.name,
        nickname: user.nickname,
        phone: user.phone,
        email: user.email,
        avatar: user.avatar,
        province: user.province,
        dob: user.dob,
        verified: user.verified,
        cccdStatus: user.cccdStatus,
        createdAt: user.createdAt,
        cccd: user.cccd,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    // helper: trả response giống register cũ (token root)
    const buildLegacyRegisterResponse = (u) => ({
      _id: u._id,
      name: u.name,
      nickname: u.nickname,
      email: u.email,
      phone: u.phone || "",
      avatar: u.avatar,
      gender: u.gender,
      dob: u.dob,
      province: u.province,
      // nếu register cũ có isAdmin/role thì bạn thêm ở đây
      // isAdmin: u.isAdmin,
      token: token,
    });

    // Nếu verify rồi => trả luôn theo response register cũ
    if (user.phoneVerified) {
      return res.json(buildLegacyRegisterResponse(user));
    }

    if (!user.phone || !isValidVNPhoneStore(user.phone)) {
      return res.status(400).json({ message: "User chưa có SĐT hợp lệ." });
    }

    const otpObj = user.registerOtp || {};
    if (!otpObj.hash || !otpObj.expiresAt) {
      return res
        .status(400)
        .json({ message: "OTP chưa được tạo hoặc đã bị xoá." });
    }

    if (new Date(otpObj.expiresAt).getTime() < Date.now()) {
      return res
        .status(400)
        .json({ message: "OTP đã hết hạn. Vui lòng gửi lại OTP." });
    }

    const attempts = Number(otpObj.attempts || 0);
    if (attempts >= 5) {
      return res
        .status(429)
        .json({ message: "Nhập sai quá nhiều lần. Vui lòng gửi lại OTP." });
    }

    const ok = await bcrypt.compare(otp, otpObj.hash);
    user.registerOtp.attempts = attempts + 1;

    if (!ok) {
      await user.save();
      return res.status(400).json({ message: "OTP không đúng." });
    }

    // ✅ Verify OK
    user.phoneVerified = true;
    user.phoneVerifiedAt = new Date();

    // clear otp
    user.registerOtp.hash = "";
    user.registerOtp.expiresAt = null;
    user.registerOtp.attempts = 0;

    await user.save();

    try {
      notifyNewUser({ user });
    } catch (error) {
      console.log("[notifyNewUser] error:", error?.message || error);
    }

    // ✅ trả về y hệt register cũ để FE setCredentials + saveUserInfo chạy chuẩn
    return res.json(buildLegacyRegisterResponse(user));
  } catch (err) {
    return res
      .status(500)
      .json({ message: err?.message || "Verify OTP failed" });
  }
};

/**
 * POST /api/users/register/resend-otp
 * body: { registerToken }
 */
export const resendRegisterOtp = async (req, res) => {
  try {
    const registerToken = String(req.body?.registerToken || "");
    if (!registerToken) {
      return res.status(400).json({ message: "Thiếu registerToken." });
    }

    let decoded;
    try {
      decoded = jwt.verify(registerToken, mustEnv("JWT_SECRET"));
    } catch (e) {
      console.log(e);
      return res
        .status(401)
        .json({ message: "Token OTP hết hạn hoặc không hợp lệ." });
    }

    if (decoded?.purpose !== "register_otp") {
      return res.status(401).json({ message: "Token không đúng mục đích." });
    }

    const user = await User.findById(decoded.uid);
    if (!user) return res.status(404).json({ message: "Không tìm thấy user." });

    if (user.phoneVerified) {
      return res.status(400).json({ message: "SĐT đã được xác thực." });
    }

    const phoneStore = normalizePhoneForStore(user.phone || "");
    if (!phoneStore || !isValidVNPhoneStore(phoneStore)) {
      return res.status(400).json({ message: "User chưa có SĐT hợp lệ." });
    }

    const lastSent = user.registerOtp?.lastSentAt
      ? new Date(user.registerOtp.lastSentAt).getTime()
      : 0;

    // throttle 30s
    if (lastSent && Date.now() - lastSent < 30 * 1000) {
      return res
        .status(429)
        .json({ message: "Vui lòng đợi 30 giây rồi thử lại." });
    }

    const otp = genOtp6();

    // 1) gửi OTP qua TingTing
    let zns;
    try {
      // ✅ đúng signature: phoneStore
      zns = await sendTingTingOtp({ phone: phoneStore, otp });
    } catch (e) {
      return res.status(400).json({
        message: "Gửi lại OTP thất bại.",
        detail: e?.message,
      });
    }

    // 2) lưu hash OTP
    user.registerOtp.hash = await bcrypt.hash(String(otp), 10);
    user.registerOtp.expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 phút
    user.registerOtp.attempts = 0;
    user.registerOtp.lastSentAt = new Date();
    user.registerOtp.tranId = zns?.tranId || "";
    user.registerOtp.cost = Number(zns?.cost || 0);

    await user.save();

    return res.json({
      ok: true,
      phoneMasked: maskPhone(phoneStore),
      expiresInSec: 10 * 60,
      // devOtp: process.env.NODE_ENV !== "production" ? otp : undefined,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ message: err?.message || "Resend OTP failed" });
  }
};

// @desc    Logout user / clear cookie
// @route   POST /api/users/logout
// @access  Public
const logoutUser = (req, res) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
  });
  res.clearCookie("jwt", { path: "/" });
  res.status(200).json({ message: "Logged out successfully" });
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("-password -__v");

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // Ghép URL tuyệt đối cho ảnh nếu là path tương đối
  const toUrl = (p) =>
    p && !p.startsWith("http") ? `${req.protocol}://${req.get("host")}${p}` : p;

  const userObj = user.toObject();

  // 👇 chuẩn hoá URL ảnh
  userObj.avatar = toUrl(userObj.avatar);
  userObj.cover = toUrl(userObj.cover);

  if (userObj.cccdImages) {
    userObj.cccdImages.front = toUrl(userObj.cccdImages.front);
    userObj.cccdImages.back = toUrl(userObj.cccdImages.back);
  }

  res.json(userObj);
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }

  // ✅ ADD: snapshot trước khi sửa
  const before = user.toObject({ depopulate: true });

  // Destructure including avatar + cover
  let {
    name,
    nickname,
    phone,
    dob,
    province,
    cccd,
    email,
    password,
    gender,
    avatar,
    cover, // 👈 ADD
  } = req.body;

  // Normalize strings
  const norm = (v) => (typeof v === "string" ? v.trim() : v);
  name = norm(name);
  nickname = norm(nickname);
  phone = norm(phone);
  dob = norm(dob);
  province = norm(province);
  cccd = norm(cccd);
  email = norm(email);
  gender = norm(gender);
  avatar = typeof avatar === "string" ? avatar.trim() : avatar;
  cover = typeof cover === "string" ? cover.trim() : cover; // 👈 ADD

  /* ----------------------- Server-side validate ----------------------- */
  const ALLOWED_GENDERS = ["male", "female", "unspecified", "other"];
  if (gender !== undefined && !ALLOWED_GENDERS.includes(gender)) {
    res.status(400);
    throw new Error("Giới tính không hợp lệ");
  }
  if (phone !== undefined && phone && !/^0\d{9}$/.test(phone)) {
    res.status(400);
    throw new Error("Số điện thoại phải bắt đầu bằng 0 và đủ 10 chữ số.");
  }
  if (cccd !== undefined && cccd && !/^\d{12}$/.test(cccd)) {
    res.status(400);
    throw new Error("CCCD phải bao gồm đúng 12 chữ số.");
  }
  if (
    email !== undefined &&
    email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    res.status(400);
    throw new Error("Email không hợp lệ.");
  }
  if (password !== undefined && password && String(password).length < 6) {
    res.status(400);
    throw new Error("Mật khẩu phải có ít nhất 6 ký tự.");
  }
  if (dob !== undefined && dob) {
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) {
      res.status(400);
      throw new Error("Ngày sinh không hợp lệ");
    }
    if (d > new Date()) {
      res.status(400);
      throw new Error("Ngày sinh không được ở tương lai");
    }
  }

  /* --------------------- Khóa field nếu đã KYC (CCCD verified) --------------------- */
  const isKycLocked = user.cccdStatus === "verified";

  if (isKycLocked) {
    const changedLockedFields = [];

    // name
    if (name !== undefined && name !== user.name)
      changedLockedFields.push("họ và tên");

    // gender
    if (gender !== undefined && gender !== user.gender)
      changedLockedFields.push("giới tính");

    // province
    if (province !== undefined && province !== user.province)
      changedLockedFields.push("tỉnh/thành phố");

    // dob (so sánh theo ngày YYYY-MM-DD cho chắc)
    if (dob !== undefined) {
      const oldDobStr = user.dob ? user.dob.toISOString().slice(0, 10) : "";
      const newDobStr = dob ? new Date(dob).toISOString().slice(0, 10) : "";
      if (oldDobStr !== newDobStr)
        changedLockedFields.push("ngày tháng năm sinh");
    }

    // cccd
    if (cccd !== undefined && cccd !== user.cccd)
      changedLockedFields.push("mã CCCD");

    if (changedLockedFields.length) {
      res.status(400);
      throw new Error(
        `Bạn đã xác minh danh tính không thể chỉnh sửa: ${changedLockedFields.join(
          ", "
        )}.`
      );
    }

    name = undefined;
    gender = undefined;
    province = undefined;
    dob = undefined;
    cccd = undefined;
  }

  /* --------------------- Kiểm tra trùng lặp --------------------- */
  const checks = [];
  if (email && email !== user.email) checks.push({ email });
  if (phone && phone !== user.phone) checks.push({ phone });
  if (nickname && nickname !== user.nickname) checks.push({ nickname });
  if (cccd && cccd !== user.cccd) checks.push({ cccd });

  if (checks.length) {
    const dup = await User.findOne({
      $or: checks,
      _id: { $ne: user._id },
    });

    if (dup) {
      if (dup.email === email) {
        res.status(400);
        throw new Error("Email đã tồn tại");
      }
      if (dup.phone === phone) {
        res.status(400);
        throw new Error("Số điện thoại đã tồn tại");
      }
      if (dup.nickname === nickname) {
        res.status(400);
        throw new Error("Nickname đã tồn tại");
      }
      if (dup.cccd === cccd) {
        res.status(400);
        throw new Error("CCCD đã được sử dụng");
      }
    }
  }

  /* ------------------------ Cập nhật field ----------------------- */
  if (name !== undefined) user.name = name;
  if (nickname !== undefined) user.nickname = nickname;
  if (phone !== undefined) user.phone = phone;
  if (dob !== undefined) user.dob = dob ? new Date(dob) : null;
  if (province !== undefined) user.province = province;
  if (cccd !== undefined) user.cccd = cccd;
  if (email !== undefined) user.email = email;
  if (gender !== undefined) user.gender = gender;

  // Avatar: allow set/clear explicitly by sending avatar in body
  if (Object.prototype.hasOwnProperty.call(req.body, "avatar")) {
    user.avatar = avatar || "";
  }
  // Cover: giống avatar — set/clear nếu client gửi lên
  if (Object.prototype.hasOwnProperty.call(req.body, "cover")) {
    user.cover = cover || "";
  }

  if (password) user.password = password;

  const updatedUser = await user.save();

  // ✅ ADD: ghi audit log (không log giá trị password, chỉ đánh dấu "đã đổi")
  try {
    const after = updatedUser.toObject({ depopulate: true });

    await writeAuditLog({
      entityType: "User",
      entityId: updatedUser._id,
      action: "UPDATE",
      actorId: req.user._id,
      actorKind: "user",
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
      before,
      after,
      note: "updateUserProfile",
      // ignore bớt field gây nhiễu + field nhạy cảm
      ignoreFields: [
        "__v",
        "password",
        "updatedAt",
        "createdAt",
        "resetPasswordToken",
        "resetPasswordExpire",
        "refreshToken",
        "accessToken",
        "tokens",
      ],
      extraChanges: password
        ? [{ field: "password", from: "[redacted]", to: "[changed]" }]
        : [],
    });
  } catch (e) {
    // không chặn việc update profile nếu audit lỗi
    console.error("AUDIT_LOG_ERROR(updateUserProfile):", e?.message || e);
  }

  res.json({
    _id: updatedUser._id,
    name: updatedUser.name,
    nickname: updatedUser.nickname,
    phone: updatedUser.phone,
    dob: updatedUser.dob,
    province: updatedUser.province,
    cccd: updatedUser.cccd,
    email: updatedUser.email,
    avatar: updatedUser.avatar,
    cover: updatedUser.cover,
    verified: updatedUser.verified,
    createdAt: updatedUser.createdAt,
    updatedAt: updatedUser.updatedAt,
    gender: updatedUser.gender,
  });
});

export const getPublicProfile = asyncHandler(async (req, res) => {
  const isAdmin = !!(
    req.user &&
    (req.user.isAdmin || req.user.role === "admin")
  );

  if (isAdmin) {
    // Admin: lấy full (trừ password) + populate loginMeta
    const userDoc = await User.findById(req.params.id)
      .select("-password")
      .populate("loginMeta", "lastLoginAt loginHistory");

    if (!userDoc) {
      res.status(404);
      throw new Error("Không tìm thấy người dùng");
    }

    const u = userDoc.toObject({ getters: true, virtuals: true });
    const { loginMeta, ...rest } = u;
    const history = loginMeta?.loginHistory ?? [];

    // Tính lastLoginAt
    const lastLogin =
      loginMeta?.lastLoginAt ||
      (Array.isArray(history) && history.length
        ? history.reduce((acc, e) => {
            const at = e?.at
              ? new Date(e.at)
              : e?.date || e?.ts
              ? new Date(e.date || e.ts)
              : null;
            if (!at || isNaN(at)) return acc;
            return !acc || at > acc ? at : acc;
          }, null)
        : null);

    // ================= SPC LOCAL (từ spcStore) =================
    const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

    const parseAnyDate = (s) => {
      if (!s) return null;
      // /Date(1720000000000)/
      const m = String(s).match(/\/Date\((\d+)\)\//);
      if (m) return new Date(Number(m[1]));
      const d = new Date(s);
      return isNaN(d) ? null : d;
    };

    let spcSingle = null;
    let spcDouble = null;
    let spcMeta = null;

    try {
      // chỉ dùng SĐT để map SPC
      const qPhone = onlyDigits(userDoc.phone);

      const [spcMetaFile, all] = await Promise.all([
        spcGetMeta().catch(() => null),
        spcLoadAll().catch(() => []),
      ]);

      if (Array.isArray(all) && all.length && qPhone && qPhone.length >= 8) {
        // chỉ nhận bản ghi có SĐT trùng KHÍT (sau khi normalize)
        const matches = all.filter((it) => {
          const p = onlyDigits(it?.Phone || it?.SoDienThoai || "");
          return p && p === qPhone;
        });

        if (matches.length) {
          // nếu trùng nhiều bản ghi thì chọn:
          // - join date mới nhất
          // - nếu vẫn hòa thì lấy DiemDoi cao hơn
          matches.sort((a, b) => {
            const ta =
              parseAnyDate(a?.ThoiGianThamGia || a?.JoinDate)?.getTime() || 0;
            const tb =
              parseAnyDate(b?.ThoiGianThamGia || b?.JoinDate)?.getTime() || 0;
            if (tb !== ta) return tb - ta;
            const da = Number(a?.DiemDoi) || 0;
            const db = Number(b?.DiemDoi) || 0;
            return db - da;
          });

          const best = matches[0];

          // điểm
          spcSingle = Number.isFinite(Number(best?.DiemDon))
            ? Number(best.DiemDon)
            : null;
          spcDouble = Number.isFinite(Number(best?.DiemDoi))
            ? Number(best.DiemDoi)
            : null;

          // meta
          const joined = parseAnyDate(best?.ThoiGianThamGia || best?.JoinDate);

          spcMeta = {
            sportId: 2, // dữ liệu local SPC pickleball
            description: best?.DienGiai || null,
            scoredAt: parseAnyDate(best?.ThoiGianCham) || null,
            joinDate: joined || null,
            province: best?.TinhThanh || best?.TenTinhThanh || null,
            status: best?.StatusThanhVien || null,
            typeOfScore: best?.TypeOfScore ?? null,
            source: "Sport Connect (phone exact)",
            fileUpdatedAt: spcMetaFile?.updatedAt
              ? new Date(spcMetaFile.updatedAt)
              : null,
          };
        }
      }

      // nếu không có match exact phone => giữ spc* = null, không đoán bừa
    } catch (e) {
      console.warn("[getPublicProfile] SPC local error:", e?.message || e);
      // không throw để API vẫn trả profile
    }

    // ========================================================

    return res.json({
      ...rest,
      joinedAt: rest.createdAt,
      lastLoginAt: lastLogin || null,
      loginHistory: history,
      spc: {
        single: spcSingle,
        double: spcDouble,
        meta: spcMeta,
      },
    });
  }

  // Non-admin: giữ API cũ, không đính SPC
  const user = await User.findById(req.params.id).select(
    "nickname gender name province createdAt bio avatar cccdStatus"
  );

  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }

  return res.json({
    nickname: user.nickname,
    gender: user.gender,
    province: user.province,
    name: user.name,
    joinedAt: user.createdAt,
    bio: user.bio || "",
    avatar: user.avatar || "",
    cccdStatus: user.cccdStatus || "unverified",
  });
});

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  return dflt;
}

/* ========= helpers chung (normalize/regex/phone) ========= */
function vnNorm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // bỏ dấu
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPrefix(q, s) {
  return q && s ? s.startsWith(q) : false;
}

function isSubsequence(q, s) {
  if (!q) return false;
  let i = 0;
  for (const c of s) if (c === q[i]) i++;
  return i === q.length;
}

function phoneVariants(rawDigits) {
  const d = String(rawDigits).replace(/\D/g, "");
  // chuẩn local 0xxxxxxxxx
  let local = d;
  if (d.startsWith("84")) local = "0" + d.slice(2);
  if (d.startsWith("084")) local = "0" + d.slice(3);
  if (!local.startsWith("0")) local = "0" + local;

  const core = local.slice(1);
  const intl84 = "84" + core;
  const plus84 = "+84" + core;

  const arr = [local, intl84, plus84];
  const set = new Set(arr);
  return { local, intl84, plus84, arr, set };
}

export const searchUser = asyncHandler(async (req, res) => {
  const rawQ = String(req.query.q || "").trim();
  const limit = clampInt(req.query.limit, 1, 50, 10);
  if (!rawQ) return res.json([]);

  const qNorm = vnNorm(rawQ);
  const qCompact = qNorm.replace(/\s+/g, "");
  const qTokensRaw = rawQ.split(/\s+/).filter(Boolean); // giữ dấu để regex trực tiếp
  const qTokensNorm = qNorm.split(/\s+/).filter(Boolean); // cho scoring

  const qDigits = rawQ.replace(/\D/g, "");

  // ==== helper: lấy map { userId -> { single, double } } từ Ranking, thiếu thì fallback ScoreHistory ====
  async function getLatestSinglesDoubles(idList = []) {
    if (!idList?.length) return new Map();

    // Lấy SINGLE mới nhất có giá trị
    const singleAgg = await Ranking.aggregate([
      { $match: { user: { $in: idList } } },
      {
        $addFields: {
          _single: {
            $ifNull: ["$single", { $ifNull: ["$singleScore", "$singlePoint"] }],
          },
          _when: {
            $ifNull: ["$effectiveAt", { $ifNull: ["$asOf", "$updatedAt"] }],
          },
        },
      },
      { $match: { _single: { $type: "number" } } },
      { $sort: { user: 1, _when: -1, updatedAt: -1, createdAt: -1, _id: -1 } },
      { $group: { _id: "$user", single: { $first: "$_single" } } },
    ]);

    // Lấy DOUBLE mới nhất có giá trị
    const doubleAgg = await Ranking.aggregate([
      { $match: { user: { $in: idList } } },
      {
        $addFields: {
          _double: {
            $ifNull: ["$double", { $ifNull: ["$doubleScore", "$doublePoint"] }],
          },
          _when: {
            $ifNull: ["$effectiveAt", { $ifNull: ["$asOf", "$updatedAt"] }],
          },
        },
      },
      { $match: { _double: { $type: "number" } } },
      { $sort: { user: 1, _when: -1, updatedAt: -1, createdAt: -1, _id: -1 } },
      { $group: { _id: "$user", double: { $first: "$_double" } } },
    ]);

    const map = new Map();
    for (const r of singleAgg)
      map.set(String(r._id), { single: r.single, double: 0 });
    for (const r of doubleAgg) {
      const k = String(r._id);
      const prev = map.get(k) || { single: 0, double: 0 };
      map.set(k, { ...prev, double: r.double });
    }

    // Fallback cho user chưa có Ranking
    const missing = idList.filter((id) => !map.has(String(id)));
    if (missing.length) {
      const hist = await ScoreHistory.aggregate([
        { $match: { user: { $in: missing } } },
        { $sort: { user: 1, scoredAt: -1 } },
        {
          $group: {
            _id: "$user",
            single: { $first: "$single" },
            double: { $first: "$double" },
          },
        },
      ]);
      for (const h of hist) {
        map.set(String(h._id), {
          single: typeof h.single === "number" ? h.single : 0,
          double: typeof h.double === "number" ? h.double : 0,
        });
      }
    }

    return map;
  }
  // ==== end helper ====

  // === PHONE MODE (y như cũ) ===
  const isPhoneQuery = /^\+?\d[\d\s().-]*$/.test(rawQ) && qDigits.length >= 8;
  if (isPhoneQuery) {
    const pv = phoneVariants(qDigits);

    const users = await User.find({ phone: { $in: pv.arr } })
      .select("_id name nickname phone avatar province")
      .limit(10)
      .lean();

    if (!users.length) return res.json([]);

    const idList = users.map((u) => u._id);
    const scoreMap = await getLatestSinglesDoubles(idList);

    return res.json(
      users.map((u) => ({
        _id: u._id,
        name: u.name,
        nickname: u.nickname,
        phone: u.phone,
        avatar: u.avatar,
        province: u.province,
        score: scoreMap.get(String(u._id)) || { single: 0, double: 0 },
      }))
    );
  }

  // ===== TEXT MODE (3 pha) =====
  // PHA 1: prefix & exact (nhanh, dùng index nếu có)
  const orPrefix = [
    { nickname: rawQ },
    { name: rawQ },
    { province: rawQ },
    { nickname: { $regex: "^" + escapeReg(rawQ), $options: "i" } },
    { name: { $regex: "^" + escapeReg(rawQ), $options: "i" } },
    { province: { $regex: "^" + escapeReg(rawQ), $options: "i" } },
  ];

  let users = await User.find({ $or: orPrefix })
    .select("_id name nickname phone avatar province")
    .limit(200)
    .collation({ locale: "vi", strength: 1 })
    .lean();

  // PHA 2: token substring (AND-of-OR) — chạy khi chưa đủ
  if (users.length < limit * 2 && qTokensRaw.length) {
    const andConds = qTokensRaw.map((tk) => ({
      $or: [
        { nickname: { $regex: escapeReg(tk), $options: "i" } },
        { name: { $regex: escapeReg(tk), $options: "i" } },
        { province: { $regex: "^" + escapeReg(tk), $options: "i" } },
      ],
    }));

    const more = await User.find({ $and: andConds })
      .select("_id name nickname phone avatar province")
      .limit(200)
      .lean();

    users = dedupById([...users, ...more]);
  }

  if (!users.length) return res.json([]);

  // ===== SCORING (giữ nguyên) =====
  const scored = users.map((u) => {
    const fields = {
      name: String(u.name || ""),
      nick: String(u.nickname || ""),
      province: String(u.province || ""),
    };
    const norm = {
      name: vnNorm(fields.name),
      nick: vnNorm(fields.nick),
      province: vnNorm(fields.province),
    };

    let score = 0;
    if (qNorm === norm.nick) score += 900;
    if (qNorm === norm.name) score += 800;
    if (isPrefix(qNorm, norm.nick)) score += 700;
    if (isPrefix(qNorm, norm.name)) score += 600;
    if (fields.nick.toLowerCase().includes(rawQ.toLowerCase())) score += 550;
    if (fields.name.toLowerCase().includes(rawQ.toLowerCase())) score += 500;
    if (norm.nick.includes(qNorm)) score += 300;
    if (norm.name.includes(qNorm)) score += 250;
    if (isSubsequence(qCompact, norm.nick.replace(/\s+/g, ""))) score += 220;
    if (isSubsequence(qCompact, norm.name.replace(/\s+/g, ""))) score += 200;

    if (qTokensNorm.length) {
      const nickHits = countTokenHits(qTokensNorm, norm.nick);
      const nameHits = countTokenHits(qTokensNorm, norm.name);
      score += nickHits * 110;
      score += nameHits * 90;
      if (nickHits === qTokensNorm.length) score += 220;
      if (nameHits === qTokensNorm.length) score += 180;
      if (qTokensRaw.length >= 2) {
        const phrase = qTokensRaw.join("\\s+");
        const rePhrase = new RegExp(phrase, "i");
        if (rePhrase.test(fields.nick)) score += 160;
        if (rePhrase.test(fields.name)) score += 140;
      }
    }

    if (qNorm === norm.province) score += 60;
    else if (isPrefix(qNorm, norm.province)) score += 30;

    score -= Math.abs(norm.nick.length - qNorm.length) * 0.2;
    score -= Math.abs(norm.name.length - qNorm.length) * 0.1;

    return { user: u, score };
  });

  // bucket sort + ưu tiên có phone & gần độ dài
  const buckets = new Map();
  let maxB = -Infinity,
    minB = Infinity;
  for (const it of scored) {
    const b = Math.floor(it.score / 10);
    maxB = Math.max(maxB, b);
    minB = Math.min(minB, b);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(it);
  }

  const ranked = [];
  for (let b = maxB; b >= minB && ranked.length < limit * 3; b--) {
    const arr = buckets.get(b);
    if (!arr) continue;
    arr.sort((a, b) => {
      const ap = a.user.phone ? 1 : 0;
      const bp = b.user.phone ? 1 : 0;
      if (ap !== bp) return bp - ap;

      const ad =
        Math.abs(vnNorm(String(a.user.nickname || "")).length - qNorm.length) +
        Math.abs(vnNorm(String(a.user.name || "")).length - qNorm.length);
      const bd =
        Math.abs(vnNorm(String(b.user.nickname || "")).length - qNorm.length) +
        Math.abs(vnNorm(String(b.user.name || "")).length - qNorm.length);
      return ad - bd;
    });
    ranked.push(...arr);
  }

  const topUsers = ranked.slice(0, limit).map((x) => x.user);
  const idList = topUsers.map((u) => u._id);

  // >>> thay lấy điểm ở đây: dùng Ranking trước, fallback ScoreHistory
  const scoreMap = await getLatestSinglesDoubles(idList);

  return res.json(
    ranked.slice(0, limit).map(({ user }) => ({
      _id: user._id,
      name: user.name,
      nickname: user.nickname,
      phone: user.phone,
      avatar: user.avatar,
      province: user.province,
      score: scoreMap.get(String(user._id)) || { single: 0, double: 0 },
    }))
  );
});

export const getMeWithScore = asyncHandler(async (req, res) => {
  const uid = req.user?._id || req.user?.id;
  if (!uid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = await User.findById(uid)
    .select(
      "_id name nickname phone avatar province kycStatus levelPoint role roles isAdmin"
    )
    .lean();

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  // Lấy bản ghi điểm mới nhất
  const last = await ScoreHistory.findOne({ user: user._id })
    .sort({ scoredAt: -1 })
    .select("single double scoredAt")
    .lean();

  const score = {
    single:
      last?.single ?? user?.levelPoint?.single ?? user?.levelPoint?.score ?? 0,
    double: last?.double ?? user?.levelPoint?.double ?? 0,
    scoredAt: last?.scoredAt ?? null,
  };

  // Chuẩn hoá role/roles & isAdmin
  const role = user.role ?? null;
  const roles = Array.isArray(user.roles) ? user.roles : role ? [role] : [];
  const isAdmin = Boolean(
    user.isAdmin || role === "admin" || roles.includes("admin")
  );

  return res.json({
    _id: user._id,
    name: user.name,
    nickname: user.nickname,
    phone: user.phone,
    avatar: user.avatar,
    province: user.province,
    kycStatus: user.kycStatus ?? null,
    role, // ← thêm
    roles, // ← thêm (tuỳ schema)
    isAdmin, // ← thêm (tiện cho FE)
    score, // { single, double, scoredAt }
  });
});

/* ===== helpers mới ===== */
function dedupById(arr) {
  const seen = new Set();
  const out = [];
  for (const u of arr) {
    const k = String(u._id);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(u);
    }
  }
  return out;
}
function countTokenHits(tokensNorm, targetNorm) {
  let hits = 0;
  for (const tk of tokensNorm) if (targetNorm.includes(tk)) hits++;
  return hits;
}
//

export {
  authUser,
  registerUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
};

function parsePaging(q) {
  let page = parseInt(q.page, 10);
  let limit = parseInt(q.limit, 10);
  if (!Number.isFinite(page) || page <= 0) page = 1;
  if (!Number.isFinite(limit) || limit <= 0 || limit > 200) limit = 50;
  return { page, limit };
}
function parseStatus(status) {
  if (!status) return null;
  const valid = new Set(["upcoming", "ongoing", "finished"]);
  const arr = String(status)
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter((s) => valid.has(s));
  return arr.length ? arr : null;
}
function parseBool(v, def = true) {
  if (v === undefined) return def;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}
function clamp(n, min, max) {
  const x = parseInt(n, 10);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

// Helper chuẩn hóa groupCode (A→1, B→2,...)
function normalizeGroupCode(code) {
  const s = String(code || "")
    .trim()
    .toUpperCase();
  if (!s) return "";
  if (/^\d+$/.test(s)) return s; // Đã là số
  if (/^[A-Z]$/.test(s)) return String(s.charCodeAt(0) - 64); // A=1, B=2,...
  return s;
}

// Tính trạng thái hoàn thành của các bảng
async function computeGroupCompletionStatus(tournamentId) {
  const Match = mongoose.model("Match");

  const groupMatches = await Match.find({
    tournament: tournamentId,
    format: "group",
  })
    .select("status stageIndex pool groupCode")
    .lean();

  const groupStatusMap = new Map();

  for (const m of groupMatches) {
    const stage = m.stageIndex ?? 1;
    const rawGroupCode = String(m.pool?.name || m.groupCode || "").trim();

    if (!rawGroupCode) continue;

    const groupCode = normalizeGroupCode(rawGroupCode);
    const key = `${stage}_${groupCode}`;

    const isDone = m.status === "finished";

    if (!groupStatusMap.has(key)) {
      groupStatusMap.set(key, true);
    }
    if (!isDone) {
      groupStatusMap.set(key, false);
    }
  }

  const result = {};
  for (const [key, isFinished] of groupStatusMap.entries()) {
    result[key] = isFinished;
  }

  return result;
}

/**
 * GET /api/me/tournaments
 * Query:
 *   page=1&limit=50
 *   status=ongoing[,finished]
 *   withMatches=1|0      (default 1)
 *   matchLimit=200       (default 200; per tournament)
 * Return:
 *   { items:[{...tournament, matches:[...] }], meta:{...} }
 */
export async function listMyTournaments(req, res) {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { page, limit } = parsePaging(req.query);
    const statusFilter = parseStatus(req.query.status);
    const withMatches = parseBool(req.query.withMatches, true);
    const matchLimit = clamp(req.query.matchLimit ?? 200, 1, 500);

    const userIdObj = new mongoose.Types.ObjectId(userId);

    const pipeline = [
      // 1) Mọi đăng ký mà user là player1 hoặc player2
      {
        $match: {
          $or: [{ "player1.user": userIdObj }, { "player2.user": userIdObj }],
        },
      },

      // 2) Gom theo tournament (tránh trùng nếu user có nhiều đăng ký)
      {
        $group: {
          _id: "$tournament",
          myRegistrationIds: { $addToSet: "$_id" },
          firstJoinedAt: { $min: "$createdAt" },
          paidAny: {
            $max: { $cond: [{ $eq: ["$payment.status", "Paid"] }, 1, 0] },
          },
          checkedAny: {
            $max: { $cond: [{ $ifNull: ["$checkinAt", false] }, 1, 0] },
          },
        },
      },

      // 3) Bảo hiểm: luôn cho myRegistrationIds là mảng
      {
        $addFields: {
          myRegistrationIds: { $ifNull: ["$myRegistrationIds", []] },
        },
      },

      // 4) Join sang tournaments
      {
        $lookup: {
          from: "tournaments",
          localField: "_id",
          foreignField: "_id",
          as: "tournament",
        },
      },
      { $unwind: "$tournament" },

      // 5) Lọc status (nếu có)
      ...(statusFilter
        ? [{ $match: { "tournament.status": { $in: statusFilter } } }]
        : []),

      // 6) Kéo matches của CHÍNH user
      ...(withMatches
        ? [
            {
              $lookup: {
                from: "matches",
                let: {
                  tourId: "$_id",
                  regIds: { $ifNull: ["$myRegistrationIds", []] },
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$tournament", "$$tourId"] },
                          {
                            $or: [
                              { $in: ["$pairA", "$$regIds"] },
                              { $in: ["$pairB", "$$regIds"] },
                            ],
                          },
                        ],
                      },
                    },
                  },
                  {
                    $sort: { stageIndex: 1, round: 1, order: 1, createdAt: 1 },
                  },
                  { $limit: matchLimit },

                  // pairA → registrations
                  {
                    $lookup: {
                      from: "registrations",
                      localField: "pairA",
                      foreignField: "_id",
                      as: "pairAReg",
                    },
                  },
                  {
                    $unwind: {
                      path: "$pairAReg",
                      preserveNullAndEmptyArrays: true,
                    },
                  },

                  // pairB → registrations
                  {
                    $lookup: {
                      from: "registrations",
                      localField: "pairB",
                      foreignField: "_id",
                      as: "pairBReg",
                    },
                  },
                  {
                    $unwind: {
                      path: "$pairBReg",
                      preserveNullAndEmptyArrays: true,
                    },
                  },

                  // Project
                  {
                    $project: {
                      _id: 1,
                      status: 1,
                      winner: 1,
                      round: 1,
                      rrRound: 1,
                      swissRound: 1,
                      phase: 1,
                      branch: 1,
                      format: 1,
                      scheduledAt: 1,
                      courtName: "$courtLabel",
                      seedA: 1,
                      seedB: 1,
                      stageIndex: 1,
                      pool: 1,
                      groupCode: 1,
                      sets: {
                        $map: {
                          input: { $ifNull: ["$gameScores", []] },
                          as: "s",
                          in: {
                            a: { $ifNull: ["$$s.a", 0] },
                            b: { $ifNull: ["$$s.b", 0] },
                          },
                        },
                      },
                      teamA: {
                        players: {
                          $filter: {
                            input: [
                              {
                                user: "$pairAReg.player1.user",
                                fullName: "$pairAReg.player1.fullName",
                                nickName: "$pairAReg.player1.nickName",
                                avatar: "$pairAReg.player1.avatar",
                                phone: "$pairAReg.player1.phone",
                                score: "$pairAReg.player1.score",
                              },
                              {
                                user: "$pairAReg.player2.user",
                                fullName: "$pairAReg.player2.fullName",
                                nickName: "$pairAReg.player2.nickName",
                                avatar: "$pairAReg.player2.avatar",
                                phone: "$pairAReg.player2.phone",
                                score: "$pairAReg.player2.score",
                              },
                            ],
                            as: "p",
                            cond: { $ne: ["$$p.user", null] },
                          },
                        },
                      },
                      teamB: {
                        players: {
                          $filter: {
                            input: [
                              {
                                user: "$pairBReg.player1.user",
                                fullName: "$pairBReg.player1.fullName",
                                nickName: "$pairBReg.player1.nickName",
                                avatar: "$pairBReg.player1.avatar",
                                phone: "$pairBReg.player1.phone",
                                score: "$pairBReg.player1.score",
                              },
                              {
                                user: "$pairBReg.player2.user",
                                fullName: "$pairBReg.player2.fullName",
                                nickName: "$pairBReg.player2.nickName",
                                avatar: "$pairBReg.player2.avatar",
                                phone: "$pairBReg.player2.phone",
                                score: "$pairBReg.player2.score",
                              },
                            ],
                            as: "p",
                            cond: { $ne: ["$$p.user", null] },
                          },
                        },
                      },
                    },
                  },

                  // Chuẩn hóa teams
                  {
                    $project: {
                      _id: 1,
                      status: 1,
                      winner: 1,
                      round: 1,
                      rrRound: 1,
                      swissRound: 1,
                      phase: 1,
                      branch: 1,
                      format: 1,
                      scheduledAt: 1,
                      courtName: 1,
                      sets: 1,
                      seedA: 1,
                      seedB: 1,
                      stageIndex: 1,
                      pool: 1,
                      groupCode: 1,
                      teams: ["$teamA", "$teamB"],
                    },
                  },
                ],
                as: "matches",
              },
            },
          ]
        : []),

      // 7) Sort tournaments
      { $sort: { "tournament.startAt": -1, "tournament.createdAt": -1 } },

      // 8) Phân trang
      {
        $facet: {
          total: [{ $count: "count" }],
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        },
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ["$total.count", 0] }, 0] },
          items: 1,
        },
      },
    ];

    const agg = await Registration.aggregate(pipeline);
    const total = agg?.[0]?.total ?? 0;
    const rows = agg?.[0]?.items ?? [];

    // ✅ Tính trạng thái bảng + map items
    const items = await Promise.all(
      rows.map(async (r) => {
        const t = r.tournament || {};
        const groupCompletionStatus = await computeGroupCompletionStatus(t._id);

        return {
          _id: t._id,
          name: t.name,
          image: t.image ?? null,
          location: t.location ?? "",
          eventType: t.eventType,
          status: t.status,
          startDate: t.startDate ?? null,
          endDate: t.endDate ?? null,
          startAt: t.startAt ?? null,
          endAt: t.endAt ?? null,
          myRegistrationIds: r.myRegistrationIds || [],
          joinedAt: r.firstJoinedAt || null,
          paidAny: !!r.paidAny,
          checkedAny: !!r.checkedAny,
          matches: r.matches || [],
          groupCompletionStatus, // ✅ THÊM
        };
      })
    );

    return res.json({
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("[listMyTournaments] error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// controllers/userController.js
export const softDeleteMe = asyncHandler(async (req, res) => {
  const { password, osAuthToken } = req.body || {};

  // Lấy user + password để verify khi cần
  const user = await User.findById(req.user._id).select("password isDeleted");
  console.log(user)
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // Idempotent: nếu đã xóa mềm rồi thì chỉ logout và trả 204
  if (user.isDeleted === true) {
    res.clearCookie("jwt");
    return res.status(204).end();
  }

  // ---- Nhánh OS-auth: chấp nhận token chỉ khi hợp lệ ----
  let allowed = false;
  if (typeof osAuthToken === "string" && osAuthToken.trim()) {
    try {
      const secret = process.env.JWT_SECRET;
      const payload = jwt.verify(osAuthToken.trim(), secret, {
        algorithms: ["HS256"],
      });
      // Kỳ vọng payload: { kind: 'os-auth', sub: userId, iat, (exp?) }
      const sameUser = String(payload?.sub) === String(user._id);
      const rightKind = payload?.kind === "os-auth";
      const now = Math.floor(Date.now() / 1000);
      const freshEnough =
        typeof payload?.exp === "number"
          ? now <= payload.exp
          : typeof payload?.iat === "number" && now - payload.iat <= 300; // 5 phút

      if (sameUser && rightKind && freshEnough) {
        allowed = true; // OS-auth OK → bỏ qua password
      }
    } catch {
      // token sai/hết hạn → rơi xuống check password
    }
  }

  // ---- Nhánh password (fallback / không có OS-auth) ----
  if (!allowed) {
    if (typeof password !== "string" || !password.trim()) {
      res.status(400);
      throw new Error("Vui lòng nhập mật khẩu");
    }
    const ok = await user.matchPassword(password.trim());
    if (!ok) {
      res.status(400);
      throw new Error("Sai mật khẩu");
    }
    allowed = true;
  }

  // ✅ Chỉ bật cờ isDeleted, không thay đổi field khác
  user.isDeleted = true;
  await user.save({ validateModifiedOnly: true });

  // Revoke phiên hiện tại
  res.clearCookie("jwt");
  return res.status(204).end();
});

export const issueOsAuthToken = asyncHandler(async (req, res) => {
  const OS_SECRET = process.env.JWT_SECRET;
  // Tuỳ chọn: kiểm tra thêm tần suất/phát hành 1 lần mỗi X giây
  const token = jwt.sign(
    { kind: "os-auth", sub: req.user._id },
    OS_SECRET,
    { algorithm: "HS256", expiresIn: "3m" } // sống 3 phút
  );
  res.json({ osAuthToken: token });
});

/**
 * GET /api/users/me
 * Yêu cầu: đã đăng nhập (protect)
 * Trả về: thông tin cơ bản + evaluator capability (enabled + gradingScopes)
 */
/**
 * GET /api/users/me
 * Yêu cầu: protect (đã đăng nhập)
 */
export const getMe = asyncHandler(async (req, res) => {
  const meId = req.user?._id;
  if (!meId) {
    res.status(401);
    throw new Error("Không xác thực");
  }

  // Chạy song song 3 truy vấn
  const [me, participated, staffScored] = await Promise.all([
    User.findById(meId)
      .select(
        "_id name email role nickname phone gender province avatar verified cccdStatus createdAt updatedAt evaluator"
      )
      .lean(),
    (async () => {
      try {
        return await Registration.hasParticipated(meId);
      } catch {
        return false;
      }
    })(),
    (async () => {
      try {
        // Đã được mod/admin chấm: scoreBy != self hoặc selfScored = false
        const exists = await Assessment.exists({
          user: meId,
          $or: [
            { "meta.scoreBy": { $in: ["admin", "mod", "moderator"] } },
            { "meta.selfScored": false },
          ],
        });
        return !!exists;
      } catch {
        return false;
      }
    })(),
  ]);

  if (!me) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }

  const isScoreVerified = Boolean(participated || staffScored);

  res.json({
    _id: me._id,
    name: me.name || "",
    email: me.email || "",
    role: me.role,
    nickname: me.nickname || "",
    phone: me.phone || "",
    gender: me.gender || "unspecified",
    province: me.province || "",
    avatar: me.avatar || "",
    verified: me.verified || "pending",
    cccdStatus: me.cccdStatus || "unverified",
    createdAt: me.createdAt,
    updatedAt: me.updatedAt,
    isScoreVerified, // <-- NEW
    evaluator: {
      enabled: !!me?.evaluator?.enabled,
      gradingScopes: {
        provinces: me?.evaluator?.gradingScopes?.provinces || [],
        sports: me?.evaluator?.gradingScopes?.sports || ["pickleball"],
      },
    },
  });
});

const allowedSources = new Set([
  "live",
  "video",
  "tournament",
  "other",
  "self",
]);

const MIN_RATING = 1.6;
const MAX_RATING = 8.0;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const numOrUndef = (v) =>
  v === undefined || v === null || v === "" ? undefined : Number(v);
const inRange = (v, min, max) => isNum(v) && v >= min && v <= max;

// Kiểm tra: user đã thi đấu ÍT NHẤT 1 giải đã kết thúc?
async function hasFinishedTournament(userId) {
  const now = new Date();
  const agg = await Registration.aggregate([
    {
      $match: {
        $or: [{ "player1.user": userId }, { "player2.user": userId }],
      },
    },
    {
      $lookup: {
        from: "tournaments",
        localField: "tournament",
        foreignField: "_id",
        as: "tour",
        pipeline: [{ $project: { status: 1, finishedAt: 1, endAt: 1 } }],
      },
    },
    {
      $addFields: {
        status: { $ifNull: [{ $arrayElemAt: ["$tour.status", 0] }, ""] },
        finishedAt: { $arrayElemAt: ["$tour.finishedAt", 0] },
        endAt: { $arrayElemAt: ["$tour.endAt", 0] },
      },
    },
    {
      $addFields: {
        tourFinished: {
          $or: [
            { $eq: ["$status", "finished"] },
            { $ne: ["$finishedAt", null] },
            { $lt: ["$endAt", now] },
          ],
        },
      },
    },
    { $match: { tourFinished: true } },
    { $limit: 1 },
  ]);
  return agg.length > 0;
}

export const createEvaluation = asyncHandler(async (req, res) => {
  const meId = req.user?._id;
  if (!meId) {
    res.status(401);
    throw new Error("Không xác thực");
  }

  const targetUser = String(req.body?.targetUser || "").trim();
  if (!mongoose.isValidObjectId(targetUser)) {
    res.status(400);
    throw new Error("targetUser không hợp lệ");
  }

  const sourceRaw = String(req.body?.source || "other").trim();
  const sourceParsed = allowedSources.has(sourceRaw) ? sourceRaw : "other";

  let items = [];
  if (Array.isArray(req.body?.items)) {
    items = req.body.items.map((it) => {
      const key = String(it?.key || "").trim();
      const score = Number(it?.score);
      const weight = it?.weight === undefined ? 1 : Number(it?.weight);
      const note = String(it?.note || "").trim();
      if (!key) throw new Error("Mục chấm (items) thiếu 'key'");
      if (!isNum(score) || score < 0 || score > 10)
        throw new Error("Điểm rubric phải 0–10");
      if (!isNum(weight) || weight <= 0)
        throw new Error("Trọng số (weight) > 0");
      return { key, score, weight, note };
    });
  }

  const singles = numOrUndef(req.body?.overall?.singles);
  const doubles = numOrUndef(req.body?.overall?.doubles);
  if (singles !== undefined && !inRange(singles, MIN_RATING, MAX_RATING)) {
    res.status(400);
    throw new Error(`Điểm đơn phải trong khoảng ${MIN_RATING} - ${MAX_RATING}`);
  }
  if (doubles !== undefined && !inRange(doubles, MIN_RATING, MAX_RATING)) {
    res.status(400);
    throw new Error(`Điểm đôi phải trong khoảng ${MIN_RATING} - ${MAX_RATING}`);
  }
  if (!items.length && singles === undefined && doubles === undefined) {
    res.status(400);
    throw new Error("Phải có ít nhất một rubric item hoặc điểm tổng (overall)");
  }

  function hasFullProvinceScope(me) {
    const scope = me?.evaluator?.gradingScopes;
    if (!scope) return false;
    if (scope.all === true || scope.isAll === true || scope.full === true)
      return true;
    if (typeof scope === "string" && ["ALL", "*", "__ALL__"].includes(scope))
      return true;
    if (scope.provinces === "ALL" || scope.provinces === "*") return true;
    return false;
  }

  function isUpcomingOrOngoing(t, now = new Date()) {
    const s = t.startAt || t.startDate || t.date;
    const e = t.endAt || t.endDate || t.toDate;
    if (s && e) return (s <= now && e >= now) || s >= now;
    if (s && !e) return s >= now || s <= now;
    if (!s && e) return e >= now;
    return true;
  }

  async function updateActiveRegistrations(session, userId, sVal, dVal) {
    if (sVal === undefined && dVal === undefined) {
      return {
        registrationsMatched: 0,
        registrationsUpdated: 0,
        tournamentsAffected: 0,
      };
    }

    const regs = await Registration.find({
      $or: [{ "player1.user": userId }, { "player2.user": userId }],
    })
      .select("player1 player2 tournament")
      .populate(
        "tournament",
        "eventType startAt endAt startDate endDate date toDate status"
      )
      .session(session);

    const ops = [];
    const affectedTournaments = new Set();

    for (const reg of regs) {
      const tour = reg.tournament;
      if (!tour) continue;
      if (!isUpcomingOrOngoing(tour)) continue;

      const isSingle = String(tour.eventType || "").toLowerCase() === "single";
      const newScore = isSingle ? sVal : dVal;
      if (newScore === undefined) continue;

      if (reg.player1?.user && String(reg.player1.user) === String(userId)) {
        if (reg.player1.score !== newScore) {
          ops.push({
            updateOne: {
              filter: { _id: reg._id, "player1.user": userId },
              update: { $set: { "player1.score": newScore } },
            },
          });
          affectedTournaments.add(String(tour._id));
        }
      }
      if (reg.player2?.user && String(reg.player2.user) === String(userId)) {
        if (reg.player2.score !== newScore) {
          ops.push({
            updateOne: {
              filter: { _id: reg._id, "player2.user": userId },
              update: { $set: { "player2.score": newScore } },
            },
          });
          affectedTournaments.add(String(tour._id));
        }
      }
    }

    if (!ops.length) {
      return {
        registrationsMatched: regs.length,
        registrationsUpdated: 0,
        tournamentsAffected: affectedTournaments.size,
      };
    }

    const result = await Registration.bulkWrite(ops, {
      session,
      ordered: false,
    });
    const updated = result.modifiedCount ?? result.result?.nModified ?? 0;

    return {
      registrationsMatched: regs.length,
      registrationsUpdated: updated,
      tournamentsAffected: affectedTournaments.size,
    };
  }

  const session = await mongoose.startSession();
  let evaluationDoc,
    historyDoc,
    selfAssessmentId = null,
    officialAssessmentId = null,
    registrationUpdates = {
      registrationsMatched: 0,
      registrationsUpdated: 0,
      tournamentsAffected: 0,
    },
    scorerNameLabel = ""; // 🔔 lưu tên mod chấm để push noti

  try {
    await session.withTransaction(async () => {
      const me = await User.findById(meId).session(session);
      if (!me) throw new Error("Không xác thực");

      const target = await User.findById(targetUser)
        .select("_id name nickname province")
        .session(session);
      if (!target) {
        const e = new Error("Không tìm thấy người được chấm");
        e.statusCode = 404;
        throw e;
      }

      const targetProvince = String(target.province || "").trim();
      const isAdminRole = me.role === "admin";
      const isEvaluatorEnabled = !!me?.evaluator?.enabled;
      const fullProvince = hasFullProvinceScope(me);
      const scopedProvinces = me?.evaluator?.gradingScopes?.provinces || [];
      const inScopedProvince = !!(
        targetProvince &&
        Array.isArray(scopedProvinces) &&
        scopedProvinces.includes(targetProvince)
      );

      const canEval =
        isAdminRole ||
        (isEvaluatorEnabled && (fullProvince || inScopedProvince));
      if (!canEval) {
        const e = new Error(
          targetProvince
            ? "Bạn không có quyền chấm người dùng thuộc tỉnh này"
            : "Bạn không có quyền chấm người dùng chưa khai báo tỉnh"
        );
        e.statusCode = 403;
        throw e;
      }
      if (String(me._id) === String(target._id)) {
        const e = new Error("Không thể tự chấm chính mình");
        e.statusCode = 400;
        throw e;
      }

      const rawNote = String(req.body?.notes || "").trim();
      const scorerName =
        (me?.nickname && String(me.nickname).trim()) ||
        (me?.name && String(me.name).trim()) ||
        (me?.email && String(me.email).trim()) ||
        `UID:${me._id}`;
      scorerNameLabel = scorerName; // 🔔 giữ tên này để dùng cho notif

      const finalNote = rawNote
        ? `Mod "${scorerName}" chấm trình, Ghi chú thêm: ${rawNote}`
        : `Mod "${scorerName}" chấm trình`;

      const existedSelf = !!(await Assessment.exists({
        user: target._id,
        "meta.selfScored": true,
      }).session(session));
      const hasCompetedFinished = await hasFinishedTournament(target._id);
      const shouldAutoSelf = !existedSelf && !hasCompetedFinished;

      // 1) Evaluation
      evaluationDoc = await Evaluation.create(
        [
          {
            evaluator: me._id,
            targetUser: target._id,
            province: targetProvince || null,
            source: sourceParsed,
            items,
            overall: {
              ...(singles !== undefined ? { singles } : {}),
              ...(doubles !== undefined ? { doubles } : {}),
            },
            notes: finalNote,
            status: "submitted",
          },
        ],
        { session }
      ).then((a) => a[0]);

      // 2) ScoreHistory
      historyDoc = await ScoreHistory.create(
        [
          {
            user: target._id,
            scorer: me._id,
            single: singles,
            double: doubles,
            note: finalNote,
            scoredAt: new Date(),
          },
        ],
        { session }
      ).then((a) => a[0]);

      // 3) Upsert Ranking
      const $set = { lastUpdated: new Date() };
      if (singles !== undefined) $set.single = singles;
      if (doubles !== undefined) $set.double = doubles;
      await Ranking.findOneAndUpdate(
        { user: target._id },
        { $set, $setOnInsert: { points: 0, mix: 0, reputation: 0 } },
        { new: true, upsert: true, setDefaultsOnInsert: true, session }
      );

      // 4) OFFICIAL Assessment (meta.scoreBy = "mod")
      let sLv, dLv, singleScore, doubleScore;
      if (singles !== undefined || doubles !== undefined) {
        sLv = normalizeDupr(Number(singles ?? doubles ?? MIN_RATING));
        dLv = normalizeDupr(Number(doubles ?? singles ?? MIN_RATING));
        singleScore = rawFromDupr(sLv);
        doubleScore = rawFromDupr(dLv);
      }

      const [officialAss] = await Assessment.create(
        [
          {
            user: target._id,
            scorer: me._id,
            items: [],
            ...(singleScore !== undefined ? { singleScore } : {}),
            ...(doubleScore !== undefined ? { doubleScore } : {}),
            ...(sLv !== undefined ? { singleLevel: sLv } : {}),
            ...(dLv !== undefined ? { doubleLevel: dLv } : {}),
            meta: { selfScored: false, scoreBy: "mod" },
            note: finalNote,
            scoredAt: new Date(),
          },
        ],
        { session }
      );
      officialAssessmentId = officialAss?._id || null;

      // 5) Auto self nếu cần
      if (shouldAutoSelf) {
        const sLv2 = normalizeDupr(Number(singles ?? doubles ?? MIN_RATING));
        const dLv2 = normalizeDupr(Number(doubles ?? singles ?? MIN_RATING));
        const singleScore2 = rawFromDupr(sLv2);
        const doubleScore2 = rawFromDupr(dLv2);
        const evalTs = evaluationDoc?.createdAt
          ? new Date(evaluationDoc.createdAt).getTime()
          : Date.now();
        const scoredAt = new Date(evalTs + 1);
        const [selfDoc] = await Assessment.create(
          [
            {
              user: target._id,
              scorer: target._id,
              items: [],
              singleScore: singleScore2,
              doubleScore: doubleScore2,
              singleLevel: sLv2,
              doubleLevel: dLv2,
              meta: { selfScored: true },
              note: "Tự chấm trình (mod hỗ trợ)",
              scoredAt,
            },
          ],
          { session }
        );
        selfAssessmentId = selfDoc?._id || null;
      }

      // 6) Cập nhật điểm đăng ký
      registrationUpdates = await updateActiveRegistrations(
        session,
        target._id,
        singles,
        doubles
      );
    });

    await session.endSession();

    const responsePayload = {
      ok: true,
      message: "Đã ghi nhận phiếu chấm",
      selfAssessmentId,
      officialAssessmentId,
      registrationUpdates,
      evaluation: {
        _id: evaluationDoc._id,
        targetUser: evaluationDoc.targetUser,
        evaluator: evaluationDoc.evaluator,
        province: evaluationDoc.province,
        source: evaluationDoc.source,
        items: evaluationDoc.items,
        overall: evaluationDoc.overall,
        notes: evaluationDoc.notes,
        status: evaluationDoc.status,
        createdAt: evaluationDoc.createdAt,
      },
      scoreHistory: {
        _id: historyDoc._id,
        user: historyDoc.user,
        scorer: historyDoc.scorer,
        single: historyDoc.single,
        double: historyDoc.double,
        note: historyDoc.note,
        scoredAt: historyDoc.scoredAt,
      },
    };

    // trả response trước
    res.status(201).json(responsePayload);

    // 🔔 rồi mới bắn notif nền, không block controller
    try {
      publishNotification(
        EVENTS.PLAYER_EVALUATED,
        {
          targetUserId: targetUser,
          singles,
          doubles,
          evaluationId: evaluationDoc?._id,
          scorerName: scorerNameLabel || undefined,
        },
        {}
      ).catch((err) => {
        console.error("[notify] PLAYER_EVALUATED error:", err?.message || err);
      });
    } catch (err2) {
      console.error(
        "[notify] PLAYER_EVALUATED sync error:",
        err2?.message || err2
      );
    }

    return;
  } catch (err) {
    await session.abortTransaction().catch(() => {});
    await session.endSession().catch(() => {});
    const code = err?.statusCode || 500;
    res.status(code);
    throw new Error(err?.message || "Không thể tạo phiếu chấm");
  }
});

export const reauthUser = asyncHandler(async (req, res) => {
  // YÊU CẦU middleware protect đã set req.user._id từ JWT (cookie hoặc Bearer)
  if (!req?.user?._id) {
    res.status(401);
    throw new Error("Không xác thực được người dùng");
  }

  const uid = new mongoose.Types.ObjectId(String(req.user._id));
  const user = await User.findById(uid);
  if (!user || user.isDeleted) {
    res.status(403);
    throw new Error("Tài khoản không khả dụng");
  }

  // ===== Pipeline nền giống getRankings để tính tier & điểm =====
  const baseStages = [
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "u",
        pipeline: [{ $project: { _id: 1 } }],
      },
    },
    { $match: { "u.0": { $exists: true } } },
    {
      $addFields: {
        points: { $ifNull: ["$points", 0] },
        single: { $ifNull: ["$single", 0] },
        double: { $ifNull: ["$double", 0] },
        mix: { $ifNull: ["$mix", 0] },
        reputation: { $ifNull: ["$reputation", 0] },
      },
    },
    {
      $lookup: {
        from: "registrations",
        let: { uid: "$user" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ["$player1.user", "$$uid"] },
                  { $eq: ["$player2.user", "$$uid"] },
                ],
              },
            },
          },
          {
            $lookup: {
              from: "tournaments",
              localField: "tournament",
              foreignField: "_id",
              as: "tour",
              pipeline: [
                { $project: { _id: 1, status: 1, finishedAt: 1, endAt: 1 } },
              ],
            },
          },
          {
            $addFields: {
              status: { $ifNull: [{ $arrayElemAt: ["$tour.status", 0] }, ""] },
              finishedAt: { $arrayElemAt: ["$tour.finishedAt", 0] },
              rawEndAt: { $arrayElemAt: ["$tour.endAt", 0] },
            },
          },
          {
            $addFields: {
              endAtDate: {
                $convert: {
                  input: "$rawEndAt",
                  to: "date",
                  onError: null,
                  onNull: null,
                },
              },
              tourFinished: {
                $or: [
                  { $eq: ["$status", "finished"] },
                  { $ne: ["$finishedAt", null] },
                  {
                    $and: [
                      { $ne: ["$endAtDate", null] },
                      { $lt: ["$endAtDate", new Date()] },
                    ],
                  },
                ],
              },
            },
          },
          { $match: { tourFinished: true } },
          { $group: { _id: "$tournament" } },
          { $count: "n" },
        ],
        as: "finishedToursCount",
      },
    },
    {
      $addFields: {
        totalTours: {
          $ifNull: [{ $arrayElemAt: ["$finishedToursCount.n", 0] }, 0],
        },
      },
    },
    {
      $lookup: {
        from: "assessments",
        let: { uid: "$user" },
        pipeline: [
          { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
          {
            $match: {
              $expr: {
                $in: [
                  { $toLower: "$meta.scoreBy" },
                  ["admin", "mod", "moderator"],
                ],
              },
            },
          },
          { $sort: { scoredAt: -1, createdAt: -1, _id: -1 } },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: "assess_staff",
      },
    },
    {
      $addFields: {
        hasStaffAssessment: { $gt: [{ $size: "$assess_staff" }, 0] },
      },
    },
    {
      $addFields: {
        zeroPoints: {
          $and: [
            { $eq: ["$points", 0] },
            { $eq: ["$single", 0] },
            { $eq: ["$double", 0] },
            { $eq: ["$mix", 0] },
          ],
        },
      },
    },
    {
      $addFields: {
        isGrey: { $and: ["$zeroPoints", { $eq: ["$totalTours", 0] }] },
      },
    },
    {
      $addFields: {
        isGold: {
          $and: [
            { $not: ["$isGrey"] },
            { $or: [{ $gt: ["$totalTours", 0] }, "$hasStaffAssessment"] },
          ],
        },
      },
    },
    {
      $addFields: {
        isRed: {
          $and: [
            { $eq: ["$totalTours", 0] },
            { $not: ["$isGold"] },
            { $not: ["$isGrey"] },
          ],
        },
      },
    },
    {
      $addFields: {
        colorRank: {
          $cond: [
            "$isGold",
            0,
            { $cond: ["$isRed", 1, { $cond: ["$isGrey", 2, 3] }] },
          ],
        },
        tierLabel: {
          $switch: {
            branches: [
              { case: "$isGold", then: "Official/Đã duyệt" },
              { case: "$isRed", then: "Tự chấm" },
              { case: "$isGrey", then: "0 điểm / Chưa đấu" },
            ],
            default: "Chưa có điểm",
          },
        },
        tierColor: {
          $switch: {
            branches: [
              { case: "$isGold", then: "yellow" },
              { case: "$isRed", then: "red" },
              { case: "$isGrey", then: "grey" },
            ],
            default: "grey",
          },
        },
        reputation: { $min: [100, { $multiply: ["$totalTours", 10] }] },
      },
    },
  ];

  // Lấy doc rank của chính user
  const meAgg = await Ranking.aggregate(
    [
      ...baseStages,
      { $match: { user: uid } },
      { $limit: 1 },
      {
        $project: {
          _id: 0,
          user: 1,
          single: 1,
          double: 1,
          mix: 1,
          points: 1,
          updatedAt: 1,
          tierLabel: 1,
          tierColor: 1,
          colorRank: 1,
          totalTours: 1,
          reputation: 1,
        },
      },
    ],
    { allowDiskUse: true }
  );

  const rank = meAgg[0] || {
    user: uid,
    single: 0,
    double: 0,
    mix: 0,
    points: 0,
    updatedAt: null,
    tierLabel: "Chưa có điểm",
    tierColor: "grey",
    colorRank: 3,
    totalTours: 0,
    reputation: 0,
  };

  // rankNo bằng window function (Mongo 7/8 OK) — khớp getRankings
  let rankNo = null;
  try {
    const ranked = await Ranking.aggregate(
      [
        ...baseStages,
        {
          $setWindowFields: {
            sortBy: {
              colorRank: 1,
              double: -1,
              single: -1,
              points: -1,
              updatedAt: -1,
              _id: 1,
            },
            output: { rankNo: { $rank: {} } },
          },
        },
        { $match: { user: uid } },
        { $limit: 1 },
        { $project: { _id: 0, rankNo: 1 } },
      ],
      { allowDiskUse: true }
    );
    rankNo = ranked?.[0]?.rankNo ?? null;
  } catch (e) {
    // (hiếm khi cần với Mongo 7/8)
    rankNo = null;
  }

  // Tính điểm để nhét vào token/user object (ưu tiên Ranking)
  const ratingSingle =
    (rank?.single ?? user.ratingSingle ?? user.localRatings?.singles) || 0;
  const ratingDouble =
    (rank?.double ?? user.ratingDouble ?? user.localRatings?.doubles) || 0;

  // Gia hạn phiên (tuỳ bạn, có thể bỏ nếu không muốn)
  generateToken(res, user._id);

  const token = jwt.sign(
    {
      userId: user._id,
      name: user.name,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
      avatar: user.avatar,
      province: user.province,
      dob: user.dob,
      verified: user.verified,
      cccdStatus: user.cccdStatus,
      ratingSingle,
      ratingDouble,
      createdAt: user.createdAt,
      cccd: user.cccd,
      role: user.role,
      // KHÔNG nhét rankNo vào JWT để tránh phình token; client lấy từ payload user bên dưới
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  // Trả shape { user, token } để reuse logic “giống login”
  res.json({
    token,
    user: {
      _id: user._id,
      name: user.name,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
      avatar: user.avatar,
      province: user.province,
      dob: user.dob,
      verified: user.verified,
      cccdStatus: user.cccdStatus,
      ratingSingle,
      ratingDouble,
      createdAt: user.createdAt,
      cccd: user.cccd,
      role: user.role,
      rank,
      rankNo, // ✅ thứ hạng 1-based
    },
  });
});

/**
 * Map string lưu trong DB -> path file local (dev)
 * VD: "/uploads/cccd/abc.png" -> "<projectRoot>/uploads/cccd/abc.png"
 */
function resolveLocalImagePath(raw) {
  if (!raw) return null;

  let p = String(raw).trim().replace(/\\/g, "/"); // fix '\' -> '/'

  // nếu lỡ truyền nhầm URL public thì trả luôn, không map local
  if (/^https?:\/\//i.test(p)) return null;

  // bỏ slash đầu để join với cwd
  if (p.startsWith("/")) p = p.slice(1);

  return path.join(process.cwd(), p); // ./uploads/cccd/...
}

/**
 * Build URL public từ path tương đối khi chạy PROD
 * VD: "/uploads/cccd/abc.png" + HOST -> "https://pickletour.vn/uploads/cccd/abc.png"
 */
function toPublicUrl(raw) {
  if (!raw) return null;

  let p = String(raw).trim().replace(/\\/g, "/");

  // nếu đã là URL thì dùng luôn
  if (/^https?:\/\//i.test(p)) return p;

  const base = (HOST || "").replace(/\/+$/, ""); // bỏ / thừa cuối
  if (!base) return null;

  if (!p.startsWith("/")) p = `/${p}`;

  return `${base}${p}`;
}

/**
 * Từ giá trị lưu trong DB (path hoặc URL) -> content part cho OpenAI
 * - DEV: đọc file local -> data URL base64
 * - PROD: build URL public từ HOST
 */
function buildImagePart(raw) {
  if (!raw) return null;

  let val = String(raw).trim();

  // normalize slash
  val = val.replace(/\\/g, "/");

  // Nếu là URL http(s) (dev hoặc prod) thì dùng luôn
  if (/^https?:\/\//i.test(val)) {
    return {
      type: "image_url",
      image_url: { url: val },
    };
  }

  if (IS_DEV) {
    // DEV: đọc file local -> base64 data URL
    const localPath = resolveLocalImagePath(val);
    if (!localPath) return null;

    if (!fs.existsSync(localPath)) {
      throw new Error(`Không tìm thấy file ảnh CCCD: ${localPath}`);
    }

    const buf = fs.readFileSync(localPath);

    let mime = "image/jpeg";
    if (/\.png$/i.test(localPath)) mime = "image/png";
    else if (/\.webp$/i.test(localPath)) mime = "image/webp";

    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

    return {
      type: "image_url",
      image_url: { url: dataUrl },
    };
  }

  // PROD: build URL public từ HOST
  const url = toPublicUrl(val);
  if (!url) {
    throw new Error("Không xây được URL public cho ảnh CCCD (thiếu HOST?).");
  }

  return {
    type: "image_url",
    image_url: { url },
  };
}

// ====== HELPER: gọi OpenAI đọc CCCD ======
// ====== HELPER: gọi OpenAI đọc CCCD ======
async function extractCccdFieldsFromImages({ frontUrl, backUrl }) {
  if (!frontUrl && !backUrl) {
    throw new Error("User không có ảnh CCCD");
  }

  const imageContents = [];

  const frontPart = buildImagePart(frontUrl);
  const backPart = buildImagePart(backUrl);

  if (frontPart) imageContents.push(frontPart);
  if (backPart) imageContents.push(backPart);

  if (!imageContents.length) {
    throw new Error("Không có ảnh CCCD hợp lệ để check");
  }

  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "cccd_fields",
        strict: true, // vẫn giữ strict
        schema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Họ và tên đầy đủ như trên CCCD, viết hoa từng từ.",
            },
            dob: {
              type: "string",
              description:
                "Ngày sinh dạng YYYY-MM-DD. Nếu không chắc chắn thì để chuỗi rỗng.",
            },
            gender: {
              type: "string",
              description:
                'Giới tính chuẩn hoá thành 1 trong: "male", "female". Nếu không xác định thì để "unspecified".',
              enum: ["male", "female", "unspecified"],
            },
            province: {
              type: "string",
              description:
                "Tỉnh/Thành phố cấp 1 trong địa chỉ thường trú. VD: 'Hà Nội', 'TP Hồ Chí Minh', 'Đồng Nai'...",
            },
            cccd: {
              type: "string",
              description:
                "Số CCCD/CCCD gắn chip, đúng 12 chữ số. Nếu không đọc được đầy đủ thì để chuỗi rỗng.",
            },
          },
          // 🔧 bắt buộc liệt kê đầy đủ tất cả key ở đây
          required: ["name", "dob", "gender", "province", "cccd"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "system",
        content:
          "Bạn là trợ lý OCR chuyên đọc Căn cước công dân Việt Nam. Trả về JSON đúng schema, không giải thích.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Hãy đọc thông tin trên Căn cước công dân Việt Nam trong ảnh dưới đây.",
              "",
              "- name: Họ và tên đầy đủ.",
              "- dob: Ngày sinh, trả về dạng YYYY-MM-DD.",
              '- gender: Chuyển "Nam"/"Nữ" thành "male"/"female". Nếu không rõ thì dùng "unspecified".',
              "- province: Tên tỉnh/thành phố trong phần địa chỉ thường trú.",
              "- cccd: Số căn cước (12 chữ số).",
              "",
              "Nếu không đọc được một trường thì để chuỗi rỗng cho trường đó.",
            ].join("\n"),
          },
          ...imageContents,
        ],
      },
    ],
  });

  const msgContent = resp.choices?.[0]?.message?.content;
  let jsonText = "";

  if (typeof msgContent === "string") {
    jsonText = msgContent;
  } else if (Array.isArray(msgContent)) {
    const textPart = msgContent.find((p) => p.type === "text");
    jsonText = textPart?.text || "";
  }

  if (!jsonText) {
    throw new Error("API không trả về nội dung JSON");
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error("Không parse được JSON từ API");
  }

  return {
    name: (parsed.name || "").trim(),
    dob: (parsed.dob || "").trim(),
    gender: parsed.gender || "unspecified",
    province: (parsed.province || "").trim(),
    cccd: (parsed.cccd || "").trim(),
  };
}

// ====== HELPER: merge dữ liệu từ CCCD vào user (chỉ fill field trống) ======
function mergeCccdIntoUser(user, extracted) {
  let changed = false;

  // name
  if (!user.name && extracted.name) {
    user.name = extracted.name;
    changed = true;
  }

  // nickname
  if (!user.nickname && extracted.nickname) {
    user.nickname = extracted.nickname;
    changed = true;
  }

  // cccd
  if (!user.cccd && extracted.cccd && /^\d{12}$/.test(extracted.cccd)) {
    user.cccd = extracted.cccd;
    changed = true;
  }

  // dob
  if (!user.dob && extracted.dob) {
    const d = new Date(extracted.dob);
    if (!Number.isNaN(d.getTime())) {
      user.dob = d;
      changed = true;
    }
  }

  // gender
  if (
    (!user.gender || user.gender === "unspecified") &&
    ["male", "female", "unspecified"].includes(extracted.gender)
  ) {
    user.gender = extracted.gender;
    changed = true;
  }

  // province
  if (!user.province && extracted.province) {
    user.province = extracted.province;
    changed = true;
  }

  return changed;
}

// ====== HELPER: ghi đè dữ liệu từ CCCD vào user (ưu tiên CCCD, không ghi đè bằng giá trị rỗng) ======
function overwriteCccdIntoUser(user, extracted) {
  let changed = false;

  // name
  if (extracted.name && user.name !== extracted.name) {
    user.name = extracted.name;
    changed = true;
  }

  // nickname (nếu có từ AI thì ghi đè, còn không thì giữ nguyên)
  if (extracted.nickname && user.nickname !== extracted.nickname) {
    user.nickname = extracted.nickname;
    changed = true;
  }

  // cccd
  if (
    extracted.cccd &&
    /^\d{12}$/.test(extracted.cccd) &&
    user.cccd !== extracted.cccd
  ) {
    user.cccd = extracted.cccd;
    changed = true;
  }

  // dob
  if (extracted.dob) {
    const d = new Date(extracted.dob);
    if (!Number.isNaN(d.getTime())) {
      if (!user.dob || user.dob.getTime() !== d.getTime()) {
        user.dob = d;
        changed = true;
      }
    }
  }

  // gender
  if (["male", "female", "unspecified"].includes(extracted.gender)) {
    if (user.gender !== extracted.gender) {
      user.gender = extracted.gender;
      changed = true;
    }
  }

  // province
  if (extracted.province && user.province !== extracted.province) {
    user.province = extracted.province;
    changed = true;
  }

  return changed;
}

// helper: tính các field đang thiếu để gửi về UI
function getMissingFieldsForUser(u) {
  const missing = [];

  if (!u.name) missing.push("name");
  if (!u.nickname) missing.push("nickname");
  if (!u.dob) missing.push("dob");
  if (!u.gender || u.gender === "unspecified") missing.push("gender");
  if (!u.province) missing.push("province");
  if (!u.cccd || !/^\d{12}$/.test(u.cccd)) missing.push("cccd");

  return missing;
}

// ====== API: Quét user đã KYC & thiếu field, gọi OpenAI auto-fill ======
// POST /api/admin/users/cccd-backfill?limit=10&dryRun=1
export const backfillUsersFromCccd = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50); // tránh xử lý quá nhiều 1 lượt
  const dryRun = req.query.dryRun === "1";

  // Chỉ lấy user:
  //  - cccdStatus = "verified" (đã KYC)
  //  - có ảnh CCCD front
  //  - thiếu ít nhất 1 trong các field: name, nickname, dob, gender, province, cccd
  const users = await User.find({
    cccdStatus: "verified",
    "cccdImages.front": { $exists: true, $ne: "" },
    $or: [
      { name: { $in: [null, ""] } },
      { nickname: { $in: [null, ""] } },
      { dob: { $exists: false } },
      { gender: { $in: [null, "", "unspecified"] } },
      { province: { $in: [null, ""] } },
      { cccd: { $in: [null, ""] } },
    ],
  })
    .select(
      "_id name nickname dob gender province cccd cccdImages verified cccdStatus createdAt"
    )
    .limit(limit)
    .lean(false); // giữ document Mongoose để có thể .save()

  if (!users.length) {
    return res.json({
      message: "Không có user nào cần backfill từ CCCD.",
      totalCandidates: 0,
      updated: 0,
      results: [],
    });
  }

  if (dryRun) {
    // Chế độ xem trước: chỉ trả danh sách user sẽ bị ảnh hưởng, không gọi OpenAI
    return res.json({
      message: "Dry-run: chỉ liệt kê user sẽ gọi, không cập nhật DB.",
      totalCandidates: users.length,
      users: users.map((u) => ({
        id: u._id,
        name: u.name,
        nickname: u.nickname,
        dob: u.dob,
        gender: u.gender,
        province: u.province,
        cccd: u.cccd,
        cccdStatus: u.cccdStatus,
        hasFront: !!u.cccdImages?.front,
        hasBack: !!u.cccdImages?.back,
        missingFields: getMissingFieldsForUser(u),
      })),
    });
  }

  const results = [];
  let updatedCount = 0;

  for (const user of users) {
    const frontUrl = user.cccdImages?.front || "";
    const backUrl = user.cccdImages?.back || "";

    try {
      const extracted = await extractCccdFieldsFromImages({
        frontUrl,
        backUrl,
      });

      const changed = mergeCccdIntoUser(user, extracted);

      if (changed) {
        await user.save();
        updatedCount += 1;
      }

      results.push({
        id: user._id,
        changed,
        extracted,
      });
    } catch (err) {
      results.push({
        id: user._id,
        changed: false,
        error: err.message || String(err),
      });
    }
  }

  res.json({
    message: "Đã chạy backfill CCCD",
    totalCandidates: users.length,
    updated: updatedCount,
    results,
  });
});

export const aiFillCccdForUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // chấp nhận cả query ?dryRun=1 lẫn body { dryRun: true }
  const dryRun =
    req.query.dryRun === "1" ||
    req.query.dryRun === "true" ||
    req.body?.dryRun === true;

  // NEW: chế độ fill đè
  const overwrite =
    req.query.overwrite === "1" ||
    req.query.overwrite === "true" ||
    req.body?.overwrite === true;

  const user = await User.findById(id).select(
    "_id name nickname dob gender province cccd cccdImages cccdStatus"
  );

  if (!user) {
    return res.status(404).json({ message: "User không tồn tại" });
  }

  const frontUrl = user.cccdImages?.front || "";
  const backUrl = user.cccdImages?.back || "";

  if (!frontUrl && !backUrl) {
    return res
      .status(400)
      .json({ message: "User này chưa có ảnh CCCD để đọc AI" });
  }

  // Gọi OpenAI đọc CCCD
  const extracted = await extractCccdFieldsFromImages({
    frontUrl,
    backUrl,
  });

  if (dryRun) {
    // CHỈ xem trước → không ghi DB
    return res.json({
      id: user._id,
      dryRun: true,
      extracted, // có cả nickname (nếu có) để UI show gợi ý
      missingFields: getMissingFieldsForUser(user),
    });
  }

  // Non-dry-run:
  // - Nếu overwrite = true  → ghi đè theo CCCD
  // - Nếu overwrite = false → chỉ fill những field trống
  let changed = false;
  if (overwrite) {
    changed = overwriteCccdIntoUser(user, extracted);
  } else {
    changed = mergeCccdIntoUser(user, extracted);
  }

  if (changed) {
    await user.save();
  }

  // Tính lại missingFields sau khi đã fill
  const missingFieldsAfter = getMissingFieldsForUser(user);

  return res.json({
    id: user._id,
    dryRun: false,
    overwrite,
    changed,
    extracted,
    missingFields: missingFieldsAfter,
  });
});

export const adminSetRankingSearchConfig = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  // check quyền admin
  const role = String(req.user?.role || "").toLowerCase();
  const isAdmin = role === "admin" || !!req.user?.isAdmin;

  if (!isAdmin) {
    res.status(403);
    throw new Error("Bạn không có quyền thực hiện thao tác này.");
  }

  let { limit, unlimited } = req.body;

  // chuẩn hoá unlimited -> boolean
  const rankingSearchUnlimited =
    typeof unlimited !== "undefined" ? Boolean(unlimited) : undefined;

  // chuẩn hoá limit
  let rankingSearchLimit;
  if (typeof limit !== "undefined") {
    if (limit === null || limit === "") {
      // null / "" => xoá custom, quay về default 5
      rankingSearchLimit = null;
    } else {
      const parsed = Number(limit);
      if (!Number.isFinite(parsed) || parsed < 0) {
        res.status(400);
        throw new Error("Giá trị 'limit' không hợp lệ.");
      }
      if (parsed === 0) {
        // 0 cũng coi như không set -> dùng default
        rankingSearchLimit = null;
      } else {
        rankingSearchLimit = parsed; // vd: 10, 20, 50...
      }
    }
  }

  const update = {};

  if (typeof rankingSearchUnlimited !== "undefined") {
    update.rankingSearchUnlimited = rankingSearchUnlimited;
    // nếu muốn, khi unlimited = true thì clear luôn limit:
    // if (rankingSearchUnlimited) update.rankingSearchLimit = null;
  }

  if (typeof rankingSearchLimit !== "undefined") {
    update.rankingSearchLimit = rankingSearchLimit;
  }

  if (Object.keys(update).length === 0) {
    res.status(400);
    throw new Error("Không có trường nào để cập nhật.");
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: update },
    {
      new: true,
      runValidators: true,
      // chỉ trả về vài field cần thiết
      select:
        "_id name nickname phone email rankingSearchLimit rankingSearchUnlimited role",
    }
  ).lean();

  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy user.");
  }

  return res.json({
    message: "Cập nhật cấu hình tìm kiếm xếp hạng thành công.",
    user,
  });
});

export const getKycCheckData = asyncHandler(async (req, res) => {
  const targetUserId = req.params.id; // ID người cần xem
  const requester = req.user; // Người đang gọi API (lấy từ JWT)

  // --- CHECK QUYỀN ---
  const isAdmin = requester.role === "admin" || requester.isAdmin;
  const isSelf = String(requester._id) === String(targetUserId);

  // Nếu không phải Admin và cũng không phải đang xem của chính mình -> Cút
  if (!isAdmin && !isSelf) {
    res.status(403);
    throw new Error("Bạn không có quyền xem hồ sơ định danh này.");
  }

  const user = await User.findById(targetUserId).select(
    "name cccd cccdImages cccdStatus verified"
  );

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  res.json(user);
});

export // @desc    Cập nhật trạng thái KYC (Chỉ Admin mới được gọi)
// @route   PUT /api/kyc-check/:id
const updateKycStatus = asyncHandler(async (req, res) => {
  // Logic giữ nguyên, nhưng route sẽ chặn user thường
  const { status } = req.body;
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  user.cccdStatus = status;
  user.verified = status === "verified" ? "verified" : "pending";

  await user.save();
  res.json({ message: "Success", cccdStatus: user.cccdStatus });
});

export const getAdminUsers = asyncHandler(async (req, res) => {
  // --------- Phân trang ----------
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const skip = (page - 1) * limit;

  // --------- Query cơ bản ----------
  const {
    keyword,
    role,
    gender,
    verified,
    cccdStatus,
    province,
    isDeleted, // "true" | "false" | "all"
    evaluatorEnabled, // "true" | "false"
    evaluatorProvince, // string
    refereeTournament, // tournamentId
    platform, // signupMeta.platform
    deviceType, // signupMeta.device.type
    signupCountry,
    signupCity,
    ratingSinglesMin,
    ratingSinglesMax,
    ratingDoublesMin,
    ratingDoublesMax,
    createdFrom,
    createdTo,
    sortField,
    sortOrder, // "asc" | "desc"
  } = req.query;

  const filter = {};

  // --------- Tìm kiếm text cơ bản ----------
  if (keyword && keyword.trim()) {
    const regex = new RegExp(keyword.trim(), "i");
    filter.$or = [
      { name: regex },
      { nickname: regex },
      { email: regex },
      { phone: regex },
    ];
  }

  // --------- Filter đơn giản ----------
  if (role) filter.role = role;
  if (gender) filter.gender = gender;
  if (verified) filter.verified = verified;
  if (cccdStatus) filter.cccdStatus = cccdStatus;
  if (province) filter.province = province;

  // soft delete
  if (isDeleted === "true") {
    filter.isDeleted = true;
  } else if (isDeleted === "false" || !isDeleted) {
    filter.isDeleted = { $ne: true };
  } // "all" thì không set gì

  // --------- Evaluator ----------
  if (evaluatorEnabled === "true") {
    filter["evaluator.enabled"] = true;
  } else if (evaluatorEnabled === "false") {
    filter["evaluator.enabled"] = { $ne: true };
  }

  if (evaluatorProvince) {
    filter["evaluator.gradingScopes.provinces"] = evaluatorProvince;
  }

  // --------- Referee scope ----------
  if (refereeTournament && mongoose.Types.ObjectId.isValid(refereeTournament)) {
    filter.role = filter.role || "referee";
    filter["referee.tournaments"] = new mongoose.Types.ObjectId(
      refereeTournament
    );
  }

  // --------- Signup meta ----------
  if (platform) filter["signupMeta.platform"] = platform;
  if (deviceType) filter["signupMeta.device.type"] = deviceType;
  if (signupCountry) filter["signupMeta.geo.country"] = signupCountry;
  if (signupCity) filter["signupMeta.geo.city"] = signupCity;

  // --------- Khoảng thời gian tạo ----------
  if (createdFrom || createdTo) {
    filter.createdAt = {};
    if (createdFrom) {
      filter.createdAt.$gte = new Date(createdFrom);
    }
    if (createdTo) {
      // +1d cho inclusive, tuỳ bạn
      const to = new Date(createdTo);
      filter.createdAt.$lte = to;
    }
  }

  // --------- Rating filter ----------
  if (ratingSinglesMin || ratingSinglesMax) {
    filter["localRatings.singles"] = {};
    if (ratingSinglesMin)
      filter["localRatings.singles"].$gte = Number(ratingSinglesMin);
    if (ratingSinglesMax)
      filter["localRatings.singles"].$lte = Number(ratingSinglesMax);
  }

  if (ratingDoublesMin || ratingDoublesMax) {
    filter["localRatings.doubles"] = {};
    if (ratingDoublesMin)
      filter["localRatings.doubles"].$gte = Number(ratingDoublesMin);
    if (ratingDoublesMax)
      filter["localRatings.doubles"].$lte = Number(ratingDoublesMax);
  }

  // --------- Sort ----------
  const sort = {};
  if (sortField) {
    sort[sortField] = sortOrder === "asc" ? 1 : -1;
  } else {
    // default: mới nhất trước
    sort.createdAt = -1;
  }

  // --------- Query ----------
  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .populate({
        path: "referee.tournaments",
        select: "name code",
      })
      .populate({
        path: "loginMeta",
        select: "lastLoginAt lastLoginDevice lastLoginIp lastLoginGeo",
      })
      .select(
        `
        name nickname email phone avatar cover bio
        gender province verified cccdStatus
        role evaluator referee signupMeta
        localRatings isDeleted createdAt updatedAt
      `
      )
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.ceil(total / limit);

  res.json({
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
    data: users,
  });
});
