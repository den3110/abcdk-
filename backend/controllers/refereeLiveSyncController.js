import asyncHandler from "express-async-handler";
import {
  claimMatchLiveOwner,
  getMatchLiveOwner,
  normalizeLiveOwnerForClient,
  releaseMatchLiveOwner,
} from "../services/matchLiveOwnership.service.js";
import { loadMatchLiveSnapshot } from "../services/matchLiveSnapshot.service.js";
import { syncMatchLiveEvents } from "../services/matchLiveSync.service.js";
import { getRefereeMatchControlLockRuntime } from "../services/systemSettingsRuntime.service.js";

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

function ownerPayload(owner, deviceId = "", userId = null) {
  return normalizeLiveOwnerForClient(owner, deviceId, userId);
}

function emitOwnershipChanged(io, matchId, owner) {
  if (!io || !matchId) return;
  io.to(`match:${String(matchId)}`).emit("match:ownership_changed", {
    matchId: String(matchId),
    owner: owner ? { ...owner } : null,
  });
}

function buildLiveSyncModePayload(lockRuntime) {
  const featureEnabled = lockRuntime?.enabled !== false;
  return {
    featureEnabled,
    mode: featureEnabled ? "offline_sync_v1" : "legacy_realtime_v1",
    settingsUpdatedAt: lockRuntime?.updatedAt || null,
  };
}

async function loadLiveSyncContext(matchId, deviceId = "", userId = null) {
  const lockRuntime = await getRefereeMatchControlLockRuntime();
  const snapshot = await loadMatchLiveSnapshot(matchId);
  const owner =
    lockRuntime.enabled !== false ? await getMatchLiveOwner(matchId) : null;

  return {
    snapshot,
    serverVersion: Number(snapshot?.liveVersion || 0),
    owner: ownerPayload(owner, deviceId, userId),
    ...buildLiveSyncModePayload(lockRuntime),
  };
}

export const bootstrapMatchLiveSync = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { deviceId } = getDeviceContext(req);
  const userId = req.user?._id || null;
  const context = await loadLiveSyncContext(id, deviceId, userId);

  if (!context.snapshot) {
    res.status(404);
    throw new Error("Match not found");
  }

  res.json({
    ok: true,
    ...context,
  });
});

export const claimMatchLiveSyncOwner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const io = req.app?.get?.("io");
  const { deviceId, deviceName } = getDeviceContext(req);
  const userId = req.user?._id || null;
  const lockRuntime = await getRefereeMatchControlLockRuntime();
  const modePayload = buildLiveSyncModePayload(lockRuntime);

  if (!modePayload.featureEnabled) {
    const context = await loadLiveSyncContext(id, deviceId, userId);
    return res.json({
      ok: true,
      ...context,
      takeover: false,
    });
  }

  if (!deviceId) {
    return res.status(400).json({
      ok: false,
      code: "invalid_transition",
      message: "deviceId is required",
      ...modePayload,
    });
  }

  const result = await claimMatchLiveOwner({
    matchId: id,
    deviceId,
    userId,
    displayName: currentDisplayName(req.user, deviceName),
    force: false,
  });

  const context = await loadLiveSyncContext(id, deviceId, userId);
  if (!result.ok) {
    return res.status(409).json({
      ok: false,
      code: "ownership_conflict",
      ...context,
      owner: ownerPayload(result.owner, deviceId, userId),
    });
  }

  emitOwnershipChanged(io, id, result.owner);

  res.json({
    ok: true,
    ...context,
    owner: ownerPayload(result.owner, deviceId, userId),
    takeover: Boolean(result.takeover),
  });
});

export const takeoverMatchLiveSyncOwner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const io = req.app?.get?.("io");
  const { deviceId, deviceName } = getDeviceContext(req);
  const userId = req.user?._id || null;
  const lockRuntime = await getRefereeMatchControlLockRuntime();
  const modePayload = buildLiveSyncModePayload(lockRuntime);

  if (!modePayload.featureEnabled) {
    const context = await loadLiveSyncContext(id, deviceId, userId);
    return res.json({
      ok: true,
      ...context,
      takeover: false,
    });
  }

  if (!deviceId) {
    return res.status(400).json({
      ok: false,
      code: "invalid_transition",
      message: "deviceId is required",
      ...modePayload,
    });
  }

  const result = await claimMatchLiveOwner({
    matchId: id,
    deviceId,
    userId,
    displayName: currentDisplayName(req.user, deviceName),
    force: true,
  });

  const context = await loadLiveSyncContext(id, deviceId, userId);
  emitOwnershipChanged(io, id, result.owner);

  res.json({
    ok: true,
    ...context,
    owner: ownerPayload(result.owner, deviceId, userId),
    takeover: true,
  });
});

export const releaseMatchLiveSyncOwner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const io = req.app?.get?.("io");
  const { deviceId } = getDeviceContext(req);
  const userId = req.user?._id || null;
  const lockRuntime = await getRefereeMatchControlLockRuntime();
  const modePayload = buildLiveSyncModePayload(lockRuntime);

  if (!modePayload.featureEnabled) {
    const context = await loadLiveSyncContext(id, deviceId, userId);
    return res.json({
      ok: true,
      ...context,
      released: false,
      owner: null,
    });
  }

  const result = await releaseMatchLiveOwner(id, deviceId);

  if (!result.ok) {
    return res.status(409).json({
      ok: false,
      code: "ownership_conflict",
      ...modePayload,
      owner: ownerPayload(result.owner, deviceId, userId),
    });
  }

  emitOwnershipChanged(io, id, null);

  res.json({
    ok: true,
    ...modePayload,
    released: Boolean(result.released),
    owner: null,
  });
});

export const syncMatchLiveSyncEvents = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const io = req.app?.get?.("io");
  const { deviceId, deviceName } = getDeviceContext(req);
  const userId = req.user?._id || null;
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

  if (result.featureEnabled && result.owner) {
    emitOwnershipChanged(io, id, result.owner);
  }

  res.json({
    ok: true,
    featureEnabled: result.featureEnabled,
    mode: result.mode,
    settingsUpdatedAt: result.settingsUpdatedAt || null,
    ackedClientEventIds: result.ackedClientEventIds,
    rejectedEvents: result.rejectedEvents,
    snapshot: result.snapshot,
    serverVersion: Number(result.serverVersion || 0),
    owner: ownerPayload(result.owner, deviceId, userId),
  });
});
