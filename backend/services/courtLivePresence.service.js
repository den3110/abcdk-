import { randomUUID } from "crypto";
import Court from "../models/courtModel.js";
import { presenceRedis } from "./presenceService.js";
import { publishCourtLivePresenceUpdate } from "./courtLivePresenceEvents.service.js";

const HEARTBEAT_INTERVAL_MS = 5_000;
const PRESENCE_TIMEOUT_MS = 20_000;
const PREVIEW_STALE_TIMEOUT_MS = 60 * 60 * 1000;
const PREVIEW_WARNING_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5_000;

const ACTIVE_COURTS_SET_KEY = "court-live:presence:active-courts";

let sweeperStarted = false;
let sweeperTimer = null;

const LIVE_LIKE_STATES = new Set([
  "live",
  "connecting",
  "reconnecting",
  "starting_countdown",
  "ending_live",
  "ending_countdown",
]);

const PREVIEW_LIKE_STATES = new Set([
  "preview",
  "waiting_for_court",
  "waiting_for_next_match",
  "idle",
  "preview_unknown",
]);

function redisAvailable() {
  return Boolean(presenceRedis?.isOpen);
}

function courtPresenceKey(courtId) {
  return `court-live:presence:court:${courtId}`;
}

function sessionPresenceKey(clientSessionId) {
  return `court-live:presence:session:${clientSessionId}`;
}

function safeString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function normalizeScreenState(screenState) {
  const normalized = safeString(screenState).toLowerCase();
  if (!normalized) return "preview_unknown";
  return normalized;
}

function isLiveLikeScreenState(screenState) {
  return LIVE_LIKE_STATES.has(normalizeScreenState(screenState));
}

function isPreviewLikeScreenState(screenState) {
  const normalized = normalizeScreenState(screenState);
  if (PREVIEW_LIKE_STATES.has(normalized)) return true;
  return !isLiveLikeScreenState(normalized);
}

function parseEventDate(timestamp) {
  const parsed = timestamp ? new Date(timestamp) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function parseDateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function computeWarningWindow(screenState, previousPreviewModeSince, now) {
  if (!isPreviewLikeScreenState(screenState)) {
    return {
      previewModeSince: null,
      previewReleaseAt: null,
      warningAt: null,
    };
  }

  const previewModeSince =
    parseDateOrNull(previousPreviewModeSince) || new Date(now);
  const previewReleaseAt = new Date(
    previewModeSince.getTime() + PREVIEW_STALE_TIMEOUT_MS
  );
  const warningAt = new Date(previewReleaseAt.getTime() - PREVIEW_WARNING_MS);

  return {
    previewModeSince,
    previewReleaseAt,
    warningAt,
  };
}

function buildPresenceDocument({
  current = null,
  court,
  userId,
  clientSessionId,
  screenState,
  matchId,
  timestamp,
}) {
  const now = parseEventDate(timestamp);
  const normalizedScreenState = normalizeScreenState(screenState);
  const timing = computeWarningWindow(
    normalizedScreenState,
    current?.previewModeSince,
    now
  );
  const expiresAt = new Date(now.getTime() + PRESENCE_TIMEOUT_MS);

  return {
    courtId: String(court._id),
    tournamentId: String(court.tournament),
    userId: safeString(userId),
    clientSessionId: safeString(clientSessionId) || randomUUID(),
    screenState: normalizedScreenState,
    matchId: safeString(matchId) || null,
    startedAt: current?.startedAt || now.toISOString(),
    lastHeartbeatAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    previewModeSince: timing.previewModeSince?.toISOString() || null,
    previewReleaseAt: timing.previewReleaseAt?.toISOString() || null,
    warningAt: timing.warningAt?.toISOString() || null,
  };
}

function serializePresence(presence) {
  return JSON.stringify(presence);
}

function deserializePresence(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.courtId || !parsed.tournamentId || !parsed.clientSessionId) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("[court-live-presence] deserialize failed:", error?.message || error);
    return null;
  }
}

function buildPresenceSummary(presence) {
  if (!presence?.courtId) return null;
  return {
    occupied: true,
    status: "active",
    screenState: normalizeScreenState(presence.screenState),
    matchId: presence.matchId || null,
    startedAt: presence.startedAt || null,
    lastHeartbeatAt: presence.lastHeartbeatAt || null,
    expiresAt: presence.expiresAt || null,
    previewModeSince: presence.previewModeSince || null,
    previewReleaseAt: presence.previewReleaseAt || null,
    warningAt: presence.warningAt || null,
  };
}

function buildConfigShape() {
  return {
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    presenceTimeoutMs: PRESENCE_TIMEOUT_MS,
    previewStaleTimeoutMs: PREVIEW_STALE_TIMEOUT_MS,
    previewWarningMs: PREVIEW_WARNING_MS,
  };
}

function buildResponse({
  ok = true,
  status = "active",
  reason = null,
  presence = null,
  occupiedSummary = null,
}) {
  const config = buildConfigShape();
  return {
    ok,
    status,
    reason,
    clientSessionId: presence?.clientSessionId || null,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    presenceTimeoutMs: config.presenceTimeoutMs,
    previewStaleTimeoutMs: config.previewStaleTimeoutMs,
    previewWarningMs: config.previewWarningMs,
    previewReleaseAt: presence?.previewReleaseAt || null,
    warningAt: presence?.warningAt || null,
    occupied: occupiedSummary || buildPresenceSummary(presence),
  };
}

async function readPresenceByCourtId(courtId) {
  if (!redisAvailable() || !courtId) return null;
  try {
    const raw = await presenceRedis.get(courtPresenceKey(courtId));
    return deserializePresence(raw);
  } catch (error) {
    console.warn("[court-live-presence] readPresenceByCourtId failed:", error?.message || error);
    return null;
  }
}

async function writePresence(presence) {
  if (!redisAvailable()) {
    throw new Error("court presence redis unavailable");
  }
  const ttlSeconds = Math.ceil(PRESENCE_TIMEOUT_MS / 1000);
  const payload = serializePresence(presence);
  await Promise.all([
    presenceRedis.set(courtPresenceKey(presence.courtId), payload, { EX: ttlSeconds }),
    presenceRedis.set(sessionPresenceKey(presence.clientSessionId), payload, {
      EX: ttlSeconds,
    }),
    presenceRedis.sAdd(ACTIVE_COURTS_SET_KEY, String(presence.courtId)),
  ]);
}

async function deletePresence(presence) {
  if (!redisAvailable()) return;
  const tasks = [presenceRedis.sRem(ACTIVE_COURTS_SET_KEY, String(presence.courtId))];
  if (presence?.courtId) {
    tasks.push(presenceRedis.del(courtPresenceKey(presence.courtId)));
  }
  if (presence?.clientSessionId) {
    tasks.push(presenceRedis.del(sessionPresenceKey(presence.clientSessionId)));
  }
  await Promise.all(tasks);
}

async function getCourtDoc(courtId) {
  if (!courtId) return null;
  return Court.findById(courtId)
    .select("_id tournament name isActive")
    .lean();
}

async function releasePresence(presence, reason = "released", { publish = true } = {}) {
  if (!presence?.courtId) return false;
  await deletePresence(presence);
  if (publish && presence.tournamentId) {
    await publishCourtLivePresenceUpdate({
      tournamentId: String(presence.tournamentId),
      courtIds: [String(presence.courtId)],
      reason,
      mode: "event",
    });
  }
  return true;
}

function shouldAutoReleasePreview(presence, now = new Date()) {
  if (!presence?.previewReleaseAt) return false;
  if (!isPreviewLikeScreenState(presence.screenState)) return false;
  const previewReleaseAt = parseDateOrNull(presence.previewReleaseAt);
  if (!previewReleaseAt) return false;
  return previewReleaseAt.getTime() <= now.getTime();
}

async function ensurePresenceNotStale(presence) {
  if (!presence) return null;
  if (!shouldAutoReleasePreview(presence)) return presence;
  await releasePresence(presence, "preview_stale_auto");
  return null;
}

export async function getCourtLivePresenceSummaryMap(courtIds = []) {
  const ids = Array.from(
    new Set(
      (courtIds || [])
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  );
  if (!ids.length || !redisAvailable()) return new Map();

  const summaryMap = new Map();
  try {
    const raws = await presenceRedis.mGet(ids.map((courtId) => courtPresenceKey(courtId)));
    const releases = [];
    raws.forEach((raw, index) => {
      const presence = deserializePresence(raw);
      if (!presence) return;
      if (shouldAutoReleasePreview(presence)) {
        releases.push(releasePresence(presence, "preview_stale_auto"));
        return;
      }
      summaryMap.set(ids[index], buildPresenceSummary(presence));
    });
    if (releases.length) {
      await Promise.allSettled(releases);
    }
  } catch (error) {
    console.warn("[court-live-presence] get summary map failed:", error?.message || error);
    return new Map();
  }
  return summaryMap;
}

export async function buildTournamentCourtLivePresenceSnapshot(tournamentId) {
  const normalizedTournamentId = safeString(tournamentId);
  if (!normalizedTournamentId) {
    return {
      tournamentId: "",
      ts: new Date().toISOString(),
      courts: [],
    };
  }

  const courts = await Court.find({ tournament: normalizedTournamentId })
    .select("_id")
    .sort({ order: 1, createdAt: 1 })
    .lean();
  const summaryMap = await getCourtLivePresenceSummaryMap(courts.map((court) => String(court._id)));

  return {
    tournamentId: normalizedTournamentId,
    ts: new Date().toISOString(),
    courts: courts.map((court) => ({
      courtId: String(court._id),
      liveScreenPresence: summaryMap.get(String(court._id)) || null,
    })),
  };
}

export async function startOrRenewCourtPresence({
  courtId,
  userId,
  clientSessionId,
  screenState,
  matchId = null,
  timestamp,
}) {
  const normalizedCourtId = safeString(courtId);
  const normalizedUserId = safeString(userId);
  const normalizedSessionId = safeString(clientSessionId) || randomUUID();
  const court = await getCourtDoc(normalizedCourtId);
  if (!court) {
    return { notFound: true, ...buildResponse({ ok: false, status: "expired", reason: "court_not_found" }) };
  }

  if (!redisAvailable()) {
    return {
      degraded: true,
      ...buildResponse({
        ok: true,
        status: "active",
        reason: "presence_unavailable",
        presence: buildPresenceDocument({
          court,
          userId: normalizedUserId,
          clientSessionId: normalizedSessionId,
          screenState,
          matchId,
          timestamp,
        }),
      }),
    };
  }

  const current = await ensurePresenceNotStale(await readPresenceByCourtId(normalizedCourtId));
  if (current && current.clientSessionId !== normalizedSessionId) {
    return buildResponse({
      ok: false,
      status: "blocked",
      reason: "occupied",
      occupiedSummary: buildPresenceSummary(current),
    });
  }

  const presence = buildPresenceDocument({
    current,
    court,
    userId: normalizedUserId,
    clientSessionId: normalizedSessionId,
    screenState,
    matchId,
    timestamp,
  });

  try {
    await writePresence(presence);
    await publishCourtLivePresenceUpdate({
      tournamentId: String(court.tournament),
      courtIds: [String(court._id)],
      reason: current ? "renew_presence" : "start_presence",
      mode: "event",
    });
    return buildResponse({
      ok: true,
      status: "active",
      presence,
    });
  } catch (error) {
    console.warn("[court-live-presence] startOrRenew failed:", error?.message || error);
    return {
      degraded: true,
      ...buildResponse({
        ok: true,
        status: "active",
        reason: "presence_unavailable",
        presence,
      }),
    };
  }
}

export async function heartbeatCourtPresence({
  courtId,
  userId,
  clientSessionId,
  screenState,
  matchId = null,
  timestamp,
}) {
  const normalizedCourtId = safeString(courtId);
  const normalizedSessionId = safeString(clientSessionId);
  if (!normalizedCourtId || !normalizedSessionId) {
    return buildResponse({
      ok: false,
      status: "expired",
      reason: "missing_session",
    });
  }

  if (!redisAvailable()) {
    return buildResponse({
      ok: true,
      status: "active",
      reason: "presence_unavailable",
      presence: {
        clientSessionId: normalizedSessionId,
      },
    });
  }

  const current = await ensurePresenceNotStale(await readPresenceByCourtId(normalizedCourtId));
  if (!current) {
    return buildResponse({
      ok: false,
      status: "expired",
      reason: "not_found",
    });
  }
  if (current.clientSessionId !== normalizedSessionId) {
    return buildResponse({
      ok: false,
      status: "blocked",
      reason: "occupied",
      occupiedSummary: buildPresenceSummary(current),
    });
  }

  const court = await getCourtDoc(normalizedCourtId);
  if (!court) {
    await releasePresence(current, "court_deleted");
    return buildResponse({
      ok: false,
      status: "expired",
      reason: "court_not_found",
    });
  }

  const nextPresence = buildPresenceDocument({
    current,
    court,
    userId: safeString(userId) || current.userId,
    clientSessionId: normalizedSessionId,
    screenState: screenState || current.screenState,
    matchId: matchId || current.matchId,
    timestamp,
  });

  try {
    const changedState =
      normalizeScreenState(current.screenState) !==
        normalizeScreenState(nextPresence.screenState) ||
      String(current.previewReleaseAt || "") !== String(nextPresence.previewReleaseAt || "") ||
      String(current.warningAt || "") !== String(nextPresence.warningAt || "");
    await writePresence(nextPresence);
    if (changedState) {
      await publishCourtLivePresenceUpdate({
        tournamentId: String(court.tournament),
        courtIds: [String(court._id)],
        reason: "heartbeat_state_change",
        mode: "event",
      });
    }
    return buildResponse({
      ok: true,
      status: "active",
      presence: nextPresence,
    });
  } catch (error) {
    console.warn("[court-live-presence] heartbeat failed:", error?.message || error);
    return buildResponse({
      ok: true,
      status: "active",
      reason: "presence_unavailable",
      presence: nextPresence,
    });
  }
}

export async function endCourtPresence({
  courtId,
  clientSessionId,
}) {
  const normalizedCourtId = safeString(courtId);
  const normalizedSessionId = safeString(clientSessionId);
  if (!normalizedCourtId || !normalizedSessionId || !redisAvailable()) {
    return buildResponse({
      ok: true,
      status: "released",
      reason: "no_active_presence",
    });
  }

  const current = await readPresenceByCourtId(normalizedCourtId);
  if (!current) {
    return buildResponse({
      ok: true,
      status: "released",
      reason: "no_active_presence",
    });
  }
  if (current.clientSessionId !== normalizedSessionId) {
    return buildResponse({
      ok: true,
      status: "active",
      reason: "session_mismatch",
      occupiedSummary: buildPresenceSummary(current),
    });
  }

  await releasePresence(current, "end_presence");
  return buildResponse({
    ok: true,
    status: "released",
    reason: "released",
  });
}

export async function extendCourtPreviewPresence({
  courtId,
  clientSessionId,
  timestamp,
}) {
  const normalizedCourtId = safeString(courtId);
  const normalizedSessionId = safeString(clientSessionId);
  if (!normalizedCourtId || !normalizedSessionId) {
    return buildResponse({
      ok: false,
      status: "expired",
      reason: "missing_session",
    });
  }

  const current = await ensurePresenceNotStale(await readPresenceByCourtId(normalizedCourtId));
  if (!current) {
    return buildResponse({
      ok: false,
      status: "expired",
      reason: "not_found",
    });
  }
  if (current.clientSessionId !== normalizedSessionId) {
    return buildResponse({
      ok: false,
      status: "blocked",
      reason: "occupied",
      occupiedSummary: buildPresenceSummary(current),
    });
  }

  const court = await getCourtDoc(normalizedCourtId);
  if (!court) {
    await releasePresence(current, "court_deleted");
    return buildResponse({
      ok: false,
      status: "expired",
      reason: "court_not_found",
    });
  }

  const previewLikeScreenState = isPreviewLikeScreenState(current.screenState)
    ? current.screenState
    : "preview";
  const nextPresence = buildPresenceDocument({
    current: {
      ...current,
      previewModeSince: parseEventDate(timestamp).toISOString(),
    },
    court,
    userId: current.userId,
    clientSessionId: normalizedSessionId,
    screenState: previewLikeScreenState,
    matchId: current.matchId,
    timestamp,
  });

  try {
    await writePresence(nextPresence);
    await publishCourtLivePresenceUpdate({
      tournamentId: String(court.tournament),
      courtIds: [String(court._id)],
      reason: "extend_preview_presence",
      mode: "event",
    });
    return buildResponse({
      ok: true,
      status: "active",
      presence: nextPresence,
    });
  } catch (error) {
    console.warn("[court-live-presence] extend preview failed:", error?.message || error);
    return buildResponse({
      ok: true,
      status: "active",
      reason: "presence_unavailable",
      presence: nextPresence,
    });
  }
}

async function lookupTournamentIdByCourtId(courtId) {
  const court = await getCourtDoc(courtId);
  return court?.tournament ? String(court.tournament) : null;
}

async function sweepActiveCourtPresences() {
  if (!redisAvailable()) return;
  try {
    const courtIds = await presenceRedis.sMembers(ACTIVE_COURTS_SET_KEY);
    if (!Array.isArray(courtIds) || !courtIds.length) return;

    const raws = await presenceRedis.mGet(courtIds.map((courtId) => courtPresenceKey(courtId)));
    const releaseTasks = [];

    for (let index = 0; index < courtIds.length; index += 1) {
      const courtId = String(courtIds[index]);
      const presence = deserializePresence(raws[index]);
      if (!presence) {
        await presenceRedis.sRem(ACTIVE_COURTS_SET_KEY, courtId).catch(() => {});
        const tournamentId = await lookupTournamentIdByCourtId(courtId);
        if (tournamentId) {
          releaseTasks.push(
            publishCourtLivePresenceUpdate({
              tournamentId,
              courtIds: [courtId],
              reason: "presence_timeout_expired",
              mode: "event",
            })
          );
        }
        continue;
      }

      if (shouldAutoReleasePreview(presence)) {
        releaseTasks.push(releasePresence(presence, "preview_stale_auto"));
      }
    }

    if (releaseTasks.length) {
      await Promise.allSettled(releaseTasks);
    }
  } catch (error) {
    console.warn("[court-live-presence] sweep failed:", error?.message || error);
  }
}

export function startCourtLivePresenceSweep() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  sweeperTimer = setInterval(() => {
    void sweepActiveCourtPresences();
  }, SWEEP_INTERVAL_MS);
  if (typeof sweeperTimer?.unref === "function") {
    sweeperTimer.unref();
  }
}
