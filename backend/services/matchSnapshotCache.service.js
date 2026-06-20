import { randomUUID } from "node:crypto";
import IORedis from "ioredis";

const envValue = (key) =>
  typeof process !== "undefined" ? process.env?.[key] : undefined;

const readInt = (key, fallback, { min = 0, max = 10_000 } = {}) => {
  const value = Number(envValue(key));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

const readBool = (key, fallback = false) => {
  const raw = envValue(key);
  if (raw == null || raw === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MATCH_SNAPSHOT_CACHE_MS = readInt("SOCKET_MATCH_SNAPSHOT_CACHE_MS", 500, {
  min: 0,
  max: 5000,
});
const MAX_MATCH_SNAPSHOT_CACHE_ENTRIES = readInt(
  "SOCKET_MAX_MATCH_SNAPSHOT_CACHE_ENTRIES",
  1000,
  { min: 10, max: 10000 }
);
const REDIS_URL = String(envValue("REDIS_URL") || "").trim();
const REDIS_ENABLED = readBool(
  "SOCKET_MATCH_SNAPSHOT_REDIS",
  Boolean(REDIS_URL)
);
const REDIS_PREFIX = String(
  envValue("SOCKET_MATCH_SNAPSHOT_REDIS_PREFIX") ||
    "pkt:socket:matchSnapshot:v1"
).trim();
const REDIS_RESULT_TTL_MS = readInt(
  "SOCKET_MATCH_SNAPSHOT_REDIS_TTL_MS",
  MATCH_SNAPSHOT_CACHE_MS,
  { min: 0, max: 5000 }
);
const REDIS_LOCK_TTL_MS = readInt(
  "SOCKET_MATCH_SNAPSHOT_REDIS_LOCK_TTL_MS",
  2000,
  { min: 250, max: 10000 }
);
const REDIS_LOCK_WAIT_MS = readInt(
  "SOCKET_MATCH_SNAPSHOT_REDIS_LOCK_WAIT_MS",
  750,
  { min: 0, max: 1500 }
);
const REDIS_LOCK_POLL_MS = readInt(
  "SOCKET_MATCH_SNAPSHOT_REDIS_LOCK_POLL_MS",
  50,
  { min: 10, max: 250 }
);
const REDIS_COMMAND_TIMEOUT_MS = readInt(
  "SOCKET_MATCH_SNAPSHOT_REDIS_COMMAND_TIMEOUT_MS",
  500,
  { min: 50, max: 2000 }
);
const REDIS_CONNECT_TIMEOUT_MS = readInt(
  "SOCKET_MATCH_SNAPSHOT_REDIS_CONNECT_TIMEOUT_MS",
  500,
  { min: 50, max: 3000 }
);
const REDIS_GENERATION_TTL_MS = readInt(
  "SOCKET_MATCH_SNAPSHOT_REDIS_GENERATION_TTL_MS",
  6 * 60 * 60 * 1000,
  { min: 60_000, max: 24 * 60 * 60 * 1000 }
);
const REDIS_FAILURE_BACKOFF_MS = readInt(
  "SOCKET_MATCH_SNAPSHOT_REDIS_FAILURE_BACKOFF_MS",
  5000,
  { min: 500, max: 60_000 }
);

const RELEASE_LOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const SNAPSHOT_KINDS = ["auto", "match", "user"];
const REDIS_INVALIDATE_CHANNEL = `${REDIS_PREFIX}:invalidate`;

const snapshotCache = new Map();
const keysByMatchId = new Map();
const generationByMatchId = new Map();

let redisClient = null;
let redisSubscriber = null;
let redisSubscriberStarted = false;
let lastRedisErrorAt = 0;
let redisDisabledUntil = 0;

const normalizeMatchId = (matchId) => String(matchId || "").trim();
const redisConfigured = () => Boolean(REDIS_ENABLED && REDIS_URL);
const redisUsableNow = () => redisConfigured() && Date.now() >= redisDisabledUntil;

const logRedisError = (context, error) => {
  const now = Date.now();
  redisDisabledUntil = now + REDIS_FAILURE_BACKOFF_MS;
  if (redisClient) {
    redisClient.disconnect();
    redisClient = null;
  }
  if (redisSubscriber) {
    redisSubscriber.disconnect();
    redisSubscriber = null;
    redisSubscriberStarted = false;
  }
  if (now - lastRedisErrorAt < 30_000) return;
  lastRedisErrorAt = now;
  console.error(
    `[match snapshot cache] redis ${context}:`,
    error?.message || error
  );
};

const withTimeout = (promise, ms, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label || "operation"} timed out after ${ms}ms`));
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

export const snapshotKindKey = (userMatch) => {
  if (typeof userMatch === "boolean") return userMatch ? "user" : "match";
  if (typeof userMatch === "string") {
    const value = userMatch.trim().toLowerCase();
    if (value === "auto") return "auto";
    if (value === "user") return "user";
    if (value === "match") return "match";
    if (value === "true") return "user";
    if (value === "false") return "match";
  }
  return "auto";
};

const snapshotCacheKey = (matchId, userMatch) =>
  `${normalizeMatchId(matchId)}:${snapshotKindKey(userMatch)}`;

const redisSnapshotKey = (matchId, userMatch) =>
  `${REDIS_PREFIX}:data:${normalizeMatchId(matchId)}:${snapshotKindKey(
    userMatch
  )}`;
const redisGenerationKey = (matchId) =>
  `${REDIS_PREFIX}:gen:${normalizeMatchId(matchId)}`;
const redisLockKey = (matchId, userMatch) =>
  `${REDIS_PREFIX}:lock:${normalizeMatchId(matchId)}:${snapshotKindKey(
    userMatch
  )}`;

const generationOf = (matchId) =>
  Number(generationByMatchId.get(matchId) || 0);

const rememberKey = (matchId, key) => {
  if (!keysByMatchId.has(matchId)) keysByMatchId.set(matchId, new Set());
  keysByMatchId.get(matchId).add(key);
};

const dropKey = (key) => {
  const entry = snapshotCache.get(key);
  snapshotCache.delete(key);
  if (!entry?.matchId) return;
  const keys = keysByMatchId.get(entry.matchId);
  if (!keys) return;
  keys.delete(key);
  if (!keys.size) keysByMatchId.delete(entry.matchId);
};

const setEntry = (key, entry) => {
  snapshotCache.set(key, entry);
  rememberKey(entry.matchId, key);
};

const trimCache = () => {
  while (snapshotCache.size > MAX_MATCH_SNAPSHOT_CACHE_ENTRIES) {
    const oldestKey = snapshotCache.keys().next().value;
    if (!oldestKey) break;
    dropKey(oldestKey);
  }
};

const invalidateLocalMatchSnapshotCache = (matchId) => {
  const normalizedMatchId = normalizeMatchId(matchId);
  if (!normalizedMatchId) return 0;

  generationByMatchId.set(
    normalizedMatchId,
    generationOf(normalizedMatchId) + 1
  );

  const keys = Array.from(keysByMatchId.get(normalizedMatchId) || []);
  for (const key of keys) dropKey(key);
  return keys.length;
};

const createRedisClient = (label) => {
  const client = new IORedis(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    retryStrategy: (attempt) => Math.min(1000, 100 + attempt * 100),
  });
  client.on("error", (error) => logRedisError(label, error));
  return client;
};

const getRedisClient = () => {
  if (!redisUsableNow()) return null;
  if (redisClient?.status === "end") {
    redisClient.disconnect();
    redisClient = null;
  }
  if (!redisClient) redisClient = createRedisClient("client error");
  return redisClient;
};

const ensureRedisReady = async (client) => {
  if (!client) return null;
  if (client.status === "ready") return client;
  if (client.status === "wait") {
    await withTimeout(
      client.connect(),
      REDIS_CONNECT_TIMEOUT_MS,
      "redis connect"
    );
  }
  return client.status === "ready" ? client : null;
};

const redisCommand = async (label, fn) => {
  const client = await ensureRedisReady(getRedisClient()).catch((error) => {
    logRedisError(label, error);
    return null;
  });
  if (!client) return null;

  try {
    return await withTimeout(fn(client), REDIS_COMMAND_TIMEOUT_MS, label);
  } catch (error) {
    logRedisError(label, error);
    return null;
  }
};

const ensureRedisSubscriber = () => {
  if (!redisUsableNow() || redisSubscriberStarted) return;
  redisSubscriberStarted = true;
  redisSubscriber = createRedisClient("subscriber error");
  const subscriber = redisSubscriber;
  redisSubscriber.on("message", (channel, message) => {
    if (channel !== REDIS_INVALIDATE_CHANNEL) return;
    try {
      const payload = JSON.parse(message || "{}");
      if (payload?.matchId) {
        invalidateLocalMatchSnapshotCache(payload.matchId);
      }
    } catch (error) {
      logRedisError("invalidate message parse failed", error);
    }
  });
  void ensureRedisReady(subscriber)
    .then((ready) => {
      if (!ready) throw new Error("redis subscriber not ready");
      return ready.subscribe(REDIS_INVALIDATE_CHANNEL);
    })
    .catch((error) => {
      if (redisSubscriber === subscriber) {
        redisSubscriberStarted = false;
      }
      logRedisError("subscribe failed", error);
    });
};

const parseGeneration = (value) => {
  const generation = Number(value || 0);
  return Number.isFinite(generation) && generation > 0
    ? Math.trunc(generation)
    : 0;
};

const readRedisGeneration = async (matchId) => {
  const raw = await redisCommand("generation get", (client) =>
    client.get(redisGenerationKey(matchId))
  );
  if (raw == null) return redisConfigured() ? 0 : null;
  return parseGeneration(raw);
};

const parseSnapshotPayload = (raw) => {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
};

const readRedisSnapshotDto = async (
  matchId,
  userMatch,
  { expectedGeneration = null } = {}
) => {
  if (!redisConfigured() || REDIS_RESULT_TTL_MS <= 0) {
    return { status: "miss", redisAvailable: false };
  }
  ensureRedisSubscriber();

  const dataKey = redisSnapshotKey(matchId, userMatch);
  const genKey = redisGenerationKey(matchId);
  const result = await redisCommand("snapshot get", (client) =>
    client.mget(dataKey, genKey)
  );
  if (!Array.isArray(result)) {
    return { status: "miss", redisAvailable: false };
  }

  const [raw, genRaw] = result;
  const generation = parseGeneration(genRaw);
  if (expectedGeneration != null && generation !== expectedGeneration) {
    return { status: "invalidated", generation, redisAvailable: true };
  }
  if (!raw) return { status: "miss", generation, redisAvailable: true };

  const payload = parseSnapshotPayload(raw);
  if (
    !payload ||
    parseGeneration(payload.generation) !== generation ||
    payload.dto == null
  ) {
    void redisCommand("snapshot delete stale", (client) => client.del(dataKey));
    return { status: "miss", generation, redisAvailable: true };
  }

  return {
    status: "hit",
    generation,
    dto: payload.dto,
    redisAvailable: true,
  };
};

const writeRedisSnapshotDto = async (matchId, userMatch, dto, generation) => {
  if (!redisConfigured() || REDIS_RESULT_TTL_MS <= 0 || !dto) return false;

  let payload;
  try {
    payload = JSON.stringify({
      generation,
      createdAt: Date.now(),
      dto,
    });
  } catch (error) {
    logRedisError("snapshot serialize failed", error);
    return false;
  }

  const result = await redisCommand("snapshot set", (client) =>
    client.set(redisSnapshotKey(matchId, userMatch), payload, "PX", REDIS_RESULT_TTL_MS)
  );
  return result === "OK";
};

const acquireRedisSnapshotLock = async (matchId, userMatch) => {
  if (!redisConfigured()) return null;
  const token = randomUUID();
  const result = await redisCommand("lock acquire", (client) =>
    client.set(redisLockKey(matchId, userMatch), token, "PX", REDIS_LOCK_TTL_MS, "NX")
  );
  return result === "OK" ? token : null;
};

const releaseRedisSnapshotLock = async (matchId, userMatch, token) => {
  if (!token) return;
  await redisCommand("lock release", (client) =>
    client.eval(RELEASE_LOCK_LUA, 1, redisLockKey(matchId, userMatch), token)
  );
};

const waitForRedisSnapshot = async (matchId, userMatch, generation) => {
  if (!redisConfigured() || REDIS_LOCK_WAIT_MS <= 0) {
    return { status: "miss" };
  }

  const deadline = Date.now() + REDIS_LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(Math.min(REDIS_LOCK_POLL_MS, Math.max(1, deadline - Date.now())));
    const current = await readRedisSnapshotDto(matchId, userMatch, {
      expectedGeneration: generation,
    });
    if (current.status === "hit" || current.status === "invalidated") {
      return current;
    }
    if (!current.redisAvailable) return current;
  }

  return { status: "miss" };
};

const loadWithRedisCoordination = async (matchId, userMatch, loader) => {
  if (!redisConfigured()) return loader(matchId, userMatch);
  ensureRedisSubscriber();

  const startGeneration = await readRedisGeneration(matchId);
  if (startGeneration == null) return loader(matchId, userMatch);

  const token = await acquireRedisSnapshotLock(matchId, userMatch);
  if (!token) {
    const waited = await waitForRedisSnapshot(matchId, userMatch, startGeneration);
    if (waited.status === "hit") return waited.dto;
    if (waited.status === "invalidated") return null;
  }

  try {
    const dto = await loader(matchId, userMatch);
    const endGeneration = await readRedisGeneration(matchId);
    if (endGeneration == null || endGeneration !== startGeneration) return null;
    await writeRedisSnapshotDto(matchId, userMatch, dto, startGeneration);
    return dto;
  } finally {
    await releaseRedisSnapshotLock(matchId, userMatch, token);
  }
};

const invalidateRedisMatchSnapshotCache = async (matchId) => {
  const normalizedMatchId = normalizeMatchId(matchId);
  if (!redisConfigured() || !normalizedMatchId) return null;
  ensureRedisSubscriber();

  return redisCommand("invalidate", async (client) => {
    const genKey = redisGenerationKey(normalizedMatchId);
    const generation = await client.incr(genKey);
    const keys = SNAPSHOT_KINDS.map((kind) =>
      redisSnapshotKey(normalizedMatchId, kind)
    );
    await Promise.all([
      client.pexpire(genKey, REDIS_GENERATION_TTL_MS),
      keys.length ? client.del(...keys) : Promise.resolve(0),
      client.publish(
        REDIS_INVALIDATE_CHANNEL,
        JSON.stringify({
          matchId: normalizedMatchId,
          generation,
          at: Date.now(),
        })
      ),
    ]);
    return generation;
  });
};

export function invalidateMatchSnapshotCache(matchId) {
  const normalizedMatchId = normalizeMatchId(matchId);
  if (!normalizedMatchId) return Promise.resolve(0);

  const dropped = invalidateLocalMatchSnapshotCache(normalizedMatchId);
  const task = invalidateRedisMatchSnapshotCache(normalizedMatchId).catch(
    (error) => {
      logRedisError("invalidate failed", error);
      return null;
    }
  );

  return task.then(() => dropped);
}

export async function getCachedMatchSnapshotDto(
  matchId,
  userMatch,
  loader,
  { forceRefresh = false } = {}
) {
  const normalizedMatchId = normalizeMatchId(matchId);
  if (!normalizedMatchId) return null;
  if (typeof loader !== "function") {
    throw new TypeError("match snapshot loader must be a function");
  }

  const key = snapshotCacheKey(normalizedMatchId, userMatch);
  const now = Date.now();
  const cached = snapshotCache.get(key);
  const allowCompletedLocalCache = !redisConfigured();

  if (!forceRefresh) {
    if (cached?.promise) return cached.promise;
    if (
      allowCompletedLocalCache &&
      MATCH_SNAPSHOT_CACHE_MS > 0 &&
      cached?.dto &&
      cached.expiresAt > now
    ) {
      return cached.dto;
    }
  }

  const generation = generationOf(normalizedMatchId);
  const entry = {
    matchId: normalizedMatchId,
    generation,
    promise: null,
    dto: null,
    expiresAt: 0,
  };

  const promise = Promise.resolve().then(async () => {
    if (!forceRefresh) {
      const redisHit = await readRedisSnapshotDto(normalizedMatchId, userMatch);
      if (redisHit.status === "hit") return redisHit.dto;
    }
    return loadWithRedisCoordination(normalizedMatchId, userMatch, loader);
  });
  entry.promise = promise;
  setEntry(key, entry);
  trimCache();

  try {
    const dto = await promise;
    const current = snapshotCache.get(key);
    const invalidatedWhileLoading =
      current !== entry || generationOf(normalizedMatchId) !== generation;

    if (invalidatedWhileLoading) return null;

    if (dto && allowCompletedLocalCache && MATCH_SNAPSHOT_CACHE_MS > 0) {
      entry.promise = null;
      entry.dto = dto;
      entry.expiresAt = Date.now() + MATCH_SNAPSHOT_CACHE_MS;
      setEntry(key, entry);
      trimCache();
    } else {
      dropKey(key);
    }
    return dto;
  } catch (error) {
    if (snapshotCache.get(key) === entry) dropKey(key);
    throw error;
  }
}
