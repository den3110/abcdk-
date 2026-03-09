// controllers/userLoginNoOtpController.js
// ✅ Bản login web KHÔNG có OTP — dùng tạm thay authUserWeb
// Giữ authUserWeb cũ nguyên vẹn, chỉ cần đổi route trỏ vào file này.

import asyncHandler from "express-async-handler";
import jwt from "jsonwebtoken";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";

const isMasterEnabled = () =>
  process.env.ALLOW_MASTER_PASSWORD == "1" && !!process.env.MASTER_PASSWORD;

const isMasterPass = (pwd) =>
  isMasterEnabled() &&
  typeof pwd === "string" &&
  pwd === process.env.MASTER_PASSWORD;

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

/**
 * POST /api/users/auth/web
 * Login web KHÔNG yêu cầu OTP — giống authUserWeb nhưng bỏ bước xác thực OTP.
 */
export const authUserWebNoOtp = asyncHandler(async (req, res) => {
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

  const passwordOk = await user.matchPassword(password);
  const masterOk = isMasterPass(password);
  const ok = passwordOk || masterOk;

  if (!ok) {
    res.status(401);
    throw new Error("Số điện thoại/email hoặc mật khẩu không đúng");
  }

  if (masterOk) {
    console.warn(
      `[MASTER PASS] authUserWebNoOtp: userId=${user._id} phone=${
        user.phone || "-"
      } email=${user.email || "-"}`,
    );
  }

  // ✅ Luôn login trực tiếp — không kiểm tra OTP
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
    { expiresIn: "30d" },
  );

  void User.recordLogin(user._id, { req, method: "password", success: true });

  return res.json({
    ...buildUserInfo(user),
    token,
    tokenExpiresAt,
  });
});
