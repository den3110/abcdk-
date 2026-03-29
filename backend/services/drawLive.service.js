import Bracket from "../models/bracketModel.js";
import DrawSession from "../models/drawSessionModel.js";
import DrawControlState from "../models/drawControlStateModel.js";
import { canManageTournament } from "../utils/tournamentAuth.js";

export const DRAW_CONTROL_HEARTBEAT_MS = 5000;
export const DRAW_CONTROL_TTL_MS = 15000;

const toId = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  return String(value._id || value.id || value);
};

const toDateOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isSuperAdminUser = (user) =>
  Boolean(user?.isSuperUser || user?.isSuperAdmin);

const userDisplayName = (user) =>
  String(
    user?.name ||
      user?.fullName ||
      user?.username ||
      user?.email ||
      user?._id ||
      user?.id ||
      "Unknown user",
  ).trim();

const userRoleList = (user) => {
  const roles = [];
  if (Array.isArray(user?.roles)) roles.push(...user.roles);
  if (user?.role) roles.push(user.role);
  return Array.from(
    new Set(
      roles
        .map((role) => String(role || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
};

const buildEmptySnapshot = (tournamentId, viewer = {}) => ({
  tournamentId: toId(tournamentId),
  lock: {
    locked: false,
    holderUserId: null,
    holderName: "",
    holderRoles: [],
    activeDrawId: null,
    activeBracketId: null,
    status: "idle",
    expiresAt: null,
    revision: 0,
  },
  activeSession: null,
  viewer: {
    canControl: Boolean(viewer.canControl),
    canTakeover: Boolean(viewer.canTakeover),
    canStop: Boolean(viewer.canStop),
  },
});

const isLockExpired = (control, now = new Date()) => {
  const expiresAt = toDateOrNull(control?.expiresAt);
  if (!expiresAt) return false;
  return expiresAt.getTime() <= now.getTime();
};

const roomForTournament = (tournamentId) =>
  `draw-live:tournament:${toId(tournamentId)}`;

export const getDrawLiveRoom = roomForTournament;

const nextExpiry = (now = new Date()) =>
  new Date(now.getTime() + DRAW_CONTROL_TTL_MS);

const clearLockUpdate = (status = "idle", now = new Date()) => ({
  activeDrawId: null,
  activeBracketId: null,
  holderUserId: null,
  holderName: "",
  holderRoles: [],
  holderSocketId: "",
  status,
  updatedAt: now,
  heartbeatAt: null,
  expiresAt: null,
});

async function getControlStateRaw(tournamentId) {
  return DrawControlState.findOne({ tournament: tournamentId });
}

export async function getDrawControlState(tournamentId) {
  if (!tournamentId) return null;
  return getNormalizedControlState(tournamentId);
}

async function normalizeExpiredControl(tournamentId) {
  const current = await getControlStateRaw(tournamentId);
  if (!current) return null;
  if (!isLockExpired(current)) return current;

  const now = new Date();
  await DrawControlState.findOneAndUpdate(
    { tournament: tournamentId },
    {
      $set: clearLockUpdate("idle", now),
      $inc: { revision: 1 },
    },
    { new: false },
  );
  return getControlStateRaw(tournamentId);
}

async function getNormalizedControlState(tournamentId) {
  return normalizeExpiredControl(tournamentId);
}

const latestRevealFromHistory = (history = []) => {
  if (!Array.isArray(history) || history.length === 0) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry?.action === "pick") {
      return {
        action: entry.action,
        payload: entry.payload || null,
        at: entry.at || null,
        by: toId(entry.by),
      };
    }
  }
  return null;
};

const buildLockPayload = (control) => {
  const locked =
    Boolean(control?.holderUserId) &&
    Boolean(control?.status) &&
    String(control.status) !== "idle" &&
    !isLockExpired(control);

  return {
    locked,
    holderUserId: locked ? toId(control?.holderUserId) : null,
    holderName: locked ? control?.holderName || "" : "",
    holderRoles: locked ? [...(control?.holderRoles || [])] : [],
    activeDrawId: control?.activeDrawId ? toId(control.activeDrawId) : null,
    activeBracketId: control?.activeBracketId
      ? toId(control.activeBracketId)
      : null,
    status: locked ? control?.status || "active" : "idle",
    expiresAt:
      locked && control?.expiresAt
        ? toDateOrNull(control.expiresAt)?.toISOString() || null
        : null,
    revision: Number(control?.revision || 0),
  };
};

export async function buildDrawLiveSnapshot({ tournamentId, user = null }) {
  const normalizedTournamentId = toId(tournamentId);
  if (!normalizedTournamentId) {
    return buildEmptySnapshot(null);
  }

  const control = await getNormalizedControlState(normalizedTournamentId);
  const lock = buildLockPayload(control);
  const currentUserId = toId(user?._id || user?.id);
  const isHolder =
    Boolean(currentUserId) &&
    Boolean(lock.holderUserId) &&
    String(lock.holderUserId) === String(currentUserId);
  const isSuperAdmin = isSuperAdminUser(user);
  const canManage = user ? await canManageTournament(user, normalizedTournamentId) : false;

  let activeSession = null;
  if (lock.activeDrawId) {
    const session = await DrawSession.findById(lock.activeDrawId)
      .select(
        "_id bracket mode status board cursor history tournament committedAt canceledAt",
      )
      .lean();
    if (session) {
      const bracket = session?.bracket
        ? await Bracket.findById(session.bracket).select("name").lean()
        : null;
      activeSession = {
        drawId: toId(session._id),
        bracketId: toId(session.bracket),
        bracketName: String(bracket?.name || "").trim(),
        mode: session.mode || null,
        status: session.status || null,
        board: session.board || null,
        cursor: session.cursor || null,
        history: Array.isArray(session.history)
          ? session.history.slice(-50)
          : [],
        latestReveal: latestRevealFromHistory(session.history),
      };
    }
  }

  return {
    tournamentId: normalizedTournamentId,
    lock,
    activeSession,
    viewer: {
      canControl: Boolean(isHolder || (!lock.locked && (canManage || isSuperAdmin))),
      canTakeover: Boolean(isSuperAdmin && lock.locked && !isHolder),
      canStop: Boolean(isSuperAdmin && lock.locked),
    },
  };
}

export async function publishDrawLiveSnapshot(io, tournamentId, user = null) {
  if (!io || !tournamentId) return null;
  const snapshot = await buildDrawLiveSnapshot({ tournamentId, user });
  io.to(getDrawLiveRoom(tournamentId)).emit("draw-live:snapshot", snapshot);
  return snapshot;
}

export function publishDrawLiveReveal(io, tournamentId, payload = null) {
  if (!io || !tournamentId) return;
  io.to(getDrawLiveRoom(tournamentId)).emit("draw-live:reveal", {
    tournamentId: toId(tournamentId),
    reveal: payload || null,
    at: new Date().toISOString(),
  });
}

export async function releaseDrawControl({ tournamentId, status = "idle" }) {
  if (!tournamentId) return null;
  const now = new Date();
  return DrawControlState.findOneAndUpdate(
    { tournament: tournamentId },
    {
      $set: clearLockUpdate(status, now),
      $inc: { revision: 1 },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

export async function acquireDrawControl({
  tournamentId,
  bracketId = null,
  user,
  socketId = "",
}) {
  const normalizedTournamentId = toId(tournamentId);
  if (!normalizedTournamentId || !user) {
    return { ok: false, snapshot: buildEmptySnapshot(normalizedTournamentId) };
  }

  const isSuperAdmin = isSuperAdminUser(user);
  const canManage = isSuperAdmin
    ? true
    : await canManageTournament(user, normalizedTournamentId);
  if (!canManage) {
    return {
      ok: false,
      snapshot: await buildDrawLiveSnapshot({
        tournamentId: normalizedTournamentId,
        user,
      }),
    };
  }

  const current = await getNormalizedControlState(normalizedTournamentId);
  const holderUserId = toId(current?.holderUserId);
  const currentUserId = toId(user?._id || user?.id);
  const lockedByOther =
    Boolean(holderUserId) &&
    holderUserId !== currentUserId &&
    String(current?.status || "") !== "idle";

  if (lockedByOther && !isSuperAdmin) {
    return {
      ok: false,
      snapshot: await buildDrawLiveSnapshot({
        tournamentId: normalizedTournamentId,
        user,
      }),
    };
  }

  const now = new Date();
  const updated = await DrawControlState.findOneAndUpdate(
    { tournament: normalizedTournamentId },
    {
      $set: {
        tournament: normalizedTournamentId,
        activeBracketId: bracketId || current?.activeBracketId || null,
        holderUserId: currentUserId,
        holderName: userDisplayName(user),
        holderRoles: userRoleList(user),
        holderSocketId: socketId || current?.holderSocketId || "",
        status: current?.activeDrawId ? "active" : "locked",
        updatedAt: now,
        heartbeatAt: now,
        expiresAt: nextExpiry(now),
        startedAt: current?.startedAt || now,
      },
      $setOnInsert: {
        revision: 0,
      },
      $inc: {
        revision: 1,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return { ok: true, control: updated };
}

export async function bindDrawControlToSession({
  tournamentId,
  drawId,
  bracketId = null,
  user,
  socketId = "",
  status = "active",
}) {
  const normalizedTournamentId = toId(tournamentId);
  if (!normalizedTournamentId) return null;

  const currentUserId = toId(user?._id || user?.id);
  const now = new Date();
  return DrawControlState.findOneAndUpdate(
    { tournament: normalizedTournamentId },
    {
      $set: {
        tournament: normalizedTournamentId,
        activeDrawId: drawId || null,
        activeBracketId: bracketId || null,
        holderUserId: currentUserId || null,
        holderName: user ? userDisplayName(user) : "",
        holderRoles: user ? userRoleList(user) : [],
        holderSocketId: socketId || "",
        status,
        updatedAt: now,
        heartbeatAt: now,
        expiresAt: nextExpiry(now),
        startedAt: now,
      },
      $setOnInsert: {
        revision: 0,
      },
      $inc: {
        revision: 1,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

export async function ensureDrawControlAllowed({
  tournamentId,
  bracketId = null,
  drawId = null,
  user,
  socketId = "",
}) {
  const normalizedTournamentId = toId(tournamentId);
  if (!normalizedTournamentId || !user) {
    return {
      ok: false,
      snapshot: await buildDrawLiveSnapshot({
        tournamentId: normalizedTournamentId,
        user,
      }),
    };
  }

  const isSuperAdmin = isSuperAdminUser(user);
  const canManage = isSuperAdmin
    ? true
    : await canManageTournament(user, normalizedTournamentId);
  if (!canManage) {
    return {
      ok: false,
      snapshot: await buildDrawLiveSnapshot({
        tournamentId: normalizedTournamentId,
        user,
      }),
    };
  }

  const current = await getNormalizedControlState(normalizedTournamentId);
  const holderUserId = toId(current?.holderUserId);
  const currentUserId = toId(user?._id || user?.id);

  if (!current || !holderUserId || String(current?.status || "") === "idle") {
    const rebound = await bindDrawControlToSession({
      tournamentId: normalizedTournamentId,
      drawId,
      bracketId,
      user,
      socketId,
      status: "active",
    });
    return { ok: true, control: rebound };
  }

  if (holderUserId === currentUserId || isSuperAdmin) {
    const now = new Date();
    const updated = await DrawControlState.findOneAndUpdate(
      { tournament: normalizedTournamentId },
      {
        $set: {
          activeDrawId: drawId || current.activeDrawId || null,
          activeBracketId: bracketId || current.activeBracketId || null,
          holderSocketId: socketId || current.holderSocketId || "",
          updatedAt: now,
          heartbeatAt: now,
          expiresAt: nextExpiry(now),
          status:
            current?.status && current.status !== "idle"
              ? current.status
              : "active",
        },
        $inc: { revision: 1 },
      },
      { new: true },
    );
    return { ok: true, control: updated };
  }

  return {
    ok: false,
    snapshot: await buildDrawLiveSnapshot({
      tournamentId: normalizedTournamentId,
      user,
    }),
  };
}

export async function heartbeatDrawControl({
  tournamentId,
  drawId = null,
  bracketId = null,
  user,
  socketId = "",
}) {
  const normalizedTournamentId = toId(tournamentId);
  if (!normalizedTournamentId) return buildEmptySnapshot(null);

  const access = await ensureDrawControlAllowed({
    tournamentId: normalizedTournamentId,
    drawId,
    bracketId,
    user,
    socketId,
  });

  if (!access.ok) {
    return access.snapshot;
  }

  return buildDrawLiveSnapshot({
    tournamentId: normalizedTournamentId,
    user,
  });
}

export async function takeoverDrawControl({
  tournamentId,
  user,
  socketId = "",
  io = null,
}) {
  const normalizedTournamentId = toId(tournamentId);
  if (!normalizedTournamentId || !isSuperAdminUser(user)) {
    return {
      ok: false,
      snapshot: await buildDrawLiveSnapshot({
        tournamentId: normalizedTournamentId,
        user,
      }),
    };
  }

  const current = await getNormalizedControlState(normalizedTournamentId);
  const previousSocketId = current?.holderSocketId || "";
  const now = new Date();
  await DrawControlState.findOneAndUpdate(
    { tournament: normalizedTournamentId },
    {
      $set: {
        tournament: normalizedTournamentId,
        holderUserId: toId(user?._id || user?.id),
        holderName: userDisplayName(user),
        holderRoles: userRoleList(user),
        holderSocketId: socketId || "",
        status:
          current?.activeDrawId || current?.activeBracketId ? "active" : "locked",
        updatedAt: now,
        heartbeatAt: now,
        expiresAt: nextExpiry(now),
        startedAt: current?.startedAt || now,
      },
      $setOnInsert: {
        revision: 0,
      },
      $inc: { revision: 1 },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  if (io && previousSocketId) {
    io.to(previousSocketId).emit("draw-live:kicked", {
      tournamentId: normalizedTournamentId,
      at: now.toISOString(),
    });
  }

  return {
    ok: true,
    snapshot: await publishDrawLiveSnapshot(io, normalizedTournamentId, user),
  };
}

export async function stopDrawControl({ tournamentId, io = null, user = null }) {
  const normalizedTournamentId = toId(tournamentId);
  if (!normalizedTournamentId) {
    return buildEmptySnapshot(null);
  }

  await releaseDrawControl({ tournamentId: normalizedTournamentId, status: "idle" });
  return publishDrawLiveSnapshot(io, normalizedTournamentId, user);
}

export async function sweepExpiredDrawControls(io) {
  if (!io) return 0;
  const now = new Date();
  const expired = await DrawControlState.find({
    status: { $ne: "idle" },
    expiresAt: { $lte: now },
  })
    .select("tournament")
    .lean();

  if (!expired.length) return 0;

  for (const item of expired) {
    const tournamentId = toId(item?.tournament);
    if (!tournamentId) continue;
    await releaseDrawControl({ tournamentId, status: "idle" });
    await publishDrawLiveSnapshot(io, tournamentId, null);
  }

  return expired.length;
}
