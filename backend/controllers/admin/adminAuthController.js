// controllers/adminAuthController.js
import asyncHandler from "express-async-handler";
import bcrypt from "bcryptjs";
import User from "../../models/userModel.js";
import generateToken from "../../utils/generateToken.js";
import jwt from "jsonwebtoken";

// helpers (có thể đặt trên cùng file)
const isMasterEnabled = () =>
  process.env.ALLOW_MASTER_PASSWORD === "1" && !!process.env.MASTER_PASSWORD;

const isMasterPass = (pwd) =>
  isMasterEnabled() &&
  typeof pwd === "string" &&
  pwd === process.env.MASTER_PASSWORD;

// 2) ADMIN/REFEREE LOGIN (email + password or MASTER_PASSWORD)
export const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const loginRaw = String(email || "").trim();
  if (!loginRaw || !password) {
    res.status(400);
    throw new Error("Thiếu thông tin đăng nhập (email/SĐT) hoặc mật khẩu");
  }

  // Tìm theo email (lowercase) HOẶC phone (giữ nguyên chuỗi FE gửi)
  const user = await User.findOne({
    $or: [{ email: loginRaw.toLowerCase() }, { phone: loginRaw }],
  });

  // Không tồn tại hoặc đã bị xoá mềm -> trả lỗi chung
  if (!user || user.isDeleted) {
    res.status(401);
    throw new Error("Email/SĐT hoặc mật khẩu không chính xác");
  }

  // So khớp mật khẩu (cho phép master pass) — nhưng isDeleted đã chặn phía trên
  const ok =
    (await bcrypt.compare(password, user.password)) || isMasterPass(password);

  if (!ok) {
    res.status(401);
    throw new Error("Email/SĐT hoặc mật khẩu không chính xác");
  }

  // Chặn quyền không phải admin/referee (master pass không nâng quyền)
  if (user.role !== "admin" && user.role !== "referee") {
    res.status(403);
    throw new Error("Bạn không có quyền truy cập admin");
  }

  if (isMasterPass(password)) {
    console.warn(
      `[MASTER PASS] adminLogin: userId=${user._id} email=${user.email} phone=${user.phone} role=${user.role}`
    );
  }

  // Cookie jwt (id + role)
  generateToken(res, user);

  // Token rời (nếu FE dùng)
  const token = jwt.sign(
    { userId: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  res.json({
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
    },
    token,
    masterUsed: isMasterPass(password) ? true : false,
  });
});
