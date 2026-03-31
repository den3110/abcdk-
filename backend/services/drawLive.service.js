import Bracket from "../models/bracketModel.js";
import DrawSession from "../models/drawSessionModel.js";
import DrawControlState from "../models/drawControlStateModel.js";
import Registration from "../models/registrationModel.js";
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

const playerName = (player) =>
  String(
    player?.nickName ||
      player?.fullName ||
      player?.name ||
      player?.displayName ||
      "",
  ).trim();

const displayNameFromReg = (reg, eventType = "") => {
  if (!reg) return "";
  const teamFallback = String(
    reg.teamFactionName ||
      reg.teamName ||
      reg.nickName ||
      reg.name ||
      reg.displayName ||
      "",
  ).trim();
  const isSingle = String(eventType || "")
    .toLowerCase()
    .includes("single");
  const p1 = playerName(reg.player1) || String(reg.player1Name || "").trim();
  if (isSingle) return p1 || teamFallback || "";
  const p2 = playerName(reg.player2) || String(reg.player2Name || "").trim();
  if (p1 && p2) return `${p1} & ${p2}`;
  return p1 || teamFallback || "";
};

const registrationIdsFromBoard = (board) => {
  const ids = new Set();
  for (const group of Array.isArray(board?.groups) ? board.groups : []) {
    for (const slot of Array.isArray(group?.slots) ? group.slots : []) {
      const id = toId(slot);
      if (id) ids.add(id);
    }
  }
  for (const pair of Array.isArray(board?.pairs) ? board.pairs : []) {
    const a = toId(pair?.a);
    const b = toId(pair?.b);
    if (a) ids.add(a);
    if (b) ids.add(b);
  }
  return [...ids];
};

const registrationLabelFallback = (regId) => {
  const suffix = String(regId || "").slice(-6);
  return suffix ? `#${suffix}` : "";
};

const normalizeGroupCode = (value, index = 0) => {
  const raw = String(value || "").trim();
  if (raw) return raw;
  return String.fromCharCode(65 + index);
};

const buildBoardView = async (board, eventType = "") => {
  const registrationIds = registrationIdsFromBoard(board);
  const registrationMap = new Map();

  if (registrationIds.length > 0) {
    const registrations = await Registration.find({ _id: { $in: registrationIds } })
      .select(
        "teamFactionName teamName nickName name displayName player1 player2 player1Name player2Name",
      )
      .populate("player1", "nickName fullName name displayName")
      .populate("player2", "nickName fullName name displayName")
      .lean();

    registrations.forEach((registration) => {
      registrationMap.set(
        String(registration?._id),
        displayNameFromReg(registration, eventType) ||
          registrationLabelFallback(registration?._id),
      );
    });
  }

  const groups = (Array.isArray(board?.groups) ? board.groups : []).map(
    (group, groupIndex) => {
      const code =
        String(group?.key || group?.code || "").trim() ||
        String.fromCharCode(65 + groupIndex);
      const sourceSlots = Array.isArray(group?.slots) ? group.slots : [];
      const slots =
        sourceSlots.length > 0
          ? sourceSlots.map((slot, slotIndex) => {
              const regId = toId(slot);
              return {
                slotIndex,
                regId,
                label: regId
                  ? registrationMap.get(String(regId)) ||
                    registrationLabelFallback(regId)
                  : "",
              };
            })
          : Array.from({ length: Number(group?.size || 0) }, (_unused, slotIndex) => ({
              slotIndex,
              regId: null,
              label: "",
            }));

      return { code, slots };
    },
  );

  const pairs = (Array.isArray(board?.pairs) ? board.pairs : []).map(
    (pair, pairIndex) => {
      const aId = toId(pair?.a);
      const bId = toId(pair?.b);
      return {
        pairIndex,
        title: `Cap ${pairIndex + 1}`,
        a: {
          regId: aId,
          label: aId
            ? registrationMap.get(String(aId)) || registrationLabelFallback(aId)
            : "",
        },
        b: {
          regId: bId,
          label: bId
            ? registrationMap.get(String(bId)) || registrationLabelFallback(bId)
            : "",
        },
      };
    },
  );

  return { groups, pairs };
};

const buildGroupsMeta = (bracket) => {
  const rawGroups = Array.isArray(bracket?.groups) ? bracket.groups : [];
  return rawGroups.map((group, groupIndex) => {
    const regIds = Array.isArray(group?.regIds)
      ? group.regIds.map((item) => toId(item)).filter(Boolean)
      : [];
    const size = Number(group?.expectedSize || group?.size || regIds.length || 0);
    return {
      code: normalizeGroupCode(group?.name || group?.code || group?.key, groupIndex),
      size: Number.isFinite(size) && size > 0 ? size : regIds.length,
      regIds,
    };
  });
};

const revealsFromBoardView = (boardView) => {
  const reveals = [];

  for (const group of Array.isArray(boardView?.groups) ? boardView.groups : []) {
    for (const slot of Array.isArray(group?.slots) ? group.slots : []) {
      const label = String(slot?.label || "").trim();
      const regId = toId(slot?.regId);
      if (!label && !regId) continue;
      reveals.push({
        group: String(group?.code || "").trim(),
        groupCode: String(group?.code || "").trim(),
        slotIndex: Number(slot?.slotIndex || 0),
        regId: regId || null,
        teamName: label,
        label,
      });
    }
  }

  for (const pair of Array.isArray(boardView?.pairs) ? boardView.pairs : []) {
    const pairIndex = Number(pair?.pairIndex || 0);
    for (const sideKey of ["a", "b"]) {
      const side = pair?.[sideKey];
      const label = String(side?.label || "").trim();
      const regId = toId(side?.regId);
      if (!label && !regId) continue;
      reveals.push({
        pairIndex,
        side: sideKey === "a" ? "A" : "B",
        regId: regId || null,
        teamName: label,
        label,
      });
    }
  }

  return reveals;
};

const revealsFromHistory = (history = []) => {
  const reveals = [];
  for (const entry of Array.isArray(history) ? history : []) {
    if (entry?.action !== "pick") continue;
    const payload = entry?.payload || {};
    const label = String(
      payload?.name ||
        payload?.teamName ||
        payload?.displayName ||
        payload?.label ||
        payload?.regLabel ||
        "",
    ).trim();
    const regId = toId(payload?.regId || payload?.registrationId);
    if (!label && !regId) continue;
    reveals.push({
      group: String(payload?.groupCode || payload?.groupKey || payload?.group || "").trim(),
      groupCode: String(
        payload?.groupCode || payload?.groupKey || payload?.group || "",
      ).trim(),
      slotIndex: Number.isFinite(Number(payload?.slotIndex))
        ? Number(payload.slotIndex)
        : null,
      pairIndex: Number.isFinite(Number(payload?.pairIndex))
        ? Number(payload.pairIndex)
        : null,
      side: payload?.side ? String(payload.side).trim().toUpperCase() : "",
      regId: regId || null,
      teamName: label,
      label,
      at: entry?.at || null,
    });
  }
  return reveals;
};

const loadSessionForSnapshot = async ({ tournamentId, drawId = null }) => {
  let session = null;
  if (drawId) {
    session = await DrawSession.findById(drawId)
      .select(
        "_id bracket mode status board cursor history tournament committedAt canceledAt updatedAt createdAt",
      )
      .lean();
  }

  if (!session) {
    session = await DrawSession.findOne({
      tournament: tournamentId,
      status: "active",
    })
      .select(
        "_id bracket mode status board cursor history tournament committedAt canceledAt updatedAt createdAt",
      )
      .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
      .lean();
  }

  if (!session) return null;

  const bracket = session?.bracket
    ? await Bracket.findById(session.bracket)
        .select("name eventType groups.name groups.expectedSize groups.regIds")
        .lean()
    : null;
  const boardView = await buildBoardView(session.board || null, bracket?.eventType);
  const groupsMeta = buildGroupsMeta(bracket);
  const boardReveals = revealsFromBoardView(boardView);
  const reveals = boardReveals.length
    ? boardReveals
    : revealsFromHistory(session.history);

  return {
    drawId: toId(session._id),
    bracketId: toId(session.bracket),
    bracketName: String(bracket?.name || "").trim(),
    mode: session.mode || null,
    status: session.status || null,
    board: session.board || null,
    boardView,
    groupsMeta,
    reveals,
    cursor: session.cursor || null,
    history: Array.isArray(session.history) ? session.history.slice(-50) : [],
    latestReveal: latestRevealFromHistory(session.history),
  };
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

  const activeSession = await loadSessionForSnapshot({
    tournamentId: normalizedTournamentId,
    drawId: lock.activeDrawId,
  });

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
