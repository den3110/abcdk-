// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import Match from "../models/matchModel.js"
import Tournament from "../models/tournamentModel.js"
import mongoose from "mongoose";

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

export const protectJwt = asyncHandler(async (req, res, next) => {
  let token;

  // 1. Extract Bearer token from Authorization header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized — no token provided");
  }

  try {
    // 2. Verify & decode
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // 3. Lookup user in DB (exclude password)
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      res.status(401);
      throw new Error("Not authorized — user not found");
    }

    // 4. Attach to request
    req.user = user;
    next();
  } catch (err) {
    console.error("JWT verification failed:", err.message);
    res.status(401);
    throw new Error("Not authorized — token invalid or expired");
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

/* Chỉ referee hoặc admin */
export const refereeOnly = (req, res, next) => {
  const role = req.user?.role;
  if (role === "referee" || role === "admin") return next();
  res.status(403);
  throw new Error("Referee-only endpoint");
};

export function canScore(req, res, next) {
  // Admin/Referee chấm bất kỳ; user chỉ chấm chính mình
  const targetUserId = req.params.userId || req.body.userId;
  const isSelf = String(req.user._id) === String(targetUserId);
  const role = req.user.role;
  if (isSelf || role === "admin" || role === "referee") return next();
  return res.status(403).json({ message: "Forbidden" });
}

export async function optionalAuth(req, res, next) {
  try {
    let token = null;

    if (req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies?.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) return next(); // khách vãng lai

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const uid = payload.userId || payload.id || payload._id;

    if (uid) {
      const u = await User.findById(uid)
        .select("_id roles role isAdmin")
        .lean();
      if (u) {
        req.user = {
          _id: String(u._id),
          roles: Array.isArray(u.roles) ? u.roles : (u.role ? [u.role] : []),
          role: u.role,
          isAdmin: !!u.isAdmin,
        };
      }
    }
  } catch (e) {
    // token hỏng/expire → coi như khách, không 401
  }
  next();
}

export const isManagerTournament = asyncHandler(async (req, res, next) => {
  // Yêu cầu đã có req.user (thường đặt sau protect)
  if (!req.user?._id) {
    res.status(401);
    throw new Error("Not authorized – no user");
  }

  // Lấy matchId từ params
  const matchId = req.params?.id || req.params?.matchId;
  if (!mongoose.isValidObjectId(matchId)) {
    res.status(400);
    throw new Error("Invalid match id");
  }

  // Tìm match
  const match = await Match.findById(matchId);
  if (!match) {
    res.status(404);
    throw new Error("Match not found");
  }

  // Admin luôn pass
  const isAdmin =
    req.user.isAdmin ||
    req.user.role === "admin" ||
    (Array.isArray(req.user.roles) && req.user.roles.includes("admin"));
  if (isAdmin) {
    req.match = match;
    return next();
  }

  // Kiểm tra owner/manager của tournament chứa match này
  const t = await Tournament.findById(match.tournament)
    .select("createdBy managers")
    .lean();
  if (!t) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const uid = String(req.user._id);
  const isOwner = String(t.createdBy) === uid;

  const isManager = Array.isArray(t.managers)
    ? t.managers.some((m) => {
        const v =
          typeof m === "object" && m !== null
            ? (m.user ?? m._id ?? m)
            : m;
        return String(v) === uid;
      })
    : false;

  if (!isOwner && !isManager) {
    res.status(403);
    throw new Error("Forbidden");
  }

  // Gắn doc để controller dùng
  req.match = match;
  return next();
});