import { dispatchMatchLiveActivityUpdate } from "../services/liveActivityApns.service.js";
import { invalidateMatchSnapshotCache } from "../services/matchSnapshotCache.service.js";

const envValue = (key) =>
  typeof process !== "undefined" ? process.env?.[key] : undefined;

const readPositiveInt = (key, fallback, { max = 1000 } = {}) => {
  const value = Number(envValue(key));
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(max, Math.trunc(value));
};

const MATCH_UPDATE_FLUSH_MS = readPositiveInt(
  "SOCKET_MATCH_UPDATE_FLUSH_MS",
  800,
  { max: 1500 }
);
const MATCH_UPDATE_MAX_WAIT_MS = readPositiveInt(
  "SOCKET_MATCH_UPDATE_MAX_WAIT_MS",
  1500,
  { max: 5000 }
);
const INVALIDATE_FLUSH_MS = readPositiveInt(
  "SOCKET_INVALIDATE_FLUSH_MS",
  1000,
  { max: 2000 }
);
const INVALIDATE_MAX_WAIT_MS = readPositiveInt(
  "SOCKET_INVALIDATE_MAX_WAIT_MS",
  2000,
  { max: 5000 }
);
const LIVE_ACTIVITY_FLUSH_MS = readPositiveInt(
  "SOCKET_LIVE_ACTIVITY_FLUSH_MS",
  1500,
  { max: 5000 }
);
const MAX_PENDING_MATCH_UPDATES = readPositiveInt(
  "SOCKET_MAX_PENDING_MATCH_UPDATES",
  5000,
  { max: 50000 }
);
const MAX_PENDING_INVALIDATES = readPositiveInt(
  "SOCKET_MAX_PENDING_INVALIDATES",
  2000,
  { max: 20000 }
);
const MAX_PENDING_LIVE_ACTIVITY = readPositiveInt(
  "SOCKET_MAX_PENDING_LIVE_ACTIVITY",
  5000,
  { max: 50000 }
);

const pendingMatchUpdates = new Map();
const pendingInvalidates = new Map();
const pendingLiveActivities = new Map();
let matchUpdateFlushTimer = null;
let invalidateFlushTimer = null;
let liveActivityFlushTimer = null;

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

const nowMs = () => Date.now();

const scheduleTimer = (timerRef, callback, delayMs) =>
  timerRef || setTimeout(callback, Math.max(0, Number(delayMs) || 0));

const debounceFlushAt = (entry, delayMs, maxWaitMs) => {
  const now = nowMs();
  const firstAt = entry?.firstAt || now;
  const trailingAt = now + Math.max(0, Number(delayMs) || 0);
  const maxAt = firstAt + Math.max(0, Number(maxWaitMs) || 0);
  return Math.min(trailingAt, maxAt);
};

const emitToRoom = (io, room, eventName, payload) => {
  if (!io || !room || !eventName) return;
  try {
    io.to(room).emit(eventName, payload);
  } catch (error) {
    console.error(
      "[socket realtime] emit error:",
      eventName,
      room,
      error?.message || error
    );
  }
};

const versionOf = (value = {}) => {
  const version = Number(value?.liveVersion ?? value?.version);
  if (Number.isFinite(version) && version > 0) return version;
  const ts = Date.parse(value?.updatedAt || value?.liveAt || "");
  return Number.isFinite(ts) ? ts : 0;
};

const shouldReplaceMatchData = (current, incoming) => {
  if (!current?.data) return true;
  const currentVersion = versionOf(current.data);
  const nextVersion = versionOf(incoming);
  if (currentVersion > 0 && nextVersion > 0) {
    return nextVersion >= currentVersion;
  }
  return true;
};

const mergeScope = (current = {}, next = {}) => ({
  matchId: next.matchId || current.matchId || "",
  bracketId: next.bracketId || current.bracketId || "",
  tournamentId: next.tournamentId || current.tournamentId || "",
});

const buildMatchUpdatePayload = (entry) => ({
  type: entry.type || "update",
  matchId: entry.scope.matchId,
  bracketId: entry.scope.bracketId || undefined,
  tournamentId: entry.scope.tournamentId || undefined,
  data: entry.data,
});

const flushMatchUpdateEntry = (key, entry = pendingMatchUpdates.get(key)) => {
  if (!entry) return null;
  pendingMatchUpdates.delete(key);

  const { io, scope, data } = entry;
  if (!io || !scope?.matchId || !data) return null;

  const room = matchRoom(scope.matchId);
  const payload = buildMatchUpdatePayload(entry);

  if (entry.emitMatchSnapshot) {
    emitToRoom(io, room, "match:snapshot", data);
  }
  if (entry.emitScoreUpdated) {
    emitToRoom(io, room, "score:updated", data);
  }
  if (entry.emitMatchUpdate) {
    emitToRoom(io, room, "match:update", payload);
  }
  if (scope.bracketId) {
    emitToRoom(io, drawRoom(scope.bracketId), "draw:match:update", payload);
  }
  if (scope.tournamentId) {
    emitToRoom(
      io,
      tournamentRoom(scope.tournamentId),
      "tournament:match:update",
      payload
    );
  }

  return payload;
};

const scheduleMatchUpdateFlush = () => {
  if (matchUpdateFlushTimer) return;
  matchUpdateFlushTimer = scheduleTimer(
    matchUpdateFlushTimer,
    flushDueMatchUpdates,
    MATCH_UPDATE_FLUSH_MS
  );
};

function flushDueMatchUpdates() {
  matchUpdateFlushTimer = null;
  const now = nowMs();
  let nextDelay = null;

  for (const [key, entry] of pendingMatchUpdates.entries()) {
    if (entry.flushAt <= now) {
      flushMatchUpdateEntry(key, entry);
      continue;
    }
    const delay = entry.flushAt - now;
    nextDelay = nextDelay == null ? delay : Math.min(nextDelay, delay);
  }

  if (pendingMatchUpdates.size > 0) {
    matchUpdateFlushTimer = scheduleTimer(
      matchUpdateFlushTimer,
      flushDueMatchUpdates,
      nextDelay == null ? MATCH_UPDATE_FLUSH_MS : nextDelay
    );
  }
}

const scheduleMatchUpdate = (io, scope, data, options) => {
  const key = scope.matchId;
  const existing = pendingMatchUpdates.get(key);
  const replaceData = shouldReplaceMatchData(existing, data);
  const nextScope = mergeScope(existing?.scope, scope);
  const firstAt = existing?.firstAt || nowMs();
  const entry = {
    io,
    scope: nextScope,
    data: replaceData ? data : existing.data,
    type: replaceData ? options.type : existing.type,
    firstAt,
    emitMatchSnapshot:
      Boolean(existing?.emitMatchSnapshot) || Boolean(options.emitMatchSnapshot),
    emitMatchUpdate:
      Boolean(existing?.emitMatchUpdate) || Boolean(options.emitMatchUpdate),
    emitScoreUpdated:
      Boolean(existing?.emitScoreUpdated) || Boolean(options.emitScoreUpdated),
    flushAt: debounceFlushAt(
      { firstAt },
      MATCH_UPDATE_FLUSH_MS,
      MATCH_UPDATE_MAX_WAIT_MS
    ),
  };

  pendingMatchUpdates.set(key, entry);

  if (pendingMatchUpdates.size > MAX_PENDING_MATCH_UPDATES) {
    const [oldestKey, oldestEntry] =
      pendingMatchUpdates.entries().next().value || [];
    if (oldestKey) flushMatchUpdateEntry(oldestKey, oldestEntry);
  }

  scheduleMatchUpdateFlush();
  return buildMatchUpdatePayload(entry);
};

const invalidateKeyOf = ({ tournamentId, bracketId } = {}) =>
  `t:${tournamentId || ""}|b:${bracketId || ""}`;

const buildInvalidatePayload = (entry) => {
  const reasons = Array.from(entry.reasons).filter(Boolean);
  const matchIds = Array.from(entry.matchIds).filter(Boolean);
  return {
    tournamentId: entry.tournamentId || undefined,
    bracketId: entry.bracketId || undefined,
    matchId: matchIds.length === 1 ? matchIds[0] : undefined,
    matchIds: matchIds.length > 1 ? matchIds : undefined,
    reason: reasons.length ? reasons.slice(0, 5).join(",") : "unknown",
    at: entry.at,
  };
};

const flushInvalidateEntry = (key, entry = pendingInvalidates.get(key)) => {
  if (!entry) return null;
  pendingInvalidates.delete(key);

  const payload = buildInvalidatePayload(entry);
  if (entry.tournamentId) {
    emitToRoom(
      entry.io,
      tournamentRoom(entry.tournamentId),
      "tournament:invalidate",
      payload
    );
  }
  if (entry.bracketId) {
    emitToRoom(
      entry.io,
      drawRoom(entry.bracketId),
      "tournament:invalidate",
      payload
    );
  }
  return payload;
};

const scheduleInvalidateFlush = () => {
  if (invalidateFlushTimer) return;
  invalidateFlushTimer = scheduleTimer(
    invalidateFlushTimer,
    flushDueInvalidates,
    INVALIDATE_FLUSH_MS
  );
};

function flushDueInvalidates() {
  invalidateFlushTimer = null;
  const now = nowMs();
  let nextDelay = null;

  for (const [key, entry] of pendingInvalidates.entries()) {
    if (entry.flushAt <= now) {
      flushInvalidateEntry(key, entry);
      continue;
    }
    const delay = entry.flushAt - now;
    nextDelay = nextDelay == null ? delay : Math.min(nextDelay, delay);
  }

  if (pendingInvalidates.size > 0) {
    invalidateFlushTimer = scheduleTimer(
      invalidateFlushTimer,
      flushDueInvalidates,
      nextDelay == null ? INVALIDATE_FLUSH_MS : nextDelay
    );
  }
}

const liveActivityKeyOf = (source = {}) => {
  const matchId =
    normalizeId(source?.matchId) ||
    normalizeId(source?._id) ||
    normalizeId(source?.id);
  if (matchId) return `match:${matchId}`;
  const tournamentId = normalizeId(source?.tournamentId || source?.tournament);
  const bracketId = normalizeId(source?.bracketId || source?.bracket);
  return `scope:t:${tournamentId || ""}|b:${bracketId || ""}`;
};

const flushLiveActivityEntry = (
  key,
  entry = pendingLiveActivities.get(key)
) => {
  if (!entry?.source) return null;
  pendingLiveActivities.delete(key);
  void dispatchMatchLiveActivityUpdate(entry.source).catch((error) => {
    console.error(
      "[live-activity] emitTournamentMatchUpdate error:",
      error?.message || error
    );
  });
  return entry.source;
};

const scheduleLiveActivityFlush = () => {
  if (liveActivityFlushTimer) return;
  liveActivityFlushTimer = scheduleTimer(
    liveActivityFlushTimer,
    flushDueLiveActivities,
    LIVE_ACTIVITY_FLUSH_MS
  );
};

function flushDueLiveActivities() {
  liveActivityFlushTimer = null;
  const now = nowMs();
  let nextDelay = null;

  for (const [key, entry] of pendingLiveActivities.entries()) {
    if (entry.flushAt <= now) {
      flushLiveActivityEntry(key, entry);
      continue;
    }
    const delay = entry.flushAt - now;
    nextDelay = nextDelay == null ? delay : Math.min(nextDelay, delay);
  }

  if (pendingLiveActivities.size > 0) {
    liveActivityFlushTimer = scheduleTimer(
      liveActivityFlushTimer,
      flushDueLiveActivities,
      nextDelay == null ? LIVE_ACTIVITY_FLUSH_MS : nextDelay
    );
  }
}

const scheduleLiveActivity = (source) => {
  if (!source || typeof source !== "object") return null;
  const key = liveActivityKeyOf(source);
  if (!key) return null;
  const existing = pendingLiveActivities.get(key);
  const firstAt = existing?.firstAt || nowMs();
  const entry = {
    source,
    firstAt,
    flushAt: debounceFlushAt(
      { firstAt },
      LIVE_ACTIVITY_FLUSH_MS,
      LIVE_ACTIVITY_FLUSH_MS
    ),
  };
  pendingLiveActivities.set(key, entry);

  if (pendingLiveActivities.size > MAX_PENDING_LIVE_ACTIVITY) {
    const [oldestKey, oldestEntry] =
      pendingLiveActivities.entries().next().value || [];
    if (oldestKey) flushLiveActivityEntry(oldestKey, oldestEntry);
  }

  scheduleLiveActivityFlush();
  return source;
};

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
    emitLiveActivity = true,
  } = {}
) {
  if (!io || !data) return null;

  const scope = extractTournamentRealtimeScope(source || data, {
    matchId,
    bracketId,
    tournamentId,
  });

  if (!scope.matchId) return null;
  invalidateMatchSnapshotCache(scope.matchId);

  const payload = {
    type,
    matchId: scope.matchId,
    bracketId: scope.bracketId || undefined,
    tournamentId: scope.tournamentId || undefined,
    data,
  };

  const scheduledPayload = scheduleMatchUpdate(io, scope, data, {
    type,
    emitMatchSnapshot,
    emitMatchUpdate,
    emitScoreUpdated,
  });

  const liveActivitySource = emitLiveActivity
    ? (data && typeof data === "object" ? data : null) ||
      (source && typeof source === "object" ? source : null)
    : null;
  if (liveActivitySource) {
    scheduleLiveActivity(liveActivitySource);
  }

  return scheduledPayload || payload;
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

  const key = invalidateKeyOf({
    tournamentId: normalizedTournamentId,
    bracketId: normalizedBracketId,
  });
  const existing = pendingInvalidates.get(key);
  const entry = existing || {
    io,
    tournamentId: normalizedTournamentId,
    bracketId: normalizedBracketId,
    reasons: new Set(),
    matchIds: new Set(),
    at: payload.at,
    firstAt: nowMs(),
    flushAt: nowMs() + INVALIDATE_FLUSH_MS,
  };
  entry.io = io;
  entry.tournamentId = normalizedTournamentId || entry.tournamentId;
  entry.bracketId = normalizedBracketId || entry.bracketId;
  entry.reasons.add(payload.reason);
  if (normalizedMatchId) entry.matchIds.add(normalizedMatchId);
  entry.flushAt = debounceFlushAt(
    entry,
    INVALIDATE_FLUSH_MS,
    INVALIDATE_MAX_WAIT_MS
  );
  pendingInvalidates.set(key, entry);

  if (pendingInvalidates.size > MAX_PENDING_INVALIDATES) {
    const [oldestKey, oldestEntry] =
      pendingInvalidates.entries().next().value || [];
    if (oldestKey) flushInvalidateEntry(oldestKey, oldestEntry);
  }
  scheduleInvalidateFlush();

  return payload;
}
