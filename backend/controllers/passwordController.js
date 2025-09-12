// controllers/passwordController.js
import crypto from "crypto";
import User from "../models/userModel.js";
import { createPasswordResetToken, maskEmail } from "../utils/passwordReset.js";
import {
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
} from "../services/emailService.js";

// POST /api/users/forgot-password  { email }
export async function forgotPassword(req, res) {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ message: "Email là bắt buộc" });

  // Trả về message chung để tránh user enumeration
  const generic = {
    ok: true,
    message: "Nếu email tồn tại, chúng tôi đã gửi hướng dẫn đặt lại.",
    masked: maskEmail(email),
  };

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) return res.json(generic);

  // Tạo token
  const { raw, hashed, expiresAt } = createPasswordResetToken();
  user.resetPasswordToken = hashed;
  user.resetPasswordExpires = new Date(expiresAt);
  await user.save();

  try {
    await sendPasswordResetEmail({ to: user.email, token: raw });
  } catch (e) {
    // Nếu email lỗi, xoá token để không treo
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    // Vẫn trả generic để không lộ thông tin
    return res.json(generic);
  }

  return res.json(generic);
}

// POST /api/users/reset-password  { token, password }
export async function resetPassword(req, res) {
  const { token, password } = req.body || {};
  if (!token || !password)
    return res.status(400).json({ message: "Thiếu token hoặc password" });
  if (String(password).length < 6)
    return res.status(400).json({ message: "Mật khẩu tối thiểu 6 ký tự" });

  // Hash token gửi lên để so khớp DB
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

  // Đổi mật khẩu
  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;

  await user.save();

  // (Tuỳ chọn) gửi email xác nhận đã đổi
  try {
    await sendPasswordChangedEmail({ to: user.email });
  } catch (e) {
    console.log(e)
    // bỏ qua lỗi email confirm
  }

  return res.json({
    ok: true,
    message: "Đổi mật khẩu thành công. Vui lòng đăng nhập lại.",
  });
}
