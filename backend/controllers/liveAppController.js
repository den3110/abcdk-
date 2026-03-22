import { createFacebookLiveForMatch } from "./adminMatchLiveController.js";
import IORedis from "ioredis";
import Match from "../models/matchModel.js";
import { randomUUID } from "crypto";
import {
  buildLiveAppCourtRuntime,
  buildLiveAppMatchRuntime,
} from "../services/liveAppRuntime.service.js";

const pendingByMatchId = new Map();
const redis = process.env.REDIS_URL ? new IORedis(process.env.REDIS_URL) : null;

const RELEASE_LOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

async function acquireRedisLock(key, ttlMs, maxWaitMs) {
  if (!redis) return null;
  const token = randomUUID();
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const ok = await redis.set(key, token, "PX", ttlMs, "NX").catch(() => null);
    if (ok === "OK") {
      return async () => {
        await redis.eval(RELEASE_LOCK_LUA, 1, key, token).catch(() => {});
      };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

export const createLiveSessionForLiveApp = async (req, res) => {
  const matchId = String(req.params?.matchId || "").trim();
  if (!matchId) return res.status(400).json({ message: "matchId is required" });

  const forceNew =
    ["1", "true", "yes"].includes(String(req.query?.force || req.query?.refresh || "").toLowerCase());

  const releaseLock = await acquireRedisLock(
    `lock:live-app:create:${matchId}`,
    20000,
    10000
  );

  const existing = pendingByMatchId.get(matchId);
  if (existing) await existing.catch(() => {});

  let statusCode = 200;
  let payload = null;
  const runner = (async () => {
    const m = await Match.findById(matchId)
      .select("facebookLive meta")
      .lean()
      .catch(() => null);

    const fbLive = m?.facebookLive || null;
    const metaFb = m?.meta?.facebook || null;

    const fbStatus = String(fbLive?.status || "CREATED").toUpperCase();
    const createdAtMs = fbLive?.createdAt ? new Date(fbLive.createdAt).getTime() : 0;
    const createdAtOk = Number.isFinite(createdAtMs) && createdAtMs > 0;
    const maxReuseMs = 60_000;
    const freshEnough = createdAtOk && Date.now() - createdAtMs <= maxReuseMs;
    const allowReuse =
      !forceNew &&
      fbStatus !== "ENDED" &&
      fbStatus !== "STOPPED" &&
      (fbStatus === "LIVE" || freshEnough);

    if (
      allowReuse &&
      fbLive &&
      (fbLive.secure_stream_url || (fbLive.server_url && fbLive.stream_key))
    ) {
      payload = {
        facebook: {
          secure_stream_url: fbLive.secure_stream_url || null,
          server_url: fbLive.server_url || null,
          stream_key: fbLive.stream_key || null,
          pageId: fbLive.pageId || metaFb?.pageId || null,
          pageName: metaFb?.pageName || null,
          watch_url:
            fbLive.watch_url ||
            fbLive.watchUrl ||
            metaFb?.watch_url ||
            metaFb?.watchUrl ||
            null,
          permalink_url:
            fbLive.permalink_url ||
            fbLive.permalinkUrl ||
            metaFb?.permalink_url ||
            metaFb?.permalinkUrl ||
            null,
        },
      };
      return;
    }

    const captureRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(obj) {
        payload = obj;
        return obj;
      },
    };
    await createFacebookLiveForMatch(req, captureRes);
  })();

  pendingByMatchId.set(matchId, runner);
  await runner.finally(() => pendingByMatchId.delete(matchId));
  if (releaseLock) await releaseLock();

  if (!payload) {
    return res.status(500).json({ message: "Create live failed" });
  }
  if (statusCode !== 200) {
    return res.status(statusCode).json(payload);
  }

  const fb =
    payload?.facebook ||
    payload?.platforms?.facebook?.live ||
    payload?.platforms?.facebook ||
    null;
  const primary = payload?.primary || null;

  const secure_stream_url =
    fb?.secure_stream_url || fb?.secureStreamUrl || primary?.secure_stream_url || primary?.secureStreamUrl || null;
  const server_url = fb?.server_url || fb?.serverUrl || primary?.server_url || primary?.serverUrl || null;
  const stream_key = fb?.stream_key || fb?.streamKey || primary?.stream_key || primary?.streamKey || null;
  const watch_url =
    fb?.watch_url ||
    fb?.watchUrl ||
    payload?.facebook_watch_url ||
    payload?.facebookWatchUrl ||
    payload?.platforms?.facebook?.live?.watch_url ||
    payload?.platforms?.facebook?.live?.watchUrl ||
    null;
  const permalink_url =
    fb?.permalink_url ||
    fb?.permalinkUrl ||
    payload?.facebook_permalink_url ||
    payload?.facebookPermalinkUrl ||
    payload?.platforms?.facebook?.live?.permalink_url ||
    payload?.platforms?.facebook?.live?.permalinkUrl ||
    null;

  if (secure_stream_url == null && (!server_url || !stream_key)) {
    return res.status(409).json({
      message: "Không nhận được RTMP URL từ server",
      detail: { hasFacebook: !!fb, hasPrimary: !!primary },
    });
  }

  return res.json({
    facebook: {
      secure_stream_url,
      server_url,
      stream_key,
      pageId: fb?.pageId || fb?.page_id || primary?.pageId || primary?.page_id || null,
      pageName: fb?.pageName || fb?.page_name || primary?.pageName || primary?.page_name || null,
      watch_url,
      permalink_url,
    },
  });
};

export const getCourtRuntimeForLiveApp = async (req, res) => {
  const courtId = String(req.params?.courtId || "").trim();
  if (!courtId) {
    return res.status(400).json({ message: "courtId is required" });
  }

  const runtime = await buildLiveAppCourtRuntime(courtId);
  if (!runtime) {
    return res.status(404).json({ message: "Court not found" });
  }

  res.setHeader("Cache-Control", "private, max-age=1, stale-while-revalidate=2");
  res.setHeader("X-PKT-Cache", runtime?._cache?.hit ? "HIT" : "MISS");
  return res.json({
    ...runtime,
    _cache: undefined,
  });
};

export const getMatchRuntimeForLiveApp = async (req, res) => {
  const matchId = String(req.params?.matchId || "").trim();
  if (!matchId) {
    return res.status(400).json({ message: "matchId is required" });
  }

  const runtime = await buildLiveAppMatchRuntime(matchId);
  if (!runtime) {
    return res.status(404).json({ message: "Match not found" });
  }

  res.setHeader("Cache-Control", "private, max-age=2, stale-while-revalidate=3");
  res.setHeader("X-PKT-Cache", runtime?._cache?.hit ? "HIT" : "MISS");
  return res.json({
    ...runtime,
    _cache: undefined,
  });
};
