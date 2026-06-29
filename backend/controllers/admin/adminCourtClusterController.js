import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Match from "../../models/matchModel.js";
import CourtCluster from "../../models/courtClusterModel.js";
import CourtStation from "../../models/courtStationModel.js";
import Tournament from "../../models/tournamentModel.js";
import {
  appendMatchToCourtStationQueue,
  assignMatchToCourtStation,
  buildCourtClusterRuntime,
  createCourtCluster,
  createCourtStation,
  deleteCourtCluster,
  deleteCourtStation,
  freeCourtStation,
  getCourtStationCurrentMatch,
  listCourtClusters,
  listCourtStations,
  removeMatchFromCourtStationQueue,
  updateCourtStationAssignmentConfig,
  updateCourtCluster,
  updateCourtStation,
} from "../../services/courtCluster.service.js";
import {
  publishCourtClusterRuntimeUpdate,
  publishCourtStationRuntimeUpdate,
} from "../../services/courtStationRuntimeEvents.service.js";
import {
  forceReleaseCourtStationPresence,
  getCourtStationPresenceSummaryMap,
} from "../../services/courtStationPresence.service.js";
import { emitTournamentInvalidate } from "../../socket/tournamentRealtime.js";
import { canManageTournament } from "../../utils/tournamentAuth.js";

function ensureValidObjectId(value, label = "id") {
  if (!mongoose.isValidObjectId(String(value || ""))) {
    const error = new Error(`Invalid ${label}`);
    error.status = 400;
    throw error;
  }
}

const isAdminLike = (user) =>
  Boolean(
    user?.isAdmin === true ||
      String(user?.role || "")
        .trim()
        .toLowerCase() === "admin"
  );

function toIdString(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function compareTournamentManagerItems(left, right) {
  const rank = (item) => {
    const normalized = safeText(item?.status).toLowerCase();
    if (normalized === "ongoing") return 0;
    if (normalized === "upcoming") return 1;
    if (normalized === "finished") return 2;
    return 3;
  };
  const leftRank = rank(left);
  const rightRank = rank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;

  const leftStart = left?.startDate ? new Date(left.startDate).getTime() : 0;
  const rightStart = right?.startDate ? new Date(right.startDate).getTime() : 0;
  if (leftStart !== rightStart) return leftStart - rightStart;

  return String(left?.name || "")
    .trim()
    .localeCompare(String(right?.name || "").trim(), "vi");
}

function safeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

const LIVE_MONITOR_PRESENCE_GRACE_MS = 30_000;
const LIVE_MONITOR_ACTIVE_MATCH_STATUSES = new Set([
  "live",
  "ongoing",
  "playing",
  "in_progress",
  "started",
]);
const LIVE_MONITOR_LIVE_SCREEN_STATES = new Set([
  "live",
  "connecting",
  "reconnecting",
  "starting_countdown",
  "armed_waiting_for_court",
  "armed_waiting_for_next_match",
  "ending_live",
  "ending_countdown",
]);

function safeLower(value) {
  return safeText(value).toLowerCase();
}

function parseDateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function toIsoOrNull(value) {
  const parsed = parseDateOrNull(value);
  return parsed ? parsed.toISOString() : null;
}

function elapsedMsSince(value, now = new Date()) {
  const parsed = parseDateOrNull(value);
  if (!parsed) return null;
  return Math.max(0, now.getTime() - parsed.getTime());
}

function normalizePresenceForMonitor(station, livePresence, now = new Date()) {
  const stationPresence = station?.presence || null;
  const presence =
    livePresence ||
    stationPresence?.liveScreenPresence ||
    (stationPresence?.occupied ? stationPresence : null) ||
    null;
  const lastHeartbeatAt =
    presence?.lastHeartbeatAt ||
    stationPresence?.lastSeenAt ||
    stationPresence?.lastHeartbeatAt ||
    null;
  const expiresAt = presence?.expiresAt || null;
  const heartbeatAgeMs = elapsedMsSince(lastHeartbeatAt, now);
  const expiresDate = parseDateOrNull(expiresAt);
  const isExpired = expiresDate
    ? expiresDate.getTime() + 1_000 < now.getTime()
    : false;
  const isRecentlySeen =
    heartbeatAgeMs !== null && heartbeatAgeMs <= LIVE_MONITOR_PRESENCE_GRACE_MS;
  const isOnline = Boolean(presence?.occupied) && !isExpired && isRecentlySeen;

  return {
    occupied: Boolean(presence?.occupied),
    isOnline,
    status: isOnline ? "online" : presence?.occupied ? "stale" : "offline",
    source: livePresence ? "redis" : presence ? "station" : "none",
    screenState: safeText(presence?.screenState),
    matchId: toIdString(presence?.matchId),
    startedAt: toIsoOrNull(presence?.startedAt),
    lastHeartbeatAt: toIsoOrNull(lastHeartbeatAt),
    expiresAt: toIsoOrNull(expiresAt),
    offlineForMs: isOnline ? 0 : heartbeatAgeMs,
  };
}

function isLiveLikeScreenState(screenState) {
  return LIVE_MONITOR_LIVE_SCREEN_STATES.has(safeLower(screenState));
}

function buildStationMonitorStatus(station, presence) {
  const stationStatus = safeLower(station?.status);
  const matchStatus = safeLower(station?.currentMatch?.status);
  const hasLiveWork =
    stationStatus === "live" ||
    LIVE_MONITOR_ACTIVE_MATCH_STATUSES.has(matchStatus) ||
    isLiveLikeScreenState(presence?.screenState);
  const presenceOfflineWhileLive = hasLiveWork && !presence?.isOnline;
  const lostSignal = presenceOfflineWhileLive;
  const stationName = safeText(station?.name, "sân live");

  if (lostSignal) {
    return {
      state: "lost_signal",
      severity: "error",
      hasLiveWork,
      lostSignal: true,
      online: false,
      message: `Máy live tại ${stationName} mất tín hiệu trên server chính, có dấu hiệu crash hoặc bị đóng app. Hãy kiểm tra thiết bị và mở lại live.`,
    };
  }

  if (hasLiveWork) {
    return {
      state: "live_ok",
      severity: "success",
      hasLiveWork,
      lostSignal: false,
      online: Boolean(presence?.isOnline),
      message: "Live đang có tín hiệu.",
    };
  }

  if (presence?.isOnline) {
    return {
      state: "standby_online",
      severity: "info",
      hasLiveWork: false,
      lostSignal: false,
      online: true,
      message: "Máy live đang online, chưa có trận live.",
    };
  }

  return {
    state: "idle",
    severity: "default",
    hasLiveWork: false,
    lostSignal: false,
    online: false,
    message: "Chưa có tín hiệu live đang chạy.",
  };
}

function buildClusterManagerSummary(cluster) {
  return {
    _id: toIdString(cluster?._id),
    name: safeText(cluster?.name),
    slug: safeText(cluster?.slug),
    venueName: safeText(cluster?.venueName),
    description: safeText(cluster?.description),
    color: safeText(cluster?.color),
    order: Number.isFinite(Number(cluster?.order)) ? Number(cluster.order) : 0,
    isActive: cluster?.isActive !== false,
  };
}

async function ensureTournamentAllowsCluster(tournamentId, clusterId) {
  const tournament = await Tournament.findById(tournamentId)
    .select("_id allowedCourtClusterIds")
    .lean();
  if (!tournament) {
    const error = new Error("Tournament not found");
    error.status = 404;
    throw error;
  }
  const allowedIds = Array.isArray(tournament.allowedCourtClusterIds)
    ? tournament.allowedCourtClusterIds.map((value) => toIdString(value))
    : [];
  if (!allowedIds.includes(toIdString(clusterId))) {
    const error = new Error(
      "Giải đấu này chưa được phép dùng cụm sân này."
    );
    error.status = 409;
    throw error;
  }
  return tournament;
}

async function emitClusterRuntime(clusterId, reason, stationId = null) {
  const normalizedClusterId = String(clusterId || "").trim();
  const normalizedStationId = stationId ? String(stationId).trim() : "";
  await Promise.allSettled([
    publishCourtClusterRuntimeUpdate({
      clusterId: normalizedClusterId,
      stationIds: normalizedStationId ? [normalizedStationId] : [],
      reason,
    }),
    normalizedStationId
      ? publishCourtStationRuntimeUpdate({
          stationId: normalizedStationId,
          clusterId: normalizedClusterId,
          reason,
        })
      : Promise.resolve(false),
  ]);
}

function collectStationMatchIds(station) {
  if (!station || typeof station !== "object") return [];

  const ids = new Set();
  const currentMatchId = toIdString(
    station?.currentMatchId || station?.currentMatch?._id || station?.currentMatch
  );
  if (currentMatchId) ids.add(currentMatchId);

  const queueItems = Array.isArray(station?.queueItems)
    ? station.queueItems
    : Array.isArray(station?.assignmentQueue?.items)
      ? station.assignmentQueue.items
      : [];

  queueItems.forEach((item) => {
    const matchId = toIdString(
      item?.matchId || item?.match?._id || item?.match || item?._id
    );
    if (matchId) ids.add(matchId);
  });

  return Array.from(ids);
}

async function collectTournamentIdsFromStationSnapshots(...snapshots) {
  const tournamentIds = new Set();
  const matchIds = new Set();

  snapshots.filter(Boolean).forEach((raw) => {
    const station = raw?.station || raw;
    if (!station || typeof station !== "object") return;

    const currentTournamentId = toIdString(
      station?.currentTournamentId ||
        station?.currentTournament?._id ||
        station?.currentTournament
    );
    if (currentTournamentId) {
      tournamentIds.add(currentTournamentId);
    }

    collectStationMatchIds(station).forEach((matchId) => matchIds.add(matchId));
  });

  if (matchIds.size) {
    const matches = await Match.find({
      _id: { $in: Array.from(matchIds) },
    })
      .select("_id tournament")
      .lean();

    matches.forEach((match) => {
      const tournamentId = toIdString(match?.tournament);
      if (tournamentId) tournamentIds.add(tournamentId);
    });
  }

  return Array.from(tournamentIds);
}

async function emitTournamentInvalidatesForStations(
  req,
  {
    reason,
    fallbackTournamentIds = [],
    extraMatchIds = [],
    snapshots = [],
  } = {}
) {
  const io = req.app?.get?.("io");
  if (!io) return;

  const tournamentIds = new Set(
    (Array.isArray(fallbackTournamentIds) ? fallbackTournamentIds : [fallbackTournamentIds])
      .map((value) => toIdString(value))
      .filter(Boolean)
  );

  const snapshotTournamentIds = await collectTournamentIdsFromStationSnapshots(
    ...(Array.isArray(snapshots) ? snapshots : [snapshots])
  );
  snapshotTournamentIds.forEach((tournamentId) => tournamentIds.add(tournamentId));

  const normalizedExtraMatchIds = Array.from(
    new Set(
      (Array.isArray(extraMatchIds) ? extraMatchIds : [extraMatchIds])
        .map((value) => toIdString(value))
        .filter(Boolean)
    )
  );
  if (normalizedExtraMatchIds.length) {
    const matches = await Match.find({
      _id: { $in: normalizedExtraMatchIds },
    })
      .select("_id tournament")
      .lean();

    matches.forEach((match) => {
      const tournamentId = toIdString(match?.tournament);
      if (tournamentId) tournamentIds.add(tournamentId);
    });
  }

  tournamentIds.forEach((tournamentId) => {
    emitTournamentInvalidate(io, {
      tournamentId,
      reason: safeText(reason, "court_station_runtime_updated"),
    });
  });
}

export const listAdminCourtClusters = asyncHandler(async (req, res) => {
  const activeOnly = String(req.query?.activeOnly || "").trim() === "1";
  const items = await listCourtClusters({ activeOnly });
  res.json({ items });
});

export const listAdminCourtStationFreeManager = asyncHandler(
  async (req, res) => {
    const includeInactive =
      String(req.query?.includeInactive || "").trim() === "1";
    const tournamentQuery = {
      "allowedCourtClusterIds.0": { $exists: true },
    };

    if (!includeInactive) {
      tournamentQuery.status = { $in: ["upcoming", "ongoing"] };
    }

    const tournaments = await Tournament.find(tournamentQuery)
      .select(
        "_id name code status image location startDate endDate allowedCourtClusterIds"
      )
      .lean();

    const uniqueClusterIds = Array.from(
      new Set(
        tournaments.flatMap((item) =>
          Array.isArray(item?.allowedCourtClusterIds)
            ? item.allowedCourtClusterIds.map((value) => toIdString(value))
            : []
        )
      )
    ).filter(Boolean);

    const [clusterDocs, clusterStationEntries] = await Promise.all([
      CourtCluster.find({ _id: { $in: uniqueClusterIds } })
        .select("_id name slug venueName description color order isActive")
        .lean(),
      Promise.all(
        uniqueClusterIds.map(async (clusterId) => {
          const items = await listCourtStations(clusterId, {
            includeMatches: true,
          }).catch(() => []);
          return [clusterId, items];
        })
      ),
    ]);

    const clusterDocMap = new Map(
      clusterDocs.map((item) => [toIdString(item?._id), item])
    );
    const clusterStationsMap = new Map(clusterStationEntries);
    const allStationIds = clusterStationEntries.flatMap(([, items]) =>
      Array.isArray(items) ? items.map((station) => toIdString(station?._id)) : []
    );
    const livePresenceMap = await getCourtStationPresenceSummaryMap(allStationIds);
    const clusterUsageCount = new Map();

    tournaments.forEach((tournament) => {
      const clusterIds = Array.isArray(tournament?.allowedCourtClusterIds)
        ? tournament.allowedCourtClusterIds.map((value) => toIdString(value)).filter(Boolean)
        : [];
      clusterIds.forEach((clusterId) => {
        clusterUsageCount.set(clusterId, (clusterUsageCount.get(clusterId) || 0) + 1);
      });
    });

    const items = tournaments
      .slice()
      .sort(compareTournamentManagerItems)
      .map((tournament) => {
        const clusterIds = Array.isArray(tournament?.allowedCourtClusterIds)
          ? tournament.allowedCourtClusterIds.map((value) => toIdString(value)).filter(Boolean)
          : [];

        const clusters = clusterIds.map((clusterId) => {
          const cluster = clusterDocMap.get(clusterId) || {
            _id: clusterId,
            name: `Cluster ${clusterId.slice(0, 6)}`,
            slug: "",
            venueName: "",
            description: "",
            color: "",
            order: 0,
            isActive: true,
          };
          const stations = (clusterStationsMap.get(clusterId) || []).map((station) => {
            const presence = livePresenceMap.get(toIdString(station?._id)) || station?.presence || null;
            const hasPresenceLock = Boolean(presence?.occupied);
            const hasActiveAssignment = Boolean(
              station?.currentMatchId ||
                station?.currentTournamentId ||
                safeText(station?.status).toLowerCase() === "assigned" ||
                safeText(station?.status).toLowerCase() === "live"
            );

            return {
              ...station,
              presence,
              management: {
                hasPresenceLock,
                hasActiveAssignment,
                canForceFree: hasActiveAssignment || hasPresenceLock,
                canReleasePresence: hasPresenceLock,
                isIdle: !hasActiveAssignment && !hasPresenceLock,
              },
            };
          });

          const busyCount = stations.filter(
            (station) => station?.management?.hasActiveAssignment
          ).length;
          const lockedCount = stations.filter(
            (station) => station?.management?.hasPresenceLock
          ).length;
          const occupiedCount = stations.filter(
            (station) => station?.management?.canForceFree
          ).length;

          return {
            ...buildClusterManagerSummary(cluster),
            sharedTournamentCount: clusterUsageCount.get(clusterId) || 1,
            stationCount: stations.length,
            busyCount,
            lockedCount,
            idleCount: Math.max(0, stations.length - occupiedCount),
            stations,
          };
        });

        const stationCount = clusters.reduce(
          (total, cluster) => total + Number(cluster?.stationCount || 0),
          0
        );
        const busyCount = clusters.reduce(
          (total, cluster) => total + Number(cluster?.busyCount || 0),
          0
        );
        const lockedCount = clusters.reduce(
          (total, cluster) => total + Number(cluster?.lockedCount || 0),
          0
        );
        const occupiedCount = clusters.reduce(
          (total, cluster) =>
            total +
            Math.max(
              Number(cluster?.busyCount || 0),
              Number(cluster?.lockedCount || 0)
            ),
          0
        );

        return {
          _id: toIdString(tournament?._id),
          name: safeText(tournament?.name),
          code: safeText(tournament?.code),
          status: safeText(tournament?.status),
          image: safeText(tournament?.image),
          location: safeText(tournament?.location),
          startDate: tournament?.startDate || null,
          endDate: tournament?.endDate || null,
          clusterCount: clusters.length,
          stationCount,
          busyCount,
          lockedCount,
          idleCount: Math.max(0, stationCount - occupiedCount),
          clusters,
        };
      });

    const totals = {
      tournaments: items.length,
      clusters: items.reduce(
        (total, tournament) => total + Number(tournament?.clusterCount || 0),
        0
      ),
      stations: items.reduce(
        (total, tournament) => total + Number(tournament?.stationCount || 0),
        0
      ),
      busy: items.reduce(
        (total, tournament) => total + Number(tournament?.busyCount || 0),
        0
      ),
      locked: items.reduce(
        (total, tournament) => total + Number(tournament?.lockedCount || 0),
        0
      ),
    };

    res.json({ items, totals });
  }
);

export const createAdminCourtCluster = asyncHandler(async (req, res) => {
  const item = await createCourtCluster(req.body || {});
  res.status(201).json(item);
});

export const updateAdminCourtCluster = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "clusterId");
  const item = await updateCourtCluster(req.params.id, req.body || {});
  if (!item) {
    res.status(404);
    throw new Error("Court cluster not found");
  }
  await emitClusterRuntime(req.params.id, "cluster_updated");
  res.json(item);
});

export const deleteAdminCourtCluster = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "clusterId");
  const deleted = await deleteCourtCluster(req.params.id);
  if (!deleted) {
    res.status(404);
    throw new Error("Court cluster not found");
  }
  res.json({ ok: true, deletedId: String(deleted._id) });
});

export const listAdminCourtStations = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "clusterId");
  const items = await listCourtStations(req.params.id, {
    includeMatches: String(req.query?.includeMatches || "").trim() !== "0",
  });
  res.json({ items });
});

export const createAdminCourtStation = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "clusterId");
  const item = await createCourtStation(req.params.id, req.body || {});
  await emitClusterRuntime(req.params.id, "station_created", item?._id);
  res.status(201).json(item);
});

export const updateAdminCourtStation = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "clusterId");
  ensureValidObjectId(req.params.stationId, "stationId");
  const previousStation = await CourtStation.findById(req.params.stationId)
    .select(
      "_id currentMatch currentTournament assignmentQueue.items.matchId"
    )
    .lean();
  const item = await updateCourtStation(req.params.stationId, req.body || {});
  if (!item) {
    res.status(404);
    throw new Error("Court station not found");
  }
  await emitClusterRuntime(req.params.id, "station_updated", req.params.stationId);
  await emitTournamentInvalidatesForStations(req, {
    reason: "court_station_updated",
    snapshots: [previousStation, item],
  });
  res.json(item);
});

export const deleteAdminCourtStation = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "clusterId");
  ensureValidObjectId(req.params.stationId, "stationId");
  const previousStation = await CourtStation.findById(req.params.stationId)
    .select(
      "_id currentMatch currentTournament assignmentQueue.items.matchId"
    )
    .lean();
  const deleted = await deleteCourtStation(req.params.stationId);
  if (!deleted) {
    res.status(404);
    throw new Error("Court station not found");
  }
  await emitClusterRuntime(req.params.id, "station_deleted", req.params.stationId);
  await emitTournamentInvalidatesForStations(req, {
    reason: "court_station_deleted",
    snapshots: [previousStation],
  });
  res.json({ ok: true, deletedId: String(deleted._id) });
});

export const getAdminCourtClusterRuntime = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "clusterId");
  const payload = await buildCourtClusterRuntime(req.params.id);
  if (!payload) {
    res.status(404);
    throw new Error("Court cluster not found");
  }
  res.json(payload);
});

export const getTournamentCourtClusterRuntime = asyncHandler(
  async (req, res) => {
    ensureValidObjectId(req.params.tournamentId, "tournamentId");
    ensureValidObjectId(req.params.clusterId, "clusterId");

    await ensureTournamentAllowsCluster(
      req.params.tournamentId,
      req.params.clusterId
    );

    const payload = await buildCourtClusterRuntime(req.params.clusterId, {
      tournamentId: req.params.tournamentId,
    });
    if (!payload) {
      res.status(404);
      throw new Error("Court cluster not found");
    }
    res.json(payload);
  }
);

export const getTournamentCourtLiveMonitor = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.tournamentId, "tournamentId");

  const tournament = await Tournament.findById(req.params.tournamentId)
    .select("_id name code status allowedCourtClusterIds")
    .lean();
  if (!tournament) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const clusterIds = Array.from(
    new Set(
      (Array.isArray(tournament.allowedCourtClusterIds)
        ? tournament.allowedCourtClusterIds
        : []
      )
        .map((value) => toIdString(value))
        .filter(Boolean)
    )
  );

  const [clusterDocs, clusterStationEntries] = await Promise.all([
    clusterIds.length
      ? CourtCluster.find({ _id: { $in: clusterIds } })
          .select("_id name slug venueName description color order isActive")
          .lean()
      : Promise.resolve([]),
    Promise.all(
      clusterIds.map(async (clusterId) => {
        const stations = await listCourtStations(clusterId, {
          includeMatches: true,
        }).catch(() => []);
        return [clusterId, stations];
      })
    ),
  ]);

  const clusterDocMap = new Map(
    clusterDocs.map((cluster) => [toIdString(cluster?._id), cluster])
  );
  const stations = clusterStationEntries.flatMap(([clusterId, items]) => {
    const cluster = clusterDocMap.get(clusterId) || {
      _id: clusterId,
      name: `Cluster ${clusterId.slice(0, 6)}`,
      slug: "",
      venueName: "",
      description: "",
      color: "",
      order: 0,
      isActive: true,
    };
    return (Array.isArray(items) ? items : [])
      .filter((station) => station?.isActive !== false)
      .map((station) => ({
        ...station,
        cluster: buildClusterManagerSummary(cluster),
      }));
  });

  const stationIds = stations.map((station) => toIdString(station?._id)).filter(Boolean);
  const presenceMap = await getCourtStationPresenceSummaryMap(stationIds);
  const now = new Date();

  const monitorStations = stations.map((station) => {
    const stationId = toIdString(station?._id);
    const presence = normalizePresenceForMonitor(
      station,
      presenceMap.get(stationId),
      now
    );
    const monitor = buildStationMonitorStatus(station, presence);

    return {
      _id: stationId,
      name: safeText(station?.name),
      code: safeText(station?.code),
      order: Number.isFinite(Number(station?.order)) ? Number(station.order) : 0,
      status: safeText(station?.status, "idle"),
      assignmentMode: safeText(station?.assignmentMode, "manual"),
      clusterId: toIdString(station?.clusterId || station?.cluster?._id),
      clusterName: safeText(station?.clusterName || station?.cluster?.name),
      cluster: station.cluster,
      currentMatch: station.currentMatch || null,
      currentTournament: station.currentTournament || null,
      liveConfig: station.liveConfig || null,
      presence,
      monitor: {
        ...monitor,
        checkedAt: now.toISOString(),
      },
    };
  });

  const counts = monitorStations.reduce(
    (acc, station) => {
      acc.total += 1;
      if (station.monitor?.hasLiveWork) acc.live += 1;
      if (station.monitor?.online) acc.online += 1;
      if (station.monitor?.lostSignal) acc.lostSignal += 1;
      if (station.monitor?.severity === "warning") acc.warning += 1;
      if (station.monitor?.state === "lost_signal") acc.offline += 1;
      return acc;
    },
    {
      total: 0,
      live: 0,
      online: 0,
      warning: 0,
      lostSignal: 0,
      offline: 0,
    }
  );

  res.json({
    ok: true,
    tournament: {
      _id: toIdString(tournament._id),
      name: safeText(tournament.name),
      code: safeText(tournament.code),
      status: safeText(tournament.status),
    },
    source: {
      type: "main_server_presence",
      heartbeatGraceMs: LIVE_MONITOR_PRESENCE_GRACE_MS,
    },
    counts,
    stations: monitorStations.sort((left, right) => {
      const leftClusterOrder = Number(left?.cluster?.order || 0);
      const rightClusterOrder = Number(right?.cluster?.order || 0);
      if (leftClusterOrder !== rightClusterOrder) {
        return leftClusterOrder - rightClusterOrder;
      }
      const leftOrder = Number(left?.order || 0);
      const rightOrder = Number(right?.order || 0);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return safeText(left?.name).localeCompare(safeText(right?.name), "vi");
    }),
    updatedAt: now.toISOString(),
  });
});

export const updateTournamentCourtStationAssignmentConfigHttp = asyncHandler(
  async (req, res) => {
    ensureValidObjectId(req.params.tournamentId, "tournamentId");
    ensureValidObjectId(req.params.stationId, "stationId");

    const station = await CourtStation.findById(req.params.stationId)
      .select(
        "_id clusterId currentMatch currentTournament assignmentQueue.items.matchId"
      )
      .lean();
    if (!station) {
      res.status(404);
      throw new Error("Court station not found");
    }

    await ensureTournamentAllowsCluster(
      req.params.tournamentId,
      station.clusterId
    );

    const isAdmin = isAdminLike(req.user);
    if (!isAdmin) {
      const canManageMatchTournament = await canManageTournament(
        req.user,
        req.params.tournamentId
      );

      if (!canManageMatchTournament && !req.isTournamentReferee) {
        res.status(403);
        throw new Error("Forbidden");
      }
    }

    const payload = await updateCourtStationAssignmentConfig(req.params.stationId, {
      tournamentId: req.params.tournamentId,
      assignmentMode: req.body?.assignmentMode,
      queueMatchIds: Array.isArray(req.body?.queueMatchIds)
        ? req.body.queueMatchIds
        : undefined,
      refereeIds: Array.isArray(req.body?.refereeIds)
        ? req.body.refereeIds
        : undefined,
      user: req.user || null,
      isAdmin,
    });

    await emitClusterRuntime(
      payload?.station?.clusterId,
      "station_assignment_config_updated",
      req.params.stationId
    );
    await emitTournamentInvalidatesForStations(req, {
      reason: "court_station_assignment_config_updated",
      fallbackTournamentIds: [req.params.tournamentId],
      snapshots: [station, payload],
    });
    res.json(payload);
  }
);

export const appendTournamentCourtStationQueueItemHttp = asyncHandler(
  async (req, res) => {
    ensureValidObjectId(req.params.tournamentId, "tournamentId");
    ensureValidObjectId(req.params.stationId, "stationId");
    ensureValidObjectId(req.body?.matchId, "matchId");

    const station = await CourtStation.findById(req.params.stationId)
      .select(
        "_id clusterId currentMatch currentTournament assignmentQueue.items.matchId"
      )
      .lean();
    if (!station) {
      res.status(404);
      throw new Error("Court station not found");
    }

    await ensureTournamentAllowsCluster(
      req.params.tournamentId,
      station.clusterId
    );

    const isAdmin = isAdminLike(req.user);
    if (!isAdmin) {
      const canManageMatchTournament = await canManageTournament(
        req.user,
        req.params.tournamentId
      );

      if (!canManageMatchTournament && !req.isTournamentReferee) {
        res.status(403);
        throw new Error("Forbidden");
      }
    }

    const payload = await appendMatchToCourtStationQueue(req.params.stationId, {
      tournamentId: req.params.tournamentId,
      matchId: req.body.matchId,
      user: req.user || null,
    });

    await emitClusterRuntime(
      payload?.station?.clusterId,
      "station_queue_item_appended",
      req.params.stationId
    );
    await emitTournamentInvalidatesForStations(req, {
      reason: "court_station_queue_item_appended",
      fallbackTournamentIds: [req.params.tournamentId],
      snapshots: [station, payload],
      extraMatchIds: [req.body.matchId],
    });
    res.status(201).json(payload);
  }
);

export const removeTournamentCourtStationQueueItemHttp = asyncHandler(
  async (req, res) => {
    ensureValidObjectId(req.params.tournamentId, "tournamentId");
    ensureValidObjectId(req.params.stationId, "stationId");
    ensureValidObjectId(req.params.matchId, "matchId");

    const station = await CourtStation.findById(req.params.stationId)
      .select(
        "_id clusterId currentMatch currentTournament assignmentQueue.items.matchId"
      )
      .lean();
    if (!station) {
      res.status(404);
      throw new Error("Court station not found");
    }

    await ensureTournamentAllowsCluster(
      req.params.tournamentId,
      station.clusterId
    );

    const isAdmin = isAdminLike(req.user);
    if (!isAdmin) {
      const match = await Match.findById(req.params.matchId).select("_id tournament").lean();
      if (!match || toIdString(match.tournament) !== String(req.params.tournamentId)) {
        res.status(403);
        throw new Error("Không được phép xóa trận của giải đấu khác");
      }

      const canManageMatchTournament = await canManageTournament(
        req.user,
        req.params.tournamentId
      );

      if (!canManageMatchTournament && !req.isTournamentReferee) {
        res.status(403);
        throw new Error("Forbidden");
      }
    }

    const payload = await removeMatchFromCourtStationQueue(
      req.params.stationId,
      req.params.matchId
    );

    await emitClusterRuntime(
      payload?.station?.clusterId,
      "station_queue_item_removed",
      req.params.stationId
    );
    await emitTournamentInvalidatesForStations(req, {
      reason: "court_station_queue_item_removed",
      fallbackTournamentIds: [req.params.tournamentId],
      snapshots: [station, payload],
      extraMatchIds: [req.params.matchId],
    });
    res.json(payload);
  }
);

export const assignMatchToCourtStationHttp = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "stationId");
  ensureValidObjectId(req.body?.matchId, "matchId");
  const force = req.body?.force === true || req.body?.force === "true";
  if (force && !isAdminLike(req.user)) {
    res.status(403);
    throw new Error("Chỉ admin mới được ép gán sân.");
  }
  const previousStation = await CourtStation.findById(req.params.id)
    .select(
      "_id clusterId currentMatch currentTournament assignmentQueue.items.matchId"
    )
    .lean();
  const payload = await assignMatchToCourtStation(
    req.params.id,
    req.body.matchId,
    { force }
  );
  await emitClusterRuntime(
    payload?.station?.clusterId,
    "station_match_assigned",
    req.params.id
  );
  await emitTournamentInvalidatesForStations(req, {
    reason: "court_station_match_assigned",
    snapshots: [previousStation, payload],
    extraMatchIds: [req.body.matchId, payload?.replacedMatchId].filter(Boolean),
  });
  res.json(payload);
});

export const assignTournamentMatchToCourtStationHttp = asyncHandler(
  async (req, res) => {
    ensureValidObjectId(req.params.tournamentId, "tournamentId");
    ensureValidObjectId(req.params.stationId, "stationId");
    ensureValidObjectId(req.body?.matchId, "matchId");

    const [station, match] = await Promise.all([
      CourtStation.findById(req.params.stationId)
        .select(
          "_id clusterId currentMatch currentTournament assignmentQueue.items.matchId"
        )
        .lean(),
      Match.findById(req.body.matchId).select("_id tournament").lean(),
    ]);

    if (!station) {
      res.status(404);
      throw new Error("Court station not found");
    }
    if (!match) {
      res.status(404);
      throw new Error("Match not found");
    }
    if (toIdString(match.tournament) !== String(req.params.tournamentId)) {
      res.status(409);
      throw new Error("Trận đấu không thuộc giải đấu hiện tại.");
    }

    await ensureTournamentAllowsCluster(
      req.params.tournamentId,
      station.clusterId
    );

    const isAdmin = isAdminLike(req.user);
    const force = req.body?.force === true || req.body?.force === "true";
    if (force && !isAdmin) {
      res.status(403);
      throw new Error("Chỉ admin mới được ép gán sân.");
    }
    if (!isAdmin) {
      const canManageMatchTournament = await canManageTournament(
        req.user,
        req.params.tournamentId
      );

      if (!canManageMatchTournament && !req.isTournamentReferee) {
        res.status(403);
        throw new Error("Forbidden");
      }

      const occupiedTournamentId = toIdString(station.currentTournament);
      if (
        occupiedTournamentId &&
        occupiedTournamentId !== String(req.params.tournamentId)
      ) {
        res.status(409);
        throw new Error("Sân đang được giải đấu khác sử dụng.");
      }
    }

    const payload = await assignMatchToCourtStation(
      req.params.stationId,
      req.body.matchId,
      { force }
    );
    await emitClusterRuntime(
      payload?.station?.clusterId,
      "station_match_assigned",
      req.params.stationId
    );
    await emitTournamentInvalidatesForStations(req, {
      reason: "court_station_match_assigned",
      fallbackTournamentIds: [req.params.tournamentId],
      snapshots: [station, payload],
      extraMatchIds: [req.body.matchId, payload?.replacedMatchId].filter(
        Boolean
      ),
    });
    res.json(payload);
  }
);

export const freeCourtStationHttp = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "stationId");
  const previousStation = await CourtStation.findById(req.params.id)
    .select(
      "_id clusterId currentMatch currentTournament assignmentQueue.items.matchId"
    )
    .lean();
  const payload = await freeCourtStation(req.params.id);
  if (!payload) {
    res.status(404);
    throw new Error("Court station not found");
  }
  await emitClusterRuntime(
    payload?.station?.clusterId,
    "station_freed",
    req.params.id
  );
  await emitTournamentInvalidatesForStations(req, {
    reason: "court_station_freed",
    snapshots: [previousStation, payload],
  });
  res.json(payload);
});

export const forceFreeAdminCourtStationHttp = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "stationId");

  const station = await CourtStation.findById(req.params.id)
    .select(
      "_id clusterId currentMatch currentTournament assignmentQueue.items.matchId"
    )
    .lean();
  if (!station) {
    res.status(404);
    throw new Error("Court station not found");
  }

  const [freePayload, presencePayload] = await Promise.all([
    freeCourtStation(req.params.id, { advanceQueue: false }),
    forceReleaseCourtStationPresence(req.params.id, {
      reason: "admin_force_free",
      publish: false,
    }),
  ]);

  await emitClusterRuntime(
    station.clusterId,
    "station_force_freed",
    req.params.id
  );
  await emitTournamentInvalidatesForStations(req, {
    reason: "court_station_force_freed",
    snapshots: [station, freePayload],
  });

  res.json({
    ok: true,
    station: freePayload?.station || null,
    previousMatchId: freePayload?.previousMatchId || null,
    presenceReleased: Boolean(presencePayload?.released),
    stationId: toIdString(station?._id),
    clusterId: toIdString(station?.clusterId),
  });
});

export const forceReleaseAdminCourtStationPresenceHttp = asyncHandler(
  async (req, res) => {
    ensureValidObjectId(req.params.id, "stationId");

    const payload = await forceReleaseCourtStationPresence(req.params.id, {
      reason: "admin_force_presence_release",
      publish: false,
    });
    if (!payload?.ok) {
      if (payload?.reason === "court_station_not_found") {
        res.status(404);
        throw new Error("Court station not found");
      }
      res.status(400);
      throw new Error("Không thọƒ gọ¡ lock sý¢n.");
    }

    await emitClusterRuntime(
      payload.clusterId,
      "station_presence_force_released",
      req.params.id
    );

    res.json(payload);
  }
);

export const freeTournamentCourtStationHttp = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.tournamentId, "tournamentId");
  ensureValidObjectId(req.params.stationId, "stationId");

  const station = await CourtStation.findById(req.params.stationId)
    .select(
      "_id clusterId currentMatch currentTournament assignmentQueue.items.matchId"
    )
    .lean();
  if (!station) {
    res.status(404);
    throw new Error("Court station not found");
  }

  await ensureTournamentAllowsCluster(req.params.tournamentId, station.clusterId);

  const isAdmin = isAdminLike(req.user);
  if (!isAdmin) {
    const canManageMatchTournament = await canManageTournament(
      req.user,
      req.params.tournamentId
    );

    if (!canManageMatchTournament && !req.isTournamentReferee) {
      res.status(403);
      throw new Error("Forbidden");
    }

    const occupiedTournamentId = toIdString(station.currentTournament);
    if (
      occupiedTournamentId &&
      occupiedTournamentId !== String(req.params.tournamentId)
    ) {
      res.status(409);
      throw new Error("Sân đang được giải đấu khác sử dụng.");
    }
  }

  const payload = await freeCourtStation(req.params.stationId);
  if (!payload) {
    res.status(404);
    throw new Error("Court station not found");
  }
  await emitClusterRuntime(
    payload?.station?.clusterId,
    "station_freed",
    req.params.stationId
  );
  await emitTournamentInvalidatesForStations(req, {
    reason: "court_station_freed",
    fallbackTournamentIds: [req.params.tournamentId],
    snapshots: [station, payload],
  });
  res.json(payload);
});

export const getAdminCourtStationCurrentMatch = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "stationId");
  const payload = await getCourtStationCurrentMatch(req.params.id);
  if (!payload) {
    res.status(404);
    throw new Error("Court station not found");
  }
  res.json(payload);
});
