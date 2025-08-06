// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";

/* ----------------------------------------------------------
 | Tiện ích lấy JWT:
 |  1. Ưu tiên cookie 'jwt'
 |  2. Fallback header 'Authorization: Bearer <token>'
 * -------------------------------------------------------- */
function extractToken(req) {
  // 1) Cookie
  if (req.cookies?.jwt) return req.cookies.jwt;

  // 2) Header
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);

  return null;
}

/* --------- Bảo vệ tất cả route yêu cầu đăng nhập --------- */
export const protect = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    res.status(401);
    throw new Error("Not authorized – no token");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Gắn user (đã có .role) vào req
    req.user = await User.findById(decoded.userId).select("-password");

    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized – user not found");
    }

    return next();
  } catch (err) {
    console.error("JWT verify failed:", err.message);
    res.status(401);
    throw new Error("Not authorized – token invalid/expired");
  }
});

/* --------- Middleware kiểm tra quyền (role) --------- */
export const authorize =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403);
      throw new Error("Forbidden – insufficient role");
    }

    return next();
  };
