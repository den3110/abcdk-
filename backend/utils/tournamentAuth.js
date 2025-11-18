import TournamentManager from "../models/tournamentManagerModel.js";

export async function isTournamentManager(userId, tournamentId) {
  if (!userId || !tournamentId) return false;
  const ok = await TournamentManager.exists({
    tournament: tournamentId,
    user: userId,
  });
  return !!ok;
}

export async function canManageTournament(user, tournamentId) {
  if (!user) return false;
  if (user.role === "admin") return true;
  const check = await isTournamentManager(user._id, tournamentId);
  return check;
  
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
