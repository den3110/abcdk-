// src/services/notificationService.js
import Subscription from "../../models/subscriptionsModel.js";
import PushToken from "../../models/pushTokenModel.js";
import Registration from "../../models/registrationModel.js";
import Match from "../../models/matchModel.js";
import Tournament from "../../models/tournamentModel.js";
import { sendToTokens } from "./expoPush.js";
import { asId } from "../../utils/ids.js";
import SystemSettings from "../../models/systemSettingsModel.js";

function emptySendResult(extra = {}) {
  return {
    sent: 0,
    tokens: 0,
    tickets: [],
    ticketResults: [],
    receiptResults: [],
    summary: {
      tokens: 0,
      ticketOk: 0,
      ticketError: 0,
      receiptOk: 0,
      receiptError: 0,
      disabledTokens: 0,
      errorBreakdown: {},
      byPlatform: {},
      platforms: [],
    },
    sampleFailures: [],
    ...extra,
  };
}

function mergeErrorBreakdown(base = {}, next = {}) {
  const out = { ...(base || {}) };
  Object.entries(next || {}).forEach(([key, value]) => {
    out[key] = Number(out[key] || 0) + Number(value || 0);
  });
  return out;
}

function mergeByPlatform(base = {}, next = {}) {
  const out = { ...(base || {}) };
  Object.entries(next || {}).forEach(([platform, stats]) => {
    const current = out[platform] || {};
    out[platform] = {
      tokens: Number(current.tokens || 0) + Number(stats?.tokens || 0),
      ticketOk: Number(current.ticketOk || 0) + Number(stats?.ticketOk || 0),
      ticketError: Number(current.ticketError || 0) + Number(stats?.ticketError || 0),
      receiptOk: Number(current.receiptOk || 0) + Number(stats?.receiptOk || 0),
      receiptError:
        Number(current.receiptError || 0) + Number(stats?.receiptError || 0),
      disabledTokens:
        Number(current.disabledTokens || 0) + Number(stats?.disabledTokens || 0),
    };
  });
  return out;
}

function mergeSummary(base = {}, next = {}) {
  return {
    tokens: Number(base?.tokens || 0) + Number(next?.tokens || 0),
    ticketOk: Number(base?.ticketOk || 0) + Number(next?.ticketOk || 0),
    ticketError: Number(base?.ticketError || 0) + Number(next?.ticketError || 0),
    receiptOk: Number(base?.receiptOk || 0) + Number(next?.receiptOk || 0),
    receiptError: Number(base?.receiptError || 0) + Number(next?.receiptError || 0),
    disabledTokens:
      Number(base?.disabledTokens || 0) + Number(next?.disabledTokens || 0),
    errorBreakdown: mergeErrorBreakdown(base?.errorBreakdown, next?.errorBreakdown),
    byPlatform: mergeByPlatform(base?.byPlatform, next?.byPlatform),
    platforms: Array.from(
      new Set([...(base?.platforms || []), ...(next?.platforms || [])].filter(Boolean))
    ),
  };
}

function mergeSampleFailures(base = [], next = []) {
  const out = [];
  const seen = new Set();
  [...(base || []), ...(next || [])].forEach((item) => {
    const key = [
      item?.stage || "",
      item?.platform || "",
      item?.error || "",
      item?.message || "",
      item?.token || "",
    ].join("|");
    if (!key || seen.has(key) || out.length >= 20) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

/** ───── Audience resolvers ───── */
const audienceResolvers = {
  // Gửi cho người chơi trận + followers của giải
  async MATCH_START_SOON(ctx) {
    const { matchId, include = ["participants", "subscribers"] } = ctx;
    const users = new Set();
    const m = await Match.findById(matchId)
      .select("tournament players teamA teamB participants")
      .lean();
    if (!m) return [];

    const tid = m.tournament;

    if (include.includes("participants")) {
      const add = (arr) => arr?.forEach((u) => u && users.add(String(u)));
      add(m.players);
      add(m.participants);
      add(m.teamA?.players);
      add(m.teamB?.players);
    }

    if (include.includes("subscribers") && tid) {
      const subs = await Subscription.find({
        topicType: "tournament",
        topicId: asId(tid),
        muted: { $ne: true },
      })
        .select("user")
        .lean();
      subs.forEach((s) => users.add(String(s.user)));
    }

    return [...users];
  },

  // Followers tổ chức/CLB nhận thông báo có giải mới
  async TOURNAMENT_CREATED(ctx) {
    const { orgId, include = ["subscribers"] } = ctx;
    const users = new Set();
    if (include.includes("subscribers") && orgId) {
      const subs = await Subscription.find({
        topicType: "org",
        topicId: asId(orgId),
        muted: { $ne: true },
      })
        .select("user")
        .lean();
      subs.forEach((s) => users.add(String(s.user)));
    }
    return [...users];
  },

  // Lịch giải cập nhật: followers + participants
  async TOURNAMENT_SCHEDULE_UPDATED(ctx) {
    const { tournamentId, include = ["participants", "subscribers"] } = ctx;
    const users = new Set();

    if (include.includes("subscribers")) {
      const subs = await Subscription.find({
        topicType: "tournament",
        topicId: asId(tournamentId),
        muted: { $ne: true },
      })
        .select("user")
        .lean();
      subs.forEach((s) => users.add(String(s.user)));
    }

    if (include.includes("participants")) {
      const regs = await Registration.find({ tournament: asId(tournamentId) })
        .select("user players")
        .lean();
      for (const r of regs) {
        if (r.user) users.add(String(r.user));
        if (Array.isArray(r.players))
          r.players.forEach((u) => u && users.add(String(u)));
      }
    }

    return [...users];
  },
};

/** ───── Payload builders ───── */
const payloadBuilders = {
  async MATCH_START_SOON(ctx) {
    const { matchId } = ctx;
    return {
      title: "Trận sắp bắt đầu",
      body: "Chuẩn bị vào sân nhé!",
      data: { url: `/match/${matchId}` },
    };
  },

  async TOURNAMENT_CREATED(ctx) {
    const { tournamentId } = ctx;
    const t = await Tournament.findById(tournamentId).select("name").lean();
    return {
      title: "Có giải mới!",
      body: t?.name ? `Giải ${t.name} vừa mở` : "Một giải đấu mới vừa mở",
      data: { url: `/tournament/${tournamentId}` },
    };
  },

  async TOURNAMENT_SCHEDULE_UPDATED(ctx) {
    const { tournamentId } = ctx;
    return {
      title: "Lịch thi đấu đã cập nhật",
      body: "Chạm để xem chi tiết",
      data: { url: `/tournament/${tournamentId}/schedule` },
    };
  },
};

/** ───── Emit ───── */
export async function emitNotification(
  eventType,
  ctx = {},
  sendOpts = {},
  runtime = {}
) {
  const resolveAudience = audienceResolvers[eventType];
  const buildPayload = payloadBuilders[eventType];
  if (!resolveAudience || !buildPayload) {
    throw new Error(`Unsupported eventType: ${eventType}`);
  }

  const sys = await SystemSettings.findById("system").lean();
  if (sys?.notifications?.systemPushEnabled === false) {
    return emptySendResult();
  }

  const userIds = await resolveAudience(ctx);
  if (userIds.length === 0) return emptySendResult();

  const rows = await PushToken.find({ user: { $in: userIds }, enabled: true })
    .populate("user", "isPushNotificationEnabled")
    .select(
      "token platform easProjectId projectId experienceId appId bundleId androidPackage buildChannel user"
    )
    .lean();

  const tokens = rows.filter((r) => r.user?.isPushNotificationEnabled !== false);

  if (runtime?.tracker?.onResolvedAudience) {
    await runtime.tracker.onResolvedAudience({
      totalUsers: userIds.length,
      totalTokens: tokens.length,
    });
  }

  if (!tokens.length) return emptySendResult({ sent: userIds.length });

  const payload = await buildPayload(ctx);
  const out = await sendToTokens(tokens, payload, sendOpts, runtime);

  return {
    sent: userIds.length,
    tokens: tokens.length,
    ...out,
  };
}

/** Helper cụ thể “theo dõi giải”: gửi cho subscribers + participants */
export async function notifyTournamentAudience(
  tournamentId,
  { title, body, data } = {},
  opts = {}
) {
  return emitNotification(
    "TOURNAMENT_SCHEDULE_UPDATED",
    { tournamentId },
    opts
  );
}

export async function broadcastToAllTokens(
  { platform, minVersion, maxVersion } = {},
  payload = {},
  sendOpts = {},
  runtime = {}
) {
  const sys = await SystemSettings.findById("system").lean();
  if (sys?.notifications?.systemPushEnabled === false) {
    return emptySendResult();
  }

  const q = { enabled: true };
  if (platform) q.platform = platform;

  // Lọc appVersion kiểu "1.2.3.45" (string compare ổn nếu bạn zero-pad; nếu không thì bỏ)
  if (minVersion) q.appVersion = { ...(q.appVersion || {}), $gte: minVersion };
  if (maxVersion) q.appVersion = { ...(q.appVersion || {}), $lte: maxVersion };

  // Duyệt theo cursor để không ăn nhiều RAM khi tập lớn
  const cursor = PushToken.find(q)
    .populate("user", "isPushNotificationEnabled")
    .select(
      "token platform easProjectId projectId experienceId appId bundleId androidPackage buildChannel user"
    )
    .cursor();

  let batch = [];
  const BATCH_SIZE = 200;
  const all = emptySendResult();
  let processedTokens = 0;
  let processedBatches = 0;
  const estimatedTotalTokens =
    runtime?.estimatedTotalTokens != null
      ? Number(runtime.estimatedTotalTokens || 0)
      : null;

  if (runtime?.tracker?.onResolvedAudience) {
    await runtime.tracker.onResolvedAudience({
      totalUsers: 0,
      totalTokens: estimatedTotalTokens ?? 0,
    });
  }

  for await (const doc of cursor) {
    if (doc.user && doc.user.isPushNotificationEnabled === false) continue;
    if (!doc?.token) continue;
    batch.push(doc);
    if (batch.length >= BATCH_SIZE) {
      const out = await sendToTokens(batch, payload, sendOpts);
      all.tickets.push(...out.tickets);
      all.ticketResults.push(...out.ticketResults);
      all.receiptResults.push(...out.receiptResults);
      all.summary = mergeSummary(all.summary, out.summary);
      all.sampleFailures = mergeSampleFailures(all.sampleFailures, out.sampleFailures);
      processedTokens += batch.length;
      processedBatches += 1;
      if (runtime?.tracker?.onProgress) {
        await runtime.tracker.onProgress({
          progress: {
            totalTokens: estimatedTotalTokens ?? processedTokens,
            processedTokens,
            processedBatches,
            totalBatches:
              estimatedTotalTokens != null
                ? Math.ceil(estimatedTotalTokens / BATCH_SIZE)
                : processedBatches,
          },
          summary: all.summary,
          sampleFailures: all.sampleFailures,
        });
      }
      batch = [];
    }
  }
  if (batch.length) {
    const out = await sendToTokens(batch, payload, sendOpts);
    all.tickets.push(...out.tickets);
    all.ticketResults.push(...out.ticketResults);
    all.receiptResults.push(...out.receiptResults);
    all.summary = mergeSummary(all.summary, out.summary);
    all.sampleFailures = mergeSampleFailures(all.sampleFailures, out.sampleFailures);
    processedTokens += batch.length;
    processedBatches += 1;
    if (runtime?.tracker?.onProgress) {
      await runtime.tracker.onProgress({
        progress: {
          totalTokens: estimatedTotalTokens ?? processedTokens,
          processedTokens,
          processedBatches,
          totalBatches:
            estimatedTotalTokens != null
              ? Math.ceil(estimatedTotalTokens / BATCH_SIZE)
              : processedBatches,
        },
        summary: all.summary,
        sampleFailures: all.sampleFailures,
      });
    }
  }

  return {
    ...all,
    tickets: all.tickets.slice(0, 50),
  };
}
