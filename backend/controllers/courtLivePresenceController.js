import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Court from "../models/courtModel.js";
import {
  endCourtPresence,
  extendCourtPreviewPresence,
  heartbeatCourtPresence,
  startOrRenewCourtPresence,
} from "../services/courtLivePresence.service.js";
import { canManageTournament } from "../utils/tournamentAuth.js";

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

  const court = await ensureCourtManagementAccess(req, res, courtId);
  if (!court) return;

  const userId = requireUserId(req);
  if (!userId) {
    return res.status(401).json({
      ok: false,
      status: "expired",
      reason: "unauthorized",
    });
  }

  const result = await startOrRenewCourtPresence({
    courtId: String(court._id),
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

  const court = await ensureCourtManagementAccess(req, res, courtId);
  if (!court) return;

  const userId = requireUserId(req);
  if (!userId) {
    return res.status(401).json({
      ok: false,
      status: "expired",
      reason: "unauthorized",
    });
  }

  const result = await heartbeatCourtPresence({
    courtId: String(court._id),
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

  const court = await ensureCourtManagementAccess(req, res, courtId);
  if (!court) return;

  const result = await endCourtPresence({
    courtId: String(court._id),
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

  const court = await ensureCourtManagementAccess(req, res, courtId);
  if (!court) return;

  const result = await extendCourtPreviewPresence({
    courtId: String(court._id),
    clientSessionId: normalizeBodyString(req.body?.clientSessionId),
    timestamp: req.body?.timestamp,
  });

  return handlePresenceResponse(res, result);
});
