// src/jobs/notifyJobs.js
import { agenda } from "./agenda.js";
import {
  publishNotification,
  EVENTS,
  CATEGORY,
} from "../services/notifications/notificationHub.js";
import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";
import PushToken from "../models/pushTokenModel.js";
import SystemSettings from "../models/systemSettingsModel.js";
import { broadcastToAllTokens } from "../services/notifications/notificationService.js";
import {
  buildPushDispatchTracker,
  markPushDispatchCompleted,
  markPushDispatchFailed,
  markPushDispatchRunning,
  markPushDispatchSkipped,
  updatePushDispatchProgress,
} from "../services/pushDispatchService.js";

const ADMIN_GLOBAL_BROADCAST_JOB = "notify.admin.global-broadcast";
const BROADCAST_BATCH_SIZE = 200;
const ZERO_SUMMARY = {
  tokens: 0,
  ticketOk: 0,
  ticketError: 0,
  receiptOk: 0,
  receiptError: 0,
  disabledTokens: 0,
  errorBreakdown: {},
  byPlatform: {},
  platforms: [],
};

function buildBroadcastFilters({ platform, minVersion, maxVersion } = {}) {
  return {
    ...(platform ? { platform } : {}),
    ...(minVersion ? { minVersion } : {}),
    ...(maxVersion ? { maxVersion } : {}),
  };
}

function buildBroadcastQuery({ platform, minVersion, maxVersion } = {}) {
  const q = { enabled: true };
  if (platform) q.platform = platform;
  if (minVersion) q.appVersion = { ...(q.appVersion || {}), $gte: minVersion };
  if (maxVersion) q.appVersion = { ...(q.appVersion || {}), $lte: maxVersion };
  return q;
}

async function estimateBroadcastTokenCount(filters = {}) {
  return PushToken.countDocuments(buildBroadcastQuery(filters));
}

/** D-3/D-2/D-1/D0 */
agenda.define("notify.tournament.countdown", async (job, done) => {
  try {
    const { tournamentId, phase } = job.attrs.data || {};
    if (!tournamentId || !phase) return done();

    const t = await Tournament.findById(tournamentId)
      .select("_id startAt")
      .lean();
    if (!t || !t.startAt) return done();

    await publishNotification(EVENTS.TOURNAMENT_COUNTDOWN, {
      tournamentId,
      topicType: "tournament",
      topicId: tournamentId,
      category: CATEGORY.COUNTDOWN,
      phase, // "D-3"|"D-2"|"D-1"|"D0"
    });

    done();
  } catch (e) {
    done(e);
  }
});

/** Match sắp bắt đầu (ví dụ trước 30’, 15’, 5’) */
agenda.define("notify.match.startSoon", async (job, done) => {
  try {
    const { matchId, etaLabel } = job.attrs.data || {};
    if (!matchId) return done();

    const m = await Match.findById(matchId)
      .select("_id status scheduledAt court label")
      .lean();
    if (!m) return done();
    if (["finished", "canceled"].includes(m.status)) return done();

    const label = m.label || ""; // ví dụ "R1#3 • Sân 2 • 10:30"
    await publishNotification(EVENTS.MATCH_START_SOON, {
      matchId,
      topicType: "match",
      topicId: matchId,
      category: CATEGORY.SCHEDULE,
      label,
      eta: etaLabel, // "30′" | "15′" | "5′"
    });

    done();
  } catch (e) {
    done(e);
  }
});

agenda.define(ADMIN_GLOBAL_BROADCAST_JOB, async (job, done) => {
  const data = job.attrs.data || {};
  const {
    dispatchId,
    scope = "all",
    title,
    body,
    url,
    platform,
    minVersion,
    maxVersion,
    badge,
    ttl,
    triggeredBy = null,
  } = data;

  try {
    if (!dispatchId || !title || !body) return done();

    const filters = buildBroadcastFilters({ platform, minVersion, maxVersion });
    const payload = {
      title,
      body,
      data: url ? { url } : {},
    };
    const dispatchPayload = { title, body, url, badge, ttl };

    if (scope === "subscribers") {
      await publishNotification(
        EVENTS.SYSTEM_BROADCAST,
        {
          scope,
          topicType: "global",
          topicId: null,
          category: CATEGORY.SYSTEM,
          title,
          body,
          url,
          platform,
          minVersion,
          maxVersion,
        },
        {
          badge,
          ttl,
          dispatchMeta: {
            dispatchId,
            sourceKind: "admin_broadcast",
            triggeredBy,
            scope,
            filters,
          },
        }
      );
      return done();
    }

    const sys = await SystemSettings.findById("system").lean();
    if (sys?.notifications?.systemPushEnabled === false) {
      await markPushDispatchSkipped(dispatchId, {
        payload: dispatchPayload,
        target: {
          scope,
          filters,
          audienceCount: 0,
        },
        context: {
          scope,
          platform,
          minVersion,
          maxVersion,
        },
        summary: ZERO_SUMMARY,
        note: "system_push_disabled",
      });
      return done();
    }

    const estimatedTotalTokens = await estimateBroadcastTokenCount(filters);
    await markPushDispatchRunning(dispatchId, {
      triggeredBy,
      payload: dispatchPayload,
      target: {
        scope,
        filters,
        audienceCount: estimatedTotalTokens,
      },
      context: {
        scope,
        platform,
        minVersion,
        maxVersion,
      },
    });

    if (!estimatedTotalTokens) {
      await markPushDispatchSkipped(dispatchId, {
        payload: dispatchPayload,
        target: {
          scope,
          filters,
          audienceCount: 0,
        },
        context: {
          scope,
          platform,
          minVersion,
          maxVersion,
        },
        summary: ZERO_SUMMARY,
        note: "no_active_tokens",
      });
      return done();
    }

    const tracker = buildPushDispatchTracker({
      dispatchId,
      onResolvedAudience: async ({ totalTokens } = {}) => {
        const resolvedTotal = Number(totalTokens || estimatedTotalTokens || 0);
        await updatePushDispatchProgress(dispatchId, {
          target: {
            scope,
            filters,
            audienceCount: resolvedTotal,
          },
          progress: {
            totalTokens: resolvedTotal,
            processedTokens: 0,
            processedBatches: 0,
            totalBatches:
              resolvedTotal > 0 ? Math.ceil(resolvedTotal / BROADCAST_BATCH_SIZE) : 0,
          },
        });
      },
      onProgress: async ({ progress, summary, sampleFailures } = {}) => {
        await updatePushDispatchProgress(dispatchId, {
          progress: {
            totalTokens:
              Number(progress?.totalTokens || 0) || Number(estimatedTotalTokens || 0),
            processedTokens: Number(progress?.processedTokens || 0),
            processedBatches: Number(progress?.processedBatches || 0),
            totalBatches:
              Number(progress?.totalBatches || 0) ||
              Math.ceil(Number(estimatedTotalTokens || 0) / BROADCAST_BATCH_SIZE),
          },
          summary,
          sampleFailures,
          target: {
            scope,
            filters,
            audienceCount:
              Number(summary?.tokens || 0) || Number(estimatedTotalTokens || 0),
          },
        });
      },
    });

    const out = await broadcastToAllTokens(filters, payload, { badge, ttl }, {
      tracker,
      estimatedTotalTokens,
    });

    if (Number(out?.summary?.tokens || 0) === 0) {
      await markPushDispatchSkipped(dispatchId, {
        payload: dispatchPayload,
        target: {
          scope,
          filters,
          audienceCount: estimatedTotalTokens,
        },
        context: {
          scope,
          platform,
          minVersion,
          maxVersion,
        },
        summary: out?.summary || ZERO_SUMMARY,
        sampleFailures: out?.sampleFailures || [],
        note: "no_deliverable_tokens",
      });
      return done();
    }

    await markPushDispatchCompleted(dispatchId, {
      payload: dispatchPayload,
      target: {
        scope,
        filters,
        audienceCount: Number(out?.summary?.tokens || estimatedTotalTokens || 0),
      },
      context: {
        scope,
        platform,
        minVersion,
        maxVersion,
      },
      summary: out?.summary || ZERO_SUMMARY,
      sampleFailures: out?.sampleFailures || [],
      progress: {
        totalTokens: Number(out?.summary?.tokens || estimatedTotalTokens || 0),
        processedTokens: Number(out?.summary?.tokens || estimatedTotalTokens || 0),
        processedBatches: Math.ceil(Number(estimatedTotalTokens || 0) / BROADCAST_BATCH_SIZE),
        totalBatches: Math.ceil(Number(estimatedTotalTokens || 0) / BROADCAST_BATCH_SIZE),
      },
    });

    done();
  } catch (error) {
    if (dispatchId) {
      await markPushDispatchFailed(dispatchId, {
        note: error?.message || "admin_global_broadcast_failed",
      });
    }
    done(error);
  }
});
