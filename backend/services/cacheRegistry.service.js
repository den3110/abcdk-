import IORedis from "ioredis";

const cacheRegistry = new Map();
const CACHE_INVALIDATION_REDIS_URL = String(
  process.env.CACHE_INVALIDATION_REDIS_URL || process.env.REDIS_URL || "",
).trim();
const CACHE_INVALIDATION_CHANNEL =
  process.env.CACHE_INVALIDATION_CHANNEL || "pickletour-cache-invalidation";
const CACHE_INVALIDATION_INSTANCE_ID = `${process.pid}-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2)}`;
const CACHE_INVALIDATION_REDIS_ENABLED =
  String(process.env.CACHE_INVALIDATION_REDIS_ENABLED || "true").toLowerCase() !==
  "false";

let redisPublisher = null;
let redisSubscriber = null;
let redisSubscriberStarted = false;
let lastRedisWarningAt = 0;

function redisInvalidationEnabled() {
  return Boolean(CACHE_INVALIDATION_REDIS_ENABLED && CACHE_INVALIDATION_REDIS_URL);
}

function warnRedisInvalidation(label, error) {
  const now = Date.now();
  if (now - lastRedisWarningAt < 30_000) return;
  lastRedisWarningAt = now;
  console.warn(
    `[cache-registry] redis invalidation ${label}:`,
    error?.message || error,
  );
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function createRedisInvalidationClient(label) {
  const client = new IORedis(CACHE_INVALIDATION_REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    retryStrategy: (attempt) => Math.min(1000, 100 + attempt * 100),
  });
  client.on("error", (error) => warnRedisInvalidation(label, error));
  return client;
}

async function ensureRedisReady(client, label) {
  if (!client) return null;
  if (client.status === "ready") return client;
  if (client.status === "wait") {
    await withTimeout(client.connect(), 1200, label);
  }
  return client.status === "ready" ? client : null;
}

function getRedisPublisher() {
  if (!redisInvalidationEnabled()) return null;
  if (redisPublisher?.status === "end") {
    redisPublisher.disconnect();
    redisPublisher = null;
  }
  if (!redisPublisher) {
    redisPublisher = createRedisInvalidationClient("publisher error");
  }
  return redisPublisher;
}

function normalizeCacheIds(cacheIds = []) {
  return Array.from(
    new Set(
      (Array.isArray(cacheIds) ? cacheIds : [cacheIds])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

async function publishCacheInvalidation(cacheIds = []) {
  const ids = normalizeCacheIds(cacheIds);
  if (!ids.length) return false;

  const client = getRedisPublisher();
  if (!client) return false;

  try {
    const ready = await ensureRedisReady(client, "redis publisher connect");
    if (!ready) return false;
    await withTimeout(
      ready.publish(
        CACHE_INVALIDATION_CHANNEL,
        JSON.stringify({
          source: CACHE_INVALIDATION_INSTANCE_ID,
          cacheIds: ids,
          at: new Date().toISOString(),
        }),
      ),
      1200,
      "redis publish",
    );
    return true;
  } catch (error) {
    warnRedisInvalidation("publish failed", error);
    return false;
  }
}

function ensureRedisSubscriber() {
  if (!redisInvalidationEnabled() || redisSubscriberStarted) return;
  redisSubscriberStarted = true;
  redisSubscriber = createRedisInvalidationClient("subscriber error");
  const subscriber = redisSubscriber;

  subscriber.on("message", (channel, message) => {
    if (channel !== CACHE_INVALIDATION_CHANNEL) return;
    try {
      const payload = JSON.parse(message || "{}");
      if (payload?.source === CACHE_INVALIDATION_INSTANCE_ID) return;
      const ids = normalizeCacheIds(payload?.cacheIds);
      if (ids.length) void clearCacheGroupsLocal(ids);
    } catch (error) {
      warnRedisInvalidation("message parse failed", error);
    }
  });

  void ensureRedisReady(subscriber, "redis subscriber connect")
    .then((ready) => {
      if (!ready) throw new Error("subscriber not ready");
      return ready.subscribe(CACHE_INVALIDATION_CHANNEL);
    })
    .catch((error) => {
      if (redisSubscriber === subscriber) {
        redisSubscriberStarted = false;
      }
      warnRedisInvalidation("subscribe failed", error);
    });
}

function asFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeMeta(entry = {}) {
  return {
    id: String(entry.id || "").trim(),
    label: String(entry.label || entry.id || "").trim(),
    category: String(entry.category || "misc").trim(),
    scope: String(entry.scope || "internal").trim(),
    kind: String(entry.kind || "cache").trim(),
    ttlMs: entry.ttlMs == null ? null : asFiniteNumber(entry.ttlMs, null),
  };
}

function normalizeStats(raw = {}, entry = {}) {
  const stats = raw && typeof raw === "object" ? raw : {};
  return {
    ...normalizeMeta(entry),
    entries: Math.max(0, asFiniteNumber(stats.entries, 0)),
    hits: Math.max(0, asFiniteNumber(stats.hits, 0)),
    misses: Math.max(0, asFiniteNumber(stats.misses, 0)),
    lastHitAt: toIsoString(stats.lastHitAt),
    lastMissAt: toIsoString(stats.lastMissAt),
    lastSetAt: toIsoString(stats.lastSetAt),
    lastClearAt: toIsoString(stats.lastClearAt),
    updatedAt: toIsoString(stats.updatedAt) || new Date().toISOString(),
  };
}

export function registerCacheGroup(entry = {}) {
  const meta = normalizeMeta(entry);
  if (!meta.id) {
    throw new Error("registerCacheGroup requires a non-empty id");
  }
  if (typeof entry.getStats !== "function") {
    throw new Error(`Cache group '${meta.id}' must provide getStats()`);
  }
  if (typeof entry.clear !== "function") {
    throw new Error(`Cache group '${meta.id}' must provide clear()`);
  }

  cacheRegistry.set(meta.id, {
    ...entry,
    ...meta,
    registeredAt: new Date(),
  });
  ensureRedisSubscriber();

  return cacheRegistry.get(meta.id);
}

export function getRegisteredCacheGroup(cacheId) {
  return cacheRegistry.get(String(cacheId || "").trim()) || null;
}

export function listRegisteredCacheGroups() {
  return Array.from(cacheRegistry.values());
}

export async function getCacheRegistrySummary() {
  const groups = await Promise.all(
    listRegisteredCacheGroups().map(async (entry) => {
      const stats = await Promise.resolve(entry.getStats());
      return normalizeStats(stats, entry);
    })
  );

  groups.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.label.localeCompare(b.label);
  });

  const totals = groups.reduce(
    (acc, group) => {
      acc.groups += 1;
      acc.entries += group.entries;
      acc.hits += group.hits;
      acc.misses += group.misses;
      if (group.entries > 0) acc.activeGroups += 1;
      return acc;
    },
    { groups: 0, entries: 0, hits: 0, misses: 0, activeGroups: 0 }
  );

  return {
    groups,
    totals,
    updatedAt: new Date().toISOString(),
  };
}

async function clearCacheGroupLocal(cacheId) {
  const entry = getRegisteredCacheGroup(cacheId);
  if (!entry) return null;

  await Promise.resolve(entry.clear());
  const stats = await Promise.resolve(entry.getStats());
  return normalizeStats(stats, entry);
}

async function clearCacheGroupsLocal(cacheIds = []) {
  const normalizedIds = normalizeCacheIds(cacheIds);
  const cleared = [];
  for (const cacheId of normalizedIds) {
    const result = await clearCacheGroupLocal(cacheId);
    if (result) cleared.push(result);
  }
  return cleared;
}

export async function clearCacheGroup(cacheId) {
  const normalizedIds = normalizeCacheIds(cacheId);
  const result = await clearCacheGroupLocal(normalizedIds[0]);
  await publishCacheInvalidation(normalizedIds);
  return result;
}

export async function clearCacheGroups(cacheIds = []) {
  const normalizedIds = normalizeCacheIds(cacheIds);
  const cleared = await clearCacheGroupsLocal(normalizedIds);
  await publishCacheInvalidation(normalizedIds);
  return cleared;
}

export async function clearAllCacheGroups() {
  return clearCacheGroups(listRegisteredCacheGroups().map((entry) => entry.id));
}
