import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import CourtStation from "../models/courtStationModel.js";
import { toRealtimePublicMatchDTO } from "../socket/liveHandlers.js";
import { getOverlayMatch } from "./overlayController.js";
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

async function loadOverlayPayloadForMatch(req, matchId) {
  let statusCode = 200;
  let jsonPayload = null;

  const mockRes = {
    setHeader() {
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      jsonPayload = payload;
      return payload;
    },
  };

  await getOverlayMatch(
    {
      ...req,
      params: {
        ...req.params,
        id: matchId,
      },
    },
    mockRes
  );

  if (statusCode >= 400 || !jsonPayload) {
    const error = new Error(
      jsonPayload?.message || "Unable to build overlay payload for match"
    );
    error.status = statusCode || 500;
    throw error;
  }

  return jsonPayload;
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

export const getPublicLiveCourtCurrentMatchOverlay = asyncHandler(
  async (req, res) => {
    ensureValidObjectId(req.params.courtStationId, "courtStationId");
    const payload = await buildPublicLiveCourtDetail(req.params.courtStationId);

    if (!payload) {
      res.status(404);
      throw new Error("Court station not found");
    }

    const currentMatchId = String(
      payload?.currentMatch?._id ||
        payload?.station?.currentMatch?._id ||
        payload?.station?.currentMatch ||
        ""
    ).trim();
    const currentMatchStatus = String(
      payload?.currentMatch?.status || payload?.station?.currentMatch?.status || ""
    )
      .trim()
      .toLowerCase();

    if (!currentMatchId || currentMatchStatus !== "live") {
      res.status(404);
      throw new Error("No live match found for this court station");
    }

    const currentMatch = await loadOverlayPayloadForMatch(req, currentMatchId);

    res.json({
      cluster: payload.cluster,
      station: payload.station,
      currentMatch,
    });
  }
);
