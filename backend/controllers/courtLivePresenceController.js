import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Court from "../models/courtModel.js";
import CourtStation from "../models/courtStationModel.js";
import {
  endCourtPresence,
  extendCourtPreviewPresence,
  heartbeatCourtPresence,
  startOrRenewCourtPresence,
} from "../services/courtLivePresence.service.js";
import { canManageTournament } from "../utils/tournamentAuth.js";
import {
  canManageCourtCluster,
} from "../services/courtCluster.service.js";
import {
  endCourtStationPresence,
  extendCourtStationPreviewPresence,
  heartbeatCourtStationPresence,
  startOrRenewCourtStationPresence,
} from "../services/courtStationPresence.service.js";

function requireUserId(req) {
  const userId = req.user?._id || req.user?.id || null;
  return userId ? String(userId) : "";
}

function normalizeBodyString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

async function ensureCourtManagementAccess(req, res, courtId) {
  const user = req.user;
  if (!user) {
    res.status(401).json({
      ok: false,
      status: "expired",
      reason: "unauthorized",
    });
    return null;
  }

  const court = await Court.findById(courtId).select("_id tournament").lean();
  if (!court) {
    res.status(404).json({
      ok: false,
      status: "expired",
      reason: "court_not_found",
    });
    return null;
  }

  const allowed = await canManageTournament(user, court.tournament);
  if (!allowed) {
    res.status(403).json({
      ok: false,
      status: "expired",
      reason: "forbidden",
    });
    return null;
  }

  return court;
}

async function ensureCourtOrStationManagementAccess(req, res, courtId) {
  const station = await CourtStation.findById(courtId)
    .select("_id clusterId")
    .lean();
  if (station) {
    const allowed = await canManageCourtCluster(req.user, station.clusterId);
    if (!allowed) {
      res.status(403).json({
        ok: false,
        status: "expired",
        reason: "forbidden",
      });
      return null;
    }
    return {
      type: "station",
      doc: station,
    };
  }

  const court = await ensureCourtManagementAccess(req, res, courtId);
  if (!court) return null;
  return {
    type: "legacy_court",
    doc: court,
  };
}

async function handlePresenceResponse(res, result) {
  if (result?.notFound) {
    return res.status(404).json({
      ok: false,
      status: "expired",
      reason: result.reason || "court_not_found",
    });
  }
  if (result?.status === "blocked") {
    return res.status(409).json(result);
  }
  return res.json(result);
}

export const startCourtPresence = asyncHandler(async (req, res) => {
  const { courtId } = req.params;
  if (!mongoose.isValidObjectId(courtId)) {
    return res.status(400).json({
      ok: false,
      status: "expired",
      reason: "invalid_court_id",
    });
  }

  const target = await ensureCourtOrStationManagementAccess(req, res, courtId);
  if (!target) return;

  const userId = requireUserId(req);
  if (!userId) {
    return res.status(401).json({
      ok: false,
      status: "expired",
      reason: "unauthorized",
    });
  }

  const result =
    target.type === "station"
      ? await startOrRenewCourtStationPresence({
          courtStationId: String(target.doc._id),
          userId,
          clientSessionId: normalizeBodyString(req.body?.clientSessionId),
          screenState: normalizeBodyString(req.body?.screenState),
          matchId: normalizeBodyString(req.body?.matchId),
          timestamp: req.body?.timestamp,
        })
      : await startOrRenewCourtPresence({
          courtId: String(target.doc._id),
          userId,
          clientSessionId: normalizeBodyString(req.body?.clientSessionId),
          screenState: normalizeBodyString(req.body?.screenState),
          matchId: normalizeBodyString(req.body?.matchId),
          timestamp: req.body?.timestamp,
        });

  return handlePresenceResponse(res, result);
});

export const heartbeatCourtPresenceController = asyncHandler(async (req, res) => {
  const { courtId } = req.params;
  if (!mongoose.isValidObjectId(courtId)) {
    return res.status(400).json({
      ok: false,
      status: "expired",
      reason: "invalid_court_id",
    });
  }

  const target = await ensureCourtOrStationManagementAccess(req, res, courtId);
  if (!target) return;

  const userId = requireUserId(req);
  if (!userId) {
    return res.status(401).json({
      ok: false,
      status: "expired",
      reason: "unauthorized",
    });
  }

  const result =
    target.type === "station"
      ? await heartbeatCourtStationPresence({
          courtStationId: String(target.doc._id),
          userId,
          clientSessionId: normalizeBodyString(req.body?.clientSessionId),
          screenState: normalizeBodyString(req.body?.screenState),
          matchId: normalizeBodyString(req.body?.matchId),
          timestamp: req.body?.timestamp,
        })
      : await heartbeatCourtPresence({
          courtId: String(target.doc._id),
          userId,
          clientSessionId: normalizeBodyString(req.body?.clientSessionId),
          screenState: normalizeBodyString(req.body?.screenState),
          matchId: normalizeBodyString(req.body?.matchId),
          timestamp: req.body?.timestamp,
        });

  return handlePresenceResponse(res, result);
});

export const endCourtPresenceController = asyncHandler(async (req, res) => {
  const { courtId } = req.params;
  if (!mongoose.isValidObjectId(courtId)) {
    return res.status(400).json({
      ok: false,
      status: "expired",
      reason: "invalid_court_id",
    });
  }

  const target = await ensureCourtOrStationManagementAccess(req, res, courtId);
  if (!target) return;

  const result =
    target.type === "station"
      ? await endCourtStationPresence({
          courtStationId: String(target.doc._id),
          clientSessionId: normalizeBodyString(req.body?.clientSessionId),
        })
      : await endCourtPresence({
          courtId: String(target.doc._id),
          clientSessionId: normalizeBodyString(req.body?.clientSessionId),
        });

  return handlePresenceResponse(res, result);
});

export const extendCourtPreviewPresenceController = asyncHandler(async (req, res) => {
  const { courtId } = req.params;
  if (!mongoose.isValidObjectId(courtId)) {
    return res.status(400).json({
      ok: false,
      status: "expired",
      reason: "invalid_court_id",
    });
  }

  const target = await ensureCourtOrStationManagementAccess(req, res, courtId);
  if (!target) return;

  const result =
    target.type === "station"
      ? await extendCourtStationPreviewPresence({
          courtStationId: String(target.doc._id),
          clientSessionId: normalizeBodyString(req.body?.clientSessionId),
          timestamp: req.body?.timestamp,
        })
      : await extendCourtPreviewPresence({
          courtId: String(target.doc._id),
          clientSessionId: normalizeBodyString(req.body?.clientSessionId),
          timestamp: req.body?.timestamp,
        });

  return handlePresenceResponse(res, result);
});
