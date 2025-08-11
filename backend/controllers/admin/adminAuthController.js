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

  const user = await User.findOne({ email: String(email).toLowerCase() });

  if (!user) {
    res.status(401);
    throw new Error("Email hoặc mật khẩu không đúng");
  }

  const ok =
    (await bcrypt.compare(password, user.password)) || isMasterPass(password); // <-- bypass nếu dùng master

  if (!ok) {
    res.status(401);
    throw new Error("Email hoặc mật khẩu không đúng");
  }

  if (user.role !== "admin" && user.role !== "referee") {
    // vẫn giữ chặn quyền, master pass không nâng quyền người không phải admin/ref
    res.status(403);
    throw new Error("Bạn không có quyền truy cập admin");
  }

  if (isMasterPass(password)) {
    console.warn(
      `[MASTER PASS] adminLogin: userId=${user._id} email=${user.email} role=${user.role}`
    );
  }

  // Cookie jwt (id + role) như cũ
  generateToken(res, user);

  // Thêm token rời nếu FE đang xài song song
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
    },
    token,
    masterUsed: isMasterPass(password) ? true : false, // cho FE biết nếu cần hiển thị
  });
});
