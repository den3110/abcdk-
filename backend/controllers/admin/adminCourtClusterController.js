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
  const item = await updateCourtStation(req.params.stationId, req.body || {});
  if (!item) {
    res.status(404);
    throw new Error("Court station not found");
  }
  await emitClusterRuntime(req.params.id, "station_updated", req.params.stationId);
  res.json(item);
});

export const deleteAdminCourtStation = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "clusterId");
  ensureValidObjectId(req.params.stationId, "stationId");
  const deleted = await deleteCourtStation(req.params.stationId);
  if (!deleted) {
    res.status(404);
    throw new Error("Court station not found");
  }
  await emitClusterRuntime(req.params.id, "station_deleted", req.params.stationId);
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

export const updateTournamentCourtStationAssignmentConfigHttp = asyncHandler(
  async (req, res) => {
    ensureValidObjectId(req.params.tournamentId, "tournamentId");
    ensureValidObjectId(req.params.stationId, "stationId");

    const station = await CourtStation.findById(req.params.stationId)
      .select("_id clusterId currentTournament")
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
    res.json(payload);
  }
);

export const appendTournamentCourtStationQueueItemHttp = asyncHandler(
  async (req, res) => {
    ensureValidObjectId(req.params.tournamentId, "tournamentId");
    ensureValidObjectId(req.params.stationId, "stationId");
    ensureValidObjectId(req.body?.matchId, "matchId");

    const station = await CourtStation.findById(req.params.stationId)
      .select("_id clusterId currentTournament")
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
    res.status(201).json(payload);
  }
);

export const removeTournamentCourtStationQueueItemHttp = asyncHandler(
  async (req, res) => {
    ensureValidObjectId(req.params.tournamentId, "tournamentId");
    ensureValidObjectId(req.params.stationId, "stationId");
    ensureValidObjectId(req.params.matchId, "matchId");

    const station = await CourtStation.findById(req.params.stationId)
      .select("_id clusterId currentTournament")
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
    res.json(payload);
  }
);

export const assignMatchToCourtStationHttp = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "stationId");
  ensureValidObjectId(req.body?.matchId, "matchId");
  const payload = await assignMatchToCourtStation(req.params.id, req.body.matchId);
  await emitClusterRuntime(
    payload?.station?.clusterId,
    "station_match_assigned",
    req.params.id
  );
  res.json(payload);
});

export const assignTournamentMatchToCourtStationHttp = asyncHandler(
  async (req, res) => {
    ensureValidObjectId(req.params.tournamentId, "tournamentId");
    ensureValidObjectId(req.params.stationId, "stationId");
    ensureValidObjectId(req.body?.matchId, "matchId");

    const [station, match] = await Promise.all([
      CourtStation.findById(req.params.stationId)
        .select("_id clusterId currentMatch currentTournament")
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
      req.body.matchId
    );
    await emitClusterRuntime(
      payload?.station?.clusterId,
      "station_match_assigned",
      req.params.stationId
    );
    res.json(payload);
  }
);

export const freeCourtStationHttp = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "stationId");
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
  res.json(payload);
});

export const forceFreeAdminCourtStationHttp = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "stationId");

  const station = await CourtStation.findById(req.params.id)
    .select("_id clusterId")
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
      throw new Error("KhÃ´ng thá»ƒ gá»¡ lock sÃ¢n.");
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
    .select("_id clusterId currentTournament")
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
