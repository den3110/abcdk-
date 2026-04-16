import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import UserMatch from "../models/userMatchModel.js";
import CourtStation from "../models/courtStationModel.js";
import { getOverlayMatch } from "./overlayController.js";

function ensureValidObjectId(value, label = "match id") {
  if (!mongoose.isValidObjectId(String(value || ""))) {
    const error = new Error(`Invalid ${label}`);
    error.status = 400;
    throw error;
  }
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

async function resolveMatchContext(matchId) {
  const requestedUserMatch = await UserMatch.findById(matchId)
    .select("_id status")
    .lean();

  if (requestedUserMatch) {
    return {
      kind: "user_match",
      requestedMatch: requestedUserMatch,
      station: null,
    };
  }

  const requestedMatch = await Match.findById(matchId)
    .select("_id status courtStation courtStationLabel courtClusterId courtClusterLabel")
    .lean();

  if (!requestedMatch) {
    return null;
  }

  let station = null;

  if (requestedMatch.courtStation) {
    station = await CourtStation.findById(requestedMatch.courtStation)
      .select("_id name code status currentMatch clusterId")
      .populate({ path: "currentMatch", select: "_id status code displayCode" })
      .populate({ path: "clusterId", select: "_id name slug venueName color" })
      .lean();
  }

  if (!station) {
    station = await CourtStation.findOne({
      $or: [
        { currentMatch: requestedMatch._id },
        { "assignmentQueue.items.matchId": requestedMatch._id },
      ],
    })
      .select("_id name code status currentMatch clusterId")
      .populate({ path: "currentMatch", select: "_id status code displayCode" })
      .populate({ path: "clusterId", select: "_id name slug venueName color" })
      .lean();
  }

  return {
    kind: "match",
    requestedMatch,
    station,
  };
}

function resolveCurrentLiveMatchId(context) {
  const requestedMatchId = String(context?.requestedMatch?._id || "").trim();
  const requestedStatus = String(context?.requestedMatch?.status || "")
    .trim()
    .toLowerCase();

  if (requestedMatchId && requestedStatus === "live") {
    return requestedMatchId;
  }

  const stationCurrentMatchId = String(
    context?.station?.currentMatch?._id || context?.station?.currentMatch || ""
  ).trim();
  const stationCurrentMatchStatus = String(
    context?.station?.currentMatch?.status || context?.station?.status || ""
  )
    .trim()
    .toLowerCase();

  if (stationCurrentMatchId && stationCurrentMatchStatus === "live") {
    return stationCurrentMatchId;
  }

  return requestedMatchId;
}

export const getOverlayCurrentMatchByMatchId = asyncHandler(async (req, res) => {
  ensureValidObjectId(req.params.id, "match id");

  const context = await resolveMatchContext(req.params.id);
  if (!context) {
    res.status(404);
    throw new Error("Match not found");
  }

  const resolvedMatchId = resolveCurrentLiveMatchId(context);
  const payload = await loadOverlayPayloadForMatch(req, resolvedMatchId);

  res.json(payload);
});
