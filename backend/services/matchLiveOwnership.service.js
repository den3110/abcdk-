import { presenceRedis } from "./presenceService.js";

const OWNER_KEY_PREFIX = "match-live:owner:";
const DEFAULT_TTL_SECONDS = 30;

function redisAvailable() {
  return Boolean(presenceRedis?.isOpen);
}

function ownerKey(matchId) {
  return `${OWNER_KEY_PREFIX}${String(matchId || "").trim()}`;
}

function normalizeIdentityValue(value) {
  return value == null ? "" : String(value).trim();
}

export function liveOwnerMatchesIdentity(
  owner,
  { deviceId = "", userId = null } = {}
) {
  if (!owner) return false;
  const ownerUserId = normalizeIdentityValue(owner.userId);
  const currentUserId = normalizeIdentityValue(userId);
  if (ownerUserId && currentUserId) {
    return ownerUserId === currentUserId;
  }
  const currentDeviceId = normalizeIdentityValue(deviceId);
  return Boolean(currentDeviceId) && normalizeIdentityValue(owner.deviceId) === currentDeviceId;
}

function parseOwner(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.matchId || !parsed?.deviceId) return null;
    return parsed;
  } catch (error) {
    console.warn(
      "[match-live-owner] deserialize failed:",
      error?.message || error
    );
    return null;
  }
}

function buildOwnerPayload({
  matchId,
  deviceId,
  userId = null,
  displayName = "",
  claimedAt = new Date(),
  lastHeartbeatAt = claimedAt,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}) {
  const baseDate =
    claimedAt instanceof Date && !Number.isNaN(claimedAt.getTime())
      ? claimedAt
      : new Date();
  const heartbeatDate =
    lastHeartbeatAt instanceof Date && !Number.isNaN(lastHeartbeatAt.getTime())
      ? lastHeartbeatAt
      : baseDate;
  return {
    matchId: String(matchId),
    deviceId: String(deviceId),
    userId: userId ? String(userId) : null,
    displayName: String(displayName || "").trim(),
    claimedAt: baseDate.toISOString(),
    lastHeartbeatAt: heartbeatDate.toISOString(),
    expiresAt: new Date(
      heartbeatDate.getTime() + ttlSeconds * 1000
    ).toISOString(),
  };
}

async function writeOwner(owner, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!redisAvailable()) return owner;
  await presenceRedis.set(ownerKey(owner.matchId), JSON.stringify(owner), {
    EX: ttlSeconds,
  });
  return owner;
}

export function normalizeLiveOwnerForClient(owner, deviceId = "", userId = null) {
  if (!owner) return null;
  return {
    ...owner,
    isSelf: liveOwnerMatchesIdentity(owner, { deviceId, userId }),
  };
}

export async function getMatchLiveOwner(matchId) {
  if (!matchId || !redisAvailable()) return null;
  const current = parseOwner(await presenceRedis.get(ownerKey(matchId)));
  if (current) return current;
  return null;
}

export async function claimMatchLiveOwner({
  matchId,
  deviceId,
  userId = null,
  displayName = "",
  force = false,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}) {
  if (!matchId || !deviceId) {
    return { ok: false, reason: "invalid_owner_payload", owner: null };
  }

  const current = await getMatchLiveOwner(matchId);
  const isSameOwner = liveOwnerMatchesIdentity(current, { deviceId, userId });
  if (current && !isSameOwner && !force) {
    return { ok: false, reason: "ownership_conflict", owner: current };
  }

  const now = new Date();
  const nextOwner = buildOwnerPayload({
    matchId,
    deviceId,
    userId,
    displayName,
    claimedAt: current && isSameOwner ? new Date(current.claimedAt || now) : now,
    lastHeartbeatAt: now,
    ttlSeconds,
  });

  await writeOwner(nextOwner, ttlSeconds);

  return {
    ok: true,
    owner: nextOwner,
    takeover: Boolean(current) && !isSameOwner,
  };
}

export async function releaseMatchLiveOwner(matchId, deviceId = "") {
  if (!matchId || !redisAvailable()) return { ok: true, released: false };
  const current = await getMatchLiveOwner(matchId);
  if (!current) return { ok: true, released: false };
  if (deviceId && String(current.deviceId) !== String(deviceId)) {
    return { ok: false, reason: "ownership_conflict", owner: current };
  }
  await presenceRedis.del(ownerKey(matchId));
  return { ok: true, released: true, owner: current };
}

export async function clearAllMatchLiveOwners() {
  if (!redisAvailable()) {
    return { ok: true, count: 0, matchIds: [] };
  }

  const keys = [];
  const matchIds = new Set();
  let cursor = "0";

  do {
    const result = await presenceRedis.scan(String(cursor), {
      MATCH: `${OWNER_KEY_PREFIX}*`,
      COUNT: "200",
    });

    cursor = String(result?.cursor ?? "0");
    for (const key of result?.keys || []) {
      keys.push(key);
      const matchId = String(key || "").slice(OWNER_KEY_PREFIX.length).trim();
      if (matchId) matchIds.add(matchId);
    }
  } while (cursor !== "0");

  for (const key of keys) {
    await presenceRedis.del(key);
  }

  return {
    ok: true,
    count: keys.length,
    matchIds: Array.from(matchIds),
  };
}

export const MATCH_LIVE_OWNER_TTL_SECONDS = DEFAULT_TTL_SECONDS;
