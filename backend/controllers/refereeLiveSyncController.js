import asyncHandler from "express-async-handler";
import {
  claimMatchLiveOwner,
  getMatchLiveOwner,
  normalizeLiveOwnerForClient,
  releaseMatchLiveOwner,
} from "../services/matchLiveOwnership.service.js";
import { loadMatchLiveSnapshot } from "../services/matchLiveSnapshot.service.js";
import { syncMatchLiveEvents } from "../services/matchLiveSync.service.js";

function pickTrim(value) {
  return (value && String(value).trim()) || "";
}

function getDeviceContext(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const header = (name) => pickTrim(req.get?.(name) || req.headers?.[name]);
  const deviceId =
    pickTrim(body.deviceId) || header("x-device-id") || header("X-Device-Id");
  const deviceName =
    pickTrim(body.deviceName) ||
    header("x-device-name") ||
    header("X-Device-Name");
  return { deviceId, deviceName };
}

function currentDisplayName(user, fallback = "") {
  return (
    pickTrim(user?.nickname) ||
    pickTrim(user?.nickName) ||
    pickTrim(user?.name) ||
    pickTrim(user?.fullName) ||
    pickTrim(fallback) ||
    "Referee"
  );
}

function ownerPayload(owner, deviceId = "") {
  return normalizeLiveOwnerForClient(owner, deviceId);
}

function emitOwnershipChanged(io, matchId, owner, deviceId = "") {
  if (!io || !matchId) return;
  io.to(`match:${String(matchId)}`).emit("match:ownership_changed", {
    matchId: String(matchId),
    owner: owner ? { ...owner } : null,
  });
}

export const bootstrapMatchLiveSync = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { deviceId } = getDeviceContext(req);
  const [snapshot, owner] = await Promise.all([
    loadMatchLiveSnapshot(id),
    getMatchLiveOwner(id),
  ]);

  if (!snapshot) {
    res.status(404);
    throw new Error("Match not found");
  }

  res.json({
    ok: true,
    featureEnabled: true,
    mode: "offline_sync_v1",
    snapshot,
    serverVersion: Number(snapshot.liveVersion || 0),
    owner: ownerPayload(owner, deviceId),
  });
});

export const claimMatchLiveSyncOwner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const io = req.app?.get?.("io");
  const { deviceId, deviceName } = getDeviceContext(req);
  if (!deviceId) {
    return res.status(400).json({
      ok: false,
      code: "invalid_transition",
      message: "deviceId is required",
    });
  }

  const result = await claimMatchLiveOwner({
    matchId: id,
    deviceId,
    userId: req.user?._id || null,
    displayName: currentDisplayName(req.user, deviceName),
    force: false,
  });

  const snapshot = await loadMatchLiveSnapshot(id);
  if (!result.ok) {
    return res.status(409).json({
      ok: false,
      code: "ownership_conflict",
      owner: ownerPayload(result.owner, deviceId),
      snapshot,
      serverVersion: Number(snapshot?.liveVersion || 0),
    });
  }

  emitOwnershipChanged(io, id, result.owner, deviceId);

  res.json({
    ok: true,
    owner: ownerPayload(result.owner, deviceId),
    snapshot,
    serverVersion: Number(snapshot?.liveVersion || 0),
    takeover: Boolean(result.takeover),
  });
});

export const takeoverMatchLiveSyncOwner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const io = req.app?.get?.("io");
  const { deviceId, deviceName } = getDeviceContext(req);
  if (!deviceId) {
    return res.status(400).json({
      ok: false,
      code: "invalid_transition",
      message: "deviceId is required",
    });
  }

  const result = await claimMatchLiveOwner({
    matchId: id,
    deviceId,
    userId: req.user?._id || null,
    displayName: currentDisplayName(req.user, deviceName),
    force: true,
  });

  const snapshot = await loadMatchLiveSnapshot(id);
  emitOwnershipChanged(io, id, result.owner, deviceId);

  res.json({
    ok: true,
    owner: ownerPayload(result.owner, deviceId),
    snapshot,
    serverVersion: Number(snapshot?.liveVersion || 0),
    takeover: true,
  });
});

export const releaseMatchLiveSyncOwner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const io = req.app?.get?.("io");
  const { deviceId } = getDeviceContext(req);
  const result = await releaseMatchLiveOwner(id, deviceId);

  if (!result.ok) {
    return res.status(409).json({
      ok: false,
      code: "ownership_conflict",
      owner: ownerPayload(result.owner, deviceId),
    });
  }

  emitOwnershipChanged(io, id, null, deviceId);

  res.json({
    ok: true,
    released: Boolean(result.released),
    owner: null,
  });
});

export const syncMatchLiveSyncEvents = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const io = req.app?.get?.("io");
  const { deviceId, deviceName } = getDeviceContext(req);
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const result = await syncMatchLiveEvents({
    matchId: id,
    user: req.user || null,
    deviceId,
    deviceName: currentDisplayName(req.user, deviceName),
    lastKnownServerVersion: Number(body.lastKnownServerVersion || 0),
    events: Array.isArray(body.events) ? body.events : [],
    io,
  });

  if (result.owner) {
    emitOwnershipChanged(io, id, result.owner, deviceId);
  }

  res.json({
    ok: true,
    ackedClientEventIds: result.ackedClientEventIds,
    rejectedEvents: result.rejectedEvents,
    snapshot: result.snapshot,
    serverVersion: Number(result.serverVersion || 0),
    owner: ownerPayload(result.owner, deviceId),
  });
});
