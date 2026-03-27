import { randomUUID } from "crypto";
import CourtStation from "../models/courtStationModel.js";
import { presenceRedis } from "./presenceService.js";
import {
  publishCourtClusterPresenceUpdate,
  publishCourtStationPresenceUpdate,
} from "./courtStationPresenceEvents.service.js";

const HEARTBEAT_INTERVAL_MS = 5_000;
const PRESENCE_TIMEOUT_MS = 20_000;
const PREVIEW_STALE_TIMEOUT_MS = 60 * 60 * 1000;
const PREVIEW_WARNING_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5_000;
const ACTIVE_STATIONS_SET_KEY = "court-station:presence:active-stations";

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

let sweeperStarted = false;
let sweeperTimer = null;

function redisAvailable() {
  return Boolean(presenceRedis?.isOpen);
}

function stationPresenceKey(stationId) {
  return `court-station:presence:station:${stationId}`;
}

function sessionPresenceKey(clientSessionId) {
  return `court-station:presence:session:${clientSessionId}`;
}

function safeString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function parseDateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeScreenState(screenState) {
  const normalized = safeString(screenState).toLowerCase();
  if (!normalized) return "preview_unknown";
  return normalized;
}

function isPreviewLikeScreenState(screenState) {
  const normalized = normalizeScreenState(screenState);
  if (PREVIEW_LIKE_STATES.has(normalized)) return true;
  return !LIVE_LIKE_STATES.has(normalized);
}

function parseEventDate(timestamp) {
  const parsed = timestamp ? new Date(timestamp) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
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
  station,
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
    courtStationId: safeString(station._id),
    clusterId: safeString(station.clusterId),
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
    if (!parsed.courtStationId || !parsed.clientSessionId) return null;
    return parsed;
  } catch (error) {
    console.warn(
      "[court-station-presence] deserialize failed:",
      error?.message || error
    );
    return null;
  }
}

function buildPresenceSummary(presence) {
  if (!presence?.courtStationId) return null;
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

async function readPresenceByStationId(stationId) {
  if (!redisAvailable() || !stationId) return null;
  try {
    const raw = await presenceRedis.get(stationPresenceKey(stationId));
    return deserializePresence(raw);
  } catch (error) {
    console.warn(
      "[court-station-presence] read failed:",
      error?.message || error
    );
    return null;
  }
}

async function writePresence(presence) {
  if (!redisAvailable()) {
    throw new Error("court station presence redis unavailable");
  }
  const ttlSeconds = Math.ceil(PRESENCE_TIMEOUT_MS / 1000);
  const payload = serializePresence(presence);
  await Promise.all([
    presenceRedis.set(stationPresenceKey(presence.courtStationId), payload, {
      EX: ttlSeconds,
    }),
    presenceRedis.set(sessionPresenceKey(presence.clientSessionId), payload, {
      EX: ttlSeconds,
    }),
    presenceRedis.sAdd(ACTIVE_STATIONS_SET_KEY, String(presence.courtStationId)),
  ]);
}

async function deletePresence(presence) {
  if (!redisAvailable()) return;
  const tasks = [
    presenceRedis.sRem(ACTIVE_STATIONS_SET_KEY, String(presence.courtStationId)),
  ];
  if (presence?.courtStationId) {
    tasks.push(presenceRedis.del(stationPresenceKey(presence.courtStationId)));
  }
  if (presence?.clientSessionId) {
    tasks.push(presenceRedis.del(sessionPresenceKey(presence.clientSessionId)));
  }
  await Promise.all(tasks);
}

async function getStationDoc(stationId) {
  if (!stationId) return null;
  return CourtStation.findById(stationId).select("_id clusterId").lean();
}

async function publishPresence(station, reason, mode = "event") {
  await Promise.allSettled([
    publishCourtClusterPresenceUpdate({
      clusterId: safeString(station?.clusterId),
      stationIds: [safeString(station?._id)],
      reason,
      mode,
    }),
    publishCourtStationPresenceUpdate({
      stationId: safeString(station?._id),
      clusterId: safeString(station?.clusterId),
      reason,
      mode,
    }),
  ]);
}

async function releasePresence(presence, reason = "released", { publish = true } = {}) {
  if (!presence?.courtStationId) return false;
  await deletePresence(presence);
  if (publish) {
    await publishPresence(
      { _id: presence.courtStationId, clusterId: presence.clusterId },
      reason
    );
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

export async function getCourtStationPresenceSummaryMap(stationIds = []) {
  const ids = Array.from(
    new Set(
      (stationIds || [])
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  );
  if (!ids.length || !redisAvailable()) return new Map();

  const summaryMap = new Map();
  try {
    const raws = await presenceRedis.mGet(
      ids.map((stationId) => stationPresenceKey(stationId))
    );
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
    console.warn(
      "[court-station-presence] get summary map failed:",
      error?.message || error
    );
    return new Map();
  }
  return summaryMap;
}

export async function buildCourtClusterPresenceSnapshot(clusterId) {
  const normalizedClusterId = safeString(clusterId);
  if (!normalizedClusterId) {
    return {
      clusterId: "",
      ts: new Date().toISOString(),
      stations: [],
    };
  }

  const stations = await CourtStation.find({ clusterId: normalizedClusterId })
    .select("_id")
    .sort({ order: 1, createdAt: 1 })
    .lean();
  const summaryMap = await getCourtStationPresenceSummaryMap(
    stations.map((station) => String(station._id))
  );

  return {
    clusterId: normalizedClusterId,
    ts: new Date().toISOString(),
    stations: stations.map((station) => ({
      courtStationId: String(station._id),
      liveScreenPresence: summaryMap.get(String(station._id)) || null,
    })),
  };
}

export async function buildCourtStationPresenceSnapshot(stationId) {
  const normalizedStationId = safeString(stationId);
  const presence = await ensurePresenceNotStale(
    await readPresenceByStationId(normalizedStationId)
  );
  return {
    courtStationId: normalizedStationId,
    ts: new Date().toISOString(),
    liveScreenPresence: buildPresenceSummary(presence),
  };
}

export async function startOrRenewCourtStationPresence({
  courtStationId,
  userId,
  clientSessionId,
  screenState,
  matchId = null,
  timestamp,
}) {
  const normalizedStationId = safeString(courtStationId);
  const normalizedUserId = safeString(userId);
  const normalizedSessionId = safeString(clientSessionId) || randomUUID();
  const station = await getStationDoc(normalizedStationId);
  if (!station) {
    return {
      notFound: true,
      ...buildResponse({
        ok: false,
        status: "expired",
        reason: "court_station_not_found",
      }),
    };
  }

  if (!redisAvailable()) {
    return {
      degraded: true,
      ...buildResponse({
        ok: true,
        status: "active",
        reason: "presence_unavailable",
        presence: buildPresenceDocument({
          station,
          userId: normalizedUserId,
          clientSessionId: normalizedSessionId,
          screenState,
          matchId,
          timestamp,
        }),
      }),
    };
  }

  const current = await ensurePresenceNotStale(
    await readPresenceByStationId(normalizedStationId)
  );

  if (
    current &&
    current.userId &&
    current.userId !== normalizedUserId &&
    current.clientSessionId !== normalizedSessionId
  ) {
    return buildResponse({
      ok: false,
      status: "blocked",
      reason: "occupied_by_other_device",
      occupiedSummary: buildPresenceSummary(current),
    });
  }

  const presence = buildPresenceDocument({
    current,
    station,
    userId: normalizedUserId,
    clientSessionId: normalizedSessionId,
    screenState,
    matchId,
    timestamp,
  });
  await writePresence(presence);
  await CourtStation.updateOne(
    { _id: normalizedStationId },
    {
      $set: {
        "presence.screenState": normalizeScreenState(screenState),
        "presence.liveScreenPresence": buildPresenceSummary(presence),
        "presence.lastSeenAt": new Date(),
      },
    }
  ).catch(() => {});
  await publishPresence(station, current ? "heartbeat" : "start");

  return buildResponse({
    ok: true,
    status: "active",
    reason: null,
    presence,
  });
}

export async function heartbeatCourtStationPresence({
  courtStationId,
  userId,
  clientSessionId,
  screenState,
  matchId = null,
  timestamp,
}) {
  return startOrRenewCourtStationPresence({
    courtStationId,
    userId,
    clientSessionId,
    screenState,
    matchId,
    timestamp,
  });
}

export async function endCourtStationPresence({
  courtStationId,
  clientSessionId,
}) {
  const normalizedStationId = safeString(courtStationId);
  const current = await ensurePresenceNotStale(
    await readPresenceByStationId(normalizedStationId)
  );
  if (!current) {
    return buildResponse({
      ok: true,
      status: "expired",
      reason: "presence_missing",
      occupiedSummary: null,
    });
  }

  if (
    safeString(clientSessionId) &&
    current.clientSessionId !== safeString(clientSessionId)
  ) {
    return buildResponse({
      ok: false,
      status: "blocked",
      reason: "session_mismatch",
      occupiedSummary: buildPresenceSummary(current),
    });
  }

  await releasePresence(current, "end");
  await CourtStation.updateOne(
    { _id: normalizedStationId },
    {
      $set: {
        "presence.screenState": "",
        "presence.liveScreenPresence": null,
        "presence.lastSeenAt": new Date(),
      },
    }
  ).catch(() => {});

  return buildResponse({
    ok: true,
    status: "expired",
    reason: "released",
    occupiedSummary: null,
  });
}

export async function forceReleaseCourtStationPresence(
  courtStationId,
  { reason = "admin_force_release", publish = true } = {}
) {
  const normalizedStationId = safeString(courtStationId);
  if (!normalizedStationId) {
    return {
      ok: false,
      released: false,
      reason: "court_station_missing",
      stationId: "",
      clusterId: "",
    };
  }

  const station = await getStationDoc(normalizedStationId);
  if (!station) {
    return {
      ok: false,
      released: false,
      reason: "court_station_not_found",
      stationId: normalizedStationId,
      clusterId: "",
    };
  }

  const current = await ensurePresenceNotStale(
    await readPresenceByStationId(normalizedStationId)
  );

  if (current) {
    await releasePresence(current, reason, { publish: false });
  }

  await CourtStation.updateOne(
    { _id: normalizedStationId },
    {
      $set: {
        "presence.screenState": "",
        "presence.liveScreenPresence": null,
        "presence.lastSeenAt": new Date(),
      },
    }
  ).catch(() => {});

  if (publish) {
    await publishPresence(station, reason);
  }

  return {
    ok: true,
    released: Boolean(current),
    reason,
    stationId: normalizedStationId,
    clusterId: safeString(station.clusterId),
  };
}

export async function extendCourtStationPreviewPresence({
  courtStationId,
  clientSessionId,
  timestamp,
}) {
  const normalizedStationId = safeString(courtStationId);
  const current = await ensurePresenceNotStale(
    await readPresenceByStationId(normalizedStationId)
  );
  if (!current) {
    return buildResponse({
      ok: false,
      status: "expired",
      reason: "presence_missing",
      occupiedSummary: null,
    });
  }
  if (
    safeString(clientSessionId) &&
    current.clientSessionId !== safeString(clientSessionId)
  ) {
    return buildResponse({
      ok: false,
      status: "blocked",
      reason: "session_mismatch",
      occupiedSummary: buildPresenceSummary(current),
    });
  }

  return startOrRenewCourtStationPresence({
    courtStationId: normalizedStationId,
    userId: current.userId,
    clientSessionId: current.clientSessionId,
    screenState: current.screenState,
    matchId: current.matchId,
    timestamp,
  });
}

async function sweepStaleCourtStationPresence() {
  if (!redisAvailable()) return;
  const members = await presenceRedis.sMembers(ACTIVE_STATIONS_SET_KEY);
  if (!members.length) return;
  const now = Date.now();
  for (const stationId of members) {
    const presence = deserializePresence(
      await presenceRedis.get(stationPresenceKey(stationId))
    );
    if (!presence) {
      await presenceRedis.sRem(ACTIVE_STATIONS_SET_KEY, stationId);
      continue;
    }
    const expiresAt = parseDateOrNull(presence.expiresAt);
    if (!expiresAt || expiresAt.getTime() > now) continue;
    await releasePresence(presence, "expired_timeout");
  }
}

export function ensureCourtStationPresenceSweeperStarted() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  sweeperTimer = setInterval(() => {
    void sweepStaleCourtStationPresence().catch((error) => {
      console.warn(
        "[court-station-presence] sweep failed:",
        error?.message || error
      );
    });
  }, SWEEP_INTERVAL_MS);
  if (typeof sweeperTimer?.unref === "function") {
    sweeperTimer.unref();
  }
}
