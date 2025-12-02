// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";
import TournamentManager from "../models/tournamentManagerModel.js";
import mongoose from "mongoose";

const isValidId = (v) => !!v && mongoose.isValidObjectId(String(v));

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
    res.status(403);
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
// ✅ Referee/Admin only — luôn fetch user từ DB
export const refereeOnly = asyncHandler(async (req, res, next) => {
  const uid = req.user?._id || req.user?.id;
  if (!uid || !isValidId(String(uid))) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const actor = await User.findById(uid)
    .select("_id role isDeleted deletedAt")
    .lean();

  if (!actor) {
    res.status(401);
    throw new Error("Not authorized");
  }
  if (actor.isDeleted || actor.deletedAt) {
    res.status(403);
    throw new Error("Account disabled");
  }

  if (actor.role === "admin" || actor.role === "referee") return next();

  res.status(403);
  // throw new Error("Referee-only endpoint");
   return next(); // tạm thời để vậy 
});

// ✅ Admin/Referee chấm bất kỳ; user chỉ chấm chính mình — luôn fetch user từ DB
export const canScore = asyncHandler(async (req, res, next) => {
  const uid = req.user?._id || req.user?.id;
  if (!uid || !isValidId(String(uid))) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const actor = await User.findById(uid)
    .select("_id role isDeleted deletedAt")
    .lean();

  if (!actor) {
    res.status(401);
    throw new Error("Not authorized");
  }
  if (actor.isDeleted || actor.deletedAt) {
    res.status(403);
    throw new Error("Account disabled");
  }

  const targetUserId =
    req.params?.userId || req.body?.userId || req.query?.userId || "";

  const isSelf = targetUserId && String(actor._id) === String(targetUserId);

  if (isSelf || actor.role === "admin" || actor.role === "referee") {
    return next();
  }

  return res.status(403).json({ message: "Forbidden" });
});

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
          roles: Array.isArray(u.roles) ? u.roles : u.role ? [u.role] : [],
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
  // 0) Lấy actor từ DB cho "tươi"
  const rawUid = req.user?._id || req.user?.id;
  if (!rawUid || !isValidId(String(rawUid))) {
    res.status(401);
    throw new Error("Not authorized – no user");
  }

  const actor = await User.findById(rawUid)
    .select("_id role isDeleted deletedAt")
    .lean();

  if (!actor) {
    res.status(401);
    throw new Error("Not authorized – user not found");
  }
  if (actor.isDeleted || actor.deletedAt) {
    res.status(403);
    throw new Error("Account disabled");
  }

  const uid = String(actor._id);

  // 1) Nếu có matchId → ưu tiên suy ra tournament từ match
  const matchIdParam =
    req.params?.matchId || (isValidId(req.params?.id) ? req.params.id : null);

  let matchDoc = null;
  let tournamentId = null;

  if (isValidId(matchIdParam)) {
    // Giữ nguyên dạng doc thật để controller downstream có thể .save()
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

  // 4) Admin luôn pass (CHỈ dùng role)
  const isAdmin = actor.role === "admin";
  if (isAdmin) {
    req.tournament = tournament;
    if (matchDoc) req.match = matchDoc;
    req.isAdmin = true; // tiện cho downstream nếu cần
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

export const attachJwtIfPresent = asyncHandler(async (req, res, next) => {
  let token = null;

  // 1️⃣ Ưu tiên lấy từ Authorization header
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) {
    const parts = auth.split(" ");
    if (parts.length === 2 && parts[1]) {
      token = parts[1];
    }
  }
  // 2️⃣ Nếu chưa có thì lấy từ cookies
  //    Đổi tên accessToken / jwt cho khớp với cookie của bạn
  if (!token && req.cookies) {
    if (req.cookies.accessToken) {
      token = req.cookies.accessToken;
    } else if (req.cookies.jwt) {
      token = req.cookies.jwt;
    }
  }

  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Hỗ trợ cả 'userId' và 'id' cho linh hoạt cách sign
    const userId = decoded.userId || decoded.id;
    if (!userId) return next();

    const user = await User.findById(userId).select("-password");
    if (!user) return next();

    req.user = user;
    return next();
  } catch (err) {
    // Token hỏng/hết hạn: không gắn user và cho đi tiếp (fail-open)
    return next();
  }
});

export const passProtect = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Hỗ trợ cả userId/id/_id cho linh hoạt cách sign
    const userId = decoded.userId || decoded.id || decoded._id;
    if (!userId) return next();

    const user = await User.findById(userId).select("-password");
    if (!user) return next();

    req.user = user;
  } catch (err) {
    // Token hỏng/hết hạn: không gắn user và cho đi tiếp (fail-open)
  }
  return next();
});
