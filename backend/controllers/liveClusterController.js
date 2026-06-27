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
import { isConcreteTeamLabel } from "../services/matchSideDisplay.service.js";

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

function firstConcreteTeamName(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (isConcreteTeamLabel(text)) return text;
  }
  return "";
}

function overlaySideName(overlayMatch, side) {
  const key = side === "B" ? "B" : "A";
  return firstConcreteTeamName(
    overlayMatch?.[`resolvedSideName${key}`],
    overlayMatch?.[`team${key}Name`],
    overlayMatch?.teams?.[key]?.displayName,
    overlayMatch?.teams?.[key]?.name
  );
}

function mergeResolvedTeamNames(match, overlayMatch) {
  if (!match || !overlayMatch) return match;

  const next = { ...match };
  const teams = { ...(next.teams || {}) };
  const sideMap = [
    ["A", "teamAName", "resolvedSideNameA", "pairA"],
    ["B", "teamBName", "resolvedSideNameB", "pairB"],
  ];

  for (const [side, teamKey, resolvedKey, pairKey] of sideMap) {
    const name = overlaySideName(overlayMatch, side);
    if (!name) continue;

    next[teamKey] = name;
    next[resolvedKey] = name;
    teams[side] = {
      ...(teams[side] || {}),
      name,
      displayName: name,
    };

    if (next[pairKey] && typeof next[pairKey] === "object") {
      next[pairKey] = {
        ...next[pairKey],
        name,
        displayName: name,
      };
    }
  }

  if (Object.keys(teams).length) next.teams = teams;
  return next;
}

function mergeCourtPayloadTeamNames(payload, overlayMatch) {
  if (!payload || !overlayMatch) return payload;
  return {
    ...payload,
    currentMatch: mergeResolvedTeamNames(payload.currentMatch, overlayMatch),
    station: payload.station
      ? {
          ...payload.station,
          currentMatch: mergeResolvedTeamNames(
            payload.station.currentMatch,
            overlayMatch
          ),
        }
      : payload.station,
  };
}

function sameMatchId(left, right) {
  const leftId = String(left?._id || left?.matchId || left || "").trim();
  const rightId = String(right?._id || right?.matchId || right || "").trim();
  return Boolean(leftId && rightId && leftId === rightId);
}

function mergeRealtimeMatchDetails(match, realtimeMatch) {
  if (!match || !realtimeMatch || !sameMatchId(match, realtimeMatch)) return match;

  const merged = {
    ...match,
    teamAName: realtimeMatch.teamAName || match.teamAName,
    teamBName: realtimeMatch.teamBName || match.teamBName,
    resolvedSideNameA: realtimeMatch.resolvedSideNameA || match.resolvedSideNameA,
    resolvedSideNameB: realtimeMatch.resolvedSideNameB || match.resolvedSideNameB,
    pairA: realtimeMatch.pairA || match.pairA,
    pairB: realtimeMatch.pairB || match.pairB,
    teams: realtimeMatch.teams || match.teams,
    slots: realtimeMatch.slots || match.slots,
    serve: realtimeMatch.serve || match.serve,
  };

  return merged;
}

function mergeCourtPayloadRealtimeMatch(payload, realtimeMatch) {
  if (!payload || !realtimeMatch) return payload;
  return {
    ...payload,
    currentMatch: mergeRealtimeMatchDetails(payload.currentMatch, realtimeMatch),
    station: payload.station
      ? {
          ...payload.station,
          currentMatch: mergeRealtimeMatchDetails(
            payload.station.currentMatch,
            realtimeMatch
          ),
        }
      : payload.station,
  };
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
  let payload = await buildPublicLiveCourtDetail(req.params.courtStationId);
  if (!payload) {
    res.status(404);
    throw new Error("Court station not found");
  }
  let currentMatch = await loadCurrentMatchDto(req.params.courtStationId);
  payload = mergeCourtPayloadRealtimeMatch(payload, currentMatch);
  const currentMatchId = String(
    currentMatch?._id || currentMatch?.matchId || payload?.currentMatch?._id || ""
  ).trim();

  if (currentMatchId) {
    try {
      const overlayMatch = await loadOverlayPayloadForMatch(req, currentMatchId);
      currentMatch = mergeResolvedTeamNames(currentMatch, overlayMatch);
      payload = mergeCourtPayloadTeamNames(payload, overlayMatch);
    } catch (error) {
      console.error(
        "[live court detail] team name resolve error:",
        error?.message || error
      );
    }
  }

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
