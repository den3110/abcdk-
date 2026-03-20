import cron from "node-cron";
import { randomUUID } from "crypto";
import Match from "../models/matchModel.js";
import UserMatch from "../models/userMatchModel.js";
import LiveSessionLease from "../models/liveSessionLeaseModel.js";
import { getCfgInt } from "./config.service.js";
import { fbEndLiveVideo } from "./facebookLive.service.js";
import {
  getFacebookPagePoolDelays,
  markFacebookPageFreeByLive,
  markFacebookPageFreeByPage,
} from "./facebookPagePool.service.js";
import { publishFbPageMonitorUpdate } from "./fbPageMonitorEvents.service.js";

const HEARTBEAT_INTERVAL_DEFAULT_MS = 15_000;
const LEASE_TIMEOUT_DEFAULT_MS = 120_000;
const HEARTBEAT_INTERVAL_MIN_MS = 5_000;
const LEASE_TIMEOUT_MIN_MS = 30_000;
const LEASE_TIMEOUT_MULTIPLIER = 4;
const EXPIRE_SWEEP_CRON = "*/10 * * * * *";

const CFG_KEYS = {
  heartbeatIntervalMs: "LIVE_FB_LEASE_HEARTBEAT_MS",
  leaseTimeoutMs: "LIVE_FB_LEASE_TIMEOUT_MS",
};

export const LIVE_SESSION_LEASE_CONFIG = {
  HEARTBEAT_INTERVAL_DEFAULT_MS,
  LEASE_TIMEOUT_DEFAULT_MS,
};

let _leaseCronStarted = false;

function normalizeHeartbeatIntervalMs(value) {
  return Number.isFinite(value) && value >= HEARTBEAT_INTERVAL_MIN_MS
    ? Math.round(value)
    : HEARTBEAT_INTERVAL_DEFAULT_MS;
}

function normalizeLeaseTimeoutMs(value, heartbeatIntervalMs) {
  const raw = Number.isFinite(value) ? Math.round(value) : LEASE_TIMEOUT_DEFAULT_MS;
  const floor = Math.max(
    LEASE_TIMEOUT_MIN_MS,
    heartbeatIntervalMs * LEASE_TIMEOUT_MULTIPLIER
  );
  return raw >= floor ? raw : Math.max(LEASE_TIMEOUT_DEFAULT_MS, floor);
}

export async function getLiveLeaseConfig() {
  const rawHeartbeatIntervalMs = await getCfgInt(
    CFG_KEYS.heartbeatIntervalMs,
    HEARTBEAT_INTERVAL_DEFAULT_MS
  );
  const heartbeatIntervalMs = normalizeHeartbeatIntervalMs(
    rawHeartbeatIntervalMs
  );
  const rawLeaseTimeoutMs = await getCfgInt(
    CFG_KEYS.leaseTimeoutMs,
    LEASE_TIMEOUT_DEFAULT_MS
  );
  const leaseTimeoutMs = normalizeLeaseTimeoutMs(
    rawLeaseTimeoutMs,
    heartbeatIntervalMs
  );

  return {
    heartbeatIntervalMs,
    leaseTimeoutMs,
  };
}

export function ensureLiveShape(live = {}) {
  const out = {
    status: "idle",
    platforms: {},
    sessions: [],
    lastChangedAt: new Date(),
  };
  if (live && typeof live === "object") {
    out.status = live.status || "idle";
    out.platforms =
      live.platforms && typeof live.platforms === "object"
        ? { ...live.platforms }
        : {};
    out.sessions = Array.isArray(live.sessions)
      ? live.sessions.map((session) => ({ ...session }))
      : [];
    out.lastChangedAt = live.lastChangedAt
      ? new Date(live.lastChangedAt)
      : new Date();
  }
  return out;
}

export function normalizeMatchKind(kind) {
  const normalized = String(kind || "")
    .trim()
    .toLowerCase();
  return normalized === "usermatch" || normalized === "user"
    ? "userMatch"
    : "match";
}

function getTargetModel(matchKind) {
  return normalizeMatchKind(matchKind) === "userMatch" ? UserMatch : Match;
}

function getTargetRefField(matchKind) {
  return normalizeMatchKind(matchKind) === "userMatch"
    ? "userMatchId"
    : "matchId";
}

function buildTargetRefQuery(matchKind, targetId) {
  return {
    [getTargetRefField(matchKind)]: targetId,
  };
}

function computeExpiresAt(baseDate, leaseTimeoutMs) {
  return new Date(baseDate.getTime() + leaseTimeoutMs);
}

function parseEventDate(ts) {
  const date = ts ? new Date(ts) : new Date();
  return Number.isFinite(date.getTime()) ? date : new Date();
}

export function resolveClientSessionId(clientSessionId) {
  const normalized = String(clientSessionId || "").trim();
  return normalized || randomUUID();
}

export async function getLiveTargetDoc(matchId, matchKind) {
  const TargetModel = getTargetModel(matchKind);
  return TargetModel.findById(matchId).select("live facebookLive").lean();
}

function cloneDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function buildPlatformState({
  current = {},
  active,
  clientSessionId,
  lease,
  lastStartAt,
  lastEndAt,
  leaseStatus,
}) {
  return {
    ...current,
    active,
    clientSessionId: clientSessionId || current?.clientSessionId || null,
    leaseId: lease?._id ? String(lease._id) : current?.leaseId || null,
    leaseStatus: leaseStatus || lease?.status || current?.leaseStatus || null,
    lastStartAt: lastStartAt || current?.lastStartAt || null,
    lastEndAt: lastEndAt || current?.lastEndAt || null,
    lastHeartbeatAt:
      cloneDateOrNull(lease?.lastHeartbeatAt) ||
      cloneDateOrNull(current?.lastHeartbeatAt) ||
      null,
    expiresAt:
      cloneDateOrNull(lease?.expiresAt) ||
      cloneDateOrNull(current?.expiresAt) ||
      null,
    pageId: lease?.pageId || current?.pageId || null,
    liveVideoId: lease?.liveVideoId || current?.liveVideoId || null,
  };
}

async function persistLiveState({
  matchId,
  matchKind,
  live,
  extraSet = {},
  extraUnset = {},
}) {
  const TargetModel = getTargetModel(matchKind);
  const update = {
    $set: {
      live,
      ...extraSet,
    },
  };
  if (extraUnset && Object.keys(extraUnset).length) {
    update.$unset = extraUnset;
  }
  return TargetModel.findByIdAndUpdate(matchId, update, { new: true })
    .select("live facebookLive")
    .lean();
}

async function markTargetPlatformStarted({
  matchId,
  matchKind,
  platform,
  startedAt,
  clientSessionId,
  lease,
}) {
  const target = await getLiveTargetDoc(matchId, matchKind);
  if (!target) return null;

  const live = ensureLiveShape(target.live);
  const hasOpen = live.sessions.some(
    (session) =>
      session.platform === platform &&
      session.clientSessionId === clientSessionId &&
      !session.endedAt
  );

  if (!hasOpen) {
    live.sessions.push({
      platform,
      clientSessionId,
      startedAt,
      endedAt: null,
    });
  }

  live.platforms[platform] = buildPlatformState({
    current: live.platforms[platform],
    active: true,
    clientSessionId,
    lease,
    lastStartAt: startedAt,
    leaseStatus: lease?.status || "active",
  });
  live.status = "live";
  live.lastChangedAt = new Date();

  return persistLiveState({
    matchId,
    matchKind,
    live,
    extraSet:
      platform === "facebook" ? { "facebookLive.status": "LIVE" } : {},
  });
}

function findOpenSessionIndex(live, platform, clientSessionId = "") {
  const targetClientSessionId = String(clientSessionId || "").trim();
  for (let i = live.sessions.length - 1; i >= 0; i -= 1) {
    const session = live.sessions[i];
    if (session.platform !== platform || session.endedAt) continue;
    if (!targetClientSessionId || session.clientSessionId === targetClientSessionId) {
      return i;
    }
  }
  if (!targetClientSessionId) return -1;
  for (let i = live.sessions.length - 1; i >= 0; i -= 1) {
    const session = live.sessions[i];
    if (session.platform === platform && !session.endedAt) return i;
  }
  return -1;
}

async function countOtherActiveLeases({
  leaseId,
  matchId,
  matchKind,
  platform,
}) {
  return LiveSessionLease.countDocuments({
    ...buildTargetRefQuery(matchKind, matchId),
    matchKind: normalizeMatchKind(matchKind),
    platform,
    status: "active",
    _id: { $ne: leaseId },
  });
}

async function markTargetPlatformEnded({
  matchId,
  matchKind,
  platform,
  endedAt,
  clientSessionId,
  lease,
  leaseStatus = "ended",
}) {
  const target = await getLiveTargetDoc(matchId, matchKind);
  if (!target) return null;

  const live = ensureLiveShape(target.live);
  const platformState = live.platforms[platform] || {};
  const currentClientSessionId = String(platformState.clientSessionId || "").trim();
  const targetClientSessionId = String(clientSessionId || "").trim();

  const openIndex = findOpenSessionIndex(live, platform, targetClientSessionId);
  if (openIndex >= 0) {
    live.sessions[openIndex] = {
      ...live.sessions[openIndex],
      endedAt,
    };
  }

  const shouldMutatePlatformState =
    !currentClientSessionId ||
    !targetClientSessionId ||
    currentClientSessionId === targetClientSessionId ||
    String(platformState.leaseId || "") === String(lease?._id || "");

  if (shouldMutatePlatformState) {
    live.platforms[platform] = buildPlatformState({
      current: platformState,
      active: false,
      clientSessionId: targetClientSessionId || currentClientSessionId || null,
      lease,
      lastEndAt: endedAt,
      leaseStatus,
    });
  }

  const anyActive = Object.values(live.platforms).some((state) => state?.active);
  live.status = anyActive ? "live" : "idle";
  live.lastChangedAt = new Date();

  const extraSet =
    platform === "facebook" && !anyActive
      ? { "facebookLive.status": "ENDED" }
      : {};

  return persistLiveState({
    matchId,
    matchKind,
    live,
    extraSet,
  });
}

async function touchTargetLeaseState({
  matchId,
  matchKind,
  platform,
  clientSessionId,
  lease,
}) {
  const target = await getLiveTargetDoc(matchId, matchKind);
  if (!target) return null;
  const live = ensureLiveShape(target.live);
  const platformState = live.platforms[platform] || {};
  const currentClientSessionId = String(platformState.clientSessionId || "").trim();
  const nextClientSessionId = String(clientSessionId || "").trim();
  if (
    currentClientSessionId &&
    nextClientSessionId &&
    currentClientSessionId !== nextClientSessionId &&
    String(platformState.leaseId || "") !== String(lease?._id || "")
  ) {
    return target;
  }

  live.platforms[platform] = buildPlatformState({
    current: platformState,
    active: true,
    clientSessionId: nextClientSessionId || currentClientSessionId || null,
    lease,
    lastStartAt: platformState.lastStartAt || lease?.startedAt || new Date(),
    leaseStatus: lease?.status || "active",
  });
  live.status = "live";
  live.lastChangedAt = new Date();

  return persistLiveState({ matchId, matchKind, live });
}

export function pickFacebookMeta(doc) {
  const liveVideoId =
    doc?.facebookLive?.id ||
    doc?.facebookLive?.liveVideoId ||
    doc?.live?.platforms?.facebook?.id ||
    doc?.live?.platforms?.facebook?.liveVideoId ||
    doc?.facebookLive?.videoId ||
    null;

  const pageAccessToken =
    doc?.facebookLive?.pageAccessToken ||
    doc?.facebookLive?.pageToken ||
    doc?.facebookLive?.accessToken ||
    doc?.facebookLive?.access_token ||
    null;

  const pageId =
    doc?.facebookLive?.pageId ||
    doc?.facebookLive?.page_id ||
    doc?.facebookLive?.page?.id ||
    doc?.live?.platforms?.facebook?.pageId ||
    doc?.live?.platforms?.facebook?.page_id ||
    null;

  return {
    liveVideoId: liveVideoId ? String(liveVideoId) : null,
    pageId: pageId ? String(pageId) : null,
    pageAccessToken: pageAccessToken ? String(pageAccessToken) : null,
  };
}

export async function endFacebookLiveVideo({ liveVideoId, pageAccessToken }) {
  if (!liveVideoId || !pageAccessToken) {
    return { skipped: true, reason: "missing_liveVideoId_or_pageAccessToken" };
  }

  try {
    const data = await fbEndLiveVideo({
      liveVideoId,
      pageAccessToken,
    });
    return { status: 200, data };
  } catch (err) {
    return {
      error: true,
      status: err?.response?.status || 0,
      data: err?.response?.data || { message: err?.message },
    };
  }
}

export async function releaseFacebookPagePoolAfterEnd({
  pageId,
  liveVideoId,
  endResult,
}) {
  const delays = await getFacebookPagePoolDelays();
  const success = !!endResult && !endResult.error && !endResult.skipped;
  const delayMs = success ? delays.fastFreeDelayMs : delays.safeFreeDelayMs;
  const reasonSuffix = success
    ? "fb_end_ok"
    : endResult?.skipped
    ? `fb_end_skipped:${endResult.reason || "unknown"}`
    : "fb_end_error";

  const jobs = [];
  if (liveVideoId) {
    jobs.push(
      markFacebookPageFreeByLive(liveVideoId, {
        delayMs,
        force: true,
        reason: `free_by_live:${liveVideoId}:${reasonSuffix}`,
      })
    );
  }
  if (pageId) {
    jobs.push(
      markFacebookPageFreeByPage(pageId, {
        delayMs,
        force: true,
        reason: `free_by_page:${reasonSuffix}`,
      })
    );
  }
  if (!jobs.length) return;

  const settled = await Promise.allSettled(jobs);
  for (const item of settled) {
    if (item.status === "rejected") {
      console.warn(
        "[FB] schedule pool release failed:",
        item.reason?.message || item.reason
      );
    }
  }

  await publishFbPageMonitorUpdate({
    reason: "page_pool_release_scheduled",
    pageIds: [pageId],
  });
}

function serializeLease(lease) {
  if (!lease) return null;
  return {
    leaseId: String(lease._id),
    clientSessionId: lease.clientSessionId,
    leaseStatus: lease.status,
    expiresAt: lease.expiresAt,
    heartbeatIntervalMs: null,
    leaseTimeoutMs: null,
  };
}

function withLeaseConfig(lease, config) {
  const serialized = serializeLease(lease) || {};
  return {
    ...serialized,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    leaseTimeoutMs: config.leaseTimeoutMs,
  };
}

export async function startOrRenewLease({
  matchId,
  matchKind,
  platform,
  timestamp,
  clientSessionId,
}) {
  const normalizedMatchKind = normalizeMatchKind(matchKind);
  const normalizedClientSessionId = resolveClientSessionId(clientSessionId);
  const startedAt = parseEventDate(timestamp);
  const config = await getLiveLeaseConfig();
  const expiresAt = computeExpiresAt(startedAt, config.leaseTimeoutMs);
  const target = await getLiveTargetDoc(matchId, normalizedMatchKind);
  if (!target) {
    return { notFound: true, clientSessionId: normalizedClientSessionId };
  }

  const meta = pickFacebookMeta(target);
  const baseQuery = {
    ...buildTargetRefQuery(normalizedMatchKind, matchId),
    matchKind: normalizedMatchKind,
    platform,
    clientSessionId: normalizedClientSessionId,
    status: "active",
  };

  let lease = await LiveSessionLease.findOne(baseQuery).sort({ createdAt: -1 });

  if (lease) {
    lease.startedAt = lease.startedAt || startedAt;
    lease.lastHeartbeatAt = startedAt;
    lease.expiresAt = expiresAt;
    lease.pageId = meta.pageId || lease.pageId || null;
    lease.liveVideoId = meta.liveVideoId || lease.liveVideoId || null;
    lease.expireReason = null;
    await lease.save();
  } else {
    lease = await LiveSessionLease.create({
      matchKind: normalizedMatchKind,
      ...buildTargetRefQuery(normalizedMatchKind, matchId),
      platform,
      clientSessionId: normalizedClientSessionId,
      status: "active",
      startedAt,
      lastHeartbeatAt: startedAt,
      expiresAt,
      pageId: meta.pageId,
      liveVideoId: meta.liveVideoId,
    });
  }

  const updated = await markTargetPlatformStarted({
    matchId,
    matchKind: normalizedMatchKind,
    platform,
    startedAt,
    clientSessionId: normalizedClientSessionId,
    lease,
  });

  await publishFbPageMonitorUpdate({
    reason: `lease_started:${platform}`,
    pageIds: [meta.pageId || lease.pageId],
  });

  return {
    ok: true,
    lease,
    live: updated?.live || ensureLiveShape(target.live),
    clientSessionId: normalizedClientSessionId,
    leaseInfo: withLeaseConfig(lease, config),
  };
}

export async function heartbeatLease({
  matchId,
  matchKind,
  platform,
  timestamp,
  clientSessionId,
}) {
  const normalizedMatchKind = normalizeMatchKind(matchKind);
  const normalizedClientSessionId = String(clientSessionId || "").trim();
  const heartbeatAt = parseEventDate(timestamp);
  const config = await getLiveLeaseConfig();

  if (!normalizedClientSessionId) {
    return {
      ok: false,
      clientSessionId: null,
      leaseStatus: "missing_client_session",
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      leaseTimeoutMs: config.leaseTimeoutMs,
    };
  }

  const query = {
    ...buildTargetRefQuery(normalizedMatchKind, matchId),
    matchKind: normalizedMatchKind,
    platform,
    clientSessionId: normalizedClientSessionId,
  };

  const latest = await LiveSessionLease.findOne(query).sort({ createdAt: -1 });
  if (!latest) {
    return {
      ok: false,
      clientSessionId: normalizedClientSessionId,
      leaseStatus: "not_found",
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      leaseTimeoutMs: config.leaseTimeoutMs,
    };
  }

  if (latest.status !== "active") {
    return {
      ok: false,
      clientSessionId: normalizedClientSessionId,
      leaseStatus: latest.status,
      leaseId: String(latest._id),
      expiresAt: latest.expiresAt,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      leaseTimeoutMs: config.leaseTimeoutMs,
    };
  }

  const target = await getLiveTargetDoc(matchId, normalizedMatchKind);
  const meta = pickFacebookMeta(target);
  latest.lastHeartbeatAt = heartbeatAt;
  latest.expiresAt = computeExpiresAt(heartbeatAt, config.leaseTimeoutMs);
  latest.pageId = meta.pageId || latest.pageId || null;
  latest.liveVideoId = meta.liveVideoId || latest.liveVideoId || null;
  latest.expireReason = null;
  await latest.save();

  await touchTargetLeaseState({
    matchId,
    matchKind: normalizedMatchKind,
    platform,
    clientSessionId: normalizedClientSessionId,
    lease: latest,
  });

  await publishFbPageMonitorUpdate({
    reason: `lease_heartbeat:${platform}`,
    pageIds: [meta.pageId || latest.pageId],
  });

  return {
    ok: true,
    clientSessionId: normalizedClientSessionId,
    ...withLeaseConfig(latest, config),
  };
}

export async function endLease({
  matchId,
  matchKind,
  platform,
  timestamp,
  clientSessionId,
}) {
  const normalizedMatchKind = normalizeMatchKind(matchKind);
  const endedAt = parseEventDate(timestamp);
  const normalizedClientSessionId = String(clientSessionId || "").trim();
  const baseQuery = {
    ...buildTargetRefQuery(normalizedMatchKind, matchId),
    matchKind: normalizedMatchKind,
    platform,
  };

  let lease = null;
  if (normalizedClientSessionId) {
    lease = await LiveSessionLease.findOne({
      ...baseQuery,
      clientSessionId: normalizedClientSessionId,
    }).sort({ createdAt: -1 });
  }
  if (!lease) {
    lease = await LiveSessionLease.findOne(baseQuery).sort({
      status: 1,
      createdAt: -1,
    });
  }

  if (!lease) {
    return {
      ok: true,
      leaseStatus: "not_found",
      shouldTerminatePlatform: true,
      live: null,
      clientSessionId: normalizedClientSessionId || null,
    };
  }

  if (lease.status === "active") {
    lease.status = "ended";
    lease.endedAt = endedAt;
    lease.expiresAt = endedAt;
    lease.lastHeartbeatAt = endedAt;
    lease.expireReason = null;
    await lease.save();
  }

  const otherActiveLeaseCount = await countOtherActiveLeases({
    leaseId: lease._id,
    matchId,
    matchKind: normalizedMatchKind,
    platform,
  });

  let updated = null;
  if (otherActiveLeaseCount === 0) {
    updated = await markTargetPlatformEnded({
      matchId,
      matchKind: normalizedMatchKind,
      platform,
      endedAt,
      clientSessionId: lease.clientSessionId,
      lease,
      leaseStatus: lease.status,
    });
  }

  await publishFbPageMonitorUpdate({
    reason: `lease_ended:${platform}`,
    pageIds: [lease.pageId],
  });

  return {
    ok: true,
    leaseStatus: lease.status,
    shouldTerminatePlatform: otherActiveLeaseCount === 0,
    lease,
    live: updated?.live || null,
    clientSessionId: lease.clientSessionId,
  };
}

async function expireLeaseById(leaseId) {
  const now = new Date();
  const lease = await LiveSessionLease.findOneAndUpdate(
    {
      _id: leaseId,
      status: "active",
      expiresAt: { $lte: now },
    },
    {
      $set: {
        status: "expired",
        endedAt: now,
        expireReason: "heartbeat_timeout",
      },
    },
    { new: true }
  );

  if (!lease) return null;

  const otherActiveLeaseCount = await countOtherActiveLeases({
    leaseId: lease._id,
    matchId:
      lease.matchKind === "userMatch" ? lease.userMatchId : lease.matchId,
    matchKind: lease.matchKind,
    platform: lease.platform,
  });

  if (otherActiveLeaseCount > 0) {
    await publishFbPageMonitorUpdate({
      reason: `lease_expired_but_replaced:${lease.platform}`,
      pageIds: [lease.pageId],
    });
    return { lease, skipped: true, reason: "newer_active_lease_exists" };
  }

  const targetId =
    lease.matchKind === "userMatch" ? lease.userMatchId : lease.matchId;

  const target = targetId
    ? await getLiveTargetDoc(targetId, lease.matchKind)
    : null;

  await markTargetPlatformEnded({
    matchId: targetId,
    matchKind: lease.matchKind,
    platform: lease.platform,
    endedAt: now,
    clientSessionId: lease.clientSessionId,
    lease,
    leaseStatus: "expired",
  }).catch(() => null);

  await publishFbPageMonitorUpdate({
    reason: `lease_expired:${lease.platform}`,
    pageIds: [lease.pageId],
  });

  if (lease.platform !== "facebook") {
    return { lease, skipped: true, reason: "non_facebook_platform" };
  }

  const meta = pickFacebookMeta(target);
  const pageId = meta.pageId || lease.pageId || null;
  const liveVideoId = meta.liveVideoId || lease.liveVideoId || null;
  const pageAccessToken = meta.pageAccessToken || null;

  let endResult = {
    skipped: true,
    reason: target ? "missing_liveVideoId_or_pageAccessToken" : "missing_target_doc",
  };

  if (liveVideoId && pageAccessToken) {
    endResult = await endFacebookLiveVideo({
      liveVideoId,
      pageAccessToken,
    });
  }

  await releaseFacebookPagePoolAfterEnd({
    pageId,
    liveVideoId,
    endResult,
  }).catch((error) => {
    console.warn(
      "[lease] failed to release page pool after expiry:",
      error?.message || error
    );
  });

  return {
    lease,
    skipped: false,
    endResult,
  };
}

export function startLiveSessionLeaseCron() {
  if (_leaseCronStarted) return;
  _leaseCronStarted = true;

  cron.schedule(EXPIRE_SWEEP_CRON, async () => {
    try {
      const now = new Date();
      const staleLeases = await LiveSessionLease.find({
        status: "active",
        expiresAt: { $lte: now },
      })
        .sort({ expiresAt: 1 })
        .limit(20)
        .select("_id")
        .lean();

      for (const lease of staleLeases) {
        await expireLeaseById(lease._id).catch((error) => {
          console.warn(
            "[lease] expire job failed:",
            error?.message || error
          );
        });
      }
    } catch (error) {
      console.warn("[lease] cron tick failed:", error?.message || error);
    }
  });
}
