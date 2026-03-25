import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Match from "../../models/matchModel.js";
import CourtStation from "../../models/courtStationModel.js";
import Tournament from "../../models/tournamentModel.js";
import {
  appendMatchToCourtStationQueue,
  assignMatchToCourtStation,
  buildCourtClusterRuntime,
  canManageCourtCluster,
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
      const [canManageMatchTournament, canManageStationCluster] =
        await Promise.all([
          canManageTournament(req.user, req.params.tournamentId),
          canManageCourtCluster(req.user, station.clusterId),
        ]);

      if (!canManageMatchTournament || !canManageStationCluster) {
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
      user: req.user || null,
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
      const [canManageMatchTournament, canManageStationCluster] =
        await Promise.all([
          canManageTournament(req.user, req.params.tournamentId),
          canManageCourtCluster(req.user, station.clusterId),
        ]);

      if (!canManageMatchTournament || !canManageStationCluster) {
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
      const [canManageMatchTournament, canManageStationCluster] =
        await Promise.all([
          canManageTournament(req.user, req.params.tournamentId),
          canManageCourtCluster(req.user, station.clusterId),
        ]);

      if (!canManageMatchTournament || !canManageStationCluster) {
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
      const [canManageMatchTournament, canManageStationCluster] =
        await Promise.all([
          canManageTournament(req.user, req.params.tournamentId),
          canManageCourtCluster(req.user, station.clusterId),
        ]);

      if (!canManageMatchTournament || !canManageStationCluster) {
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
    const [canManageMatchTournament, canManageStationCluster] =
      await Promise.all([
        canManageTournament(req.user, req.params.tournamentId),
        canManageCourtCluster(req.user, station.clusterId),
      ]);

    if (!canManageMatchTournament || !canManageStationCluster) {
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
