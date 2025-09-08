// src/services/notificationService.js
import Subscription from "../models/subscriptionsModel.js";
import PushToken from "../models/pushTokenModel.js";
import Registration from "../models/registrationModel.js";
import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";
import { sendToTokens } from "./expoPush.js";
import { asId } from "../utils/ids.js";

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
export async function emitNotification(eventType, ctx = {}, sendOpts = {}) {
  const resolveAudience = audienceResolvers[eventType];
  const buildPayload = payloadBuilders[eventType];
  if (!resolveAudience || !buildPayload) {
    throw new Error(`Unsupported eventType: ${eventType}`);
  }

  const userIds = await resolveAudience(ctx);
  if (userIds.length === 0) return { sent: 0, tokens: 0, tickets: [] };

  const rows = await PushToken.find({ user: { $in: userIds }, enabled: true })
    .select("token")
    .lean();
  const tokens = rows.map((r) => r.token);
  if (!tokens.length) return { sent: userIds.length, tokens: 0, tickets: [] };

  const payload = await buildPayload(ctx);
  const tickets = await sendToTokens(tokens, payload, sendOpts);

  return { sent: userIds.length, tokens: tokens.length, tickets };
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
  sendOpts = {}
) {
  const q = { enabled: true };
  if (platform) q.platform = platform;

  // Lọc appVersion kiểu "1.2.3.45" (string compare ổn nếu bạn zero-pad; nếu không thì bỏ)
  if (minVersion) q.appVersion = { ...(q.appVersion || {}), $gte: minVersion };
  if (maxVersion) q.appVersion = { ...(q.appVersion || {}), $lte: maxVersion };

  // Duyệt theo cursor để không ăn nhiều RAM khi tập lớn
  const cursor = PushToken.find(q).select("token").cursor();

  let batch = [];
  const BATCH_SIZE = 200; // tuỳ chỉnh
  const ticketsAll = [];
  let tokensCount = 0;

  for await (const doc of cursor) {
    if (!doc?.token) continue;
    batch.push(doc.token);
    if (batch.length >= BATCH_SIZE) {
      const { tickets } = await sendToTokens(batch, payload, sendOpts);
      ticketsAll.push(...tickets);
      tokensCount += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    const { tickets } = await sendToTokens(batch, payload, sendOpts);
    ticketsAll.push(...tickets);
    tokensCount += batch.length;
  }

  const summary = {
    tokens: tokensCount,
    ok: ticketsAll.filter((t) => t.status === "ok").length,
    error: ticketsAll.filter((t) => t.status === "error").length,
  };
  return { summary, tickets: ticketsAll.slice(0, 50) }; // trả về tối đa 50 ticket để xem mẫu
}