import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Tournament from "../models/tournamentModel.js";
import {
  canManageCourtCluster,
  getCourtStationCurrentMatch,
  listCourtStations,
  listManageableCourtClustersForUser,
} from "../services/courtCluster.service.js";
import { canManageTournament } from "../utils/tournamentAuth.js";

function ensureValidObjectId(value, label = "id") {
  if (!mongoose.isValidObjectId(String(value || ""))) {
    const error = new Error(`Invalid ${label}`);
    error.status = 400;
    throw error;
  }
}

function isAdminLike(user) {
  return Boolean(
    user?.isAdmin === true ||
      String(user?.role || "")
        .trim()
        .toLowerCase() === "admin"
  );
}

function toIdString(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

export const listLiveAppCourtClusters = asyncHandler(async (req, res) => {
  const items = await listManageableCourtClustersForUser(req.user);
  res.setHeader("Cache-Control", "private, max-age=10, stale-while-revalidate=10");
  res.json({ items });
});

export const listLiveAppCourtStations = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.clusterId, "clusterId");
  const allowed = await canManageCourtCluster(req.user, req.params.clusterId);
  if (!allowed) {
    res.status(403);
    throw new Error("Forbidden");
  }
  const items = await listCourtStations(req.params.clusterId, {
    includeMatches: true,
  });
  res.setHeader("Cache-Control", "private, max-age=3, stale-while-revalidate=5");
  res.json({ items });
});

export const listLiveAppTournamentCourtStations = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.tournamentId, "tournamentId");

  const isAdmin = isAdminLike(req.user);
  const canManage = isAdmin || (await canManageTournament(req.user, req.params.tournamentId));
  if (!canManage) {
    res.status(403);
    throw new Error("Forbidden");
  }

  const tournament = await Tournament.findById(req.params.tournamentId)
    .select("_id allowedCourtClusterIds")
    .lean();
  if (!tournament) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const clusterIds = Array.isArray(tournament.allowedCourtClusterIds)
    ? tournament.allowedCourtClusterIds.map((value) => toIdString(value)).filter(Boolean)
    : [];

  if (!clusterIds.length) {
    res.setHeader("Cache-Control", "private, max-age=3, stale-while-revalidate=5");
    return res.json({ items: [] });
  }

  const grouped = await Promise.all(
    clusterIds.map((clusterId) =>
      listCourtStations(clusterId, {
        includeMatches: true,
      }).catch(() => [])
    )
  );

  const items = grouped
    .flat()
    .filter(Boolean)
    .sort((left, right) => {
      const leftCluster = String(left?.clusterName || "").trim().toLowerCase();
      const rightCluster = String(right?.clusterName || "").trim().toLowerCase();
      if (leftCluster !== rightCluster) return leftCluster.localeCompare(rightCluster);

      const leftOrder = Number.isFinite(Number(left?.order)) ? Number(left.order) : Number.MAX_SAFE_INTEGER;
      const rightOrder = Number.isFinite(Number(right?.order)) ? Number(right.order) : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      const leftName = String(left?.label || left?.name || left?.code || "").trim().toLowerCase();
      const rightName = String(right?.label || right?.name || right?.code || "").trim().toLowerCase();
      return leftName.localeCompare(rightName);
    });

  res.setHeader("Cache-Control", "private, max-age=3, stale-while-revalidate=5");
  res.json({ items });
});

export const getLiveAppCourtStationCurrentMatch = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.courtStationId, "courtStationId");
  const payload = await getCourtStationCurrentMatch(req.params.courtStationId);
  if (!payload) {
    res.status(404);
    throw new Error("Court station not found");
  }
  const allowed = await canManageCourtCluster(
    req.user,
    payload?.cluster?._id || payload?.station?.clusterId
  );
  if (!allowed) {
    res.status(403);
    throw new Error("Forbidden");
  }
  res.setHeader("Cache-Control", "private, max-age=2, stale-while-revalidate=3");
  res.json(payload);
});
