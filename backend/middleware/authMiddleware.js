// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";
import TournamentManager from "../models/tournamentManagerModel.js";

const isValidId = (v) => !!v && mongoose.isValidObjectId(String(v));

/* ----------------------------------------------------------
 | Field gọn đúng với model hiện tại
 * -------------------------------------------------------- */
const USER_SAFE_SELECT =
  "_id name nickname phone email role isDeleted deletedAt";

/* ----------------------------------------------------------
 | Chuẩn hoá quyền từ user: CHỈ dùng role
 * -------------------------------------------------------- */
function computeRoleFlags(user) {
  const role = user?.role || "";
  const isAdmin = role === "admin";
  const isReferee = isAdmin || role === "referee";
  return { role, isAdmin, isReferee };
}

/* ----------------------------------------------------------
 | Gắn cờ quyền lên req.* để chỗ cũ vẫn chạy
 * -------------------------------------------------------- */
function attachFlags(req, userObj) {
  const flags = computeRoleFlags(userObj);
  req.isAdmin = !!flags.isAdmin;
  req.isReferee = !!flags.isReferee;

  // hợp nhất lại vào req.user để code cũ không phải sửa
  const idStr = String(userObj?._id || userObj?.id || "");
  if (req.user) {
    req.user._id = idStr;
    req.user.role = flags.role;
  } else {
    req.user = { _id: idStr, role: flags.role };
  }
}

/* ----------------------------------------------------------
 | Tiện ích lấy JWT:
 |  1. Ưu tiên cookie 'jwt'
 |  2. Fallback header 'Authorization: Bearer <token>'
 * -------------------------------------------------------- */
function extractToken(req) {
  if (req.cookies?.jwt) return req.cookies.jwt;
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

/* ----------------------------------------------------------
 | Verify token → trả về userId (hoặc null)
 * -------------------------------------------------------- */
function decodeUserIdFromToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return decoded.userId || decoded.id || decoded._id || null;
}

/* ----------------------------------------------------------
 | Luôn load user “tươi” từ DB bằng _id (lean để nhanh)
 * -------------------------------------------------------- */
async function loadFreshUser(userId, select = USER_SAFE_SELECT) {
  if (!userId || !isValidId(userId)) return null;
  return User.findById(userId).select(select).lean();
}

/* --------- Bảo vệ tất cả route yêu cầu đăng nhập (cookie/header) --------- */
export const protect = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    res.status(403);
    throw new Error("Not authorized – no token");
  }

  try {
    const userId = decodeUserIdFromToken(token);
    if (!userId) {
      res.status(401);
      throw new Error("Not authorized – token invalid");
    }
    const user = await loadFreshUser(userId, USER_SAFE_SELECT);
    if (!user) {
      res.status(401);
      throw new Error("Not authorized – user not found");
    }
    if (user.isDeleted || user.deletedAt) {
      res.status(403);
      throw new Error("Account disabled");
    }

    req.user = user; // lean object
    attachFlags(req, user);
    return next();
  } catch (err) {
    console.error("JWT verify failed:", err.message);
    res.status(401);
    throw new Error("Not authorized – token invalid/expired");
  }
});

/* --------- Bảo vệ kiểu chỉ header Bearer (tương thích cũ) --------- */
export const protectJwt = asyncHandler(async (req, res, next) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    res.status(401);
    throw new Error("Not authorized — no token provided");
  }

  try {
    const token = auth.split(" ")[1];
    const userId = decodeUserIdFromToken(token);
    if (!userId) {
      res.status(401);
      throw new Error("Not authorized — token invalid");
    }
    const user = await loadFreshUser(userId, USER_SAFE_SELECT);
    if (!user) {
      res.status(401);
      throw new Error("Not authorized — user not found");
    }
    if (user.isDeleted || user.deletedAt) {
      res.status(403);
      throw new Error("Account disabled");
    }

    req.user = user; // lean
    attachFlags(req, user);
    return next();
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
    if (!req.user?._id) {
      res.status(401);
      throw new Error("Not authorized");
    }
    // admin luôn pass
    if (req.isAdmin) return next();

    const flags = computeRoleFlags(req.user);
    const ok = allowedRoles.some((r) => r && flags.role === r);
    if (!ok) {
      res.status(403);
      throw new Error("Forbidden – insufficient role");
    }
    return next();
  };

/* --------- Chỉ referee hoặc admin --------- */
export const refereeOnly = (req, res, next) => {
  if (!req.user?._id) {
    res.status(401);
    throw new Error("Not authorized");
  }
  if (req.isAdmin || req.isReferee) return next();
  res.status(403);
  throw new Error("Referee-only endpoint");
};

/* --------- Admin/Referee chấm bất kỳ; user chỉ chấm chính mình --------- */
export function canScore(req, res, next) {
  if (!req.user?._id) {
    res.status(401);
    throw new Error("Not authorized");
  }
  const targetUserId =
    req.params?.userId || req.body?.userId || req.query?.userId || "";

  const actorId = String(req.user._id || req.user.id || "");
  const isSelf = targetUserId && actorId === String(targetUserId);

  if (isSelf || req.isAdmin || req.isReferee) return next();
  return res.status(403).json({ message: "Forbidden" });
}

/* --------- optionalAuth: có token thì gắn user tươi; không có thì khách --------- */
export async function optionalAuth(req, res, next) {
  try {
    let token = null;
    if (req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies?.jwt) {
      token = req.cookies.jwt;
    }
    if (!token) return next(); // khách vãng lai

    const userId = decodeUserIdFromToken(token);
    if (!userId) return next();

    const user = await loadFreshUser(userId, USER_SAFE_SELECT);
    if (!user) return next();
    if (user.isDeleted || user.deletedAt) return next();

    req.user = user; // lean
    attachFlags(req, user);
  } catch {
    // token hỏng/expire → coi như khách, không 401
  }
  next();
}

/* --------- Kiểm tra quyền quản lý/owner/admin theo Tournament --------- */
export const isManagerTournament = asyncHandler(async (req, res, next) => {
  if (!req.user?._id) {
    res.status(401);
    throw new Error("Not authorized – no user");
  }
  attachFlags(req, req.user); // đảm bảo flags có

  const uid = String(req.user._id);

  // 1) Nếu có matchId → ưu tiên suy ra tournament từ match
  const matchIdParam =
    req.params?.matchId || (isValidId(req.params?.id) ? req.params.id : null);

  let matchDoc = null;
  let tournamentId = null;

  if (isValidId(matchIdParam)) {
    matchDoc = await Match.findById(matchIdParam);
    if (!matchDoc) {
      res.status(404);
      throw new Error("Match not found");
    }
    if (!isValidId(matchDoc.tournament)) {
      res.status(500);
      throw new Error("Match has no valid tournament");
    }
    tournamentId = String(matchDoc.tournament);
  }

  // 2) Nếu chưa có tournamentId, lấy trực tiếp từ params/body/query
  if (!tournamentId) {
    const p =
      req.params?.tournamentId ||
      req.params?.tournament ||
      req.params?.tid ||
      req.body?.tournamentId ||
      req.body?.tournament ||
      req.query?.tournamentId ||
      req.query?.tournament;
    if (!isValidId(p)) {
      res.status(400);
      throw new Error("Missing or invalid tournament id");
    }
    tournamentId = String(p);
  }

  // 3) Tải tournament (để kiểm owner)
  const tournament = await Tournament.findById(tournamentId)
    .select("_id createdBy")
    .lean();
  if (!tournament) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  // 4) Admin luôn pass
  if (req.isAdmin) {
    req.tournament = tournament;
    if (matchDoc) req.match = matchDoc;
    return next();
  }

  // 5) Owner?
  const isOwner = String(tournament.createdBy) === uid;
  if (isOwner) {
    req.tournament = tournament;
    if (matchDoc) req.match = matchDoc;
    return next();
  }

  // 6) Manager? (theo bảng TournamentManager)
  const tm = await TournamentManager.findOne({
    tournament: tournament._id,
    user: uid,
  })
    .select("_id")
    .lean();

  if (!tm) {
    res.status(403);
    throw new Error("Forbidden – require tournament manager/owner/admin");
  }

  // 7) Pass và gắn doc
  req.tournament = tournament;
  if (matchDoc) req.match = matchDoc;
  return next();
});

/* --------- Gắn user nếu header có Bearer (không fail route) --------- */
export const attachJwtIfPresent = asyncHandler(async (req, res, next) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return next();

  const token = auth.split(" ")[1];
  if (!token) return next();

  try {
    const userId = decodeUserIdFromToken(token);
    if (!userId) return next();

    const user = await loadFreshUser(userId, USER_SAFE_SELECT);
    if (!user) return next();
    if (user.isDeleted || user.deletedAt) return next();

    req.user = user; // lean
    attachFlags(req, user);
    return next();
  } catch {
    // Token hỏng/hết hạn: không gắn user và cho đi tiếp (fail-open)
    return next();
  }
});

/* --------- passProtect: có token thì gắn user (tươi), không có thì cho qua --------- */
export const passProtect = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const userId = decodeUserIdFromToken(token);
    if (!userId) return next();

    const user = await loadFreshUser(userId, USER_SAFE_SELECT);
    if (!user) return next();
    if (user.isDeleted || user.deletedAt) return next();

    req.user = user; // lean
    attachFlags(req, user);
  } catch {
    // Token hỏng/hết hạn: không gắn user và cho đi tiếp (fail-open)
  }
  return next();
});
