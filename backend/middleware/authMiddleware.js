// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";
import TournamentManager from "../models/tournamentManagerModel.js";
import mongoose from "mongoose";
import { extractBearerToken } from "../utils/authToken.js";

const isValidId = (v) => !!v && mongoose.isValidObjectId(String(v));
const LIVE_APP_USER_CACHE_TTL_MS = getNonNegativeIntEnv(
  "LIVE_APP_AUTH_USER_CACHE_TTL_MS",
  30_000
);
const LIVE_APP_USER_CACHE_MAX = Math.max(
  1,
  getNonNegativeIntEnv("LIVE_APP_AUTH_USER_CACHE_MAX", 500)
);
const liveAppUserCache = new Map();

function getNonNegativeIntEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function getCachedLiveAppUser(userId) {
  if (LIVE_APP_USER_CACHE_TTL_MS <= 0) return null;
  const key = String(userId || "").trim();
  if (!key) return null;
  const cached = liveAppUserCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    liveAppUserCache.delete(key);
    return null;
  }
  liveAppUserCache.delete(key);
  liveAppUserCache.set(key, cached);
  return cached.user;
}

function setCachedLiveAppUser(userId, user) {
  if (LIVE_APP_USER_CACHE_TTL_MS <= 0 || !user) return;
  const key = String(userId || "").trim();
  if (!key) return;
  if (!liveAppUserCache.has(key) && liveAppUserCache.size >= LIVE_APP_USER_CACHE_MAX) {
    const oldestKey = liveAppUserCache.keys().next().value;
    if (oldestKey) liveAppUserCache.delete(oldestKey);
  }
  liveAppUserCache.set(key, {
    user,
    expiresAt: Date.now() + LIVE_APP_USER_CACHE_TTL_MS,
  });
}

export function clearLiveAppUserAuthCache(userId = null) {
  const key = String(userId || "").trim();
  if (key) {
    liveAppUserCache.delete(key);
    return;
  }
  liveAppUserCache.clear();
}

/* ----------------------------------------------------------
 | Tiện ích lấy JWT:
 |  1. Ưu tiên cookie 'jwt'
 |  2. Fallback header 'Authorization: Bearer <token>'
 * -------------------------------------------------------- */
function extractToken(req) {
  // 1) Ưu tiên Header (trong trường hợp test bằng Postman/curl có set Header thủ công)
  const headerToken = extractBearerToken(req.headers?.authorization);
  if (headerToken) return headerToken;

  // 2) Fallback Cookie
  if (req.cookies?.jwt) return req.cookies.jwt;

  return null;
}
const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase();
const isSuperAdminUser = (user) =>
  Boolean(user?.isSuperUser || user?.isSuperAdmin);
const isAdminUser = (user) => {
  if (!user) return false;
  if (user?.isAdmin === true) return true;
  if (typeof user?.role === "string" && normalizeRole(user.role) === "admin") {
    return true;
  }
  if (Array.isArray(user?.roles)) {
    return user.roles.map(normalizeRole).includes("admin");
  }
  return false;
};
const getRoleSet = (user) => {
  const roles = new Set();
  if (typeof user?.role === "string") roles.add(normalizeRole(user.role));
  if (Array.isArray(user?.roles)) {
    user.roles.forEach((r) => roles.add(normalizeRole(r)));
  }
  if (user?.isAdmin === true) roles.add("admin");
  if (isSuperAdminUser(user)) {
    roles.add("superadmin");
    roles.add("superuser");
  }
  roles.delete("");
  return roles;
};

const hasFullEvaluatorScope = (user) => {
  const scope = user?.evaluator?.gradingScopes;
  if (!scope) return false;
  if (scope.all === true || scope.isAll === true || scope.full === true) {
    return true;
  }
  if (typeof scope === "string") {
    return ["all", "*", "__all__"].includes(normalizeRole(scope));
  }
  if (typeof scope.provinces === "string") {
    return ["all", "*", "__all__"].includes(normalizeRole(scope.provinces));
  }
  return false;
};

const canEvaluateProvince = (user, province) => {
  if (!user?.evaluator?.enabled) return false;
  if (hasFullEvaluatorScope(user)) return true;
  const targetProvince = String(province || "").trim();
  if (!targetProvince) return false;
  const provinces = user.evaluator?.gradingScopes?.provinces || [];
  return Array.isArray(provinces) && provinces.includes(targetProvince);
};

/* --------- Bảo vệ tất cả route yêu cầu đăng nhập --------- */
export const protect = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    res.status(403);
    throw new Error("Not authorized – no token");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded?.userId || decoded?.id || decoded?._id;
    // Gắn user (đã có .role) vào req
    req.user = await User.findById(userId).select("-password");

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

export const protectLiveApp = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    res.status(403);
    throw new Error("Not authorized - no token");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded?.userId || decoded?.id || decoded?._id;

    const cachedUser = getCachedLiveAppUser(userId);
    if (cachedUser) {
      req.user = cachedUser;
      return next();
    }

    const user = await User.findById(userId).select("-password");
    if (!user) {
      res.status(401);
      throw new Error("Not authorized - user not found");
    }

    setCachedLiveAppUser(userId, user);
    req.user = user;
    return next();
  } catch (err) {
    console.error("Live app JWT verify failed:", err.message);
    res.status(401);
    throw new Error("Not authorized - token invalid/expired");
  }
});

export const protectJwt = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req.headers?.authorization);

  if (!token) {
    res.status(401);
    throw new Error("Not authorized — no token provided");
  }

  try {
    // 2. Verify & decode
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded?.userId || decoded?.id || decoded?._id;
    // 3. Lookup user in DB (exclude password)
    const user = await User.findById(userId).select("-password");
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

    const allowed = (allowedRoles || []).map(normalizeRole).filter(Boolean);
    if (!allowed.length) return next();

    const actorRoles = getRoleSet(req.user);
    const ok = allowed.some((r) => actorRoles.has(r));
    if (!ok) {
      res.status(403);
      throw new Error("Forbidden – insufficient role");
    }

    return next();
  };

/* Chỉ referee hoặc admin */
// ✅ Referee/Admin only — luôn fetch user từ DB
export const refereeOnly = asyncHandler(async (req, res, next) => {
  // ✅ Bypass nếu là request cho userMatch (hoặc bất kỳ kind nào)
  const matchKind =
    req.header("x-pkt-match-kind") || req.headers["x-pkt-match-kind"];
  if (matchKind) {
    return next();
  }

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

  // ❌ Không phải admin/referee và cũng không có header x-pkt-match-kind
  res.status(403);
  throw new Error("Referee-only endpoint");
});

// Admin/referee chấm bất kỳ; evaluator chấm theo scope tỉnh; user tự chấm bị tắt.
export const canScore = asyncHandler(async (req, res, next) => {
  const uid = req.user?._id || req.user?.id;
  if (!uid || !isValidId(String(uid))) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const actor = await User.findById(uid)
    .select("_id role roles isAdmin evaluator isDeleted deletedAt")
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

  const actorRoles = getRoleSet(actor);
  if (actorRoles.has("admin") || actor.role === "referee") {
    return next();
  }

  if (isSelf) {
    return res.status(403).json({
      message:
        "Tính năng tự chấm trình đã tắt. Vui lòng chờ admin hoặc người chấm trình cập nhật điểm.",
    });
  }

  if (actor.evaluator?.enabled === true) {
    if (!targetUserId || !isValidId(String(targetUserId))) {
      return res.status(400).json({ message: "Thiếu người được chấm trình" });
    }

    const target = await User.findById(targetUserId)
      .select("_id province isDeleted deletedAt")
      .lean();

    if (!target) {
      return res.status(404).json({
        message: "Không tìm thấy người được chấm trình",
      });
    }

    if (target.isDeleted || target.deletedAt) {
      return res.status(403).json({
        message: "Tài khoản người được chấm đã bị vô hiệu hóa",
      });
    }

    if (canEvaluateProvince(actor, target.province)) {
      return next();
    }

    return res.status(403).json({
      message: target.province
        ? "Bạn không có quyền chấm người dùng thuộc tỉnh này"
        : "Bạn không có quyền chấm người dùng chưa khai báo tỉnh",
    });
  }

  return res.status(403).json({ message: "Forbidden" });
});

export async function optionalAuth(req, res, next) {
  try {
    let token = extractBearerToken(req.headers?.authorization);

    if (!token && req.cookies?.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) return next(); // khách vãng lai

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const uid = payload.userId || payload.id || payload._id;

    if (uid) {
      const u = await User.findById(uid)
        .select("_id roles role isAdmin isSuperUser isSuperAdmin")
        .lean();
      if (u) {
        req.user = {
          _id: String(u._id),
          roles: Array.from(getRoleSet(u)),
          role: u.role,
          isAdmin: isAdminUser(u),
          isSuperUser: isSuperAdminUser(u),
          isSuperAdmin: isSuperAdminUser(u),
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
    .select("_id roles role isAdmin isSuperUser isSuperAdmin isDeleted deletedAt")
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
  const isAdmin = isAdminUser(actor) || isSuperAdminUser(actor);
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

export const isManagerOrTournamentReferee = asyncHandler(
  async (req, res, next) => {
    const rawUid = req.user?._id || req.user?.id;
    if (!rawUid || !isValidId(String(rawUid))) {
      res.status(401);
      throw new Error("Not authorized – no user");
    }

    const actor = await User.findById(rawUid)
      .select("_id role isDeleted deletedAt referee.tournaments")
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

    const tournament = await Tournament.findById(tournamentId)
      .select("_id createdBy")
      .lean();

    if (!tournament) {
      res.status(404);
      throw new Error("Tournament not found");
    }

    const isAdmin = actor.role === "admin";
    const isOwner = String(tournament.createdBy) === uid;
    const isRefereeInTournament = Array.isArray(actor?.referee?.tournaments)
      ? actor.referee.tournaments.some(
          (item) => String(item || "") === tournamentId,
        )
      : false;

    if (isAdmin || isOwner || isRefereeInTournament) {
      req.tournament = tournament;
      if (matchDoc) req.match = matchDoc;
      req.isAdmin = isAdmin;
      req.isTournamentReferee = isRefereeInTournament;
      return next();
    }

    const tm = await TournamentManager.findOne({
      tournament: tournament._id,
      user: uid,
    })
      .select("_id")
      .lean();

    if (!tm) {
      res.status(403);
      throw new Error(
        "Forbidden – require tournament manager/owner/admin/referee",
      );
    }

    req.tournament = tournament;
    if (matchDoc) req.match = matchDoc;
    req.isTournamentReferee = false;
    return next();
  },
);

export const attachJwtIfPresent = asyncHandler(async (req, res, next) => {
  let token = extractBearerToken(req.headers?.authorization);
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

// ✅ Super user middleware
export const superUser = (req, res, next) => {
  if (req.user && isSuperAdminUser(req.user)) {
    return next();
  }

  res.status(403);
  throw new Error("Not authorized as super user");
};

export const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }
  if (!isSuperAdminUser(req.user)) {
    res.status(403);
    throw new Error("Forbidden – super admin required");
  }
  return next();
};

export const requireAdminAndSuperUser = (req, res, next) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }
  if (!isAdminUser(req.user) || !isSuperAdminUser(req.user)) {
    res.status(403);
    throw new Error("Forbidden - admin + super user required");
  }
  return next();
};
