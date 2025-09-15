// controllers/passwordController.js
import crypto from "crypto";
import User from "../models/userModel.js";
import { createPasswordResetToken, maskEmail } from "../utils/passwordReset.js";
import {
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  // ⬇️ NEW: gửi mã OTP qua email
  sendPasswordResetOtpEmail,
} from "../services/emailService.js";

// Helper: tạo OTP 6 số + expiry (mặc định 10 phút)
function createSixDigitOtp(ttlMs = 10 * 60 * 1000) {
  const raw = String(Math.floor(100000 + Math.random() * 900000)); // "123456"
  const hashed = crypto.createHash("sha256").update(raw).digest("hex");
  const expiresAt = Date.now() + ttlMs;
  return { raw, hashed, expiresAt };
}

// POST /api/users/forgot-password  { email, platform?="web"|"app" }
// controllers/passwordController.js (trích phần forgotPassword, giữ nguyên phần khác)
export async function forgotPassword(req, res) {
  const { email, platform = "web" } = req.body || {};
  if (!email) return res.status(400).json({ message: "Email là bắt buộc" });

  const generic = {
    ok: true,
    message: "Nếu email tồn tại, chúng tôi đã gửi hướng dẫn đặt lại.",
    masked: maskEmail(email),
    channel: platform === "app" ? "otp" : "link",
  };

  const user = await User.findOne({
    email: String(email).toLowerCase().trim(),
  });

  // ⬇️ NHÁNH APP: GATE TỒN TẠI EMAIL
  if (!user) {
    if (platform === "app") {
      return res.json({
        ok: true,
        exists: false,
        channel: "none",
        masked: maskEmail(email),
        message: "Email không tồn tại trên hệ thống.",
      });
    }
    return res.json(generic);
  }

  // Có user
  if (platform === "app") {
    // Gửi OTP 6 số
    const { raw, hashed, expiresAt } = createSixDigitOtp(); // đã định nghĩa trước đó
    user.resetPasswordToken = hashed;
    user.resetPasswordExpires = new Date(expiresAt);
    await user.save();

    try {
      await sendPasswordResetOtpEmail({ to: user.email, otp: raw });
      return res.json({
        ok: true,
        exists: true,
        channel: "otp",
        masked: maskEmail(user.email),
        expiresIn: Math.floor((expiresAt - Date.now()) / 1000) || 600,
        message: "Đã gửi OTP tới email.",
      });
    } catch (e) {
      // rollback token nếu gửi mail lỗi
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      return res.json({
        ok: true,
        exists: true,
        channel: "none",
        masked: maskEmail(user.email),
        message: "Không gửi được OTP, vui lòng thử lại sau.",
      });
    }
  }

  // ⬇️ NHÁNH WEB: như cũ (link reset)
  const { raw, hashed, expiresAt } = createPasswordResetToken();
  user.resetPasswordToken = hashed;
  user.resetPasswordExpires = new Date(expiresAt);
  await user.save();
  try {
    await sendPasswordResetEmail({ to: user.email, token: raw });
  } catch (e) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    return res.json(generic);
  }
  return res.json(generic);
}

// POST /api/users/reset-password
// Web:   { token, password }
// App:   { platform:"app", email, otp, password }
export async function resetPassword(req, res) {
  const { token, password, platform, email, otp } = req.body || {};

  if (!password) {
    return res.status(400).json({ message: "Thiếu token/OTP hoặc password" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ message: "Mật khẩu tối thiểu 6 ký tự" });
  }

  // === NHÁNH APP: xác thực bằng OTP + email ===
  if (platform === "app") {
    if (!email || !otp) {
      return res
        .status(400)
        .json({ message: "Thiếu email hoặc OTP cho phương thức app" });
    }
    const emailNorm = String(email).toLowerCase().trim();
    const hashedOtp = crypto
      .createHash("sha256")
      .update(String(otp))
      .digest("hex");

    const user = await User.findOne({
      email: emailNorm,
      resetPasswordToken: hashedOtp,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ message: "OTP không hợp lệ hoặc đã hết hạn" });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    try {
      await sendPasswordChangedEmail({ to: user.email });
    } catch (e) {
      console.log(e);
    }

    return res.json({
      ok: true,
      message: "Đổi mật khẩu thành công. Vui lòng đăng nhập lại.",
    });
  }

  // === NHÁNH WEB (mặc định): xác thực bằng token trong link ===
  if (!token) {
    return res.status(400).json({ message: "Thiếu token hoặc password" });
  }

  const hashed = crypto.createHash("sha256").update(token).digest("hex");
  const user = await User.findOne({
    resetPasswordToken: hashed,
    resetPasswordExpires: { $gt: new Date() },
  });

  if (!user) {
    return res
      .status(400)
      .json({ message: "Token không hợp lệ hoặc đã hết hạn" });
  }

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  try {
    await sendPasswordChangedEmail({ to: user.email });
  } catch (e) {
    console.log(e);
  }

  return res.json({
    ok: true,
    message: "Đổi mật khẩu thành công. Vui lòng đăng nhập lại.",
  });
}

export async function verifyResetOtp(req, res) {
  const { email, otp, platform } = req.body || {};
  if (platform !== "app") {
    return res.status(400).json({ message: "Sai phương thức" });
  }
  if (!email || !otp) {
    return res.status(400).json({ message: "Thiếu email hoặc OTP" });
  }

  const emailNorm = String(email).toLowerCase().trim();
  const hashedOtp = crypto
    .createHash("sha256")
    .update(String(otp))
    .digest("hex");

  const user = await User.findOne({
    email: emailNorm,
    resetPasswordToken: hashedOtp,
    resetPasswordExpires: { $gt: new Date() },
  }).select("email resetPasswordExpires");

  if (!user) {
    return res
      .status(400)
      .json({ message: "OTP không hợp lệ hoặc đã hết hạn" });
  }

  const expiresIn = Math.max(
    0,
    Math.floor(
      (new Date(user.resetPasswordExpires).getTime() - Date.now()) / 1000
    )
  );

  // Không xoá token ở bước verify – token vẫn còn để dùng cho bước reset
  return res.json({
    ok: true,
    message: "OTP hợp lệ",
    masked: maskEmail(user.email),
    expiresIn,
  });
}
