// controllers/adminAuthController.js
import asyncHandler from "express-async-handler";
import bcrypt from "bcryptjs";
import User from "../../models/userModel.js";
import generateToken from "../../utils/generateToken.js";

export const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401);
    throw new Error("Email hoặc mật khẩu không đúng");
  }

  if (user.role !== "admin") {
    res.status(403);
    throw new Error("Bạn không có quyền truy cập admin");
  }

  generateToken(res, user);           // set cookie jwt (id + role)

  res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
  });
});
