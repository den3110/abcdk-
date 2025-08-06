// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";

/* --------- Bảo vệ tất cả route yêu cầu đăng nhập --------- */
export const protect = asyncHandler(async (req, res, next) => {
  const token = req.cookies.jwt;
  if (!token) {
    res.status(401);
    throw new Error("Not authorized, no token");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // lấy user, gắn vào req (đã có .role)
    req.user = await User.findById(decoded.userId).select("-password");
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized, user not found");
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(401);
    throw new Error("Not authorized, token failed");
  }
});

/* --------- Middleware kiểm tra quyền --------- */
export const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }
  if (!allowedRoles.includes(req.user.role)) {
    res.status(403);
    throw new Error("Forbidden – insufficient role");
  }
  next();
};
