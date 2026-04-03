import { dispatchMatchLiveActivityUpdate } from "../services/liveActivityApns.service.js";

const normalizeId = (value) => {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (typeof value === "object") {
    return String(value?._id ?? value?.id ?? "").trim();
  }
  return "";
};

export const tournamentRoom = (tournamentId) =>
  `tournament:${String(tournamentId || "").trim()}`;

export const drawRoom = (bracketId) =>
  `draw:${String(bracketId || "").trim()}`;

export const matchRoom = (matchId) =>
  `match:${String(matchId || "").trim()}`;

export function extractTournamentRealtimeScope(source = {}, fallback = {}) {
  const matchId =
    normalizeId(fallback.matchId) ||
    normalizeId(source?.matchId) ||
    normalizeId(source?._id);
  const bracketId =
    normalizeId(fallback.bracketId) ||
    normalizeId(source?.bracketId) ||
    normalizeId(source?.bracket);
  const tournamentId =
    normalizeId(fallback.tournamentId) ||
    normalizeId(source?.tournamentId) ||
    normalizeId(source?.tournament);

  return { matchId, bracketId, tournamentId };
}

export function emitTournamentMatchUpdate(
  io,
  source,
  data,
  {
    type = "update",
    matchId,
    bracketId,
    tournamentId,
    emitMatchSnapshot = false,
    emitMatchUpdate = true,
    emitScoreUpdated = false,
  } = {}
) {
  if (!io || !data) return null;

  const scope = extractTournamentRealtimeScope(source || data, {
    matchId,
    bracketId,
    tournamentId,
  });

  if (!scope.matchId) return null;

  const room = matchRoom(scope.matchId);
  const payload = {
    type,
    matchId: scope.matchId,
    bracketId: scope.bracketId || undefined,
    tournamentId: scope.tournamentId || undefined,
    data,
  };

  if (emitMatchSnapshot) {
    io.to(room).emit("match:snapshot", data);
  }
  if (emitScoreUpdated) {
    io.to(room).emit("score:updated", data);
  }
  if (emitMatchUpdate) {
    io.to(room).emit("match:update", payload);
  }
  if (scope.bracketId) {
    io.to(drawRoom(scope.bracketId)).emit("draw:match:update", payload);
  }
  if (scope.tournamentId) {
    io.to(tournamentRoom(scope.tournamentId)).emit(
      "tournament:match:update",
      payload
    );
  }

  const liveActivitySource =
    (data && typeof data === "object" ? data : null) ||
    (source && typeof source === "object" ? source : null);
  if (liveActivitySource) {
    void dispatchMatchLiveActivityUpdate(liveActivitySource).catch((error) => {
      console.error(
        "[live-activity] emitTournamentMatchUpdate error:",
        error?.message || error
      );
    });
  }

  return payload;
}

export function emitTournamentInvalidate(
  io,
  { tournamentId, bracketId, matchId = null, reason = "unknown" } = {}
) {
  if (!io) return null;

  const normalizedTournamentId = normalizeId(tournamentId);
  const normalizedBracketId = normalizeId(bracketId);
  const normalizedMatchId = normalizeId(matchId);

  if (!normalizedTournamentId && !normalizedBracketId) return null;

  const payload = {
    tournamentId: normalizedTournamentId || undefined,
    bracketId: normalizedBracketId || undefined,
    matchId: normalizedMatchId || undefined,
    reason: String(reason || "unknown").trim() || "unknown",
    at: new Date().toISOString(),
  };

  if (normalizedTournamentId) {
    io.to(tournamentRoom(normalizedTournamentId)).emit(
      "tournament:invalidate",
      payload
    );
  }
  if (normalizedBracketId) {
    io.to(drawRoom(normalizedBracketId)).emit("tournament:invalidate", payload);
  }

  return payload;
}
