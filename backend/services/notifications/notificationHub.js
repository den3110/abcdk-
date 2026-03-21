// src/services/notificationHub.js
import Subscription from "../../models/subscriptionsModel.js";
import Registration from "../../models/registrationModel.js";
import Match from "../../models/matchModel.js";
import Tournament from "../../models/tournamentModel.js";
import NotificationLog from "../../models/notificationLogsModel.js";
import { asId } from "../../utils/ids.js";
import { sendToUserIds } from "./expoPush.js";
import SupportTicket from "../../models/supportTicketModel.js"; // ✅ THÊM
import mongoose from "mongoose";
import SystemSettings from "../../models/systemSettingsModel.js";
import {
  buildPushDispatchTracker,
  createPushDispatch,
  markPushDispatchCompleted,
  markPushDispatchFailed,
  markPushDispatchRunning,
  markPushDispatchSkipped,
  updatePushDispatchProgress,
} from "../pushDispatchService.js";

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
  REGISTRATION_PAYMENT_PAID: "REGISTRATION_PAYMENT_PAID",
  GROUP_SLOT_ASSIGNED: "group_slot_assigned",
  // 🆕 chấm trình
  PLAYER_EVALUATED: "PLAYER_EVALUATED",
  MATCH_COURT_ASSIGNED: "MATCH_COURT_ASSIGNED",
  // 🆕 kết quả vòng bảng + qualify
  GROUP_STAGE_RESULT: "GROUP_STAGE_RESULT",
  GROUP_STAGE_NEXT_OPPONENT: "GROUP_STAGE_NEXT_OPPONENT",

  // 🆕 Trọng tài giải
  TOURNAMENT_REFEREE_ADDED: "TOURNAMENT_REFEREE_ADDED",
  TOURNAMENT_REFEREE_REMOVED: "TOURNAMENT_REFEREE_REMOVED",
  TOURNAMENT_OPEN_REG: "TOURNAMENT_OPEN_REG",

  // ✅ THÊM SUPPORT EVENTS
  SUPPORT_NEW_TICKET: "SUPPORT_NEW_TICKET", // User tạo ticket mới
  SUPPORT_STAFF_REPLIED: "SUPPORT_STAFF_REPLIED", // Staff reply vào ticket
  SUPPORT_TICKET_CLOSED: "SUPPORT_TICKET_CLOSED", // Ticket đã đóng
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
  SUPPORT: "support", // ✅ THÊM
};

// ── helper chung ─────────────────────────────────────────────────────────

function pickNameFromUser(u) {
  return u?.nickname || u?.name || u?.fullName || u?.displayName || null;
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

function formatRegistrationPair(reg) {
  if (!reg) return "";
  const n1 = reg.player1?.nickName || reg.player1?.fullName || "VĐV 1";
  const n2 = reg.player2?.nickName || reg.player2?.fullName || null;
  return n2 ? `${n1} & ${n2}` : n1;
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

  async [EVENTS.REGISTRATION_PAYMENT_PAID]({
    registrationId,
    overrideAudience,
  }) {
    if (!registrationId) return [];

    // Nếu controller truyền overrideAudience (ví dụ: chỉ gửi cho createdBy)
    if (Array.isArray(overrideAudience) && overrideAudience.length) {
      return overrideAudience.map((id) => String(id));
    }

    // Mặc định: chỉ gửi cho VĐV (player1 + player2)
    const reg = await Registration.findById(registrationId)
      .select("player1.user player2.user")
      .lean();
    if (!reg) return [];

    const ids = [];
    if (reg.player1?.user) ids.push(String(reg.player1.user));
    if (reg.player2?.user) ids.push(String(reg.player2.user));

    return Array.from(new Set(ids));
  },

  async [EVENTS.GROUP_SLOT_ASSIGNED]({ registrationId, overrideAudience }) {
    // Nếu controller đã truyền sẵn userIds thì dùng luôn, khỏi query DB nữa
    if (Array.isArray(overrideAudience) && overrideAudience.length) {
      return overrideAudience.map((id) => String(id));
    }

    if (!registrationId) return [];

    const reg = await Registration.findById(registrationId)
      .select("player1.user player2.user")
      .lean();
    if (!reg) return [];

    const ids = [];
    if (reg.player1?.user) ids.push(String(reg.player1.user));
    if (reg.player2?.user) ids.push(String(reg.player2.user));

    return Array.from(new Set(ids));
  },

  async [EVENTS.PLAYER_EVALUATED]({ targetUserId, userId, overrideAudience }) {
    // Nếu controller truyền sẵn audience thì ưu tiên dùng
    if (Array.isArray(overrideAudience) && overrideAudience.length) {
      return overrideAudience.map((id) => String(id));
    }

    const id = extractIdString(targetUserId || userId);
    return id ? [id] : [];
  },

  async [EVENTS.MATCH_COURT_ASSIGNED]({ matchId, overrideAudience }) {
    // Nếu controller truyền sẵn danh sách userIds thì dùng luôn
    if (Array.isArray(overrideAudience) && overrideAudience.length) {
      return overrideAudience.map((id) => String(id));
    }

    // Còn không thì fallback: lấy participants từ match (pairA/pairB/referee...)
    if (!matchId) return [];
    return getMatchParticipants(matchId);
  },
  // 🆕 GROUP_STAGE_RESULT: luôn dùng overrideAudience (danh sách userId)
  async [EVENTS.GROUP_STAGE_RESULT]({ overrideAudience }) {
    if (Array.isArray(overrideAudience) && overrideAudience.length) {
      return overrideAudience.map((id) => String(id));
    }
    return [];
  },
  async [EVENTS.GROUP_STAGE_NEXT_OPPONENT]({
    registrationId,
    overrideAudience,
  }) {
    if (Array.isArray(overrideAudience) && overrideAudience.length) {
      return overrideAudience.map((id) => String(id));
    }

    if (!registrationId) return [];

    const reg = await Registration.findById(registrationId)
      .select("player1.user player2.user")
      .lean();
    if (!reg) return [];

    const ids = [];
    if (reg.player1?.user) ids.push(String(reg.player1.user));
    if (reg.player2?.user) ids.push(String(reg.player2.user));

    return [...new Set(ids)];
  },

  async [EVENTS.TOURNAMENT_REFEREE_ADDED]() {
    // Audience sẽ lấy từ ctx.directUserIds, nên trả [] là được
    return [];
  },

  async [EVENTS.TOURNAMENT_REFEREE_REMOVED]() {
    return [];
  },

  // ✅ THÊM SUPPORT AUDIENCE RESOLVERS
  async [EVENTS.SUPPORT_NEW_TICKET]({ ticketId, overrideAudience }) {
    // Nếu controller truyền sẵn danh sách admin IDs
    if (Array.isArray(overrideAudience) && overrideAudience.length) {
      return overrideAudience.map((id) => String(id));
    }

    // Fallback: lấy từ ticket.user (owner)
    if (!ticketId) return [];

    try {
      const ticket = await SupportTicket.findById(ticketId)
        .select("user")
        .lean();

      return ticket?.user ? [String(ticket.user)] : [];
    } catch (e) {
      console.error("[audience] SUPPORT_NEW_TICKET error:", e?.message);
      return [];
    }
  },

  async [EVENTS.SUPPORT_STAFF_REPLIED]({ ticketId }) {
    // Gửi cho user owner của ticket
    if (!ticketId) return [];

    try {
      const ticket = await SupportTicket.findById(ticketId)
        .select("user")
        .lean();

      return ticket?.user ? [String(ticket.user)] : [];
    } catch (e) {
      console.error("[audience] SUPPORT_STAFF_REPLIED error:", e?.message);
      return [];
    }
  },

  async [EVENTS.SUPPORT_TICKET_CLOSED]({ ticketId }) {
    // Gửi cho user owner của ticket
    if (!ticketId) return [];

    try {
      const ticket = await SupportTicket.findById(ticketId)
        .select("user")
        .lean();

      return ticket?.user ? [String(ticket.user)] : [];
    } catch (e) {
      console.error("[audience] SUPPORT_TICKET_CLOSED error:", e?.message);
      return [];
    }
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

  async [EVENTS.INVITE_SENT]({
    tournamentId,
    inviterNickname,
    registrationCode,
  }) {
    let tourName = "giải đấu";

    if (tournamentId) {
      try {
        const t = await Tournament.findById(tournamentId).select("name").lean();
        if (t?.name) tourName = t.name;
      } catch (_) {
        // ignore, fallback tourName = "giải đấu"
      }
    }

    let body;

    if (inviterNickname && registrationCode != null) {
      body = `Bạn được ${inviterNickname} mời tham gia cùng với họ tại giải ${tourName}. Mã đăng ký: #${registrationCode}.`;
    } else if (inviterNickname) {
      body = `Bạn được ${inviterNickname} mời tham gia giải ${tourName}.`;
    } else if (registrationCode != null) {
      body = `Bạn vừa nhận một lời mời tham gia giải ${tourName}. Mã đăng ký: #${registrationCode}.`;
    } else if (tournamentId) {
      body = `Bạn vừa nhận một lời mời tham gia giải ${tourName}.`;
    } else {
      body = "Bạn vừa nhận một lời mời tham gia giải.";
    }
    return {
      title: "Lời mời tham gia",
      body,
      data: {
        url: tournamentId
          ? `/tournament/${tournamentId}/register`
          : "/(tabs)/tournaments",
        kind: EVENTS.INVITE_SENT,
        registrationCode,
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
  // 🆕 Thanh toán đăng ký thành công
  async [EVENTS.REGISTRATION_PAYMENT_PAID]({
    registrationId,
    tournamentId,
    isCreator,
  }) {
    const reg = await Registration.findById(registrationId)
      .select("code tournament player1 player2")
      .lean();

    const tourId = tournamentId || reg?.tournament;
    let tourName = "";
    if (tourId) {
      const t = await Tournament.findById(tourId).select("name").lean();
      tourName = t?.name || "";
    }

    const pairLabel = reg ? formatRegistrationPair(reg) : "";

    let title;
    let body;

    if (isCreator) {
      // 👤 Người tạo (organizer / admin tạo hộ) – đã có chữ "thanh toán"
      title = "Đã xác nhận thanh toán đăng ký ✅";

      if (tourName && reg?.code != null) {
        body = `Đã xác nhận thanh toán cho mã đăng ký #${reg.code}${
          pairLabel ? ` (${pairLabel})` : ""
        } tại giải ${tourName}.`;
      } else if (tourName && pairLabel) {
        body = `Đã xác nhận thanh toán cho cặp ${pairLabel} tại giải ${tourName}.`;
      } else if (tourName) {
        body = `Đã xác nhận thanh toán đăng ký tại giải ${tourName}.`;
      } else if (pairLabel) {
        body = `Đã xác nhận thanh toán cho cặp ${pairLabel}.`;
      } else {
        body = "Đơn đăng ký đã được xác nhận thanh toán.";
      }
    } else {
      // 🎾 VĐV: câu chữ phải rõ là "thanh toán phí đăng ký"
      title = "Thanh toán phí đăng ký thành công ✅";

      if (tourName && reg?.code != null) {
        body = `Bạn đã được xác nhận thanh toán thành công phí đăng ký giải ${tourName} với mã #${
          reg.code
        }${pairLabel ? ` cho cặp ${pairLabel}` : ""}.`;
      } else if (tourName) {
        body = `Bạn đã được xác nhận thanh toán thành công phí đăng ký giải ${tourName}${
          pairLabel ? ` cho cặp ${pairLabel}` : ""
        }.`;
      } else if (pairLabel) {
        body = `Bạn đã được xác nhận thanh toán thành công phí đăng ký cho cặp ${pairLabel}.`;
      } else {
        body = "Thanh toán phí đăng ký của bạn đã được xác nhận.";
      }
    }

    return {
      title,
      body,
      data: {
        kind: EVENTS.REGISTRATION_PAYMENT_PAID,
        registrationId: String(registrationId),
        tournamentId: tourId ? String(tourId) : undefined,
        url: tourId ? `/tournament/${tourId}/register` : "/(tabs)/tournaments",
        pairLabel,
        isCreator: !!isCreator,
      },
    };
  },
  async [EVENTS.GROUP_SLOT_ASSIGNED]({
    tournamentId,
    registrationId,
    groupId,
    groupName,
    slotIndex,
  }) {
    const [reg, tour] = await Promise.all([
      registrationId
        ? Registration.findById(registrationId)
            .select("code player1 player2")
            .lean()
        : null,
      tournamentId
        ? Tournament.findById(tournamentId).select("name").lean()
        : null,
    ]);

    const tourName = tour?.name || "Giải đấu";
    const pairLabel = reg ? formatRegistrationPair(reg) : "";

    const groupLabel = groupName || "bảng đấu";
    const slotNum =
      typeof slotIndex === "number" && slotIndex > 0 ? slotIndex : null;

    let body = `Bạn đã được xếp vào ${groupLabel}`;
    if (slotNum) body += ` ở vị trí số ${slotNum}`;
    body += ".";
    if (tourName) body += ` • ${tourName}`;
    if (pairLabel) body += ` • ${pairLabel}`;

    return {
      title: "Bạn đã được xếp vào bảng đấu",
      body,
      data: {
        kind: EVENTS.GROUP_SLOT_ASSIGNED,
        tournamentId: tournamentId ? String(tournamentId) : undefined,
        registrationId: registrationId ? String(registrationId) : undefined,
        groupId: groupId ? String(groupId) : undefined,
        groupName: groupName || undefined,
        slotIndex: slotNum || undefined,
        // App có thể đọc groupId/slotIndex để deeplink chi tiết
        url: tournamentId
          ? `/tournament/${tournamentId}/bracket`
          : "/(tabs)/tournaments",
      },
    };
  },

  async [EVENTS.PLAYER_EVALUATED]({
    targetUserId,
    singles,
    doubles,
    scorerName,
  }) {
    const stats = [];
    if (typeof singles === "number") stats.push(`Đơn: ${singles}`);
    if (typeof doubles === "number") stats.push(`Đôi: ${doubles}`);

    let body;
    if (stats.length && scorerName) {
      body = `${stats.join(" • ")} • Do Mod Pickletour chấm.`;
    } else if (stats.length) {
      body = `${stats.join(" • ")} • Trình độ của bạn vừa được cập nhật.`;
    } else if (scorerName) {
      body = `Trình độ của bạn vừa được Mod Pickletour chấm lại.`;
    } else {
      body = "Trình độ của bạn vừa được cập nhật.";
    }

    return {
      title: "Trình độ của bạn vừa được chấm",
      body,
      data: {
        kind: EVENTS.PLAYER_EVALUATED,
        targetUserId: targetUserId ? String(targetUserId) : undefined,
        singles,
        doubles,
        // tuỳ app, mình cho về tab ranking
        url: "/(tabs)/rankings",
      },
    };
  },
  async [EVENTS.MATCH_COURT_ASSIGNED]({
    matchId,
    tournamentId,
    courtLabel,
    tournamentName,
    teamAName,
    teamBName,
    displayCode,
  }) {
    const tourName = tournamentName || "giải đấu";
    const courtName = courtLabel || "sân thi đấu";
    const a = teamAName || "Đội A";
    const b = teamBName || "Đội B";
    const codePart = displayCode ? ` (Mã trận ${displayCode})` : "";

    const body = `Trận của bạn chuẩn bị bắt đầu tại ${courtName}, giải ${tourName}.${codePart} Trận giữa ${a} vs ${b}.`;

    return {
      title: "Trận đấu sắp bắt đầu",
      body,
      data: {
        kind: EVENTS.MATCH_COURT_ASSIGNED,
        matchId,
        tournamentId,
        courtLabel: courtName,
        displayCode,
        url: matchId
          ? `/tournament/${tournamentId}/matches/${matchId}`
          : `/tournament/${tournamentId}`,
      },
    };
  },
  async [EVENTS.GROUP_STAGE_RESULT](ctx) {
    const { bracketId, groupId, groupName, rank, totalTeams, qualified } = ctx;

    const tournamentId = extractIdString(ctx.tournamentId);
    let tourName = "Giải đấu";

    if (tournamentId) {
      try {
        const t = await Tournament.findById(tournamentId).select("name").lean();
        if (t?.name) tourName = t.name;
      } catch (e) {
        console.error(
          "[payload][GROUP_STAGE_RESULT] invalid tournamentId:",
          ctx.tournamentId,
          e?.message || e
        );
      }
    }

    const gLabel = groupName || "bảng đấu";

    let placeText = `hạng ${rank}`;
    if (rank === 1) placeText = "nhất";
    else if (rank === 2) placeText = "nhì";
    else if (rank === 3) placeText = "ba";

    const qualifyText = qualified
      ? "ĐỦ ĐIỀU KIỆN đi tiếp ✅"
      : "KHÔNG đủ điều kiện đi tiếp";

    const bodyParts = [];
    bodyParts.push(`Bạn đứng ${placeText} tại ${gLabel}`);
    if (Number.isFinite(totalTeams) && totalTeams > 0) {
      // bodyParts.push(`(trong ${totalTeams} đội)`);
    }
    bodyParts.push(`• ${qualifyText}`);
    bodyParts.push(`• ${tourName}`);

    return {
      title: `Kết quả bảng ${gLabel}`,
      body: bodyParts.join(" "),
      data: {
        kind: EVENTS.GROUP_STAGE_RESULT,
        tournamentId: tournamentId || undefined,
        bracketId: bracketId ? String(bracketId) : undefined,
        groupId: groupId ? String(groupId) : undefined,
        rank,
        totalTeams,
        qualified,
        url: tournamentId
          ? `/tournament/${tournamentId}/bracket`
          : "/(tabs)/tournaments",
      },
    };
  },

  async [EVENTS.GROUP_STAGE_NEXT_OPPONENT](ctx) {
    const {
      bracketId,
      groupName,
      nextBracketName,
      opponentName,
      hasBye,
      nextMatchId,
    } = ctx;

    const tournamentId = extractIdString(ctx.tournamentId);

    let tourName = "Giải đấu";
    if (tournamentId) {
      try {
        const t = await Tournament.findById(tournamentId).select("name").lean();
        if (t?.name) tourName = t.name;
      } catch (e) {
        console.error(
          "[payload][GROUP_STAGE_NEXT_OPPONENT] invalid tournamentId:",
          ctx.tournamentId,
          e?.message || e
        );
      }
    }

    const groupLabel = groupName || "bảng đấu";
    const stageLabel = nextBracketName || "vòng tiếp theo";

    let body;
    if (hasBye) {
      body = `Bạn đã vượt qua ${groupLabel} tại ${tourName} và được miễn trận đầu ở ${stageLabel}.`;
    } else if (opponentName) {
      body = `Bạn đã vượt qua ${groupLabel} tại ${tourName}. Đối thủ kế tiếp của bạn ở ${stageLabel} là ${opponentName}.`;
    } else {
      body = `Bạn đã vượt qua ${groupLabel} tại ${tourName}. Đối thủ vòng sau sẽ được cập nhật khi sơ đồ hoàn tất.`;
    }

    return {
      title: "Đối thủ vòng tiếp theo của bạn",
      body,
      data: {
        kind: EVENTS.GROUP_STAGE_NEXT_OPPONENT,
        tournamentId: tournamentId || undefined,
        bracketId: bracketId ? String(bracketId) : undefined,
        opponentName: opponentName || undefined,
        hasBye: !!hasBye,
        url: nextMatchId
          ? `/match/${nextMatchId}/home`
          : tournamentId
          ? `/tournament/${tournamentId}/bracket`
          : "/(tabs)/tournaments",
      },
    };
  },

  async [EVENTS.TOURNAMENT_REFEREE_ADDED]({ tournamentId }) {
    const tid = extractIdString(tournamentId);
    const t = tid ? await Tournament.findById(tid).select("name").lean() : null;

    const name = t?.name || "giải đấu";

    return {
      title: "Bạn vừa được thêm làm trọng tài",
      body: `Bạn vừa được thêm làm trọng tài cho giải ${name}.`,
      data: {
        kind: EVENTS.TOURNAMENT_REFEREE_ADDED,
        tournamentId: tid || undefined,
        url: tid ? `/tournament/${tid}/schedule` : "/(tabs)/tournaments",
      },
    };
  },

  async [EVENTS.TOURNAMENT_REFEREE_REMOVED]({ tournamentId }) {
    const tid = extractIdString(tournamentId);
    const t = tid ? await Tournament.findById(tid).select("name").lean() : null;

    const name = t?.name || "giải đấu";

    return {
      title: "Bạn vừa bị gỡ khỏi danh sách trọng tài",
      body: `Bạn vừa bị gỡ khỏi danh sách trọng tài của giải ${name}.`,
      data: {
        kind: EVENTS.TOURNAMENT_REFEREE_REMOVED,
        tournamentId: tid || undefined,
        url: tid ? `/tournament/${tid}/schedule` : "/(tabs)/tournaments",
      },
    };
  },

  async [EVENTS.TOURNAMENT_REFEREE_REMOVED]({ tournamentId }) {
    const tid = extractIdString(tournamentId);
    const t = tid ? await Tournament.findById(tid).select("name").lean() : null;

    const name = t?.name || "giải đấu";

    return {
      title: "Bạn vừa bị gỡ khỏi danh sách trọng tài",
      body: `Bạn vừa bị gỡ khỏi danh sách trọng tài của giải ${name}.`,
      data: {
        kind: EVENTS.TOURNAMENT_REFEREE_REMOVED,
        tournamentId: tid || undefined,
        url: tid ? `/tournament/${tid}/schedule` : "/(tabs)/tournaments",
      },
    };
  },

  // ✅ THÊM SUPPORT PAYLOAD BUILDERS
  async [EVENTS.SUPPORT_NEW_TICKET]({ ticketId, title, preview }) {
    const tid = extractIdString(ticketId);
    const ticketTitle = title || "Hỗ trợ / Góp ý";
    const previewText = preview || "Bạn có yêu cầu hỗ trợ mới";

    return {
      title: "📩 Yêu cầu hỗ trợ mới",
      body: `${ticketTitle} • ${previewText}`,
      data: {
        kind: EVENTS.SUPPORT_NEW_TICKET,
        ticketId: tid || undefined,
        url: tid ? `/support/${tid}` : "/support",
      },
    };
  },

  async [EVENTS.SUPPORT_STAFF_REPLIED]({ ticketId, title, preview }) {
    const tid = extractIdString(ticketId);
    const ticketTitle = title || "Hỗ trợ";
    const previewText = preview || "Bạn có phản hồi mới";

    return {
      title: "💬 Phản hồi từ Support", // ✅ Cố định
      body: `${ticketTitle} • ${previewText}`,
      data: {
        kind: EVENTS.SUPPORT_STAFF_REPLIED,
        ticketId: tid || undefined,
        url: tid ? `/support/${tid}` : "/support",
      },
    };
  },

  async [EVENTS.SUPPORT_TICKET_CLOSED]({ ticketId, title }) {
    const tid = extractIdString(ticketId);
    const ticketTitle = title || "Hỗ trợ";

    return {
      title: "✅ Yêu cầu hỗ trợ đã đóng",
      body: `${ticketTitle} • Yêu cầu của bạn đã được xử lý xong.`,
      data: {
        kind: EVENTS.SUPPORT_TICKET_CLOSED,
        ticketId: tid || undefined,
        url: tid ? `/support/${tid}` : "/support",
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

  // 🆕 không spam cùng 1 registration: 1 lần Paid = 1 log
  if (eventName === EVENTS.REGISTRATION_PAYMENT_PAID)
    return `registration.paymentPaid:reg#${ctx.registrationId}`;

  if (eventName === EVENTS.GROUP_SLOT_ASSIGNED)
    return `group.slotAssigned:tour#${ctx.tournamentId}:reg#${ctx.registrationId}:group#${ctx.groupId}`;

  if (eventName === EVENTS.PLAYER_EVALUATED)
    return `evaluation.submitted:eval#${ctx.evaluationId}:target#${ctx.targetUserId}`;

  if (eventName === EVENTS.MATCH_COURT_ASSIGNED) {
    return `match.courtAssigned:match#${ctx.matchId}:court#${
      ctx.courtLabel || ""
    }:${Date.now()}`;
  }

  if (eventName === EVENTS.GROUP_STAGE_RESULT)
    return `group.stageResult:tour#${ctx.tournamentId}:br#${ctx.bracketId}:group#${ctx.groupId}:reg#${ctx.registrationId}`;

  if (eventName === EVENTS.GROUP_STAGE_NEXT_OPPONENT)
    return `group.nextOpponent:match#${ctx.nextMatchId || ctx.matchId}:reg#${
      ctx.registrationId
    }`;

  if (eventName === EVENTS.TOURNAMENT_REFEREE_ADDED) {
    const day = ctx.day || new Date().toISOString(); // YYYY-MM-DD
    return `tournament.refereeAdded:tour#${ctx.tournamentId || ""}:day#${day}`;
  }

  if (eventName === EVENTS.TOURNAMENT_REFEREE_REMOVED) {
    const day = ctx.day || new Date().toISOString(); // YYYY-MM-DD

    return `tournament.refereeRemoved:tour#${
      ctx.tournamentId || ""
    }:day#${day}`;
  }

  // ✅ THÊM SUPPORT EVENT KEYS
  if (eventName === EVENTS.SUPPORT_NEW_TICKET) {
    // Mỗi ticket chỉ notify 1 lần khi tạo
    return `support.newTicket:ticket#${ctx.ticketId}`;
  }

  if (eventName === EVENTS.SUPPORT_STAFF_REPLIED) {
    // Mỗi message chỉ notify 1 lần
    return `support.staffReplied:ticket#${ctx.ticketId}:msg#${
      ctx.messageId || Date.now()
    }`;
  }

  if (eventName === EVENTS.SUPPORT_TICKET_CLOSED) {
    // Mỗi ticket chỉ notify 1 lần khi đóng
    return `support.ticketClosed:ticket#${ctx.ticketId}`;
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
  let dispatchId = opts?.dispatchMeta?.dispatchId
    ? String(opts.dispatchMeta.dispatchId)
    : null;
  if (!resolveAudience || !buildPayload) {
    throw new Error(`Unsupported event: ${eventName}`);
  }

  const zeroSummary = {
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
  const payload = await buildPayload(ctx);
  const dispatchPayload = {
    ...payload,
    url: payload?.data?.url || ctx?.url || "",
    badge: opts?.badge,
    ttl: opts?.ttl,
  };
  const baseTarget = {
    scope: ctx?.scope || opts?.dispatchMeta?.scope || "",
    topicType: ctx?.topicType || "",
    topicId: ctx?.topicId ?? "",
    userId:
      ctx?.userId ||
      (ctx?.topicType === "user" ? ctx?.topicId : "") ||
      opts?.dispatchMeta?.userId ||
      "",
    filters: opts?.dispatchMeta?.filters || {},
    audienceCount: 0,
  };

  try {
    if (!dispatchId) {
      const dispatch = await createPushDispatch({
        sourceKind: opts?.dispatchMeta?.sourceKind || "system_event",
        eventName,
        triggeredBy: opts?.dispatchMeta?.triggeredBy || null,
        payload: dispatchPayload,
        target: baseTarget,
        context: ctx,
        status: "running",
        note: opts?.dispatchMeta?.note || "",
      });
      dispatchId = String(dispatch._id);
    } else {
      await markPushDispatchRunning(dispatchId, {
        triggeredBy: opts?.dispatchMeta?.triggeredBy,
        payload: dispatchPayload,
        target: baseTarget,
        context: ctx,
      });
    }

    const sys = await SystemSettings.findById("system").lean();
    if (sys?.notifications?.systemPushEnabled === false) {
      await markPushDispatchSkipped(dispatchId, {
        payload: dispatchPayload,
        target: baseTarget,
        context: ctx,
        summary: zeroSummary,
        note: "system_push_disabled",
      });
      return {
        ok: true,
        dispatchId,
        status: "skipped",
        reason: "system_push_disabled",
        audience: 0,
        sent: 0,
        summary: zeroSummary,
      };
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

    if (!audience.length) {
      await markPushDispatchSkipped(dispatchId, {
        payload: dispatchPayload,
        target: baseTarget,
        context: ctx,
        summary: zeroSummary,
        note: "empty_audience",
      });
      return {
        ok: true,
        dispatchId,
        status: "skipped",
        audience: 0,
        sent: 0,
        summary: zeroSummary,
      };
    }

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
  if (!remain.length) {
    await markPushDispatchSkipped(dispatchId, {
      payload: dispatchPayload,
      target: { ...baseTarget, audienceCount: audience.length },
      context: ctx,
      summary: zeroSummary,
      note: "all_audience_already_notified",
    });
    return {
      ok: true,
      dispatchId,
      status: "skipped",
      audience: audience.length,
      sent: 0,
      skipped: audience.length,
      summary: zeroSummary,
    };
  }

  // 4) Build payload & gửi qua expo-server-sdk của bạn
  await updatePushDispatchProgress(dispatchId, {
    target: { ...baseTarget, audienceCount: remain.length },
  });

  const tracker = buildPushDispatchTracker({
    dispatchId,
    onResolvedAudience: async ({ totalUsers, totalTokens } = {}) => {
      await updatePushDispatchProgress(dispatchId, {
        target: {
          ...baseTarget,
          audienceCount: Number(totalUsers || remain.length || 0),
        },
        progress: {
          totalTokens: Number(totalTokens || 0),
          processedTokens: 0,
          processedBatches: 0,
          totalBatches: Number(totalTokens || 0) > 0 ? 1 : 0,
        },
      });
    },
    onProgress: async ({ progress, summary, sampleFailures } = {}) => {
      await updatePushDispatchProgress(dispatchId, {
        progress,
        summary,
        sampleFailures,
        target: {
          ...baseTarget,
          audienceCount: remain.length,
        },
      });
    },
  });

  const { tokens, ticketResults, receiptResults, summary, sampleFailures } =
    await sendToUserIds(remain, payload, opts, { tracker });

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

  if (Number(summary?.tokens || 0) === 0) {
    await markPushDispatchSkipped(dispatchId, {
      payload: dispatchPayload,
      target: { ...baseTarget, audienceCount: remain.length },
      context: ctx,
      summary,
      sampleFailures,
      note: "no_active_tokens",
    });
    return {
      ok: true,
      dispatchId,
      status: "skipped",
      audience: audience.length,
      sentToNew: remain.length,
      tokensUsed: 0,
      ticketsOk: 0,
      receiptsPacks: 0,
      summary,
      sampleFailures,
    };
  }

  await markPushDispatchCompleted(dispatchId, {
    payload: dispatchPayload,
    target: { ...baseTarget, audienceCount: remain.length },
    context: ctx,
    summary,
    sampleFailures,
    progress: {
      totalTokens: Number(summary?.tokens || 0),
      processedTokens: Number(summary?.tokens || 0),
      processedBatches: 1,
      totalBatches: 1,
    },
  });

  return {
    ok: true,
    dispatchId,
    status: "completed",
    audience: audience.length,
    sentToNew: remain.length,
    tokensUsed: tokens,
    ticketsOk: ticketResults.filter((t) => t.ticket?.status === "ok").length,
    receiptsPacks: receiptResults.length,
    summary,
    sampleFailures,
  };
  } catch (error) {
    if (dispatchId) {
      await markPushDispatchFailed(dispatchId, {
        note: error?.message || "publish_notification_failed",
      });
    }
    throw error;
  }
}
