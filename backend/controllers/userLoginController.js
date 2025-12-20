// controllers/loginOtpController.js
import asyncHandler from "express-async-handler";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";
import { sendTingTingOtp } from "../services/tingtingZns.service.js";

const OTP_TTL_MS = 5 * 60 * 1000; // 5 phút
const OTP_COOLDOWN_SEC = 60; // 60s mới resend
const OTP_MAX_ATTEMPTS = 5;

const OTP_BYPASS_DAYS = 15;
const OTP_BYPASS_MS = OTP_BYPASS_DAYS * 24 * 60 * 60 * 1000;

function maskPhone(p = "") {
  const s = String(p || "").trim();
  if (s.length <= 4) return s;
  return `${s.slice(0, 2)}****${s.slice(-2)}`;
}

function genOtp(len = 6) {
  let out = "";
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 10);
  return out;
}

function safeStringify(v) {
  try {
    if (v == null) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function calcBypassUntil(user) {
  // ✅ ưu tiên field DB (mục tiêu chính)
  if (user?.loginOtpBypassUntil) return new Date(user.loginOtpBypassUntil);

  // ✅ fallback tương thích: nếu user cũ chỉ có loginOtpVerifiedAt
  if (user?.loginOtpVerifiedAt) {
    const t = new Date(user.loginOtpVerifiedAt).getTime();
    if (t) return new Date(t + OTP_BYPASS_MS);
  }
  return null;
}

function getOtpBypassMeta(user) {
  const verifiedAt = user?.loginOtpVerifiedAt
    ? new Date(user.loginOtpVerifiedAt)
    : null;

  const bypassUntil = calcBypassUntil(user);

  const otpBypassActive = !!(
    user?.phone &&
    user?.phoneVerified === true &&
    bypassUntil &&
    bypassUntil.getTime() > Date.now()
  );

  return {
    otpBypassDays: OTP_BYPASS_DAYS,
    otpBypassActive,
    loginOtpVerifiedAt: verifiedAt ? verifiedAt.toISOString() : null,
    loginOtpBypassUntil: bypassUntil ? bypassUntil.toISOString() : null,
  };
}

function isOtpBypassActive(user) {
  return getOtpBypassMeta(user).otpBypassActive;
}

function buildAuthPayload(user, extra = {}) {
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

  return {
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
    ratingSingle: user.ratingSingle,
    ratingDouble: user.ratingDouble,
    createdAt: user.createdAt,
    cccd: user.cccd,
    role: user.role,
    token,
    ...extra,
  };
}

// ✅ helper để authUserWeb dùng
export function makeLoginOtpToken(userId) {
  return jwt.sign(
    { userId: String(userId), purpose: "login_otp" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function verifyLoginOtpToken(loginToken, type) {
  try {
    const payload = jwt.verify(loginToken, process.env.JWT_SECRET);
    if (!payload?.userId || payload?.purpose !== "login_otp") {
      const e = new Error("Token không hợp lệ, vui lòng thử lại");
      e.statusCode = 401;
      throw e;
    }
    return payload;
  } catch {
     let e
        if(type== 1) {
            e = new Error("OTP không hợp lệ hoặc đã hết hạn, Vui lòng gửi lại mã OTP mới");

        }
        else if (type == 2 ) {
            e= new Error("OTP đã hết hạn, vui lòng đăng nhập lại.")
        }
    e.statusCode = 401;
    throw e;
  }
}

/**
 * POST /api/users/login-otp/resend
 * body: { loginToken }
 */
export const resendLoginOtp = asyncHandler(async (req, res) => {
  const { loginToken } = req.body || {};
  if (!loginToken) {
    res.status(400);
    throw new Error("Thiếu loginToken");
  }

  const { userId } = verifyLoginOtpToken(loginToken, 2);

  const user = await User.findById(userId);
  if (!user) {
    res.status(401);
    throw new Error("User không tồn tại");
  }
  if (!user.phone) {
    res.status(400);
    throw new Error("Tài khoản chưa có số điện thoại");
  }

  const meta = getOtpBypassMeta(user);

  // ✅ còn bypass 15 ngày -> không cần gửi OTP
  if (meta.otpBypassActive) {
    return res.json({
      ok: true,
      otpNotNeeded: true,
      phoneMasked: maskPhone(user.phone),
      ...meta,
    });
  }

  // cooldown
  const lastSent = user.loginOtp?.lastSentAt
    ? new Date(user.loginOtp.lastSentAt).getTime()
    : 0;

  const elapsedSec = lastSent
    ? Math.floor((Date.now() - lastSent) / 1000)
    : 999999;

  const remain = Math.max(0, OTP_COOLDOWN_SEC - elapsedSec);

  if (remain > 0) {
    return res.status(429).json({
      ok: false,
      message: `Vui lòng đợi ${remain}s để gửi lại OTP`,
      cooldown: remain,
      ...meta,
    });
  }

  const otp = genOtp(6);
  const hash = await bcrypt.hash(otp, await bcrypt.genSalt(10));
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // ✅ gửi OTP qua TingTing
  let zns;
  try {
    zns = await sendTingTingOtp({ phone: user.phone, otp });
  } catch (e) {
    const detail =
      safeStringify(e?.body) ||
      safeStringify(e?.response?.data) ||
      safeStringify(e?.message) ||
      "unknown";

    const detailShort =
      detail.length > 600 ? detail.slice(0, 600) + "..." : detail;

    console.error("[login-otp] sendTingTingOtp failed:", detailShort);

    res.status(400); // ✅ tránh 502 dính Cloudflare
    throw new Error(
      `Gửi OTP thất bại. Vui lòng thử lại. | Lỗi: ${detailShort}`
    );
  }

  user.loginOtp = {
    hash,
    expiresAt,
    attempts: 0,
    lastSentAt: new Date(),
    tranId: String(zns?.tranId || ""),
    cost: Number(zns?.cost || 0),
  };

  await user.save();

  const devOtp = process.env.NODE_ENV !== "production" ? otp : "";

  return res.json({
    ok: true,
    cooldown: OTP_COOLDOWN_SEC,
    phoneMasked: maskPhone(user.phone),
    // devOtp,
    ...getOtpBypassMeta(user),
  });
});

/**
 * POST /api/users/login-otp/verify
 * body: { loginToken, otp }
 */
export const verifyLoginOtp = asyncHandler(async (req, res) => {
  const { loginToken, otp } = req.body || {};
  const cleanOtp = String(otp || "")
    .replace(/\D/g, "")
    .slice(0, 6);

  if (!loginToken) {
    res.status(400);
    throw new Error("Thiếu loginToken");
  }
  if (!cleanOtp || cleanOtp.length < 4) {
    res.status(400);
    throw new Error("OTP không hợp lệ");
  }

  const { userId } = verifyLoginOtpToken(loginToken, 1);

  const user = await User.findById(userId);
  if (!user) {
    res.status(401);
    throw new Error("User không tồn tại");
  }
  if (!user.phone) {
    res.status(400);
    throw new Error("Tài khoản chưa có số điện thoại");
  }

  // ✅ nếu còn bypass, FE gọi nhầm verify thì vẫn cho login luôn
  if (isOtpBypassActive(user)) {
    const meta = getOtpBypassMeta(user);
    generateToken(res, user);
    return res.json(
      buildAuthPayload(user, {
        otpNotNeeded: true,
        ...meta,
      })
    );
  }

  const st = user.loginOtp || {};
  if (!st.hash || !st.expiresAt) {
    res.status(400);
    throw new Error("Chưa có OTP đăng nhập. Vui lòng bấm gửi OTP.");
  }

  const attempts = Number(st.attempts || 0);
  if (attempts >= OTP_MAX_ATTEMPTS) {
    res.status(429);
    throw new Error("Bạn đã nhập sai quá nhiều lần. Vui lòng gửi lại OTP.");
  }

  if (new Date(st.expiresAt).getTime() < Date.now()) {
    res.status(400);
    throw new Error("OTP đã hết hạn. Vui lòng gửi lại OTP.");
  }

  const ok = await bcrypt.compare(cleanOtp, st.hash);
  if (!ok) {
    user.loginOtp.attempts = attempts + 1;
    await user.save();
    res.status(400);
    throw new Error("OTP không đúng");
  }

  // ✅ OTP đúng -> bật phoneVerified + lưu bypassUntil vào DB
  const now = Date.now();

  if (!user.phoneVerified) {
    user.phoneVerified = true;
    user.phoneVerifiedAt = new Date(now);
  }

  user.loginOtpVerifiedAt = new Date(now);
  user.loginOtpBypassUntil = new Date(now + OTP_BYPASS_MS); // ✅ field DB bạn cần

  // clear loginOtp
  user.loginOtp = {
    hash: "",
    expiresAt: null,
    attempts: 0,
    lastSentAt: null,
    tranId: "",
    cost: 0,
  };

  await user.save();

  const meta = getOtpBypassMeta(user);

  generateToken(res, user);
  return res.json(
    buildAuthPayload(user, {
      ...meta,
    })
  );
});
