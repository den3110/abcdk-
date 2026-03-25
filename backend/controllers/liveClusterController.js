import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import CourtStation from "../models/courtStationModel.js";
import { toRealtimePublicMatchDTO } from "../socket/liveHandlers.js";
import {
  buildPublicLiveClusterDetail,
  buildPublicLiveClusters,
  buildPublicLiveCourtDetail,
} from "../services/courtCluster.service.js";

function ensureValidObjectId(value, label = "id") {
  if (!mongoose.isValidObjectId(String(value || ""))) {
    const error = new Error(`Invalid ${label}`);
    error.status = 400;
    throw error;
  }
}

async function loadCurrentMatchDto(stationId) {
  const station = await CourtStation.findById(stationId)
    .populate({
      path: "currentMatch",
      populate: [
        { path: "tournament", select: "name image overlay eventType nameDisplayMode" },
        { path: "bracket" },
        {
          path: "pairA",
          populate: [
            { path: "player1.user", select: "name nickname nickName fullName avatar" },
            { path: "player2.user", select: "name nickname nickName fullName avatar" },
          ],
        },
        {
          path: "pairB",
          populate: [
            { path: "player1.user", select: "name nickname nickName fullName avatar" },
            { path: "player2.user", select: "name nickname nickName fullName avatar" },
          ],
        },
        { path: "referee", select: "name fullName nickname nickName" },
        { path: "liveBy", select: "name fullName nickname nickName" },
      ],
    })
    .lean();

  if (!station?.currentMatch) return null;
  return toRealtimePublicMatchDTO(station.currentMatch);
}

export const listPublicLiveClusters = asyncHandler(async (_req, res) => {
  const items = await buildPublicLiveClusters();
  res.json({ items });
});

export const getPublicLiveClusterById = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.clusterId, "clusterId");
  const payload = await buildPublicLiveClusterDetail(req.params.clusterId);
  if (!payload) {
    res.status(404);
    throw new Error("Court cluster not found");
  }
  res.json(payload);
});

export const getPublicLiveCourtById = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.courtStationId, "courtStationId");
  const payload = await buildPublicLiveCourtDetail(req.params.courtStationId);
  if (!payload) {
    res.status(404);
    throw new Error("Court station not found");
  }
  const currentMatch = await loadCurrentMatchDto(req.params.courtStationId);
  res.json({
    ...payload,
    currentMatch,
  });
});
