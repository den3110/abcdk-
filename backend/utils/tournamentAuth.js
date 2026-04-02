import Tournament from "../models/tournamentModel.js";
import TournamentManager from "../models/tournamentManagerModel.js";

const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase();

const extractUserId = (userOrId) => {
  if (!userOrId) return "";
  if (typeof userOrId === "string" || typeof userOrId === "number") {
    return String(userOrId);
  }
  if (userOrId?._id || userOrId?.id) {
    return String(userOrId._id || userOrId.id || "");
  }
  if (typeof userOrId?.toString === "function") {
    const value = String(userOrId);
    if (value && value !== "[object Object]") return value;
  }
  return "";
};

const isAdminLike = (user) => {
  if (!user || typeof user !== "object") return false;
  if (
    user?.isAdmin === true ||
    user?.isSuperAdmin === true ||
    user?.isSuperUser === true
  ) {
    return true;
  }

  if (
    ["admin", "superadmin", "superuser"].includes(normalizeRole(user?.role))
  ) {
    return true;
  }

  if (Array.isArray(user?.roles)) {
    return user.roles.some((role) => {
      const normalized = normalizeRole(role);
      return (
        normalized === "admin" ||
        normalized === "superadmin" ||
        normalized === "superuser"
      );
    });
  }

  return false;
};

const includesUser = (items, userId) =>
  Array.isArray(items) &&
  items.some((item) => {
    const value =
      typeof item === "object" && item !== null ? item.user ?? item._id ?? item : item;
    return extractUserId(value) === String(userId);
  });

async function loadTournamentManagerMeta(tournamentId) {
  if (!tournamentId) return null;
  return Tournament.findById(tournamentId)
    .select("createdBy owner managers staffs organizers")
    .lean();
}

export async function isTournamentManager(userId, tournamentId) {
  const normalizedUserId = extractUserId(userId);
  if (!normalizedUserId || !tournamentId) return false;

  const tournament = await loadTournamentManagerMeta(tournamentId);
  if (!tournament) return false;

  const ownerId = extractUserId(tournament?.owner);
  const creatorId = extractUserId(tournament?.createdBy);

  if (
    String(ownerId || "") === normalizedUserId ||
    String(creatorId || "") === normalizedUserId
  ) {
    return true;
  }

  if (
    includesUser(tournament?.managers, normalizedUserId) ||
    includesUser(tournament?.staffs, normalizedUserId) ||
    includesUser(tournament?.organizers, normalizedUserId)
  ) {
    return true;
  }

  const ok = await TournamentManager.exists({
    tournament: tournamentId,
    user: normalizedUserId,
  });
  return !!ok;
}

export async function canManageTournament(user, tournamentId) {
  const normalizedUserId = extractUserId(user);
  if (!normalizedUserId || !tournamentId) return false;

  if (isAdminLike(user)) return true;

  return isTournamentManager(normalizedUserId, tournamentId);
}

/**
 * Middleware: yêu cầu user phải quản lý được giải (hoặc admin)
 * - Đọc tournamentId từ:
 *    + req.tournamentId (nếu đã gắn sẵn từ middleware khác, vd: attachTournamentFromBracket)
 *    + req.params.tournamentId
 *    + req.body.tournamentId
 *    + req.query.tournamentId
 * - Nếu ok → next()
 * - Nếu không → "cút" (403)
 */
export async function requireTournamentManager(req, res, next) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const tournamentId =
      req.tournamentId ||
      req.params?.tournamentId ||
      req.body?.tournamentId ||
      req.query?.tournamentId ||
      req.tournament?._id;

    if (!tournamentId) {
      return res
        .status(400)
        .json({ message: "Missing tournamentId" });
    }

    const ok = await canManageTournament(user, tournamentId);
    if (!ok) {
      return res
        .status(403)
        .json({ message: "Bạn không có quyền quản lý giải này" });
    }

    // normalize lại để các middleware/controller sau xài chung
    req.tournamentId = String(tournamentId);

    return next();
  } catch (err) {
    console.error("[requireTournamentManager] error:", err);
    return res
      .status(500)
      .json({ message: "Internal server error" });
  }
}
