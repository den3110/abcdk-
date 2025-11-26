// src/services/notificationHub.js
import Subscription from "../../models/subscriptionsModel.js";
import Registration from "../../models/registrationModel.js";
import Match from "../../models/matchModel.js";
import Tournament from "../../models/tournamentModel.js";
import NotificationLog from "../../models/notificationLogsModel.js";
import { asId } from "../../utils/ids.js";
import { sendToUserIds } from "./expoPush.js";
import mongoose from "mongoose";

/** ───────── Registry định nghĩa từng event ───────── */

export const EVENTS = {
  TOURNAMENT_COUNTDOWN: "TOURNAMENT_COUNTDOWN", // { phase: "D-3"|"D-2"|"D-1"|"D0" }
  TOURNAMENT_SCHEDULE_UPDATED: "TOURNAMENT_SCHEDULE_UPDATED",
  TOURNAMENT_CREATED: "TOURNAMENT_CREATED",

  MATCH_START_SOON: "MATCH_START_SOON",
  MATCH_RESULT_FINAL: "MATCH_RESULT_FINAL",
  MATCH_WENT_LIVE: "MATCH_WENT_LIVE",
  KYC_APPROVED: "KYC_APPROVED",
  KYC_REJECTED: "KYC_REJECTED",
  INVITE_SENT: "INVITE_SENT", // { inviteeUserId, inviterUserId, tournamentId? }
  INVITE_ACCEPTED: "INVITE_ACCEPTED",

  SYSTEM_BROADCAST: "SYSTEM_BROADCAST",
  RANK_MILESTONE: "RANK_MILESTONE", // lọt TOP xx
  RANK_MOVED: "RANK_MOVED", // tăng/giảm x bậc
  USER_DIRECT_BROADCAST: "USER_DIRECT_BROADCAST",
};

// xác định category để áp vào Subscription.categories (nếu bạn dùng)
export const CATEGORY = {
  COUNTDOWN: "countdown",
  SCHEDULE: "schedule",
  RESULT: "result",
  INVITE: "invite",
  SYSTEM: "system",
  STATUS: "status",
  KYC: "kyc",
  RANKING: "ranking",
};

// ── helper chung ─────────────────────────────────────────────────────────

function pickNameFromUser(u) {
  return u?.fullName || u?.name || u?.nickname || u?.displayName || null;
}
function pickNameFromRegPlayer(p) {
  // nếu Registration có sẵn displayName ở player1/player2 thì ưu tiên
  return p?.displayName || pickNameFromUser(p?.user) || null;
}
function formatTeam(reg) {
  if (!reg) return "";
  const n1 = pickNameFromRegPlayer(reg.player1) || "N/A";
  const n2 = pickNameFromRegPlayer(reg.player2);
  return n2 ? `${n1} & ${n2}` : n1;
}

async function getMatchParticipants(matchId) {
  const m = await Match.findById(matchId)
    .select("participants referee players teamA teamB pairA pairB")
    .populate({ path: "pairA", select: "player1.user player2.user" })
    .populate({ path: "pairB", select: "player1.user player2.user" })
    .lean();

  // 1) ưu tiên participants (đã là ObjectId theo schema)
  let users = normalizeUserIds(m?.participants || []);

  // 2) fallback: lấy từ pairA/pairB (player1.user / player2.user) và arrays legacy
  if (!users.length) {
    const fromPairs = [
      m?.pairA?.player1?.user,
      m?.pairA?.player2?.user,
      m?.pairB?.player1?.user,
      m?.pairB?.player2?.user,
    ];
    const fromArrays = [];
    if (Array.isArray(m?.players)) fromArrays.push(...m.players);
    if (Array.isArray(m?.teamA?.players)) fromArrays.push(...m.teamA.players);
    if (Array.isArray(m?.teamB?.players)) fromArrays.push(...m.teamB.players);

    users = normalizeUserIds(fromPairs.concat(fromArrays));
  }

  // 3) cộng thêm referee nếu có
  users = normalizeUserIds(users.concat(m?.referee || null));

  if (!users.length) {
    console.warn("[notify] audience empty for match", String(matchId), {
      hasParticipants:
        Array.isArray(m?.participants) && m.participants.length > 0,
      hasPairs: !!(m?.pairA || m?.pairB),
    });
  }
  return users;
}

const isValidObjIdString = (v) =>
  typeof v === "string" && mongoose.Types.ObjectId.isValid(v);
const extractIdString = (v) => {
  if (!v) return null;
  if (typeof v === "string" && mongoose.Types.ObjectId.isValid(v)) return v;
  // nếu là ObjectId hoặc document có _id
  if (v._id && mongoose.Types.ObjectId.isValid(String(v._id)))
    return String(v._id);
  // nếu là ObjectId raw
  if (mongoose.Types.ObjectId.isValid(String(v))) return String(v);
  return null;
};
const normalizeUserIds = (arr = []) =>
  Array.from(new Set(arr.map(extractIdString).filter(Boolean)));

// 1) Audience “ngầm định” theo event
const implicitAudienceResolvers = {
  async [EVENTS.TOURNAMENT_COUNTDOWN]({ tournamentId }) {
    const regs = await Registration.find({ tournament: asId(tournamentId) })
      .select("user players")
      .lean();
    const set = new Set();
    for (const r of regs) {
      if (r.user) set.add(String(r.user));
      (r.players || []).forEach((u) => u && set.add(String(u)));
    }
    return [...set];
  },

  async [EVENTS.TOURNAMENT_SCHEDULE_UPDATED]({ tournamentId }) {
    // participants + subscribers của tournament
    const set = new Set(
      await implicitAudienceResolvers[EVENTS.TOURNAMENT_COUNTDOWN]({
        tournamentId,
      })
    );
    const subs = await Subscription.find({
      topicType: "tournament",
      topicId: asId(tournamentId),
      muted: { $ne: true },
    })
      .select("user")
      .lean();
    subs.forEach((s) => set.add(String(s.user)));
    return [...set];
  },

  async [EVENTS.TOURNAMENT_CREATED]({ orgId }) {
    const subs = await Subscription.find({
      topicType: "org",
      topicId: asId(orgId),
      muted: { $ne: true },
    })
      .select("user")
      .lean();
    return subs.map((s) => String(s.user));
  },

  async [EVENTS.MATCH_START_SOON]({ matchId }) {
    return getMatchParticipants(matchId);
  },

  async [EVENTS.MATCH_RESULT_FINAL]({ matchId }) {
    // người tham gia trận + followers của tournament (tuỳ thích)
    const base = await implicitAudienceResolvers[EVENTS.MATCH_START_SOON]({
      matchId,
    });
    const m = await Match.findById(matchId).select("tournament").lean();
    if (!m?.tournament) return base;
    const subs = await Subscription.find({
      topicType: "tournament",
      topicId: asId(m.tournament),
      muted: { $ne: true },
    })
      .select("user")
      .lean();
    const set = new Set(base);
    subs.forEach((s) => set.add(String(s.user)));
    return [...set];
  },

  async [EVENTS.MATCH_WENT_LIVE]({ matchId }) {
    return getMatchParticipants(matchId);
  },

  async [EVENTS.INVITE_SENT]({ inviteeUserId }) {
    return [String(inviteeUserId)];
  },

  async [EVENTS.INVITE_ACCEPTED]({ inviterUserId }) {
    return [String(inviterUserId)];
  },

  async [EVENTS.SYSTEM_BROADCAST]() {
    // ai subscribe global (topicId = null)
    const subs = await Subscription.find({
      topicType: "global",
      topicId: null,
      muted: { $ne: true },
    })
      .select("user")
      .lean();
    return subs.map((s) => String(s.user));
  },

  // 🆕 gửi thẳng cho 1 user: audience chỉ gồm 1 user đó
  async [EVENTS.USER_DIRECT_BROADCAST]({ userId, topicId }) {
    // ưu tiên ctx.userId, fallback ctx.topicId (phòng trường hợp controller gửi topicId=userId)
    const id = extractIdString(userId || topicId);
    return id ? [id] : [];
  },

  // kyc

  async [EVENTS.KYC_APPROVED]({ userId }) {
    return [String(userId)];
  },
  async [EVENTS.KYC_REJECTED]({ userId }) {
    return [String(userId)];
  },

  // ranking
  async [EVENTS.RANK_MILESTONE]({ userId }) {
    return [String(userId)];
  },
  async [EVENTS.RANK_MOVED]({ userId }) {
    return [String(userId)];
  },
};

// 2) Render payload push theo event
const payloadBuilders = {
  async [EVENTS.TOURNAMENT_COUNTDOWN]({ tournamentId, phase }) {
    const t = await Tournament.findById(tournamentId)
      .select("name startAt timezone")
      .lean();
    return {
      title:
        phase === "D0"
          ? `Hôm nay khai mạc • ${t?.name || "Giải đấu"}`
          : `Còn ${phase.replace("D-", "")} ngày nữa • ${
              t?.name || "Giải đấu"
            }`,
      body:
        phase === "D0"
          ? "Tham gia ngay! Mở app để xem lịch & sân."
          : "Chuẩn bị sẵn sàng! Kiểm tra lịch và địa điểm trong app.",
      data: {
        url: `/tournament/${tournamentId}`,
        phase,
        kind: EVENTS.TOURNAMENT_COUNTDOWN,
      },
    };
  },
  async [EVENTS.TOURNAMENT_SCHEDULE_UPDATED]({ tournamentId }) {
    const t = await Tournament.findById(tournamentId).select("name").lean();
    return {
      title: "Lịch thi đấu cập nhật",
      body: t?.name
        ? `Giải ${t.name} vừa cập nhật lịch`
        : "Lịch thi đấu vừa cập nhật",
      data: {
        url: `/tournament/${tournamentId}/schedule`,
        kind: EVENTS.TOURNAMENT_SCHEDULE_UPDATED,
      },
    };
  },
  async [EVENTS.TOURNAMENT_CREATED]({ tournamentId }) {
    const t = await Tournament.findById(tournamentId).select("name").lean();
    return {
      title: "Có giải mới!",
      body: t?.name ? `Giải ${t.name} đã mở` : "Một giải đấu mới đã mở",
      data: {
        url: `/tournament/${tournamentId}`,
        kind: EVENTS.TOURNAMENT_CREATED,
      },
    };
  },
  async [EVENTS.MATCH_START_SOON]({ matchId, label, eta }) {
    return {
      title: "Trận sắp bắt đầu",
      body: label ? `${label} • ${eta || "15'"}` : "Chuẩn bị ra sân!",
      data: { url: `/match/${matchId}`, kind: EVENTS.MATCH_START_SOON },
    };
  },
  async [EVENTS.MATCH_RESULT_FINAL]({ matchId, label }) {
    return {
      title: "Kết quả trận đấu",
      body: label || "Trận đấu vừa kết thúc. Xem kết quả.",
      data: { url: `/match/${matchId}`, kind: EVENTS.MATCH_RESULT_FINAL },
    };
  },

  async [EVENTS.MATCH_WENT_LIVE]({ matchId, label }) {
    // Lấy pairA/pairB và tên VĐV
    const m = await Match.findById(matchId)
      .select("pairA pairB label")
      .populate({
        path: "pairA",
        select: "player1 player2",
        populate: [
          {
            path: "player1.user",
            select: "fullName name nickname displayName",
          },
          {
            path: "player2.user",
            select: "fullName name nickname displayName",
          },
        ],
      })
      .populate({
        path: "pairB",
        select: "player1 player2",
        populate: [
          {
            path: "player1.user",
            select: "fullName name nickname displayName",
          },
          {
            path: "player2.user",
            select: "fullName name nickname displayName",
          },
        ],
      })
      .lean();

    const teamA = formatTeam(m?.pairA);
    const teamB = formatTeam(m?.pairB);
    const vs = [teamA, teamB].filter(Boolean).join(" vs ");

    return {
      title: "Trận của bạn đã bắt đầu",
      body: vs
        ? `${vs} • Vào theo dõi diễn biến`
        : "Trận của bạn đã bắt đầu • Vào xem diễn biến ngay!",
      data: { url: `/match/${matchId}/home`, kind: EVENTS.MATCH_WENT_LIVE },
    };
  },

  async [EVENTS.INVITE_SENT]({ tournamentId }) {
    return {
      title: "Lời mời tham gia",
      body: "Bạn vừa nhận một lời mời tham gia giải.",
      data: {
        url: `/tournament/${tournamentId}/invites`,
        kind: EVENTS.INVITE_SENT,
      },
    };
  },
  async [EVENTS.INVITE_ACCEPTED]({ tournamentId }) {
    return {
      title: "Lời mời đã được chấp nhận",
      body: "Đồng đội đã accept. Vào app để xác nhận đăng ký.",
      data: {
        url: `/tournament/${tournamentId}/registrations`,
        kind: EVENTS.INVITE_ACCEPTED,
      },
    };
  },
  async [EVENTS.SYSTEM_BROADCAST]({ title, body, url }) {
    return {
      title: title || "Thông báo hệ thống",
      body: body || "Xem chi tiết trong app.",
      data: { url: url || "/", kind: EVENTS.SYSTEM_BROADCAST },
    };
  },

  // 🆕 payload cho notif gửi riêng 1 user
  async [EVENTS.USER_DIRECT_BROADCAST]({ title, body, url }) {
    return {
      title: title || "Thông báo",
      body: body || "Xem chi tiết trong app.",
      data: { url: url || "/", kind: EVENTS.USER_DIRECT_BROADCAST },
    };
  },

  // kyc

  async [EVENTS.KYC_APPROVED]({ userId }) {
    return {
      title: "CCCD của bạn đã được duyệt ✅",
      body: "Xác minh danh tính thành công. Bạn đã mở khóa đầy đủ tính năng.",
      data: { url: "/(tabs)/profile", kind: EVENTS.KYC_APPROVED, userId },
    };
  },
  async [EVENTS.KYC_REJECTED]({ userId, reason }) {
    return {
      title: "CCCD của bạn bị từ chối ❌",
      body: reason
        ? `Lý do: ${reason}`
        : "Vui lòng cập nhật lại thông tin CCCD.",
      data: { url: "/(tabs)/profile", kind: EVENTS.KYC_REJECTED, userId },
    };
  },

  async [EVENTS.RANK_MILESTONE]({ ladderLabel, newRank, threshold }) {
    const title = `Bạn vừa lọt TOP ${threshold}! 🎉`;
    const body = `${ladderLabel} • Hạng hiện tại: #${newRank}`;
    return {
      title,
      body,
      data: {
        url: "/(tabs)/rankings",
        kind: EVENTS.RANK_MILESTONE,
        rank: newRank,
        threshold,
        ladderLabel,
      },
    };
  },

  async [EVENTS.RANK_MOVED]({ ladderLabel, newRank, delta }) {
    const up = delta < 0; // delta = newRank - oldRank
    const steps = Math.abs(delta);
    const title = up
      ? `Thứ hạng tăng ${steps} bậc! ⬆️`
      : `Thứ hạng giảm ${steps} bậc ⬇️`;
    const body = `${ladderLabel} • Hạng hiện tại: #${newRank}`;
    return {
      title,
      body,
      data: {
        url: "/(tabs)/rankings",
        kind: EVENTS.RANK_MOVED,
        rank: newRank,
        delta,
        ladderLabel,
      },
    };
  },
};

// 3) Tạo eventKey thống nhất (để log idempotent)
function makeEventKey(eventName, ctx) {
  if (eventName === EVENTS.TOURNAMENT_COUNTDOWN)
    return `tournament.countdown:${ctx.phase}:tour#${ctx.tournamentId}`;
  if (eventName === EVENTS.TOURNAMENT_SCHEDULE_UPDATED)
    return `tournament.scheduleUpdated:tour#${ctx.tournamentId}`;
  if (eventName === EVENTS.TOURNAMENT_CREATED)
    return `tournament.created:tour#${ctx.tournamentId}`;
  if (eventName === EVENTS.MATCH_START_SOON)
    return `match.startSoon:match#${ctx.matchId}`;
  if (eventName === EVENTS.MATCH_RESULT_FINAL)
    return `match.resultFinal:match#${ctx.matchId}`;

  if (eventName === EVENTS.MATCH_WENT_LIVE)
    return `match.wentLive:match#${ctx.matchId}`;

  if (eventName === EVENTS.INVITE_SENT)
    return `invite.sent:tour#${ctx.tournamentId}:to#${ctx.inviteeUserId}`;
  if (eventName === EVENTS.INVITE_ACCEPTED)
    return `invite.accepted:tour#${ctx.tournamentId}:from#${ctx.inviterUserId}`;
  if (eventName === EVENTS.SYSTEM_BROADCAST)
    return `system.broadcast:${ctx.title || "general"}`;
  if (eventName === EVENTS.USER_DIRECT_BROADCAST)
    return `system.userBroadcast:user#${ctx.userId || ctx.topicId}:${
      ctx.title ? String(ctx.title).slice(0, 64) : "general"
    }`;

  // kyc
  if (eventName === EVENTS.KYC_APPROVED)
    return `kyc.approved:user#${ctx.userId}`;
  if (eventName === EVENTS.KYC_REJECTED)
    return `kyc.rejected:user#${ctx.userId}:${
      ctx.reason ? String(ctx.reason).slice(0, 64) : ""
    }`;

  if (eventName === EVENTS.RANK_MILESTONE) {
    // 1 user chỉ nhận 1 lần cho mỗi mốc/laddder
    return `rank.milestone:ladder#${ctx.ladderKey}:top#${ctx.threshold}:user#${ctx.userId}`;
  }
  if (eventName === EVENTS.RANK_MOVED) {
    // Chặn spam trong ngày: key theo (user, ladder, day-bucket)
    const day = ctx.day || new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `rank.moved:ladder#${ctx.ladderKey}:day#${day}:user#${ctx.userId}`;
  }
  return `${eventName}`;
}

// 4) Lọc theo Subscription (mute/categories). Chính sách:
// - Nếu user có Subscription(topicType/topicId) và muted=true -> loại.
// - Nếu Subscription có categories[] và ctx.category tồn tại nhưng không包含 -> loại.
// - Nếu không có Subscription: coi như opt-in (trừ khi bạn muốn mặc định opt-out).
async function filterBySubscription(users, { topicType, topicId, category }) {
  if (!users.length || !topicType) return users;
  const subs = await Subscription.find({
    user: { $in: users.map(asId) },
    topicType,
    topicId: topicId ?? null,
  })
    .select("user muted categories")
    .lean();

  const allow = new Set(users.map(String));
  for (const s of subs) {
    const uid = String(s.user);
    if (s.muted) {
      allow.delete(uid);
      continue;
    }
    if (Array.isArray(s.categories) && s.categories.length && category) {
      if (!s.categories.includes(category)) allow.delete(uid);
    }
  }
  return [...allow];
}

/** ───────── API chính: publish ───────── */
export async function publishNotification(eventName, ctx = {}, opts = {}) {
  const resolveAudience = implicitAudienceResolvers[eventName];
  const buildPayload = payloadBuilders[eventName];
  if (!resolveAudience || !buildPayload) {
    throw new Error(`Unsupported event: ${eventName}`);
  }

  // 1) Gom audience ngầm định + directUserIds (nếu có)
  const implicit = await resolveAudience(ctx);
  const pool = new Set(implicit.concat(ctx.directUserIds || []).map(String));
  let audience = [...pool];

  // 2) Lọc theo Subscription (nếu event có topicType/topicId)
  if (ctx.topicType && ctx.topicId !== undefined) {
    audience = await filterBySubscription(audience, {
      topicType: ctx.topicType,
      topicId: ctx.topicId,
      category: ctx.category,
    });
  }

  if (!audience.length) return { ok: true, audience: 0, sent: 0 };

  // 3) Idempotent: loại user đã nhận eventKey
  const eventKey = makeEventKey(eventName, ctx);
  const existing = await NotificationLog.find({
    user: { $in: audience.map(asId) },
    eventKey,
  })
    .select("user")
    .lean();
  const already = new Set(existing.map((x) => String(x.user)));
  const remain = audience.filter((u) => !already.has(u));
  if (!remain.length)
    return {
      ok: true,
      audience: audience.length,
      sent: 0,
      skipped: audience.length,
    };

  // 4) Build payload & gửi qua expo-server-sdk của bạn
  const payload = await buildPayload(ctx);
  const { tokens, ticketResults, receiptResults } = await sendToUserIds(
    remain,
    payload,
    opts
  );

  // 5) Ghi log idempotent (bulk upsert)
  const ops = remain.map((u) => ({
    updateOne: {
      filter: { user: asId(u), eventKey },
      update: {
        $setOnInsert: {
          user: asId(u),
          eventKey,
          meta: ctx,
          sentAt: new Date(),
        },
      },
      upsert: true,
    },
  }));
  if (ops.length) {
    try {
      await NotificationLog.bulkWrite(ops, { ordered: false });
    } catch (_) {}
  }

  return {
    ok: true,
    audience: audience.length,
    sentToNew: remain.length,
    tokensUsed: tokens,
    ticketsOk: ticketResults.filter((t) => t.ticket?.status === "ok").length,
    receiptsPacks: receiptResults.length,
  };
}
