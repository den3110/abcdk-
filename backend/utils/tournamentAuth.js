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
