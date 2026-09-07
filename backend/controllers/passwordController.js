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
import expressAsyncHandler from "express-async-handler";
import ScoreHistory from "../models/scoreHistoryModel.js"
import { sendOtpWithLimit } from "../services/otpSender.service.js";

// Helper: tạo OTP 6 số + expiry (mặc định 10 phút)
function createSixDigitOtp(ttlMs = 10 * 60 * 1000) {
  const raw = String(Math.floor(100000 + Math.random() * 900000)); // "123456"
  const hashed = crypto.createHash("sha256").update(raw).digest("hex");
  const expiresAt = Date.now() + ttlMs;
  return { raw, hashed, expiresAt };
}

// Chuẩn hoá SĐT về dạng lưu 0xxxxxxxxx + validate + mask
function normalizeResetPhone(phone = "") {
  let s = String(phone).trim().replace(/\s+/g, "");
  if (s.startsWith("+84")) s = "0" + s.slice(3);
  else if (s.startsWith("84")) s = "0" + s.slice(2);
  s = s.replace(/[^\d]/g, "");
  return s;
}
const isValidResetPhone = (s) => /^0\d{9}$/.test(String(s || ""));
function maskResetPhone(s = "") {
  const p = normalizeResetPhone(s);
  if (!isValidResetPhone(p)) return "SĐT";
  return p.slice(0, 3) + "***" + p.slice(-2);
}
const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

const looksLikeEmail = (s = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());

// Tìm user theo "định danh" người dùng nhập ở màn Quên mật khẩu:
// - dạng email  -> tra theo email
// - dạng SĐT    -> tra theo phone (đã kích hoạt)
async function findResetUserByIdentifier(identifier = "") {
  const id = String(identifier || "").trim();
  if (!id) return null;
  if (looksLikeEmail(id)) {
    return User.findOne({ email: id.toLowerCase() });
  }
  const phoneStore = normalizeResetPhone(id);
  if (isValidResetPhone(phoneStore)) {
    return User.findOne({ phone: phoneStore, phoneVerified: true });
  }
  return null;
}

// Kênh khả dụng để đặt lại mật khẩu cho 1 user
function resetChannelsOf(user) {
  return {
    email: !!user?.email,
    // Zalo chỉ khi SĐT đã kích hoạt
    zalo: !!(user?.phone && user?.phoneVerified),
  };
}

// POST /api/users/forgot-password/options   { identifier }
// Trả về các kênh khả dụng (email / zalo) + giá trị đã che, KHÔNG lộ email/SĐT thật.
// Dùng cho app: tài khoản không có email -> chỉ Zalo; có email -> cho chọn Email hoặc Zalo.
export async function resolveResetOptions(req, res) {
  const { identifier } = req.body || {};
  const id = String(identifier || "").trim();
  if (!id) {
    return res.status(400).json({ message: "Vui lòng nhập email hoặc số điện thoại." });
  }
  const user = await findResetUserByIdentifier(id);
  if (!user) {
    return res.json({
      ok: true,
      found: false,
      channels: { email: false, zalo: false },
      message: "Không tìm thấy tài khoản khớp với thông tin này.",
    });
  }
  const channels = resetChannelsOf(user);
  return res.json({
    ok: true,
    found: true,
    channels,
    maskedEmail: user.email ? maskEmail(user.email) : null,
    maskedPhone: user.phone ? maskResetPhone(user.phone) : null,
    message: "OK",
  });
}

// POST /api/users/forgot-password  { email, platform?="web"|"app" }
// controllers/passwordController.js (trích phần forgotPassword, giữ nguyên phần khác)
export async function forgotPassword(req, res) {
  const { email, phone, platform = "web", channel, identifier } = req.body || {};

  // ⬇️ NHÁNH ĐỊNH DANH (app mới): resolve user theo identifier rồi gửi OTP theo kênh chọn.
  // Không cần client biết email/SĐT thật của tài khoản.
  if (identifier && (channel === "email" || channel === "zalo")) {
    const user = await findResetUserByIdentifier(identifier);
    if (!user) {
      return res.json({
        ok: true,
        exists: false,
        channel,
        message: "Không tìm thấy tài khoản khớp với thông tin này.",
      });
    }

    if (channel === "zalo") {
      if (!(user.phone && user.phoneVerified)) {
        return res.status(400).json({
          ok: false,
          channel: "zalo",
          message: "Tài khoản chưa có số điện thoại đã kích hoạt.",
        });
      }
      let sent;
      try {
        sent = await sendOtpWithLimit({
          user: user._id,
          phone: user.phone,
          purpose: "reset",
          ip: req.ip,
        });
      } catch (e) {
        return res.status(e?.rateLimited ? 429 : 400).json({
          ok: false,
          channel: "zalo",
          message: e?.rateLimited ? e.message : "Không gửi được OTP. Vui lòng thử lại.",
        });
      }
      user.resetPasswordToken = sha256(sent.otp);
      user.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();
      return res.json({
        ok: true,
        exists: true,
        channel: "zalo",
        masked: maskResetPhone(user.phone),
        expiresIn: 600,
        message: "Đã gửi mã OTP qua Zalo.",
      });
    }

    // channel === "email"
    if (!user.email) {
      return res.status(400).json({
        ok: false,
        channel: "email",
        message: "Tài khoản không có email.",
      });
    }
    const { raw, hashed, expiresAt } = createSixDigitOtp();
    user.resetPasswordToken = hashed;
    user.resetPasswordExpires = new Date(expiresAt);
    await user.save();
    try {
      await sendPasswordResetOtpEmail({ to: user.email, otp: raw });
      return res.json({
        ok: true,
        exists: true,
        channel: "email",
        masked: maskEmail(user.email),
        expiresIn: Math.floor((expiresAt - Date.now()) / 1000) || 600,
        message: "Đã gửi OTP tới email.",
      });
    } catch (e) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      return res.status(400).json({
        ok: false,
        channel: "email",
        message: "Không gửi được OTP tới email. Vui lòng thử lại.",
      });
    }
  }

  // ⬇️ NHÁNH ZALO: đặt lại qua SĐT + OTP Zalo (chỉ SĐT đã kích hoạt)
  if (channel === "zalo" || (phone && !email)) {
    const phoneStore = normalizeResetPhone(phone);
    if (!isValidResetPhone(phoneStore)) {
      return res
        .status(400)
        .json({ message: "Số điện thoại không hợp lệ." });
    }
    const user = await User.findOne({
      phone: phoneStore,
      phoneVerified: true,
    });
    if (!user) {
      return res.json({
        ok: true,
        exists: false,
        channel: "zalo",
        masked: maskResetPhone(phoneStore),
        message:
          "Số điện thoại chưa được kích hoạt hoặc không gắn với tài khoản nào.",
      });
    }
    let sent;
    try {
      sent = await sendOtpWithLimit({
        user: user._id,
        phone: phoneStore,
        purpose: "reset",
        ip: req.ip,
      });
    } catch (e) {
      return res.status(e?.rateLimited ? 429 : 400).json({
        ok: false,
        channel: "zalo",
        message: e?.rateLimited ? e.message : "Không gửi được OTP. Vui lòng thử lại.",
      });
    }
    user.resetPasswordToken = sha256(sent.otp);
    user.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();
    return res.json({
      ok: true,
      exists: true,
      channel: "zalo",
      masked: maskResetPhone(phoneStore),
      expiresIn: 600,
      message: "Đã gửi mã OTP qua Zalo.",
    });
  }

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
  const { token, password, platform, email, otp, phone, channel, identifier } = req.body || {};

  if (!password) {
    return res.status(400).json({ message: "Thiếu token/OTP hoặc password" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ message: "Mật khẩu tối thiểu 6 ký tự" });
  }

  // === NHÁNH ĐỊNH DANH (app mới): đặt lại theo identifier + OTP ===
  if (identifier && otp) {
    const user = await findResetUserByIdentifier(identifier);
    const valid =
      user &&
      user.resetPasswordToken === sha256(otp) &&
      user.resetPasswordExpires &&
      new Date(user.resetPasswordExpires).getTime() > Date.now();
    if (!valid) {
      return res.status(400).json({ message: "OTP không hợp lệ hoặc đã hết hạn." });
    }
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    if (user.email) {
      try {
        await sendPasswordChangedEmail({ to: user.email });
      } catch (e) {
        console.log(e);
      }
    }
    return res.json({
      ok: true,
      message: "Đổi mật khẩu thành công. Vui lòng đăng nhập lại.",
    });
  }

  // === NHÁNH ZALO: xác thực bằng SĐT + OTP ===
  if (channel === "zalo") {
    const phoneStore = normalizeResetPhone(phone);
    if (!isValidResetPhone(phoneStore) || !otp) {
      return res.status(400).json({ message: "Thiếu SĐT hoặc OTP." });
    }
    const user = await User.findOne({
      phone: phoneStore,
      phoneVerified: true,
      resetPasswordToken: sha256(otp),
      resetPasswordExpires: { $gt: new Date() },
    });
    if (!user) {
      return res
        .status(400)
        .json({ message: "OTP không hợp lệ hoặc đã hết hạn." });
    }
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    if (user.email) {
      try {
        await sendPasswordChangedEmail({ to: user.email });
      } catch (e) {
        console.log(e);
      }
    }
    return res.json({
      ok: true,
      message: "Đổi mật khẩu thành công. Vui lòng đăng nhập lại.",
    });
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
  const { email, otp, platform, phone, channel, identifier } = req.body || {};

  // === NHÁNH ĐỊNH DANH (app mới): xác thực OTP theo identifier + token ===
  if (identifier && otp) {
    const user = await findResetUserByIdentifier(identifier);
    const valid =
      user &&
      user.resetPasswordToken === sha256(otp) &&
      user.resetPasswordExpires &&
      new Date(user.resetPasswordExpires).getTime() > Date.now();
    if (!valid) {
      return res.status(400).json({ message: "OTP không hợp lệ hoặc đã hết hạn." });
    }
    const expiresIn = Math.max(
      0,
      Math.floor((new Date(user.resetPasswordExpires).getTime() - Date.now()) / 1000)
    );
    return res.json({
      ok: true,
      message: "OTP hợp lệ",
      masked: user.email ? maskEmail(user.email) : maskResetPhone(user.phone),
      expiresIn,
    });
  }

  // === NHÁNH ZALO: xác thực OTP theo SĐT ===
  if (channel === "zalo") {
    const phoneStore = normalizeResetPhone(phone);
    if (!isValidResetPhone(phoneStore) || !otp) {
      return res.status(400).json({ message: "Thiếu SĐT hoặc OTP." });
    }
    const user = await User.findOne({
      phone: phoneStore,
      phoneVerified: true,
      resetPasswordToken: sha256(otp),
      resetPasswordExpires: { $gt: new Date() },
    }).select("phone resetPasswordExpires");
    if (!user) {
      return res
        .status(400)
        .json({ message: "OTP không hợp lệ hoặc đã hết hạn." });
    }
    const expiresIn = Math.max(
      0,
      Math.floor(
        (new Date(user.resetPasswordExpires).getTime() - Date.now()) / 1000
      )
    );
    return res.json({
      ok: true,
      message: "OTP hợp lệ",
      masked: maskResetPhone(phoneStore),
      expiresIn,
    });
  }

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


export const deleteRatingHistoryItem = expressAsyncHandler(async (req, res) => {
  const { userId, historyId } = req.params;

  const doc = await ScoreHistory.findOne({ _id: historyId, user: userId });
  if (!doc) {
    res.status(404);
    throw new Error("Không tìm thấy lịch sử cần xoá");
  }

  await doc.deleteOne();
  res.json({ message: "Đã xoá lịch sử điểm trình" });
});