import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import {
  canManageCourtCluster,
  getCourtStationCurrentMatch,
  listCourtStations,
  listManageableCourtClustersForUser,
} from "../services/courtCluster.service.js";

function ensureValidObjectId(value, label = "id") {
  if (!mongoose.isValidObjectId(String(value || ""))) {
    const error = new Error(`Invalid ${label}`);
    error.status = 400;
    throw error;
  }
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
