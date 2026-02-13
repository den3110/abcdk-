// services/bot/tools/dbTools.js
// Database query tools cho Agent

import mongoose from "mongoose";
import Tournament from "../../../models/tournamentModel.js";
import User from "../../../models/userModel.js";
import Registration from "../../../models/registrationModel.js";
import Match from "../../../models/matchModel.js";
import Bracket from "../../../models/bracketModel.js";
import Court from "../../../models/courtModel.js";
import RatingChange from "../../../models/ratingChangeModel.js";
import Assessment from "../../../models/assessmentModel.js";
import ReputationEvent from "../../../models/reputationEventModel.js";
import ScoreHistory from "../../../models/scoreHistoryModel.js";
import Ranking from "../../../models/rankingModel.js";
import Club from "../../../models/clubModel.js";
import ClubMember from "../../../models/clubMemberModel.js";
import ClubEvent from "../../../models/clubEventModel.js";
import NewsArticle from "../../../models/newsArticlesModel.js";
import { Sponsor } from "../../../models/sponsorModel.js";
import Evaluation from "../../../models/evaluationModel.js";
import LiveSession from "../../../models/liveSessionModel.js";
import ClubAnnouncement from "../../../models/clubAnnouncementModel.js";
import RegInvite from "../../../models/regInviteModel.js";
import SupportTicket from "../../../models/supportTicketModel.js";
import Subscription from "../../../models/subscriptionsModel.js";
import UserMatch from "../../../models/userMatchModel.js";
import Complaint from "../../../models/complaintModel.js";
import ClubPoll from "../../../models/clubPollModel.js";
import ClubPollVote from "../../../models/clubPollVoteModel.js";
import ClubJoinRequest from "../../../models/clubJoinRequestModel.js";
import TournamentManager from "../../../models/tournamentManagerModel.js";
import LiveRecording from "../../../models/liveRecordingModel.js";
import DrawSession from "../../../models/drawSessionModel.js";
import RadarIntent from "../../../models/radarIntentModel.js";
import RadarPresence from "../../../models/radarPresenceModel.js";
import UserLogin from "../../../models/userLoginModel.js";
import CmsBlock from "../../../models/cmsBlockModel.js";
import DeviceInstallation from "../../../models/deviceInstallationModel.js";
import { OTABundle } from "../../../models/otaBundleModel.js";
import Channel from "../../../models/channelModel.js";
import AppConfig from "../../../models/appConfigModel.js";
import ClubEventRsvp from "../../../models/clubEventRsvpModel.js";

// ─────────────────── helpers ───────────────────

function toObjectId(v) {
  if (!v) return null;
  if (typeof v === "string" && mongoose.Types.ObjectId.isValid(v))
    return new mongoose.Types.ObjectId(v);
  return v;
}

function calcAge(dob) {
  if (!dob) return null;
  const b = new Date(dob);
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const md = t.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && t.getDate() < b.getDate())) a--;
  return a;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Format player name as markdown link to profile (if user ID available)
function playerLink(player) {
  if (!player) return null;
  const name = player.user?.name || player.fullName || null;
  if (!name) return null;
  const uid = player.user?._id || player.user;
  if (uid && typeof uid === "object" && uid.toString) {
    return `[${name}](/user/${uid.toString()})`;
  }
  if (uid && typeof uid === "string") {
    return `[${name}](/user/${uid})`;
  }
  return name;
}

// Plain name (no link)
function playerName(player) {
  if (!player) return null;
  return player.user?.name || player.fullName || null;
}

// Combine pair into team label with links
function pairLabel(pair) {
  if (!pair) return "TBD";
  const p1 = playerLink(pair.player1) || "?";
  const p2 = playerLink(pair.player2);
  return p2 ? `${p1} & ${p2}` : p1;
}

// Plain pair label (no links)
function pairLabelPlain(pair) {
  if (!pair) return "TBD";
  const p1 = playerName(pair.player1) || "?";
  const p2 = playerName(pair.player2);
  return p2 ? `${p1} & ${p2}` : p1;
}

// ═══════════ MODEL + SELECT WHITELIST (bảo mật) ═══════════

const MODEL_MAP = {
  tournaments: Tournament,
  users: User,
  registrations: Registration,
  matches: Match,
  brackets: Bracket,
  courts: Court,
  ratingChanges: RatingChange,
  assessments: Assessment,
  reputationEvents: ReputationEvent,
  scoreHistories: ScoreHistory,
};

// Fields an toàn cho từng collection (KHÔNG cho phép query phone/email/cccd của user khác)
const SAFE_SELECT = {
  users: "name nickname gender dob province localRatings",
  tournaments:
    "name code status startDate endDate location eventType maxPairs registrationDeadline contentHtml",
  registrations:
    "code tournament player1.fullName player1.nickName player1.score player2.fullName player2.nickName player2.score payment.status checkinAt createdAt",
  matches:
    "tournament bracket court round order code status winner pairA pairB participants gameScores courtLabel scheduledAt startedAt finishedAt format branch stageIndex",
  brackets:
    "tournament name type stage order drawStatus matchesCount teamsCount meta",
  courts: "tournament name cluster bracket order isActive status currentMatch",
  ratingChanges:
    "user match tournament kind before after delta expected score createdAt",
  assessments:
    "user scorer singleLevel doubleLevel singleScore doubleScore note scoredAt",
  reputationEvents: "user type tournament amount createdAt",
  scoreHistories: "user scorer single double note scoredAt",
};

// ─────────────── TOOL IMPLEMENTATIONS ─────────────────

/**
 * Tìm giải đấu theo tên hoặc status
 */
export async function search_tournaments({ name, status, limit = 5 }) {
  const filter = {};
  if (name) filter.name = { $regex: escapeRegex(name), $options: "i" };
  if (status) filter.status = status;

  const docs = await Tournament.find(filter)
    .select("name code status startDate endDate location eventType maxPairs")
    .sort({ startDate: -1 })
    .limit(Number(limit))
    .lean();

  return {
    tournaments: docs,
    count: docs.length,
    hint: "Để xem chi tiết hoặc mở giải đấu, hãy gọi tool navigate(screen='...', tournamentId='_id_của_giải') hoặc get_tournament_details(tournamentId='...')",
  };
}

/**
 * Chi tiết 1 giải đấu
 */
export async function get_tournament_details({ tournamentId }) {
  const t = await Tournament.findById(toObjectId(tournamentId))
    .select(
      "name code status startDate endDate location eventType maxPairs registrationDeadline contentHtml",
    )
    .lean();

  if (!t) return { error: "Không tìm thấy giải đấu" };
  return t;
}

/**
 * Đếm số đội đăng ký trong 1 giải
 */
export async function count_registrations({ tournamentId }) {
  const count = await Registration.countDocuments({
    tournament: toObjectId(tournamentId),
  });
  return { count };
}

/**
 * Tìm VĐV theo tên (public info only - không trả phone/email)
 */
export async function search_users({ name, limit = 5, sortBy }) {
  if (!name) return { error: "Cần nhập tên để tìm" };

  // Build sort option
  const sortMap = {
    ratingDoubles: { "localRatings.doubles": -1 },
    ratingSingles: { "localRatings.singles": -1 },
    name: { name: 1 },
  };
  const sort = sortMap[sortBy] || {};

  const users = await User.find({
    name: { $regex: escapeRegex(name), $options: "i" },
    isDeleted: false,
  })
    .select("name nickname gender dob province localRatings")
    .sort(sort)
    .limit(Number(limit))
    .lean();

  return {
    users: users.map((u) => ({
      _id: u._id,
      name: u.name,
      nickname: u.nickname,
      gender: u.gender,
      age: calcAge(u.dob),
      province: u.province,
      ratingDoubles: u.localRatings?.doubles || 2.5,
      ratingSingles: u.localRatings?.singles || 2.5,
    })),
    count: users.length,
    sortedBy: sortBy || "default",
  };
}

/**
 * Thông tin cá nhân user hiện tại (full access - chỉ dùng cho chính user)
 */
export async function get_my_info(_params, context) {
  if (!context?.currentUserId) {
    return { error: "Bạn cần đăng nhập để xem thông tin này" };
  }

  const user = await User.findById(context.currentUserId)
    .select(
      "name nickname phone email dob gender province verified cccdStatus role localRatings",
    )
    .lean();

  if (!user) return { error: "Không tìm thấy tài khoản" };

  return {
    name: user.name,
    nickname: user.nickname,
    phone: user.phone,
    email: user.email,
    gender: user.gender,
    province: user.province,
    kycStatus: user.cccdStatus,
    verified: user.verified,
    ratingDoubles: user.localRatings?.doubles || 2.5,
    ratingSingles: user.localRatings?.singles || 2.5,
    matchesDoubles: user.localRatings?.matchesDoubles || 0,
    matchesSingles: user.localRatings?.matchesSingles || 0,
  };
}

/**
 * Xem thông tin trận đấu
 */
export async function get_match_info({ matchId }, context) {
  const id = matchId || context?.matchId;
  if (!id) return { error: "Cần matchId" };

  const match = await Match.findById(toObjectId(id))
    .select(
      "round order code status winner gameScores courtLabel startedAt finishedAt format branch",
    )
    .populate({
      path: "pairA",
      select: "player1 player2",
      populate: [
        { path: "player1.user", select: "name nickname" },
        { path: "player2.user", select: "name nickname" },
      ],
    })
    .populate({
      path: "pairB",
      select: "player1 player2",
      populate: [
        { path: "player1.user", select: "name nickname" },
        { path: "player2.user", select: "name nickname" },
      ],
    })
    .lean();

  if (!match) return { error: "Không tìm thấy trận đấu" };

  return {
    round: match.round,
    code: match.code,
    status: match.status,
    winner: match.winner,
    courtLabel: match.courtLabel,
    format: match.format,
    teamA: pairLabel(match.pairA),
    teamB: pairLabel(match.pairB),
    gameScores: match.gameScores,
    startedAt: match.startedAt,
    finishedAt: match.finishedAt,
  };
}

/**
 * Bảng xếp hạng — dùng cùng sort order với trang ranking V2
 * Sort mặc định: colorRank ASC → double DESC → single DESC → points DESC
 * Có thể chọn sortBy: single, double, mix, points, reputation
 */
export async function get_leaderboard({ limit = 10, sortBy }) {
  const safeLimit = Math.min(Number(limit) || 10, 30);

  // Build sort stage based on sortBy
  let sortStage;
  if (
    sortBy &&
    ["single", "double", "mix", "points", "reputation"].includes(sortBy)
  ) {
    sortStage = { [sortBy]: -1, colorRank: 1, updatedAt: -1, _id: 1 };
  } else {
    // Default sort: uses compound index ranking_sort_idx
    sortStage = {
      colorRank: 1,
      double: -1,
      single: -1,
      points: -1,
      updatedAt: -1,
      _id: 1,
    };
  }

  const list = await Ranking.aggregate([
    // Sort FIRST — uses index directly (no $addFields to invalidate it)
    { $sort: sortStage },
    // Limit BEFORE $lookup — only look up N users instead of entire collection
    { $limit: safeLimit * 2 },
    // Lookup user info (now only for limited set)
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "userInfo",
        pipeline: [
          { $match: { isDeleted: { $ne: true } } },
          { $project: { name: 1, nickname: 1, province: 1 } },
        ],
      },
    },
    { $addFields: { userInfo: { $arrayElemAt: ["$userInfo", 0] } } },
    // Filter out deleted users
    { $match: { userInfo: { $ne: null } } },
    // Final limit
    { $limit: safeLimit },
    {
      $project: {
        user: 1,
        name: "$userInfo.name",
        nickname: "$userInfo.nickname",
        province: "$userInfo.province",
        single: 1,
        double: 1,
        mix: 1,
        points: 1,
        reputation: 1,
        tierColor: 1,
      },
    },
  ]);

  return {
    sortedBy: sortBy || "default (colorRank → double → single → points)",
    players: list.map((u, i) => ({
      rank: i + 1,
      name: u.user ? `[${u.name}](/user/${u.user})` : u.name,
      nickname: u.nickname,
      province: u.province,
      single: u.single ?? 0,
      double: u.double ?? 0,
      mix: u.mix ?? 0,
      points: u.points ?? 0,
      reputation: u.reputation ?? 0,
      tierColor: u.tierColor ?? "grey",
    })),
    count: list.length,
  };
}

/**
 * Các giải user đã đăng ký
 */
export async function get_my_registrations({ limit = 5 }, context) {
  if (!context?.currentUserId) {
    return { error: "Cần đăng nhập" };
  }

  const regs = await Registration.find({
    $or: [
      { "player1.user": context.currentUserId },
      { "player2.user": context.currentUserId },
    ],
  })
    .populate("tournament", "name code status startDate location")
    .sort({ createdAt: -1 })
    .limit(Number(limit))
    .lean();

  return {
    registrations: regs.map((r) => ({
      code: r.code,
      tournament: r.tournament?.name,
      tournamentStatus: r.tournament?.status,
      startDate: r.tournament?.startDate,
      paymentStatus: r.payment?.status,
      checkedIn: !!r.checkinAt,
    })),
    count: regs.length,
  };
}

/**
 * Lịch sử thay đổi rating
 */
export async function get_my_rating_changes(
  { kind = "doubles", limit = 5 },
  context,
) {
  if (!context?.currentUserId) {
    return { error: "Cần đăng nhập" };
  }

  const changes = await RatingChange.find({
    user: context.currentUserId,
    kind,
  })
    .populate("tournament", "name code")
    .sort({ createdAt: -1 })
    .limit(Number(limit))
    .lean();

  return {
    changes: changes.map((c) => ({
      tournament: c.tournament?.name,
      before: c.before,
      after: c.after,
      delta: c.delta,
      result: c.score === 1 ? "Thắng" : "Thua",
      date: c.createdAt,
    })),
    count: changes.length,
  };
}

// ═══════════════════════════════════════════════════════════
// 🏆 GET TOURNAMENT MATCHES - Thống kê trận đấu trong giải
// ═══════════════════════════════════════════════════════════

/**
 * Lấy danh sách trận đấu của 1 giải, kèm thống kê
 */
export async function get_tournament_matches(
  { tournamentId, status, bracketId, limit = 20 },
  context,
) {
  const tid = tournamentId || context?.tournamentId;
  if (!tid) return { error: "Cần tournamentId" };

  const filter = { tournament: toObjectId(tid) };
  if (status) filter.status = status;
  if (bracketId) filter.bracket = toObjectId(bracketId);

  const matches = await Match.find(filter)
    .select(
      "round order code status winner gameScores startedAt finishedAt courtLabel bracket format branch scheduledAt",
    )
    .populate({
      path: "pairA",
      select: "player1 player2",
      populate: [
        { path: "player1.user", select: "name nickname" },
        { path: "player2.user", select: "name nickname" },
      ],
    })
    .populate({
      path: "pairB",
      select: "player1 player2",
      populate: [
        { path: "player1.user", select: "name nickname" },
        { path: "player2.user", select: "name nickname" },
      ],
    })
    .populate("bracket", "name eventType")
    .sort({ startedAt: -1, round: 1, order: 1 })
    .limit(Math.min(Number(limit) || 20, 30))
    .lean();

  const list = matches.map((m) => {
    // Tính thời gian trận
    let durationMin = null;
    if (m.startedAt) {
      const end = m.finishedAt || new Date();
      durationMin = Math.round((end - new Date(m.startedAt)) / 60000);
    }

    // Tính tổng điểm & chênh lệch
    let totalA = 0,
      totalB = 0;
    (m.gameScores || []).forEach((g) => {
      totalA += g.a;
      totalB += g.b;
    });
    const scoreDiff = Math.abs(totalA - totalB);

    return {
      code: m.code,
      round: m.round,
      status: m.status,
      teamA: pairLabel(m.pairA),
      teamB: pairLabel(m.pairB),
      scores: (m.gameScores || []).map((g) => `${g.a}-${g.b}`),
      totalScore: `${totalA}-${totalB}`,
      scoreDiff,
      winner: m.winner || null,
      court: m.courtLabel || null,
      bracket: m.bracket?.name || null,
      eventType: m.bracket?.eventType || null,
      durationMin,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt,
    };
  });

  // Aggregated stats
  const liveMatches = list.filter((m) => m.status === "live");
  const finishedMatches = list.filter((m) => m.status === "finished");
  const longestMatch = finishedMatches.reduce(
    (max, m) => (m.durationMin > (max?.durationMin || 0) ? m : max),
    null,
  );
  const biggestGapMatch = finishedMatches.reduce(
    (max, m) => (m.scoreDiff > (max?.scoreDiff || 0) ? m : max),
    null,
  );

  return {
    matches: list,
    total: list.length,
    stats: {
      live: liveMatches.length,
      finished: finishedMatches.length,
      scheduled: list.filter((m) =>
        ["scheduled", "queued", "assigned"].includes(m.status),
      ).length,
      longestMatch: longestMatch
        ? {
            code: longestMatch.code,
            teamA: longestMatch.teamA,
            teamB: longestMatch.teamB,
            durationMin: longestMatch.durationMin,
            totalScore: longestMatch.totalScore,
          }
        : null,
      biggestScoreGap: biggestGapMatch
        ? {
            code: biggestGapMatch.code,
            teamA: biggestGapMatch.teamA,
            teamB: biggestGapMatch.teamB,
            scoreDiff: biggestGapMatch.scoreDiff,
            totalScore: biggestGapMatch.totalScore,
          }
        : null,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 📋 GET TOURNAMENT BRACKETS - Danh sách bảng đấu
// ═══════════════════════════════════════════════════════════

export async function get_tournament_brackets({ tournamentId }, context) {
  const tid = tournamentId || context?.tournamentId;
  if (!tid) return { error: "Cần tournamentId" };

  const brackets = await Bracket.find({ tournament: toObjectId(tid) })
    .select(
      "name type stage order config.rules config.seeding.method config.roundRobin.groupSize config.swiss.rounds meta groups teamsCount noRankDelta",
    )
    .sort({ stage: 1, order: 1 })
    .lean();

  // Đếm matches cho từng bracket
  const bracketIds = brackets.map((b) => b._id);

  const matchCounts = await Match.aggregate([
    { $match: { bracket: { $in: bracketIds } } },
    {
      $group: {
        _id: { bracket: "$bracket", status: "$status" },
        count: { $sum: 1 },
      },
    },
  ]);

  // Build match stats per bracket
  const matchStatsByBracket = {};
  matchCounts.forEach((mc) => {
    const bid = String(mc._id.bracket);
    if (!matchStatsByBracket[bid]) matchStatsByBracket[bid] = {};
    matchStatsByBracket[bid][mc._id.status] = mc.count;
  });

  const list = brackets.map((b) => {
    const ms = matchStatsByBracket[String(b._id)] || {};

    // Đếm đội trong bảng từ groups.regIds
    let teamsInBracket = 0;
    const groupDetails = [];
    if (b.groups && b.groups.length > 0) {
      b.groups.forEach((g) => {
        const cnt = g.regIds?.length || 0;
        teamsInBracket += cnt;
        groupDetails.push({ name: g.name, teams: cnt });
      });
    }
    // Fallback: dùng teamsCount nếu groups rỗng
    if (teamsInBracket === 0 && b.teamsCount) teamsInBracket = b.teamsCount;

    return {
      _id: b._id,
      name: b.name,
      type: b.type,
      stage: b.stage,
      rules: b.config?.rules || null,
      seedingMethod: b.config?.seeding?.method || null,
      teamsCount: teamsInBracket,
      groups: groupDetails.length > 0 ? groupDetails : undefined,
      matchStats: {
        total: Object.values(ms).reduce((a, c) => a + c, 0),
        live: ms.live || 0,
        finished: ms.finished || 0,
        scheduled: (ms.scheduled || 0) + (ms.queued || 0) + (ms.assigned || 0),
      },
    };
  });

  return {
    brackets: list,
    total: list.length,
  };
}

// ═══════════════════════════════════════════════════════════
// 📝 GET TOURNAMENT REGISTRATIONS - Danh sách đội đăng ký
// ═══════════════════════════════════════════════════════════

export async function get_tournament_registrations(
  { tournamentId, bracketId, paymentStatus, hasCheckin, limit = 20 },
  context,
) {
  const tid = tournamentId || context?.tournamentId;
  if (!tid) return { error: "Cần tournamentId" };

  const filter = { tournament: toObjectId(tid) };

  // Nếu có bracketId → chỉ lấy đội trong bảng đó (từ groups.regIds)
  const bid = bracketId || context?.bracketId;
  let bracketName = null;
  if (bid) {
    const bracket = await Bracket.findById(toObjectId(bid))
      .select("name groups")
      .lean();
    if (bracket) {
      bracketName = bracket.name;
      const regIds = [];
      (bracket.groups || []).forEach((g) => {
        (g.regIds || []).forEach((rid) => regIds.push(rid));
      });
      if (regIds.length > 0) {
        filter._id = { $in: regIds };
      }
    }
  }

  if (paymentStatus) filter["payment.status"] = paymentStatus;
  if (hasCheckin === true) filter.checkinAt = { $ne: null };
  if (hasCheckin === false) filter.checkinAt = null;

  const regs = await Registration.find(filter)
    .select("code player1 player2 payment checkinAt createdAt")
    .populate("player1.user", "name nickname")
    .populate("player2.user", "name nickname")
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 20, 50))
    .lean();

  const totalCount = bid
    ? regs.length
    : await Registration.countDocuments({ tournament: toObjectId(tid) });

  const list = regs.map((r) => {
    const p1Link = playerLink(r.player1) || "?";
    const p2Link = playerLink(r.player2);
    return {
      code: r.code,
      team: p2Link ? `${p1Link} & ${p2Link}` : p1Link,
      player1: p1Link,
      player2: p2Link,
      payment: r.payment?.status || "Unpaid",
      checkedIn: !!r.checkinAt,
      registeredAt: r.createdAt,
    };
  });

  const paidCount = list.filter((r) => r.payment === "Paid").length;
  const checkedInCount = list.filter((r) => r.checkedIn).length;

  return {
    ...(bracketName ? { bracket: bracketName } : {}),
    registrations: list,
    showing: list.length,
    totalRegistrations: totalCount,
    stats: {
      paid: paidCount,
      unpaid: list.length - paidCount,
      checkedIn: checkedInCount,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 🏟️ GET TOURNAMENT COURTS - Sân đấu trong giải
// ═══════════════════════════════════════════════════════════

export async function get_tournament_courts({ tournamentId }, context) {
  const tid = tournamentId || context?.tournamentId;
  if (!tid) return { error: "Cần tournamentId" };

  const courts = await Court.find({ tournament: toObjectId(tid) })
    .select("name cluster order isActive status currentMatch")
    .populate({
      path: "currentMatch",
      select: "code status pairA pairB gameScores startedAt",
      populate: [
        {
          path: "pairA",
          select: "player1 player2",
          populate: [
            { path: "player1.user", select: "name" },
            { path: "player2.user", select: "name" },
          ],
        },
        {
          path: "pairB",
          select: "player1 player2",
          populate: [
            { path: "player1.user", select: "name" },
            { path: "player2.user", select: "name" },
          ],
        },
      ],
    })
    .sort({ cluster: 1, order: 1 })
    .lean();

  const list = courts.map((c) => {
    const cm = c.currentMatch;
    return {
      name: c.name,
      cluster: c.cluster,
      isActive: c.isActive,
      status: c.status,
      currentMatch: cm
        ? {
            code: cm.code,
            teamA: pairLabel(cm.pairA),
            teamB: pairLabel(cm.pairB),
            scores: (cm.gameScores || []).map((g) => `${g.a}-${g.b}`),
            startedAt: cm.startedAt,
          }
        : null,
    };
  });

  return {
    courts: list,
    total: list.length,
    stats: {
      idle: list.filter((c) => c.status === "idle").length,
      live: list.filter((c) => c.status === "live").length,
      assigned: list.filter((c) => c.status === "assigned").length,
      maintenance: list.filter((c) => c.status === "maintenance").length,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 🏅 SEARCH CLUBS - Tìm câu lạc bộ
// ═══════════════════════════════════════════════════════════

export async function search_clubs({ name, province, limit = 5 }) {
  const filter = { visibility: { $ne: "hidden" } };

  if (name) {
    filter.name = { $regex: escapeRegex(name), $options: "i" };
  }
  if (province) {
    filter.province = { $regex: escapeRegex(province), $options: "i" };
  }

  const clubs = await Club.find(filter)
    .select(
      "name slug province city description stats.memberCount joinPolicy sportTypes isVerified logoUrl",
    )
    .sort({ "stats.memberCount": -1 })
    .limit(Math.min(Number(limit) || 5, 20))
    .lean();

  return {
    clubs: clubs.map((c) => ({
      _id: c._id,
      name: c.name,
      slug: c.slug,
      province: c.province || null,
      city: c.city || null,
      description: c.description ? c.description.substring(0, 150) : null,
      memberCount: c.stats?.memberCount || 0,
      joinPolicy: c.joinPolicy,
      isVerified: c.isVerified,
    })),
    count: clubs.length,
  };
}

// ═══════════════════════════════════════════════════════════
// 📊 GET TOURNAMENT SUMMARY - Tổng quan giải đấu
// ═══════════════════════════════════════════════════════════

export async function get_tournament_summary({ tournamentId }, context) {
  const tid = tournamentId || context?.tournamentId;
  if (!tid) return { error: "Cần tournamentId" };

  const tournament = await Tournament.findById(toObjectId(tid))
    .select(
      "name code status startDate endDate location eventType maxPairs registrationDeadline timezone contentHtml image",
    )
    .lean();

  if (!tournament) return { error: "Không tìm thấy giải đấu" };

  const [brackets, regCount, matchStats, courtStats] = await Promise.all([
    Bracket.find({ tournament: toObjectId(tid) })
      .select("name type eventType stage")
      .sort({ stage: 1, order: 1 })
      .lean(),
    Registration.countDocuments({ tournament: toObjectId(tid) }),
    Match.aggregate([
      { $match: { tournament: toObjectId(tid) } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),
    Court.aggregate([
      { $match: { tournament: toObjectId(tid) } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const ms = {};
  matchStats.forEach((m) => {
    ms[m._id] = m.count;
  });
  const totalMatches = Object.values(ms).reduce((a, c) => a + c, 0);

  const cs = {};
  courtStats.forEach((c) => {
    cs[c._id] = c.count;
  });
  const totalCourts = Object.values(cs).reduce((a, c) => a + c, 0);

  // Tính tiến độ
  const finishedMatches = ms.finished || 0;
  const progress =
    totalMatches > 0 ? Math.round((finishedMatches / totalMatches) * 100) : 0;

  return {
    tournament: {
      name: tournament.name,
      code: tournament.code,
      status: tournament.status,
      startDate: tournament.startDate,
      endDate: tournament.endDate,
      location: tournament.location,
      eventType: tournament.eventType,
      maxPairs: tournament.maxPairs,
      registrationDeadline: tournament.registrationDeadline,
    },
    brackets: brackets.map((b) => ({
      name: b.name,
      type: b.type,
      eventType: b.eventType,
    })),
    stats: {
      totalBrackets: brackets.length,
      totalRegistrations: regCount,
      totalMatches,
      matchesByStatus: {
        live: ms.live || 0,
        finished: finishedMatches,
        scheduled: (ms.scheduled || 0) + (ms.queued || 0) + (ms.assigned || 0),
      },
      totalCourts,
      courtsByStatus: {
        idle: cs.idle || 0,
        live: cs.live || 0,
        assigned: cs.assigned || 0,
      },
      progress: `${progress}%`,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 🏛️ GET CLUB DETAILS - Chi tiết câu lạc bộ
// ═══════════════════════════════════════════════════════════

export async function get_club_details({ clubId, slug }) {
  let club;
  if (clubId) {
    club = await Club.findById(toObjectId(clubId))
      .populate("owner", "name nickname")
      .lean();
  } else if (slug) {
    club = await Club.findOne({ slug })
      .populate("owner", "name nickname")
      .lean();
  } else {
    return { error: "Cần clubId hoặc slug" };
  }

  if (!club) return { error: "Không tìm thấy CLB" };

  return {
    _id: club._id,
    name: club.name,
    slug: club.slug,
    description: club.description || null,
    province: club.province || null,
    city: club.city || null,
    address: club.address || null,
    owner: club.owner?.name || "?",
    adminCount: club.admins?.length || 0,
    memberCount: club.stats?.memberCount || 0,
    tournamentWins: club.stats?.tournamentWins || 0,
    joinPolicy: club.joinPolicy,
    visibility: club.visibility,
    isVerified: club.isVerified,
    sportTypes: club.sportTypes || [],
    tags: club.tags || [],
    website: club.website || null,
    facebook: club.facebook || null,
    zalo: club.zalo || null,
    createdAt: club.createdAt,
  };
}

// ═══════════════════════════════════════════════════════════
// 📊 GET BRACKET STANDINGS - BXH trong bảng (group/round-robin)
// ═══════════════════════════════════════════════════════════

export async function get_bracket_standings({ bracketId, tournamentId }, ctx) {
  const bid = bracketId || ctx?.bracketId;
  if (!bid) return { error: "Cần bracketId" };

  const bracket = await Bracket.findById(toObjectId(bid))
    .select("name type tournament groups config.roundRobin config.swiss")
    .lean();
  if (!bracket) return { error: "Không tìm thấy bảng đấu" };

  if (bracket.type === "knockout") {
    return {
      message:
        "Bảng knockout → dùng get_tournament_standings thay vì get_bracket_standings.",
    };
  }

  // Get all finished matches in this bracket
  const matches = await Match.find({
    bracket: toObjectId(bid),
    status: "finished",
  })
    .select("pairA pairB winner gameScores")
    .lean();

  // Collect all regIds from bracket groups
  const allRegIds = new Set();
  (bracket.groups || []).forEach((g) => {
    (g.regIds || []).forEach((rid) => allRegIds.add(String(rid)));
  });

  // Build standings per team
  const stats = {};
  const initTeam = (id) => {
    if (!stats[id]) {
      stats[id] = {
        regId: id,
        wins: 0,
        losses: 0,
        setsWon: 0,
        setsLost: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      };
    }
  };

  const pointsWin =
    bracket.config?.roundRobin?.points?.win ??
    bracket.config?.swiss?.points?.win ??
    1;
  const pointsLoss =
    bracket.config?.roundRobin?.points?.loss ??
    bracket.config?.swiss?.points?.loss ??
    0;

  matches.forEach((m) => {
    const aId = m.pairA ? String(m.pairA) : null;
    const bId = m.pairB ? String(m.pairB) : null;
    if (!aId || !bId || !m.winner) return;

    initTeam(aId);
    initTeam(bId);

    // Sets counting
    let setsA = 0,
      setsB = 0;
    (m.gameScores || []).forEach((g) => {
      stats[aId].pointsFor += g.a || 0;
      stats[aId].pointsAgainst += g.b || 0;
      stats[bId].pointsFor += g.b || 0;
      stats[bId].pointsAgainst += g.a || 0;
      if ((g.a || 0) > (g.b || 0)) setsA++;
      else if ((g.b || 0) > (g.a || 0)) setsB++;
    });

    stats[aId].setsWon += setsA;
    stats[aId].setsLost += setsB;
    stats[bId].setsWon += setsB;
    stats[bId].setsLost += setsA;

    if (m.winner === "A") {
      stats[aId].wins++;
      stats[bId].losses++;
    } else {
      stats[bId].wins++;
      stats[aId].losses++;
    }
  });

  // Sort standings: points → sets diff → points diff
  const standings = Object.values(stats)
    .map((s) => ({
      ...s,
      matchPoints: s.wins * pointsWin + s.losses * pointsLoss,
      setsDiff: s.setsWon - s.setsLost,
      pointsDiff: s.pointsFor - s.pointsAgainst,
    }))
    .sort(
      (a, b) =>
        b.matchPoints - a.matchPoints ||
        b.setsDiff - a.setsDiff ||
        b.pointsDiff - a.pointsDiff,
    );

  // Populate team names
  const regIds = standings
    .map((s) => s.regId)
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  const regs = await Registration.find({ _id: { $in: regIds } })
    .select("player1 player2")
    .populate("player1.user", "name")
    .populate("player2.user", "name")
    .lean();

  const regMap = new Map(regs.map((r) => [String(r._id), r]));

  const result = standings.map((s, i) => {
    const reg = regMap.get(s.regId);
    const p1 = reg ? playerLink(reg.player1) : "?";
    const p2 = reg ? playerLink(reg.player2) : null;
    return {
      rank: i + 1,
      team: p2 ? `${p1} & ${p2}` : p1 || "?",
      wins: s.wins,
      losses: s.losses,
      matchPoints: s.matchPoints,
      setsDiff: s.setsDiff,
      pointsDiff: s.pointsDiff,
    };
  });

  return {
    bracket: bracket.name,
    type: bracket.type,
    standings: result,
    total: result.length,
  };
}

// ═══════════════════════════════════════════════════════════
// 🎯 GET USER MATCHES - Lịch sử trận đấu của VĐV
// ═══════════════════════════════════════════════════════════

export async function get_user_matches(
  { userId, tournamentId, status, limit = 10 },
  ctx,
) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  // Find registrations for this user
  const regFilter = {
    $or: [
      { "player1.user": toObjectId(uid) },
      { "player2.user": toObjectId(uid) },
    ],
  };
  if (tournamentId) regFilter.tournament = toObjectId(tournamentId);

  const userRegs = await Registration.find(regFilter).select("_id").lean();
  const regIds = userRegs.map((r) => r._id);

  if (!regIds.length)
    return { matches: [], total: 0, message: "Không tìm thấy đăng ký nào" };

  // Find matches where user's registration is pairA or pairB
  const matchFilter = {
    $or: [{ pairA: { $in: regIds } }, { pairB: { $in: regIds } }],
  };
  if (status) matchFilter.status = status;

  const matches = await Match.find(matchFilter)
    .select(
      "code tournament bracket status winner pairA pairB gameScores startedAt finishedAt round courtLabel",
    )
    .populate({
      path: "pairA",
      select: "player1 player2",
      populate: [
        { path: "player1.user", select: "name" },
        { path: "player2.user", select: "name" },
      ],
    })
    .populate({
      path: "pairB",
      select: "player1 player2",
      populate: [
        { path: "player1.user", select: "name" },
        { path: "player2.user", select: "name" },
      ],
    })
    .populate("tournament", "name")
    .sort({ startedAt: -1, createdAt: -1 })
    .limit(Math.min(Number(limit) || 10, 30))
    .lean();

  const regIdSet = new Set(regIds.map(String));

  const list = matches.map((m) => {
    const isTeamA = m.pairA && regIdSet.has(String(m.pairA._id || m.pairA));
    const myTeam = isTeamA ? pairLabel(m.pairA) : pairLabel(m.pairB);
    const opponent = isTeamA ? pairLabel(m.pairB) : pairLabel(m.pairA);

    let result = null;
    if (m.status === "finished" && m.winner) {
      const iWon =
        (isTeamA && m.winner === "A") || (!isTeamA && m.winner === "B");
      result = iWon ? "win" : "loss";
    }

    let durationMin = null;
    if (m.startedAt) {
      const end = m.finishedAt || new Date();
      durationMin = Math.round((end - new Date(m.startedAt)) / 60000);
    }

    return {
      code: m.code,
      tournament: m.tournament?.name || null,
      status: m.status,
      myTeam,
      opponent,
      result,
      scores: (m.gameScores || []).map((g) => `${g.a}-${g.b}`),
      durationMin,
      court: m.courtLabel || null,
      round: m.round,
      date: m.startedAt || m.finishedAt,
    };
  });

  const wins = list.filter((m) => m.result === "win").length;
  const losses = list.filter((m) => m.result === "loss").length;

  return {
    matches: list,
    total: list.length,
    stats: {
      wins,
      losses,
      winRate:
        list.length > 0
          ? `${Math.round((wins / (wins + losses || 1)) * 100)}%`
          : "N/A",
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 👥 GET CLUB MEMBERS - Thành viên CLB
// ═══════════════════════════════════════════════════════════

export async function get_club_members({ clubId, role, limit = 20 }) {
  if (!clubId) return { error: "Cần clubId" };

  const filter = { club: toObjectId(clubId), status: "active" };
  if (role) filter.role = role;

  const members = await ClubMember.find(filter)
    .populate("user", "name nickname avatar")
    .sort({ role: 1, joinedAt: 1 })
    .limit(Math.min(Number(limit) || 20, 50))
    .lean();

  const totalCount = await ClubMember.countDocuments({
    club: toObjectId(clubId),
    status: "active",
  });

  const list = members.map((m) => ({
    name: m.user?.name || m.user?.nickname || "?",
    role: m.role,
    joinedAt: m.joinedAt,
  }));

  const roleCounts = {};
  list.forEach((m) => {
    roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;
  });

  return {
    members: list,
    showing: list.length,
    totalMembers: totalCount,
    roleCounts,
  };
}

// ═══════════════════════════════════════════════════════════
// 📅 GET CLUB EVENTS - Sự kiện CLB
// ═══════════════════════════════════════════════════════════

export async function get_club_events({ clubId, upcoming = true, limit = 10 }) {
  if (!clubId) return { error: "Cần clubId" };

  const filter = { club: toObjectId(clubId) };
  const now = new Date();
  if (upcoming) {
    filter.endAt = { $gte: now };
  } else {
    filter.endAt = { $lt: now };
  }

  const events = await ClubEvent.find(filter)
    .select(
      "title description startAt endAt location attendeesCount capacity rsvp",
    )
    .sort({ startAt: upcoming ? 1 : -1 })
    .limit(Math.min(Number(limit) || 10, 20))
    .lean();

  const list = events.map((e) => ({
    title: e.title,
    description: e.description ? e.description.slice(0, 200) : null,
    startAt: e.startAt,
    endAt: e.endAt,
    location: e.location || null,
    attendees: e.attendeesCount || 0,
    capacity: e.capacity || "unlimited",
  }));

  return {
    events: list,
    total: list.length,
    type: upcoming ? "upcoming" : "past",
  };
}

// ═══════════════════════════════════════════════════════════
// 📰 SEARCH NEWS - Tin tức Pickleball
// ═══════════════════════════════════════════════════════════

export async function search_news({ keyword, tag, limit = 5 }) {
  const filter = { status: "published" };

  if (keyword) {
    filter.$or = [
      { title: { $regex: keyword, $options: "i" } },
      { summary: { $regex: keyword, $options: "i" } },
    ];
  }
  if (tag) {
    filter.tags = { $regex: tag, $options: "i" };
  }

  const articles = await NewsArticle.find(filter)
    .select("title summary sourceName tags originalPublishedAt slug")
    .sort({ originalPublishedAt: -1, createdAt: -1 })
    .limit(Math.min(Number(limit) || 5, 15))
    .lean();

  const list = articles.map((a) => ({
    title: a.title,
    summary: a.summary ? a.summary.slice(0, 200) : null,
    source: a.sourceName || null,
    tags: a.tags || [],
    publishedAt: a.originalPublishedAt || null,
    slug: a.slug,
  }));

  return {
    articles: list,
    total: list.length,
  };
}

// ═══════════════════════════════════════════════════════════
// 🤝 GET SPONSORS - Nhà tài trợ
// ═══════════════════════════════════════════════════════════

export async function get_sponsors({ tournamentId }, ctx) {
  const tid = tournamentId || ctx?.tournamentId;

  const filter = {};
  if (tid) {
    filter.tournaments = toObjectId(tid);
  }

  const sponsors = await Sponsor.find(filter)
    .select("name tier description websiteUrl featured")
    .sort({ weight: -1, createdAt: -1 })
    .lean();

  const list = sponsors.map((s) => ({
    name: s.name,
    tier: s.tier,
    description: s.description ? s.description.slice(0, 150) : null,
    website: s.websiteUrl || null,
    featured: s.featured,
  }));

  const tierCounts = {};
  list.forEach((s) => {
    tierCounts[s.tier] = (tierCounts[s.tier] || 0) + 1;
  });

  return {
    sponsors: list,
    total: list.length,
    ...(tid ? { forTournament: true } : { global: true }),
    tierCounts,
  };
}

// ═══════════════════════════════════════════════════════════
// 🎓 GET PLAYER EVALUATIONS - Kết quả chấm trình VĐV
// ═══════════════════════════════════════════════════════════

export async function get_player_evaluations({ userId }, ctx) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const evals = await Evaluation.find({
    targetUser: toObjectId(uid),
    status: { $in: ["submitted", "finalized"] },
  })
    .select("evaluator source overall items notes status createdAt")
    .populate("evaluator", "name")
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  if (!evals.length) {
    return { message: "Chưa có kết quả chấm trình nào", evaluations: [] };
  }

  const list = evals.map((e) => ({
    evaluator: e.evaluator?.name || "Không rõ",
    source: e.source,
    singles: e.overall?.singles || null,
    doubles: e.overall?.doubles || null,
    items: (e.items || []).map((item) => ({
      skill: item.key,
      score: item.score,
    })),
    notes: e.notes ? e.notes.slice(0, 200) : null,
    status: e.status,
    date: e.createdAt,
  }));

  // Latest overall
  const latest = evals[0];

  return {
    evaluations: list,
    total: list.length,
    latestOverall: {
      singles: latest.overall?.singles || null,
      doubles: latest.overall?.doubles || null,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 📺 GET LIVE STREAMS - Trực tiếp
// ═══════════════════════════════════════════════════════════

export async function get_live_streams({ status = "LIVE" }) {
  const filter = { status };

  const sessions = await LiveSession.find(filter)
    .select("provider status matchId permalinkUrl startedAt")
    .populate({
      path: "matchId",
      select: "code courtLabel tournament bracket",
      populate: [{ path: "tournament", select: "name" }],
    })
    .sort({ startedAt: -1 })
    .limit(20)
    .lean();

  const list = sessions.map((s) => ({
    provider: s.provider,
    status: s.status,
    link: s.permalinkUrl || null,
    startedAt: s.startedAt,
    match: s.matchId
      ? {
          code: s.matchId.code,
          court: s.matchId.courtLabel || null,
          tournament: s.matchId.tournament?.name || null,
        }
      : null,
  }));

  return {
    streams: list,
    total: list.length,
  };
}

// ═══════════════════════════════════════════════════════════
// 📢 GET CLUB ANNOUNCEMENTS - Thông báo CLB
// ═══════════════════════════════════════════════════════════

export async function get_club_announcements({ clubId, limit = 10 }) {
  if (!clubId) return { error: "Cần clubId" };

  const announcements = await ClubAnnouncement.find({
    club: toObjectId(clubId),
    visibility: "public",
  })
    .populate("author", "name")
    .sort({ pinned: -1, createdAt: -1 })
    .limit(Math.min(Number(limit) || 10, 20))
    .lean();

  const list = announcements.map((a) => ({
    title: a.title,
    content: a.content ? a.content.slice(0, 300) : null,
    author: a.author?.name || "?",
    pinned: a.pinned || false,
    date: a.createdAt,
  }));

  return {
    announcements: list,
    total: list.length,
    pinnedCount: list.filter((a) => a.pinned).length,
  };
}

// ═══════════════════════════════════════════════════════════
// ✉️ GET REG INVITES - Lời mời đăng ký giải
// ═══════════════════════════════════════════════════════════

export async function get_reg_invites({ userId, tournamentId, status }, ctx) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const filter = {
    $or: [
      { "player1.user": toObjectId(uid) },
      { "player2.user": toObjectId(uid) },
    ],
  };
  if (tournamentId) filter.tournament = toObjectId(tournamentId);
  if (status) filter.status = status;

  const invites = await RegInvite.find(filter)
    .populate("tournament", "name")
    .populate("player1.user", "name")
    .populate("player2.user", "name")
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const list = invites.map((inv) => {
    const p1 = inv.player1?.user?.name || inv.player1?.fullName || "?";
    const p2 = inv.player2?.user?.name || inv.player2?.fullName || null;
    return {
      tournament: inv.tournament?.name || "?",
      eventType: inv.eventType,
      player1: p1,
      player2: p2,
      status: inv.status,
      confirmations: inv.confirmations,
      date: inv.createdAt,
    };
  });

  const statusCounts = {};
  list.forEach((i) => {
    statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;
  });

  return {
    invites: list,
    total: list.length,
    statusCounts,
  };
}

// ═══════════════════════════════════════════════════════════
// 🎟️ GET SUPPORT TICKETS - Ticket hỗ trợ
// ═══════════════════════════════════════════════════════════

export async function get_support_tickets({ userId, status }, ctx) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const filter = { user: toObjectId(uid) };
  if (status) filter.status = status;

  const tickets = await SupportTicket.find(filter)
    .select("title status lastMessageAt lastMessagePreview createdAt")
    .sort({ lastMessageAt: -1 })
    .limit(10)
    .lean();

  const list = tickets.map((t) => ({
    title: t.title,
    status: t.status,
    lastMessage: t.lastMessagePreview
      ? t.lastMessagePreview.slice(0, 100)
      : null,
    lastMessageAt: t.lastMessageAt,
    createdAt: t.createdAt,
  }));

  const statusCounts = {};
  list.forEach((t) => {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  });

  return {
    tickets: list,
    total: list.length,
    statusCounts,
  };
}

// ═══════════════════════════════════════════════════════════
// 🔔 GET MY SUBSCRIPTIONS - Đang theo dõi gì
// ═══════════════════════════════════════════════════════════

export async function get_my_subscriptions({ userId, topicType }, ctx) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const filter = { user: toObjectId(uid), muted: { $ne: true } };
  if (topicType) filter.topicType = topicType;

  const subs = await Subscription.find(filter)
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  // Populate topic names
  const tournamentIds = subs
    .filter((s) => s.topicType === "tournament" && s.topicId)
    .map((s) => s.topicId);
  const clubIds = subs
    .filter((s) => s.topicType === "club" && s.topicId)
    .map((s) => s.topicId);

  const [tournaments, clubs] = await Promise.all([
    tournamentIds.length
      ? Tournament.find({ _id: { $in: tournamentIds } })
          .select("name")
          .lean()
      : [],
    clubIds.length
      ? Club.find({ _id: { $in: clubIds } })
          .select("name")
          .lean()
      : [],
  ]);

  const nameMap = new Map();
  tournaments.forEach((t) => nameMap.set(String(t._id), t.name));
  clubs.forEach((c) => nameMap.set(String(c._id), c.name));

  const list = subs.map((s) => ({
    topicType: s.topicType,
    topicName: s.topicId
      ? nameMap.get(String(s.topicId)) || s.topicId
      : "Global",
    channels: s.channels || [],
    categories: s.categories || [],
    since: s.createdAt,
  }));

  const typeCounts = {};
  list.forEach((s) => {
    typeCounts[s.topicType] = (typeCounts[s.topicType] || 0) + 1;
  });

  return {
    subscriptions: list,
    total: list.length,
    typeCounts,
  };
}

// ═══════════════════════════════════════════════════════════
// 🎾 GET CASUAL MATCHES - Trận tự do của user
// ═══════════════════════════════════════════════════════════

export async function get_casual_matches(
  { userId, status, category, limit = 10 },
  ctx,
) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const filter = {
    $or: [
      { createdBy: toObjectId(uid) },
      { "participants.user": toObjectId(uid) },
    ],
  };
  if (status) filter.status = status;
  if (category) filter.category = category;

  const matches = await UserMatch.find(filter)
    .select(
      "title status winner gameScores category location scheduledAt startedAt finishedAt participants pairA pairB createdBy",
    )
    .populate("participants.user", "name")
    .populate("createdBy", "name")
    .sort({ scheduledAt: -1, createdAt: -1 })
    .limit(Math.min(Number(limit) || 10, 30))
    .lean();

  const list = matches.map((m) => {
    const sideA = (m.participants || []).filter((p) => p.side === "A");
    const sideB = (m.participants || []).filter((p) => p.side === "B");
    const teamName = (side) =>
      side.map((p) => p.user?.name || p.displayName || "?").join(" & ");

    let result = null;
    if (m.status === "finished" && m.winner) {
      const isUserTeamA = sideA.some(
        (p) => String(p.user?._id || p.user) === String(uid),
      );
      const iWon =
        (isUserTeamA && m.winner === "A") || (!isUserTeamA && m.winner === "B");
      result = iWon ? "win" : "loss";
    }

    return {
      title: m.title || "Trận tự do",
      status: m.status,
      category: m.category,
      teamA: teamName(sideA) || "?",
      teamB: teamName(sideB) || "?",
      scores: (m.gameScores || []).map((g) => `${g.a}-${g.b}`),
      result,
      location: m.location?.name || null,
      date: m.scheduledAt || m.startedAt,
      createdBy: m.createdBy?.name || "?",
    };
  });

  const wins = list.filter((m) => m.result === "win").length;
  const losses = list.filter((m) => m.result === "loss").length;

  return {
    matches: list,
    total: list.length,
    stats: {
      wins,
      losses,
      winRate:
        wins + losses > 0
          ? `${Math.round((wins / (wins + losses)) * 100)}%`
          : "N/A",
    },
  };
}

// ═══════════════════════════════════════════════════════════
// ⚠️ GET COMPLAINTS - Khiếu nại giải đấu
// ═══════════════════════════════════════════════════════════

export async function get_complaints({ userId, tournamentId, status }, ctx) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const filter = { createdBy: toObjectId(uid) };
  if (tournamentId || ctx?.tournamentId) {
    filter.tournament = toObjectId(tournamentId || ctx.tournamentId);
  }
  if (status) filter.status = status;

  const complaints = await Complaint.find(filter)
    .populate("tournament", "name")
    .populate("registration", "teamName")
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const list = complaints.map((c) => ({
    tournament: c.tournament?.name || "?",
    team: c.registration?.teamName || null,
    content: c.content ? c.content.slice(0, 200) : null,
    status: c.status,
    managerNotes: c.managerNotes ? c.managerNotes.slice(0, 150) : null,
    date: c.createdAt,
  }));

  const statusCounts = {};
  list.forEach((c) => {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
  });

  return { complaints: list, total: list.length, statusCounts };
}

// ═══════════════════════════════════════════════════════════
// 🗳️ GET CLUB POLLS - Bình chọn CLB
// ═══════════════════════════════════════════════════════════

export async function get_club_polls({ clubId, limit = 5 }) {
  if (!clubId) return { error: "Cần clubId" };

  const polls = await ClubPoll.find({ club: toObjectId(clubId) })
    .populate("createdBy", "name")
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 5, 15))
    .lean();

  // Get vote counts per poll
  const pollIds = polls.map((p) => p._id);
  const voteCounts = await ClubPollVote.aggregate([
    { $match: { poll: { $in: pollIds } } },
    { $group: { _id: "$poll", count: { $sum: 1 } } },
  ]);
  const voteMap = new Map(voteCounts.map((v) => [String(v._id), v.count]));

  const list = polls.map((p) => ({
    question: p.question,
    options: (p.options || []).map((o) => o.text),
    multiple: p.multiple,
    closesAt: p.closesAt || null,
    createdBy: p.createdBy?.name || "?",
    totalVotes: voteMap.get(String(p._id)) || 0,
    date: p.createdAt,
  }));

  return { polls: list, total: list.length };
}

// ═══════════════════════════════════════════════════════════
// 📩 GET CLUB JOIN REQUESTS - Đơn xin vào CLB
// ═══════════════════════════════════════════════════════════

export async function get_club_join_requests({ userId, clubId, status }, ctx) {
  const uid = userId || ctx?.currentUserId;
  const filter = {};

  if (uid) filter.user = toObjectId(uid);
  if (clubId) filter.club = toObjectId(clubId);
  if (status) filter.status = status;
  if (!uid && !clubId) return { error: "Cần userId hoặc clubId" };

  const requests = await ClubJoinRequest.find(filter)
    .populate("club", "name")
    .populate("user", "name")
    .populate("decidedBy", "name")
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();

  const list = requests.map((r) => ({
    club: r.club?.name || "?",
    user: r.user?.name || "?",
    message: r.message ? r.message.slice(0, 150) : null,
    status: r.status,
    decidedBy: r.decidedBy?.name || null,
    decidedAt: r.decidedAt || null,
    date: r.createdAt,
  }));

  return { requests: list, total: list.length };
}

// ═══════════════════════════════════════════════════════════
// 👑 GET TOURNAMENT MANAGERS - Quản lý giải
// ═══════════════════════════════════════════════════════════

export async function get_tournament_managers({ tournamentId }, ctx) {
  const tid = tournamentId || ctx?.tournamentId;
  if (!tid) return { error: "Cần tournamentId" };

  const managers = await TournamentManager.find({
    tournament: toObjectId(tid),
  })
    .populate("user", "name phone")
    .populate("createdBy", "name")
    .sort({ role: 1, createdAt: 1 })
    .lean();

  const list = managers.map((m) => ({
    name: m.user?.name || "?",
    phone: m.user?.phone || null,
    role: m.role,
    addedBy: m.createdBy?.name || null,
  }));

  const roleCounts = {};
  list.forEach((m) => {
    roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;
  });

  return { managers: list, total: list.length, roleCounts };
}

// ═══════════════════════════════════════════════════════════
// 🎥 GET MATCH RECORDINGS - Video replay trận
// ═══════════════════════════════════════════════════════════

export async function get_match_recordings({ matchId, status = "ready" }) {
  if (!matchId) return { error: "Cần matchId" };

  const filter = { match: toObjectId(matchId) };
  if (status) filter.status = status;

  const recordings = await LiveRecording.find(filter)
    .populate({
      path: "match",
      select: "code tournament courtLabel",
      populate: { path: "tournament", select: "name" },
    })
    .sort({ createdAt: -1 })
    .lean();

  const list = recordings.map((r) => ({
    status: r.status,
    totalChunks: r.totalChunks,
    sizeMB: r.totalSizeMB ? r.totalSizeMB.toFixed(1) : null,
    durationSeconds: r.finalDurationSeconds || null,
    matchCode: r.match?.code || null,
    tournament: r.match?.tournament?.name || null,
    date: r.createdAt,
  }));

  return { recordings: list, total: list.length };
}

// ═══════════════════════════════════════════════════════════
// 🎲 GET DRAW RESULTS - Kết quả bốc thăm / xếp hạt giống
// ═══════════════════════════════════════════════════════════

export async function get_draw_results({ bracketId, tournamentId }, ctx) {
  const tid = tournamentId || ctx?.tournamentId;
  const filter = { status: "committed" };
  if (bracketId) filter.bracket = toObjectId(bracketId);
  else if (tid) filter.tournament = toObjectId(tid);
  else return { error: "Cần bracketId hoặc tournamentId" };

  const sessions = await DrawSession.find(filter)
    .select("bracket mode targetRound board score metrics committedAt")
    .populate("bracket", "name type")
    .populate("board.groups.slots", "teamName")
    .populate("board.pairs.a", "teamName")
    .populate("board.pairs.b", "teamName")
    .sort({ committedAt: -1 })
    .limit(5)
    .lean();

  const list = sessions.map((s) => {
    const result = {
      bracket: s.bracket?.name || "?",
      bracketType: s.bracket?.type || s.mode,
      mode: s.mode,
      round: s.targetRound || null,
      committedAt: s.committedAt,
      score: s.score ? s.score.toFixed(2) : null,
    };

    if (s.board?.type === "group" && s.board.groups) {
      result.groups = s.board.groups.map((g) => ({
        key: g.key,
        size: g.size,
        teams: (g.slots || []).map((slot) => slot?.teamName || "BYE"),
      }));
    }
    if (
      (s.board?.type === "knockout" || s.board?.type === "roundElim") &&
      s.board.pairs
    ) {
      result.pairs = s.board.pairs.map((p) => ({
        index: p.index,
        teamA: p.a?.teamName || "BYE",
        teamB: p.b?.teamName || "BYE",
      }));
    }
    return result;
  });

  return { draws: list, total: list.length };
}

// ═══════════════════════════════════════════════════════════
// 📍 GET RADAR NEARBY - Ai gần tôi muốn đánh?
// ═══════════════════════════════════════════════════════════

export async function get_radar_nearby(
  { userId, maxDistanceKm = 10, limit = 10 },
  ctx,
) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  // Get user's own presence to find their location
  const myPresence = await RadarPresence.findOne({
    user: toObjectId(uid),
  }).lean();
  if (!myPresence || !myPresence.location?.coordinates) {
    return { message: "Bạn chưa bật radar / chưa có vị trí", nearby: [] };
  }

  const [lng, lat] = myPresence.location.coordinates;

  // Find nearby active presences
  const nearby = await RadarPresence.find({
    user: { $ne: toObjectId(uid) },
    location: {
      $nearSphere: {
        $geometry: { type: "Point", coordinates: [lng, lat] },
        $maxDistance: (Number(maxDistanceKm) || 10) * 1000,
      },
    },
  })
    .populate("user", "name avatar")
    .limit(Math.min(Number(limit) || 10, 30))
    .lean();

  // Also get their intents
  const userIds = nearby.map((n) => n.user?._id).filter(Boolean);
  const intents = await RadarIntent.find({ user: { $in: userIds } }).lean();
  const intentMap = new Map(intents.map((i) => [String(i.user), i]));

  const list = nearby.map((n) => {
    const intent = intentMap.get(String(n.user?._id));
    return {
      name: n.user?.name || "?",
      status: n.status,
      intent: intent?.kind || null,
      note: intent?.note || null,
      distance: n.location?.coordinates
        ? `~${Math.round(getDistanceKm(lat, lng, n.location.coordinates[1], n.location.coordinates[0]))}km`
        : "?",
    };
  });

  return { nearby: list, total: list.length, myStatus: myPresence.status };
}

// Haversine distance helper
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ═══════════════════════════════════════════════════════════
// 🔐 GET LOGIN HISTORY - Lịch sử đăng nhập
// ═══════════════════════════════════════════════════════════

export async function get_login_history({ userId, limit = 10 }, ctx) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const record = await UserLogin.findOne({ user: toObjectId(uid) }).lean();
  if (!record) return { message: "Chưa có lịch sử đăng nhập", history: [] };

  const history = (record.loginHistory || [])
    .slice(0, Math.min(Number(limit) || 10, 30))
    .map((e) => ({
      at: e.at,
      method: e.method,
      success: e.success,
      device: e.meta?.device || null,
      os: e.meta?.os || null,
      browser: e.meta?.browser || null,
    }));

  return {
    lastLogin: record.lastLoginAt,
    history,
    total: history.length,
  };
}

// ═══════════════════════════════════════════════════════════
// 📝 GET CMS CONTENT - Nội dung CMS (FAQ, quy định...)
// ═══════════════════════════════════════════════════════════

export async function get_cms_content({ slug }) {
  if (!slug) {
    // List all available slugs
    const blocks = await CmsBlock.find({})
      .select("slug updatedAt")
      .sort({ slug: 1 })
      .lean();
    return {
      availableSlugs: blocks.map((b) => b.slug),
      total: blocks.length,
      hint: "Gọi lại với slug cụ thể để lấy nội dung",
    };
  }

  const block = await CmsBlock.findOne({ slug }).lean();
  if (!block) return { error: `Không tìm thấy CMS block: ${slug}` };

  // Flatten data to readable format
  const data = block.data || {};
  const content =
    typeof data === "string"
      ? data
      : JSON.stringify(data, null, 2).slice(0, 2000);

  return {
    slug: block.slug,
    content,
    updatedAt: block.updatedAt,
  };
}

// ═══════════════════════════════════════════════════════════
// 📱 GET MY DEVICES - Thiết bị đã đăng ký
// ═══════════════════════════════════════════════════════════

export async function get_my_devices({ userId }, ctx) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const devices = await DeviceInstallation.find({ user: toObjectId(uid) })
    .sort({ lastSeenAt: -1 })
    .lean();

  const list = devices.map((d) => ({
    platform: d.platform,
    brand: d.deviceBrand || null,
    model: d.deviceModelName || d.deviceModel || null,
    name: d.deviceName || null,
    appVersion: d.appVersion,
    buildNumber: d.buildNumber,
    firstSeen: d.firstSeenAt,
    lastSeen: d.lastSeenAt,
  }));

  return {
    devices: list,
    total: list.length,
    platforms: {
      ios: list.filter((d) => d.platform === "ios").length,
      android: list.filter((d) => d.platform === "android").length,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 🆕 GET APP VERSION - Phiên bản app mới nhất
// ═══════════════════════════════════════════════════════════

export async function get_app_version({ platform }) {
  const filter = { isActive: true };

  if (platform) {
    filter.platform = platform;
    filter.isLatest = true;
  }

  const bundles = await OTABundle.find(filter)
    .select(
      "platform version description mandatory minAppVersion stats createdAt isLatest",
    )
    .sort({ isLatest: -1, createdAt: -1 })
    .limit(platform ? 1 : 2)
    .lean();

  const list = bundles.map((b) => ({
    platform: b.platform,
    version: b.version,
    description: b.description || null,
    mandatory: b.mandatory,
    minAppVersion: b.minAppVersion,
    downloads: b.stats?.downloads || 0,
    successRate:
      b.stats?.successfulUpdates && b.stats?.downloads
        ? `${Math.round((b.stats.successfulUpdates / b.stats.downloads) * 100)}%`
        : "N/A",
    releasedAt: b.createdAt,
  }));

  return { versions: list, total: list.length };
}

// ═══════════════════════════════════════════════════════════
// 📡 GET LIVE CHANNELS - Kênh live stream
// ═══════════════════════════════════════════════════════════

export async function get_live_channels({ provider } = {}) {
  const filter = { eligibleLive: true };
  if (provider) filter.provider = provider;

  const channels = await Channel.find(filter)
    .select("provider name externalId eligibleLive lastCheckedAt")
    .sort({ provider: 1, name: 1 })
    .lean();

  const list = channels.map((c) => ({
    provider: c.provider,
    name: c.name || c.externalId,
    eligible: c.eligibleLive,
    lastChecked: c.lastCheckedAt,
  }));

  const providerCounts = {};
  list.forEach((c) => {
    providerCounts[c.provider] = (providerCounts[c.provider] || 0) + 1;
  });

  return { channels: list, total: list.length, providerCounts };
}

// ═══════════════════════════════════════════════════════════
// 📦 GET APP UPDATE INFO - Thông tin cập nhật app (store)
// ═══════════════════════════════════════════════════════════

export async function get_app_update_info({ platform }) {
  const filter = {};
  if (platform && platform !== "all") filter.platform = platform;

  const configs = await AppConfig.find(filter).sort({ platform: 1 }).lean();

  if (!configs.length) return { error: "Chưa có cấu hình app" };

  const list = configs.map((c) => ({
    platform: c.platform,
    latestVersion: c.latestVersion,
    latestBuild: c.latestBuild,
    minSupportedBuild: c.minSupportedBuild,
    storeUrl: c.storeUrl || null,
    changelog: c.changelog ? c.changelog.slice(0, 500) : null,
    rolloutPercent: c.rollout?.percentage ?? 100,
    blockedBuilds: c.blockedBuilds || [],
  }));

  return { configs: list, total: list.length };
}

// ═══════════════════════════════════════════════════════════
// ✅ CHECK MY REGISTRATION - Tôi đã đăng ký giải chưa?
// ═══════════════════════════════════════════════════════════

export async function check_my_registration({ tournamentId, userId }, ctx) {
  const uid = userId || ctx?.currentUserId;
  const tid = tournamentId || ctx?.tournamentId;
  if (!uid) return { error: "Cần userId" };
  if (!tid) return { error: "Cần tournamentId" };

  const regs = await Registration.find({
    tournament: toObjectId(tid),
    $or: [
      { "player1.user": toObjectId(uid) },
      { "player2.user": toObjectId(uid) },
    ],
  })
    .populate("tournament", "name startDate")
    .lean();

  if (!regs.length) {
    return { registered: false, message: "Bạn chưa đăng ký giải này" };
  }

  const list = regs.map((r) => ({
    code: r.code,
    teamName:
      r.player1?.fullName + (r.player2 ? " & " + r.player2.fullName : ""),
    payment: r.payment?.status || "Unpaid",
    checkedIn: !!r.checkinAt,
    tournament: r.tournament?.name || "?",
    startDate: r.tournament?.startDate,
  }));

  return { registered: true, registrations: list, total: list.length };
}

// ═══════════════════════════════════════════════════════════
// ⚔️ GET HEAD TO HEAD - Lịch sử đối đầu
// ═══════════════════════════════════════════════════════════

export async function get_head_to_head({ playerAId, playerBId }) {
  if (!playerAId || !playerBId) return { error: "Cần playerAId và playerBId" };

  // Fetch registrations + player names in parallel
  const [regsA, regsB, pA, pB] = await Promise.all([
    Registration.find({
      $or: [
        { "player1.user": toObjectId(playerAId) },
        { "player2.user": toObjectId(playerAId) },
      ],
    })
      .select("_id")
      .lean(),
    Registration.find({
      $or: [
        { "player1.user": toObjectId(playerBId) },
        { "player2.user": toObjectId(playerBId) },
      ],
    })
      .select("_id")
      .lean(),
    User.findById(playerAId).select("name").lean(),
    User.findById(playerBId).select("name").lean(),
  ]);

  const regAIds = regsA.map((r) => r._id);
  const regBIds = regsB.map((r) => r._id);

  // Find matches between them
  const matches = await Match.find({
    status: "finished",
    $or: [
      { pairA: { $in: regAIds }, pairB: { $in: regBIds } },
      { pairA: { $in: regBIds }, pairB: { $in: regAIds } },
    ],
  })
    .populate("tournament", "name")
    .populate("pairA", "player1.fullName player2.fullName")
    .populate("pairB", "player1.fullName player2.fullName")
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();

  let winsA = 0,
    winsB = 0;
  const history = matches.map((m) => {
    const aIsPairA = regAIds.some((id) => String(id) === String(m.pairA?._id));
    const winner =
      m.winner === "A"
        ? aIsPairA
          ? "A"
          : "B"
        : m.winner === "B"
          ? aIsPairA
            ? "B"
            : "A"
          : "draw";
    if (winner === "A") winsA++;
    else if (winner === "B") winsB++;
    return {
      tournament: m.tournament?.name || "?",
      scores: (m.gameScores || []).map((g) => `${g.a}-${g.b}`).join(", "),
      winner,
      date: m.updatedAt,
    };
  });

  return {
    playerA: pA?.name || "?",
    playerB: pB?.name || "?",
    winsA,
    winsB,
    totalMatches: matches.length,
    history,
  };
}

// ═══════════════════════════════════════════════════════════
// 📅 GET UPCOMING MATCHES - Trận sắp tới của tôi
// ═══════════════════════════════════════════════════════════

export async function get_upcoming_matches(
  { userId, tournamentId, limit = 10 },
  ctx,
) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  // Get user's registrations
  const regs = await Registration.find({
    $or: [
      { "player1.user": toObjectId(uid) },
      { "player2.user": toObjectId(uid) },
    ],
  })
    .select("_id")
    .lean();

  const regIds = regs.map((r) => r._id);
  if (!regIds.length)
    return { message: "Bạn chưa đăng ký giải nào", matches: [] };

  const filter = {
    $or: [{ pairA: { $in: regIds } }, { pairB: { $in: regIds } }],
    status: { $in: ["scheduled", "queued", "assigned"] },
  };
  if (tournamentId || ctx?.tournamentId) {
    filter.tournament = toObjectId(tournamentId || ctx.tournamentId);
  }

  const matches = await Match.find(filter)
    .populate("tournament", "name")
    .populate("pairA", "player1.fullName player2.fullName")
    .populate("pairB", "player1.fullName player2.fullName")
    .sort({ scheduledAt: 1, round: 1, order: 1 })
    .limit(Math.min(Number(limit) || 10, 20))
    .lean();

  const list = matches.map((m) => ({
    code: m.code,
    tournament: m.tournament?.name || "?",
    round: m.round,
    teamA: [m.pairA?.player1?.fullName, m.pairA?.player2?.fullName]
      .filter(Boolean)
      .join(" & "),
    teamB: [m.pairB?.player1?.fullName, m.pairB?.player2?.fullName]
      .filter(Boolean)
      .join(" & "),
    court: m.courtLabel || null,
    scheduledAt: m.scheduledAt,
    status: m.status,
  }));

  return { matches: list, total: list.length };
}

// ═══════════════════════════════════════════════════════════
// 📊 GET SCORE HISTORY - Lịch sử điểm kỹ năng
// ═══════════════════════════════════════════════════════════

export async function get_score_history({ userId, limit = 15 }, ctx) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const entries = await ScoreHistory.find({ user: toObjectId(uid) })
    .populate("scorer", "name")
    .sort({ scoredAt: -1 })
    .limit(Math.min(Number(limit) || 15, 30))
    .lean();

  if (!entries.length)
    return { message: "Chưa có lịch sử chấm điểm", history: [] };

  const list = entries.map((e) => ({
    single: e.single ?? null,
    double: e.double ?? null,
    scorer: e.scorer?.name || "Hệ thống",
    note: e.note || null,
    date: e.scoredAt,
  }));

  return { history: list, total: list.length };
}

// ═══════════════════════════════════════════════════════════
// 📋 GET EVENT RSVP - Ai tham gia sự kiện CLB?
// ═══════════════════════════════════════════════════════════

export async function get_event_rsvp({ eventId, userId }, ctx) {
  if (!eventId) return { error: "Cần eventId" };

  const filter = { event: toObjectId(eventId) };
  const uid = userId || ctx?.currentUserId;

  // If asking about self, just check own RSVP
  if (uid && !eventId) {
    filter.user = toObjectId(uid);
  }

  const rsvps = await ClubEventRsvp.find(filter)
    .populate("user", "name avatar")
    .populate("event", "title startDate")
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const list = rsvps.map((r) => ({
    user: r.user?.name || "?",
    status: r.status,
    date: r.createdAt,
  }));

  // Check if current user RSVP'd
  const myRsvp = uid
    ? list.find((r) => rsvps.some((rv) => String(rv.user?._id) === String(uid)))
    : null;

  return {
    eventTitle: rsvps[0]?.event?.title || "?",
    attendees: list,
    going: list.filter((r) => r.status === "going").length,
    notGoing: list.filter((r) => r.status === "not_going").length,
    total: list.length,
    myStatus: myRsvp?.status || null,
  };
}

// ═══════════════════════════════════════════════════════════
// ⭐ GET REPUTATION HISTORY - Lịch sử uy tín
// ═══════════════════════════════════════════════════════════

export async function get_reputation_history({ userId, limit = 15 }, ctx) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const events = await ReputationEvent.find({ user: toObjectId(uid) })
    .populate("tournament", "name")
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 15, 30))
    .lean();

  if (!events.length) return { message: "Chưa có lịch sử uy tín", history: [] };

  const list = events.map((e) => ({
    type: e.type,
    tournament: e.tournament?.name || "?",
    amount: e.amount,
    date: e.createdAt,
  }));

  const totalBonus = list.reduce((sum, e) => sum + (e.amount || 0), 0);

  return { history: list, total: list.length, totalBonus };
}

// ═══════════════════════════════════════════════════════════
// 🟢 GET LIVE MATCHES - Trận đang diễn ra
// ═══════════════════════════════════════════════════════════

export async function get_live_matches({ tournamentId, limit = 20 }, ctx) {
  const filter = { status: "live" };
  const tid = tournamentId || ctx?.tournamentId;
  if (tid) filter.tournament = toObjectId(tid);

  const matches = await Match.find(filter)
    .populate("tournament", "name")
    .populate("pairA", "player1.fullName player2.fullName")
    .populate("pairB", "player1.fullName player2.fullName")
    .sort({ updatedAt: -1 })
    .limit(Math.min(Number(limit) || 20, 50))
    .lean();

  const list = matches.map((m) => ({
    code: m.code,
    tournament: m.tournament?.name || "?",
    round: m.round,
    teamA: [m.pairA?.player1?.fullName, m.pairA?.player2?.fullName]
      .filter(Boolean)
      .join(" & "),
    teamB: [m.pairB?.player1?.fullName, m.pairB?.player2?.fullName]
      .filter(Boolean)
      .join(" & "),
    court: m.courtLabel || null,
    scores: (m.gameScores || []).map((g) => `${g.a}-${g.b}`).join(", "),
    format: m.format,
  }));

  return { matches: list, total: list.length };
}

// ═══════════════════════════════════════════════════════════
// 🎯 GET MATCH SCORE DETAIL - Chi tiết điểm từng ván
// ═══════════════════════════════════════════════════════════

export async function get_match_score_detail({ matchId }, ctx) {
  const mid = matchId || ctx?.matchId;
  if (!mid) return { error: "Cần matchId" };

  const m = await Match.findById(toObjectId(mid))
    .populate("tournament", "name")
    .populate("pairA", "player1.fullName player2.fullName")
    .populate("pairB", "player1.fullName player2.fullName")
    .lean();

  if (!m) return { error: "Không tìm thấy trận" };

  const games = (m.gameScores || []).map((g, i) => ({
    game: i + 1,
    scoreA: g.a,
    scoreB: g.b,
    capped: g.capped || false,
    winner: g.a > g.b ? "A" : g.b > g.a ? "B" : "tie",
  }));

  return {
    code: m.code,
    tournament: m.tournament?.name || "?",
    round: m.round,
    format: m.format,
    bestOf: m.rules?.bestOf || 1,
    pointsToWin: m.rules?.pointsToWin || 11,
    teamA: [m.pairA?.player1?.fullName, m.pairA?.player2?.fullName]
      .filter(Boolean)
      .join(" & "),
    teamB: [m.pairB?.player1?.fullName, m.pairB?.player2?.fullName]
      .filter(Boolean)
      .join(" & "),
    games,
    winner: m.winner || null,
    status: m.status,
    court: m.courtLabel || null,
  };
}

// ═══════════════════════════════════════════════════════════
// 🤝 COMPARE PLAYERS - So sánh 2 VĐV
// ═══════════════════════════════════════════════════════════

export async function compare_players({ playerAId, playerBId }) {
  if (!playerAId || !playerBId) return { error: "Cần playerAId và playerBId" };

  // 1) Fetch users + registration IDs in parallel
  const [userA, userB, regIdsA, regIdsB] = await Promise.all([
    User.findById(playerAId)
      .select("name nickname localRatings province")
      .lean(),
    User.findById(playerBId)
      .select("name nickname localRatings province")
      .lean(),
    Registration.find({
      $or: [{ "player1.user": playerAId }, { "player2.user": playerAId }],
    }).distinct("_id"),
    Registration.find({
      $or: [{ "player1.user": playerBId }, { "player2.user": playerBId }],
    }).distinct("_id"),
  ]);

  if (!userA || !userB) return { error: "Không tìm thấy 1 hoặc cả 2 VĐV" };

  // 2) Run all counts in parallel
  const [matchCountA, matchCountB, tourCountA, tourCountB] = await Promise.all([
    Match.countDocuments({
      status: "finished",
      participants: toObjectId(playerAId),
    }),
    Match.countDocuments({
      status: "finished",
      participants: toObjectId(playerBId),
    }),
    Registration.distinct("tournament", {
      $or: [{ "player1.user": playerAId }, { "player2.user": playerAId }],
    }).then((r) => r.length),
    Registration.distinct("tournament", {
      $or: [{ "player1.user": playerBId }, { "player2.user": playerBId }],
    }).then((r) => r.length),
  ]);

  return {
    playerA: {
      name: userA.name,
      nickname: userA.nickname,
      province: userA.province,
      ratingDoubles: userA.localRatings?.doubles || 2.5,
      ratingSingles: userA.localRatings?.singles || 2.5,
      totalMatches: matchCountA,
      totalTournaments: tourCountA,
    },
    playerB: {
      name: userB.name,
      nickname: userB.nickname,
      province: userB.province,
      ratingDoubles: userB.localRatings?.doubles || 2.5,
      ratingSingles: userB.localRatings?.singles || 2.5,
      totalMatches: matchCountB,
      totalTournaments: tourCountB,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 📆 GET TOURNAMENT SCHEDULE - Lịch thi đấu giải
// ═══════════════════════════════════════════════════════════

export async function get_tournament_schedule(
  { tournamentId, date, courtLabel, limit = 30 },
  ctx,
) {
  const tid = tournamentId || ctx?.tournamentId;
  if (!tid) return { error: "Cần tournamentId" };

  const filter = { tournament: toObjectId(tid) };
  if (courtLabel) filter.courtLabel = courtLabel;

  // Date filter
  if (date) {
    const d = new Date(date);
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    filter.scheduledAt = { $gte: start, $lte: end };
  }

  const matches = await Match.find(filter)
    .populate("pairA", "player1.fullName player2.fullName")
    .populate("pairB", "player1.fullName player2.fullName")
    .populate("bracket", "name")
    .sort({ scheduledAt: 1, courtLabel: 1, round: 1, order: 1 })
    .limit(Math.min(Number(limit) || 30, 50))
    .lean();

  const list = matches.map((m) => ({
    code: m.code,
    bracket: m.bracket?.name || "?",
    round: m.round,
    teamA:
      [m.pairA?.player1?.fullName, m.pairA?.player2?.fullName]
        .filter(Boolean)
        .join(" & ") || "TBD",
    teamB:
      [m.pairB?.player1?.fullName, m.pairB?.player2?.fullName]
        .filter(Boolean)
        .join(" & ") || "TBD",
    court: m.courtLabel || null,
    scheduledAt: m.scheduledAt || null,
    status: m.status,
  }));

  // Group by court for summary
  const courtSummary = {};
  list.forEach((m) => {
    const c = m.court || "Chưa xếp sân";
    courtSummary[c] = (courtSummary[c] || 0) + 1;
  });

  return { schedule: list, total: list.length, courtSummary };
}

// ═══════════════════════════════════════════════════════════
// 📐 GET TOURNAMENT RULES - Luật thi đấu từng bảng
// ═══════════════════════════════════════════════════════════

export async function get_tournament_rules({ tournamentId, bracketId }, ctx) {
  const tid = tournamentId || ctx?.tournamentId;

  const filter = {};
  if (bracketId) {
    filter._id = toObjectId(bracketId);
  } else if (tid) {
    filter.tournament = toObjectId(tid);
  } else {
    return { error: "Cần tournamentId hoặc bracketId" };
  }

  const brackets = await Bracket.find(filter)
    .sort({ stage: 1, order: 1 })
    .lean();

  if (!brackets.length) return { error: "Không tìm thấy bảng đấu" };

  const list = brackets.map((b) => ({
    id: b._id,
    name: b.name,
    type: b.type,
    drawStatus: b.drawStatus,
    teamsCount: b.teamsCount || 0,
    matchesCount: b.matchesCount || 0,
    rules: {
      bestOf: b.config?.rules?.bestOf || 1,
      pointsToWin: b.config?.rules?.pointsToWin || 11,
      winByTwo: b.config?.rules?.winByTwo ?? true,
      cap: b.config?.rules?.cap || null,
    },
    seeding: {
      method: b.config?.seeding?.method || "rating",
      ratingKey: b.config?.seeding?.ratingKey || "double",
      protectSameClub: b.config?.seeding?.protectSameClub || false,
    },
    formatConfig: (() => {
      switch (b.type) {
        case "round_robin":
          return {
            groupSize: b.config?.roundRobin?.groupSize || 4,
            pointsWin: b.config?.roundRobin?.points?.win ?? 1,
            tiebreakers: b.config?.roundRobin?.tiebreakers || [],
          };
        case "swiss":
          return {
            rounds: b.config?.swiss?.rounds || 4,
            avoidRematch: b.config?.swiss?.avoidRematch ?? true,
          };
        case "double_elim":
          return {
            hasGrandFinalReset:
              b.config?.doubleElim?.hasGrandFinalReset ?? true,
          };
        default:
          return null;
      }
    })(),
    groupsCount: b.groups?.length || 0,
    meta: b.meta || {},
  }));

  return { brackets: list, total: list.length };
}

// ═══════════════════════════════════════════════════════════
// 🏟️ GET COURT STATUS - Trạng thái sân real-time
// ═══════════════════════════════════════════════════════════

export async function get_court_status({ tournamentId, courtName }, ctx) {
  const tid = tournamentId || ctx?.tournamentId;
  if (!tid) return { error: "Cần tournamentId" };

  const filter = { tournament: toObjectId(tid) };
  if (courtName) filter.name = { $regex: courtName, $options: "i" };

  const courts = await Court.find(filter)
    .populate("currentMatch")
    .sort({ cluster: 1, order: 1 })
    .lean();

  if (!courts.length) return { error: "Không có sân" };

  const list = await Promise.all(
    courts.map(async (c) => {
      let currentMatchInfo = null;
      if (c.currentMatch) {
        const m = await Match.findById(c.currentMatch)
          .populate("pairA", "player1.fullName player2.fullName")
          .populate("pairB", "player1.fullName player2.fullName")
          .lean();
        if (m) {
          currentMatchInfo = {
            code: m.code,
            teamA: [m.pairA?.player1?.fullName, m.pairA?.player2?.fullName]
              .filter(Boolean)
              .join(" & "),
            teamB: [m.pairB?.player1?.fullName, m.pairB?.player2?.fullName]
              .filter(Boolean)
              .join(" & "),
            scores: (m.gameScores || []).map((g) => `${g.a}-${g.b}`).join(", "),
            status: m.status,
          };
        }
      }
      return {
        name: c.name,
        cluster: c.cluster,
        status: c.status,
        isActive: c.isActive,
        liveEnabled: c.liveConfig?.enabled || false,
        currentMatch: currentMatchInfo,
      };
    }),
  );

  const summary = {
    total: list.length,
    idle: list.filter((c) => c.status === "idle").length,
    live: list.filter((c) => c.status === "live").length,
    assigned: list.filter((c) => c.status === "assigned").length,
    maintenance: list.filter((c) => c.status === "maintenance").length,
  };

  return { courts: list, ...summary };
}

// ═══════════════════════════════════════════════════════════
// 📝 GET MATCH LIVE LOG - Log diễn biến trận (point-by-point)
// ═══════════════════════════════════════════════════════════

export async function get_match_live_log({ matchId, limit = 30 }, ctx) {
  const mid = matchId || ctx?.matchId;
  if (!mid) return { error: "Cần matchId" };

  const m = await Match.findById(toObjectId(mid))
    .select("code liveLog gameScores status winner pairA pairB")
    .populate("pairA", "player1.fullName player2.fullName")
    .populate("pairB", "player1.fullName player2.fullName")
    .lean();

  if (!m) return { error: "Không tìm thấy trận" };
  if (!m.liveLog?.length)
    return { message: "Trận chưa có log diễn biến", code: m.code };

  // Take last N events
  const events = m.liveLog
    .slice(-Math.min(Number(limit) || 30, 100))
    .map((e) => ({
      type: e.type,
      payload: e.payload || null,
      at: e.at,
    }));

  return {
    code: m.code,
    teamA: [m.pairA?.player1?.fullName, m.pairA?.player2?.fullName]
      .filter(Boolean)
      .join(" & "),
    teamB: [m.pairB?.player1?.fullName, m.pairB?.player2?.fullName]
      .filter(Boolean)
      .join(" & "),
    status: m.status,
    winner: m.winner || null,
    totalEvents: m.liveLog.length,
    events,
  };
}

// ═══════════════════════════════════════════════════════════
// 💰 GET TOURNAMENT PAYMENT INFO - Lệ phí & thông tin thanh toán
// ═══════════════════════════════════════════════════════════

export async function get_tournament_payment_info({ tournamentId }, ctx) {
  const tid = tournamentId || ctx?.tournamentId;
  if (!tid) return { error: "Cần tournamentId" };

  const t = await Tournament.findById(toObjectId(tid))
    .select(
      "name registrationFee bankShortName bankAccountNumber bankAccountName contactHtml",
    )
    .lean();

  if (!t) return { error: "Không tìm thấy giải" };

  return {
    tournament: t.name,
    registrationFee: t.registrationFee || 0,
    bank: t.bankShortName
      ? {
          bankName: t.bankShortName,
          accountNumber: t.bankAccountNumber || null,
          accountName: t.bankAccountName || null,
        }
      : null,
    contactHtml: t.contactHtml
      ? t.contactHtml
          .replace(/<[^>]+>/g, " ")
          .trim()
          .slice(0, 500)
      : null,
  };
}

// ═══════════════════════════════════════════════════════════
// 👥 GET BRACKET GROUPS - Thành viên từng bảng/nhóm
// ═══════════════════════════════════════════════════════════

export async function get_bracket_groups(
  { bracketId, tournamentId, groupName },
  ctx,
) {
  const bid = bracketId || ctx?.bracketId;
  const tid = tournamentId || ctx?.tournamentId;

  let bracket;
  if (bid) {
    bracket = await Bracket.findById(toObjectId(bid)).lean();
  } else if (tid) {
    bracket = await Bracket.findOne({
      tournament: toObjectId(tid),
      type: { $in: ["group", "round_robin", "swiss", "gsl"] },
    }).lean();
  }

  if (!bracket) return { error: "Không tìm thấy bảng đấu" };
  if (!bracket.groups?.length)
    return { message: "Bảng chưa có nhóm", bracket: bracket.name };

  // Filter by group name if specified
  let groups = bracket.groups;
  if (groupName) {
    groups = groups.filter((g) =>
      g.name.toLowerCase().includes(groupName.toLowerCase()),
    );
  }

  // Populate reg IDs to get team names
  const allRegIds = groups.flatMap((g) => g.regIds || []);
  const regs = await Registration.find({ _id: { $in: allRegIds } })
    .select(
      "player1.fullName player2.fullName player1.score player2.score code",
    )
    .lean();

  const regMap = {};
  regs.forEach((r) => {
    regMap[String(r._id)] = {
      code: r.code,
      team: [r.player1?.fullName, r.player2?.fullName]
        .filter(Boolean)
        .join(" & "),
      score: r.player1?.score || 0,
    };
  });

  const result = groups.map((g) => ({
    name: g.name,
    size: g.expectedSize || g.regIds?.length || 0,
    teams: (g.regIds || []).map(
      (id) => regMap[String(id)] || { code: null, team: "?", score: 0 },
    ),
  }));

  return {
    bracket: bracket.name,
    type: bracket.type,
    groups: result,
    totalGroups: result.length,
  };
}

// ═══════════════════════════════════════════════════════════
// 🎮 GET USER CASUAL STATS - Thống kê trận tự do (UserMatch)
// ═══════════════════════════════════════════════════════════

export async function get_user_casual_stats({ userId, category }, ctx) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const matchFilter = {
    "participants.user": toObjectId(uid),
    status: "finished",
  };
  if (category) matchFilter.category = category;

  // Single aggregation instead of fetching 100 docs + JS loop
  const pipeline = [
    { $match: matchFilter },
    { $sort: { createdAt: -1 } },
    { $limit: 100 },
    {
      $addFields: {
        userSide: {
          $let: {
            vars: {
              p: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: "$participants",
                      cond: { $eq: ["$$this.user", toObjectId(uid)] },
                    },
                  },
                  0,
                ],
              },
            },
            in: "$$p.side",
          },
        },
      },
    },
    {
      $facet: {
        overall: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              wins: {
                $sum: { $cond: [{ $eq: ["$winner", "$userSide"] }, 1, 0] },
              },
              losses: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$winner", ""] },
                        { $ne: ["$winner", null] },
                        { $ne: ["$winner", "$userSide"] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        byCategory: [
          {
            $group: {
              _id: { $ifNull: ["$category", "casual"] },
              w: {
                $sum: { $cond: [{ $eq: ["$winner", "$userSide"] }, 1, 0] },
              },
              l: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$winner", ""] },
                        { $ne: ["$winner", null] },
                        { $ne: ["$winner", "$userSide"] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
      },
    },
  ];

  const [result] = await UserMatch.aggregate(pipeline);
  const o = result?.overall?.[0] || { total: 0, wins: 0, losses: 0 };
  const byCategory = {};
  (result?.byCategory || []).forEach((c) => {
    byCategory[c._id] = { w: c.w, l: c.l };
  });

  return {
    totalMatches: o.total,
    wins: o.wins,
    losses: o.losses,
    winRate: o.total > 0 ? ((o.wins / o.total) * 100).toFixed(1) + "%" : "0%",
    byCategory,
  };
}

// ═══════════════════════════════════════════════════════════
// 📈 GET MATCH RATING IMPACT - Ảnh hưởng rating trận đấu
// ═══════════════════════════════════════════════════════════

export async function get_match_rating_impact({ matchId }, ctx) {
  const mid = matchId || ctx?.matchId;
  if (!mid) return { error: "Cần matchId" };

  const m = await Match.findById(toObjectId(mid))
    .select(
      "code ratingDelta ratingApplied ratingAppliedAt winner status pairA pairB tournament",
    )
    .populate(
      "pairA",
      "player1.fullName player2.fullName player1.user player2.user",
    )
    .populate(
      "pairB",
      "player1.fullName player2.fullName player1.user player2.user",
    )
    .populate("tournament", "name")
    .lean();

  if (!m) return { error: "Không tìm thấy trận" };

  // Get rating changes for players in this match
  const userIds = [
    m.pairA?.player1?.user,
    m.pairA?.player2?.user,
    m.pairB?.player1?.user,
    m.pairB?.player2?.user,
  ].filter(Boolean);

  const changes = await RatingChange.find({
    match: toObjectId(mid),
    user: { $in: userIds },
  })
    .populate("user", "name")
    .lean();

  return {
    code: m.code,
    tournament: m.tournament?.name || null,
    teamA: [m.pairA?.player1?.fullName, m.pairA?.player2?.fullName]
      .filter(Boolean)
      .join(" & "),
    teamB: [m.pairB?.player1?.fullName, m.pairB?.player2?.fullName]
      .filter(Boolean)
      .join(" & "),
    winner: m.winner || null,
    ratingDelta: m.ratingDelta || 0,
    ratingApplied: m.ratingApplied || false,
    ratingAppliedAt: m.ratingAppliedAt || null,
    playerChanges: changes.map((c) => ({
      name: c.user?.name || "?",
      oldRating: c.oldRating,
      newRating: c.newRating,
      delta: c.delta,
    })),
  };
}

// ═══════════════════════════════════════════════════════════
// 👤 GET USER PROFILE DETAIL - Thông tin chi tiết VĐV
// ═══════════════════════════════════════════════════════════

export async function get_user_profile_detail({ userId }, ctx) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const u = await User.findById(toObjectId(uid))
    .select(
      "name nickname phone email province gender dob avatar bio verified cccdStatus role evaluator referee localRatings createdAt",
    )
    .lean();

  if (!u) return { error: "Không tìm thấy user" };

  return {
    name: u.name,
    nickname: u.nickname || null,
    phone: u.phone ? `***${u.phone.slice(-4)}` : null,
    email: u.email || null,
    province: u.province || null,
    gender: u.gender || null,
    age: u.dob ? calcAge(u.dob) : null,
    verified: u.verified,
    cccdStatus: u.cccdStatus,
    role: u.role,
    isEvaluator: u.evaluator?.enabled || false,
    evaluatorProvinces: u.evaluator?.enabled
      ? u.evaluator.gradingScopes?.provinces || []
      : [],
    isReferee: u.role === "referee",
    refereeTournaments: u.referee?.tournaments?.length || 0,
    localRatings: u.localRatings
      ? {
          singles: u.localRatings.singles,
          doubles: u.localRatings.doubles,
          matchesSingles: u.localRatings.matchesSingles || 0,
          matchesDoubles: u.localRatings.matchesDoubles || 0,
        }
      : null,
    memberSince: u.createdAt,
  };
}

// ═══════════════════════════════════════════════════════════
// 📊 GET TOURNAMENT PROGRESS - Tiến độ giải đấu
// ═══════════════════════════════════════════════════════════

export async function get_tournament_progress({ tournamentId }, ctx) {
  const tid = tournamentId || ctx?.tournamentId;
  if (!tid) return { error: "Cần tournamentId" };

  const [tournament, brackets, matchStats, courtStats] = await Promise.all([
    Tournament.findById(toObjectId(tid))
      .select("name status matchesCount startDate endDate")
      .lean(),
    Bracket.find({ tournament: toObjectId(tid) })
      .select("name type drawStatus matchesCount teamsCount")
      .lean(),
    Match.aggregate([
      { $match: { tournament: toObjectId(tid) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Court.find({ tournament: toObjectId(tid) })
      .select("name status isActive")
      .lean(),
  ]);

  if (!tournament) return { error: "Không tìm thấy giải" };

  const statusMap = {};
  matchStats.forEach((s) => {
    statusMap[s._id] = s.count;
  });
  const totalMatches = Object.values(statusMap).reduce((a, b) => a + b, 0);
  const finished = statusMap["finished"] || 0;

  return {
    tournament: tournament.name,
    status: tournament.status,
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    matches: {
      total: totalMatches,
      finished,
      live: statusMap["live"] || 0,
      scheduled: statusMap["scheduled"] || 0,
      queued: statusMap["queued"] || 0,
      assigned: statusMap["assigned"] || 0,
      progressPercent:
        totalMatches > 0
          ? ((finished / totalMatches) * 100).toFixed(1) + "%"
          : "0%",
    },
    brackets: brackets.map((b) => ({
      name: b.name,
      type: b.type,
      drawStatus: b.drawStatus,
      teams: b.teamsCount || 0,
      matches: b.matchesCount || 0,
    })),
    courts: {
      total: courtStats.length,
      active: courtStats.filter((c) => c.isActive).length,
      live: courtStats.filter((c) => c.status === "live").length,
      idle: courtStats.filter((c) => c.status === "idle").length,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 🎥 GET MATCH VIDEO - Video/link livestream trận
// ═══════════════════════════════════════════════════════════

export async function get_match_video({ matchId }, ctx) {
  const mid = matchId || ctx?.matchId;
  if (!mid) return { error: "Cần matchId" };

  const m = await Match.findById(toObjectId(mid))
    .select("code video facebookLive status pairA pairB")
    .populate("pairA", "player1.fullName player2.fullName")
    .populate("pairB", "player1.fullName player2.fullName")
    .lean();

  if (!m) return { error: "Không tìm thấy trận" };

  return {
    code: m.code,
    teamA: [m.pairA?.player1?.fullName, m.pairA?.player2?.fullName]
      .filter(Boolean)
      .join(" & "),
    teamB: [m.pairB?.player1?.fullName, m.pairB?.player2?.fullName]
      .filter(Boolean)
      .join(" & "),
    status: m.status,
    video: m.video || null,
    facebookLive: m.facebookLive
      ? {
          watchUrl:
            m.facebookLive.watch_url || m.facebookLive.permalink_url || null,
          embedUrl: m.facebookLive.embed_url || null,
          status: m.facebookLive.status || null,
        }
      : null,
    hasVideo: !!(
      m.video ||
      m.facebookLive?.watch_url ||
      m.facebookLive?.permalink_url
    ),
  };
}

// ═══════════════════════════════════════════════════════════
// 👨‍⚖️ GET TOURNAMENT REFEREES - DS trọng tài giải
// ═══════════════════════════════════════════════════════════

export async function get_tournament_referees({ tournamentId }, ctx) {
  const tid = tournamentId || ctx?.tournamentId;
  if (!tid) return { error: "Cần tournamentId" };

  // Method 1: Users with referee.tournaments including this tournament
  const refereeUsers = await User.find({
    isDeleted: { $ne: true },
    role: "referee",
    "referee.tournaments": toObjectId(tid),
  })
    .select("name nickname phone province")
    .lean();

  // Method 2: Find unique referees from matches in this tournament
  const matchReferees = await Match.distinct("referee", {
    tournament: toObjectId(tid),
    referee: { $ne: [] },
  });

  const matchRefUsers = matchReferees.length
    ? await User.find({ _id: { $in: matchReferees } })
        .select("name nickname phone province")
        .lean()
    : [];

  // Merge both lists (dedupe)
  const seen = new Set();
  const all = [];
  [...refereeUsers, ...matchRefUsers].forEach((u) => {
    const id = String(u._id);
    if (!seen.has(id)) {
      seen.add(id);
      all.push({
        id: u._id,
        name: u.name,
        nickname: u.nickname || null,
        province: u.province || null,
      });
    }
  });

  return { referees: all, total: all.length };
}

// ═══════════════════════════════════════════════════════════
// 🌱 GET SEEDING INFO - Thông tin hạt giống & bốc thăm
// ═══════════════════════════════════════════════════════════

export async function get_seeding_info({ bracketId, tournamentId }, ctx) {
  const bid = bracketId || ctx?.bracketId;
  const tid = tournamentId || ctx?.tournamentId;

  const filter = {};
  if (bid) filter._id = toObjectId(bid);
  else if (tid) filter.tournament = toObjectId(tid);
  else return { error: "Cần bracketId hoặc tournamentId" };

  const brackets = await Bracket.find(filter)
    .select(
      "name type drawStatus drawRounds teamsCount meta config.seeding groups",
    )
    .sort({ stage: 1, order: 1 })
    .lean();

  if (!brackets.length) return { error: "Không tìm thấy bảng" };

  // Batch: collect ALL regIds across all brackets, query once
  const allRegIds = brackets.flatMap((b) =>
    (b.groups || []).flatMap((g) => g.regIds || []),
  );
  const seededRegs = allRegIds.length
    ? await Registration.find({ _id: { $in: allRegIds }, seed: { $ne: null } })
        .select("player1.fullName player2.fullName seed code")
        .sort({ seed: 1 })
        .lean()
    : [];

  // Map regId → reg for fast lookup
  const regMap = {};
  seededRegs.forEach((r) => {
    regMap[String(r._id)] = r;
  });

  const results = brackets.map((b) => {
    const bracketRegIds = new Set(
      (b.groups || []).flatMap((g) => (g.regIds || []).map(String)),
    );
    const regs = seededRegs
      .filter((r) => bracketRegIds.has(String(r._id)))
      .slice(0, 16);

    return {
      bracket: b.name,
      type: b.type,
      drawStatus: b.drawStatus,
      teamsCount: b.teamsCount || 0,
      drawSize: b.meta?.drawSize || null,
      maxRounds: b.meta?.maxRounds || null,
      drawRounds: b.drawRounds || null,
      seedingMethod: b.config?.seeding?.method || "rating",
      ratingKey: b.config?.seeding?.ratingKey || "double",
      seededTeams: regs.map((r) => ({
        seed: r.seed,
        code: r.code,
        team: [r.player1?.fullName, r.player2?.fullName]
          .filter(Boolean)
          .join(" & "),
      })),
    };
  });

  return { brackets: results, total: results.length };
}

// ═══════════════════════════════════════════════════════════
// 🏅 GET PLAYER RANKING - Điểm xếp hạng VĐV
// ═══════════════════════════════════════════════════════════

export async function get_player_ranking({ userId, name }, ctx) {
  const uid = userId || ctx?.currentUserId;

  let ranking;
  if (uid) {
    ranking = await Ranking.findOne({ user: toObjectId(uid) })
      .populate("user", "name nickname province")
      .lean();
  } else if (name) {
    const users = await User.find({
      $or: [
        { name: { $regex: escapeRegex(name), $options: "i" } },
        { nickname: { $regex: escapeRegex(name), $options: "i" } },
      ],
      isDeleted: { $ne: true },
    })
      .select("_id")
      .limit(5)
      .lean();
    if (users.length) {
      ranking = await Ranking.findOne({
        user: { $in: users.map((u) => u._id) },
      })
        .populate("user", "name nickname province")
        .lean();
    }
  }

  if (!ranking) return { error: "Không tìm thấy ranking" };

  return {
    name: ranking.user?.name || "?",
    nickname: ranking.user?.nickname || null,
    province: ranking.user?.province || null,
    single: ranking.single,
    double: ranking.double,
    mix: ranking.mix,
    points: ranking.points,
    reputation: ranking.reputation,
    tierColor: ranking.tierColor,
    tierLabel: ranking.tierLabel,
    totalFinishedTours: ranking.totalFinishedTours,
    hasStaffAssessment: ranking.hasStaffAssessment,
    lastUpdated: ranking.lastUpdated,
  };
}

// ═══════════════════════════════════════════════════════════
// 📜 GET PLAYER TOURNAMENT HISTORY - Lịch sử thi đấu giải
// ═══════════════════════════════════════════════════════════

export async function get_player_tournament_history(
  { userId, limit = 10 },
  ctx,
) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const safeLimit = Math.min(Number(limit) || 10, 20);

  // Find registrations
  const regs = await Registration.find({
    $or: [
      { "player1.user": toObjectId(uid) },
      { "player2.user": toObjectId(uid) },
    ],
  })
    .populate(
      "tournament",
      "name startDate status sportType eventType location",
    )
    .select(
      "tournament player1.fullName player2.fullName payment.status seed createdAt",
    )
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  const validRegs = regs.filter((r) => r.tournament);
  if (!validRegs.length) return { history: [], total: 0 };

  // Batch: single aggregation for ALL registrations (eliminates N+1)
  const regIds = validRegs.map((r) => r._id);
  const matchStats = await Match.aggregate([
    {
      $match: {
        $or: [{ pairA: { $in: regIds } }, { pairB: { $in: regIds } }],
        status: "finished",
      },
    },
    {
      $addFields: {
        regId: {
          $cond: [{ $in: ["$pairA", regIds] }, "$pairA", "$pairB"],
        },
        isWin: {
          $or: [
            { $and: [{ $in: ["$pairA", regIds] }, { $eq: ["$winner", "A"] }] },
            { $and: [{ $in: ["$pairB", regIds] }, { $eq: ["$winner", "B"] }] },
          ],
        },
      },
    },
    {
      $group: {
        _id: "$regId",
        total: { $sum: 1 },
        wins: { $sum: { $cond: ["$isWin", 1, 0] } },
      },
    },
  ]);

  const statsMap = {};
  matchStats.forEach((s) => {
    statsMap[String(s._id)] = s;
  });

  const history = validRegs.map((r) => {
    const s = statsMap[String(r._id)] || { total: 0, wins: 0 };
    return {
      tournament: r.tournament.name,
      tournamentId: r.tournament._id,
      status: r.tournament.status,
      startDate: r.tournament.startDate,
      location: r.tournament.location,
      team: [r.player1?.fullName, r.player2?.fullName]
        .filter(Boolean)
        .join(" & "),
      seed: r.seed || null,
      paymentStatus: r.payment?.status || null,
      matchesPlayed: s.total,
      wins: s.wins,
      losses: s.total - s.wins,
    };
  });

  return { history, total: history.length };
}

// ═══════════════════════════════════════════════════════════
// 🌳 GET BRACKET MATCH TREE - Cây bracket / đường tiến
// ═══════════════════════════════════════════════════════════

export async function get_bracket_match_tree({ bracketId, tournamentId }, ctx) {
  const bid = bracketId || ctx?.bracketId;
  const tid = tournamentId || ctx?.tournamentId;

  const filter = {};
  if (bid) filter.bracket = toObjectId(bid);
  else if (tid) filter.tournament = toObjectId(tid);
  else return { error: "Cần bracketId hoặc tournamentId" };

  const matches = await Match.find(filter)
    .select(
      "code round order status winner pairA pairB nextMatch nextSlot branch phase pool labelKey stageIndex",
    )
    .populate("pairA", "player1.fullName player2.fullName seed")
    .populate("pairB", "player1.fullName player2.fullName seed")
    .sort({ stageIndex: 1, round: 1, order: 1 })
    .limit(200)
    .lean();

  const tree = matches.map((m) => ({
    id: m._id,
    code: m.code,
    labelKey: m.labelKey,
    round: m.round,
    order: m.order,
    branch: m.branch,
    phase: m.phase,
    pool: m.pool?.name || null,
    status: m.status,
    teamA: m.pairA
      ? {
          name: [m.pairA.player1?.fullName, m.pairA.player2?.fullName]
            .filter(Boolean)
            .join(" & "),
          seed: m.pairA.seed || null,
        }
      : null,
    teamB: m.pairB
      ? {
          name: [m.pairB.player1?.fullName, m.pairB.player2?.fullName]
            .filter(Boolean)
            .join(" & "),
          seed: m.pairB.seed || null,
        }
      : null,
    winner: m.winner || null,
    nextMatch: m.nextMatch || null,
    nextSlot: m.nextSlot || null,
  }));

  return { matches: tree, total: tree.length };
}

// ═══════════════════════════════════════════════════════════
// 🆓 GET USER MATCH HISTORY - Lịch sử trận tự do
// ═══════════════════════════════════════════════════════════

export async function get_user_match_history(
  { userId, category, status, limit = 15 },
  ctx,
) {
  const uid = userId || ctx?.currentUserId;
  if (!uid) return { error: "Cần userId" };

  const filter = {
    $or: [
      { createdBy: toObjectId(uid) },
      { "participants.user": toObjectId(uid) },
    ],
  };
  if (category) filter.category = category;
  if (status) filter.status = status;

  const matches = await UserMatch.find(filter)
    .select(
      "title category status winner gameScores participants scheduledAt createdAt location.name visibility tags",
    )
    .populate("participants.user", "name nickname")
    .sort({ scheduledAt: -1, createdAt: -1 })
    .limit(Math.min(Number(limit) || 15, 30))
    .lean();

  return {
    matches: matches.map((m) => {
      const userSide = m.participants?.find(
        (p) => String(p.user?._id || p.user) === String(uid),
      )?.side;
      const isWinner = m.winner && m.winner === userSide;
      return {
        title: m.title,
        category: m.category,
        status: m.status,
        result: m.status === "finished" ? (isWinner ? "WIN" : "LOSS") : null,
        scores: (m.gameScores || []).map((g) => `${g.a}-${g.b}`).join(", "),
        players:
          m.participants?.map((p) => ({
            name: p.user?.name || p.displayName || "?",
            side: p.side,
          })) || [],
        location: m.location?.name || null,
        date: m.scheduledAt || m.createdAt,
        tags: m.tags || [],
      };
    }),
    total: matches.length,
  };
}

// ═══════════════════════════════════════════════════════════
// 🎂 GET TOURNAMENT AGE CHECK - Kiểm tra điều kiện tuổi
// ═══════════════════════════════════════════════════════════

export async function get_tournament_age_check(
  { tournamentId, userId, dob },
  ctx,
) {
  const tid = tournamentId || ctx?.tournamentId;
  if (!tid) return { error: "Cần tournamentId" };

  const tournament = await Tournament.findById(toObjectId(tid))
    .select("name ageRestriction startDate")
    .lean();

  if (!tournament) return { error: "Không tìm thấy giải" };

  const ar = tournament.ageRestriction || {};
  if (!ar.enabled) {
    return {
      tournament: tournament.name,
      eligible: true,
      message: "Giải không giới hạn tuổi",
    };
  }

  // Try to get user DOB
  let userDob = dob ? new Date(dob) : null;
  if (!userDob) {
    const uid = userId || ctx?.currentUserId;
    if (uid) {
      const user = await User.findById(toObjectId(uid))
        .select("dob name")
        .lean();
      userDob = user?.dob;
    }
  }

  const result = {
    tournament: tournament.name,
    minAge: ar.minAge || 0,
    maxAge: ar.maxAge || 0,
    minBirthYear: ar.minBirthYear || null,
    maxBirthYear: ar.maxBirthYear || null,
  };

  if (!userDob) {
    result.eligible = null;
    result.message = `Giới hạn tuổi: ${ar.minAge || 0}-${ar.maxAge || 0}. Không có ngày sinh để kiểm tra.`;
  } else {
    const age = calcAge(userDob);
    const minOk = !ar.minAge || age >= ar.minAge;
    const maxOk = !ar.maxAge || age <= ar.maxAge;
    result.userAge = age;
    result.eligible = minOk && maxOk;
    result.message = result.eligible
      ? `Đủ điều kiện tuổi (${age} tuổi)`
      : `Không đủ tuổi (${age} tuổi, yêu cầu ${ar.minAge}-${ar.maxAge})`;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// ⏱️ GET MATCH DURATION - Thời lượng trận đấu
// ═══════════════════════════════════════════════════════════

export async function get_match_duration(
  { matchId, tournamentId, limit = 10 },
  ctx,
) {
  const mid = matchId || ctx?.matchId;

  if (mid) {
    // Single match
    const m = await Match.findById(toObjectId(mid))
      .select(
        "code startedAt finishedAt status pairA pairB gameScores currentGame",
      )
      .populate("pairA", "player1.fullName player2.fullName")
      .populate("pairB", "player1.fullName player2.fullName")
      .lean();

    if (!m) return { error: "Không tìm thấy trận" };

    const duration =
      m.startedAt && m.finishedAt
        ? Math.round((new Date(m.finishedAt) - new Date(m.startedAt)) / 60000)
        : null;

    return {
      code: m.code,
      teamA: [m.pairA?.player1?.fullName, m.pairA?.player2?.fullName]
        .filter(Boolean)
        .join(" & "),
      teamB: [m.pairB?.player1?.fullName, m.pairB?.player2?.fullName]
        .filter(Boolean)
        .join(" & "),
      status: m.status,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt,
      durationMinutes: duration,
      totalGames: (m.gameScores || []).length,
      currentGame: m.currentGame,
    };
  }

  // Tournament-wide duration stats
  const tid = tournamentId || ctx?.tournamentId;
  if (!tid) return { error: "Cần matchId hoặc tournamentId" };

  const stats = await Match.aggregate([
    {
      $match: {
        tournament: toObjectId(tid),
        status: "finished",
        startedAt: { $ne: null },
        finishedAt: { $ne: null },
      },
    },
    {
      $project: {
        duration: {
          $divide: [{ $subtract: ["$finishedAt", "$startedAt"] }, 60000],
        },
        gamesCount: { $size: { $ifNull: ["$gameScores", []] } },
      },
    },
    {
      $group: {
        _id: null,
        avgDuration: { $avg: "$duration" },
        minDuration: { $min: "$duration" },
        maxDuration: { $max: "$duration" },
        totalMatches: { $sum: 1 },
        avgGames: { $avg: "$gamesCount" },
      },
    },
  ]);

  const s = stats[0] || {};
  return {
    totalMatches: s.totalMatches || 0,
    avgDurationMinutes: s.avgDuration ? +s.avgDuration.toFixed(1) : 0,
    minDurationMinutes: s.minDuration ? +s.minDuration.toFixed(1) : 0,
    maxDurationMinutes: s.maxDuration ? +s.maxDuration.toFixed(1) : 0,
    avgGamesPerMatch: s.avgGames ? +s.avgGames.toFixed(1) : 0,
  };
}

// ═══════════════════════════════════════════════════════════
// 🔥 GENERIC QUERY TOOL - GPT tự query bất kỳ collection nào
// ═══════════════════════════════════════════════════════════

/**
 * Generic database query tool
 * GPT tự quyết định collection, filter, sort, limit
 * Có whitelist collection + safe select để bảo mật
 */
export async function query_db(
  { collection, filter = {}, sort, limit = 10, populate },
  context,
) {
  // Validate collection
  const Model = MODEL_MAP[collection];
  if (!Model) {
    return {
      error: `Collection "${collection}" không hợp lệ. Các collection có sẵn: ${Object.keys(MODEL_MAP).join(", ")}`,
    };
  }

  // Parse filter - convert ObjectId strings
  const parsedFilter = parseFilter(filter, context);

  // Build query
  let query = Model.find(parsedFilter);

  // Enforce safe select (đặc biệt cho users - không trả phone/email)
  const safeFields = SAFE_SELECT[collection];
  if (safeFields) {
    // Nếu query users collection và KHÔNG phải data của chính mình → ép safe select
    if (collection === "users") {
      const isOwnData =
        parsedFilter._id &&
        context?.currentUserId &&
        String(parsedFilter._id) === String(context.currentUserId);
      if (!isOwnData) {
        query = query.select(safeFields);
      }
    } else {
      query = query.select(safeFields);
    }
  }

  // Sort
  if (sort && typeof sort === "object") {
    query = query.sort(sort);
  }

  // Limit (max 20 để tránh quá nhiều data)
  query = query.limit(Math.min(Number(limit) || 10, 20));

  // Populate (nếu cần)
  if (populate && typeof populate === "string") {
    query = query.populate(populate);
  }

  const docs = await query.lean();

  // Post-process users: thêm age
  const results =
    collection === "users"
      ? docs.map((d) => ({ ...d, age: calcAge(d.dob) }))
      : docs;

  return {
    collection,
    results,
    count: results.length,
  };
}

/**
 * Thống kê chi tiết 1 VĐV (win rate, total matches, ...)
 */
export async function get_user_stats({ userId, name }, context) {
  // Tìm user bằng ID hoặc tên
  let user;
  if (userId) {
    user = await User.findById(toObjectId(userId))
      .select("name nickname localRatings province gender dob")
      .lean();
  } else if (name) {
    user = await User.findOne({
      name: { $regex: escapeRegex(name), $options: "i" },
      isDeleted: false,
    })
      .select("name nickname localRatings province gender dob")
      .lean();
  }

  if (!user) return { error: "Không tìm thấy VĐV" };

  const uid = user._id;

  // 1) Get all registration IDs for this user (one query, reuse everywhere)
  const regIds = await Registration.find({
    $or: [{ "player1.user": uid }, { "player2.user": uid }],
  }).distinct("_id");

  // 2) Run everything in parallel
  const [totalMatches, wonMatches, totalTournaments] = await Promise.all([
    Match.countDocuments({
      status: "finished",
      participants: uid,
    }),
    Match.countDocuments({
      status: "finished",
      participants: uid,
      $or: [
        { winner: "A", pairA: { $in: regIds } },
        { winner: "B", pairB: { $in: regIds } },
      ],
    }),
    Registration.distinct("tournament", {
      $or: [{ "player1.user": uid }, { "player2.user": uid }],
    }).then((ids) => ids.length),
  ]);

  const lostMatches = totalMatches - wonMatches;
  const winRate =
    totalMatches > 0 ? Math.round((wonMatches / totalMatches) * 100) : 0;

  return {
    name: user.name,
    nickname: user.nickname,
    province: user.province,
    gender: user.gender,
    age: calcAge(user.dob),
    ratingDoubles: user.localRatings?.doubles || 2.5,
    ratingSingles: user.localRatings?.singles || 2.5,
    matchesDoubles: user.localRatings?.matchesDoubles || 0,
    matchesSingles: user.localRatings?.matchesSingles || 0,
    totalMatches,
    wonMatches,
    lostMatches,
    winRate: `${winRate}%`,
    totalTournaments,
  };
}

// ═══════════ HELPER: Parse filter ═══════════

function parseFilter(filter, context = {}) {
  if (!filter || typeof filter !== "object") return {};

  const result = JSON.parse(JSON.stringify(filter));

  function walk(obj) {
    for (const key in obj) {
      const val = obj[key];
      if (typeof val === "string") {
        // Replace context variables
        if (val === "{{currentUserId}}" && context.currentUserId) {
          obj[key] = toObjectId(String(context.currentUserId));
        } else if (val === "{{tournamentId}}" && context.tournamentId) {
          obj[key] = toObjectId(context.tournamentId);
        } else if (val === "{{matchId}}" && context.matchId) {
          obj[key] = toObjectId(context.matchId);
        } else if (val === "{{bracketId}}" && context.bracketId) {
          obj[key] = toObjectId(context.bracketId);
        } else if (val === "{{courtCode}}" && context.courtCode) {
          obj[key] = context.courtCode; // STRING, not ObjectId
        } else if (
          (key === "_id" ||
            key === "tournament" ||
            key === "user" ||
            key === "bracket" ||
            key === "match") &&
          mongoose.Types.ObjectId.isValid(val)
        ) {
          obj[key] = toObjectId(val);
        }
      } else if (typeof val === "object" && val !== null) {
        walk(val);
      }
    }
  }

  walk(result);
  return result;
}

// ═══════════ GET TOURNAMENT STANDINGS (Xếp hạng kết quả giải) ═══════════

export async function get_tournament_standings(
  { tournamentId, bracketId },
  ctx,
) {
  try {
    const tid = tournamentId || ctx?.tournamentId;
    if (!tid) return { error: "Thiếu tournamentId" };

    // Find brackets for this tournament
    let brackets;
    if (bracketId) {
      brackets = await Bracket.find({ _id: toObjectId(bracketId) })
        .select("type name stage tournament")
        .lean();
    } else {
      brackets = await Bracket.find({
        tournament: toObjectId(tid),
        type: "knockout",
      })
        .select("type name stage tournament")
        .lean();
    }

    if (!brackets.length)
      return { message: "Không tìm thấy bracket knockout cho giải này." };

    const allStandings = [];

    for (const br of brackets) {
      if (br.type !== "knockout") continue;

      const matches = await Match.find({ bracket: br._id })
        .select("branch round status winner pairA pairB meta isThirdPlace")
        .lean();

      if (!matches.length) continue;

      const mainMatches = matches.filter((m) => m.branch === "main");
      if (!mainMatches.length) continue;

      const maxRound = mainMatches.reduce(
        (acc, m) => Math.max(acc, Number(m.round || 0)),
        0,
      );
      if (!maxRound || !Number.isFinite(maxRound)) continue;

      const finals = mainMatches.filter((m) => Number(m.round) === maxRound);
      if (finals.length !== 1) continue;

      const final = finals[0];
      if (final.status !== "finished" || !final.winner) {
        allStandings.push({
          bracket: br.name || br._id,
          status: "Chưa hoàn tất - trận chung kết chưa kết thúc",
        });
        continue;
      }

      const pairAId = final.pairA ? String(final.pairA) : null;
      const pairBId = final.pairB ? String(final.pairB) : null;

      let championRegId = null;
      let runnerUpRegId = null;
      if (pairAId && pairBId) {
        if (final.winner === "A") {
          championRegId = pairAId;
          runnerUpRegId = pairBId;
        } else {
          championRegId = pairBId;
          runnerUpRegId = pairAId;
        }
      }

      // 3rd / 4th place
      let thirdRegIds = [];
      let fourthRegIds = [];

      const thirdMatch =
        matches.find((m) => m.isThirdPlace) ||
        matches.find((m) => m.meta?.thirdPlace) ||
        matches.find((m) => {
          if (m.branch !== "consol") return false;
          const label = m.meta?.stageLabel;
          if (typeof label !== "string") return false;
          const l = label.toLowerCase();
          return l.includes("3/4") || l.includes("3-4") || l.includes("hạng 3");
        });

      if (thirdMatch && thirdMatch.status === "finished" && thirdMatch.winner) {
        const tAId = thirdMatch.pairA ? String(thirdMatch.pairA) : null;
        const tBId = thirdMatch.pairB ? String(thirdMatch.pairB) : null;
        if (tAId && tBId) {
          if (thirdMatch.winner === "A") {
            thirdRegIds = [tAId];
            fourthRegIds = [tBId];
          } else {
            thirdRegIds = [tBId];
            fourthRegIds = [tAId];
          }
        }
      } else {
        // No 3rd-place match → co-3rd = semi-final losers
        const semiRound = maxRound - 1;
        const semiMatches = mainMatches.filter(
          (m) => Number(m.round) === semiRound && m.status === "finished",
        );
        const losers = [];
        for (const sm of semiMatches) {
          const sAId = sm.pairA ? String(sm.pairA) : null;
          const sBId = sm.pairB ? String(sm.pairB) : null;
          if (!sAId || !sBId || !sm.winner) continue;
          losers.push(sm.winner === "A" ? sBId : sAId);
        }
        thirdRegIds = losers;
      }

      // Populate registration names
      const allRegIds = [
        championRegId,
        runnerUpRegId,
        ...thirdRegIds,
        ...fourthRegIds,
      ].filter((id) => id && mongoose.Types.ObjectId.isValid(id));

      const regs = await Registration.find({ _id: { $in: allRegIds } })
        .select("player1 player2")
        .populate({
          path: "player1.user",
          select: "fullName nickname displayName",
        })
        .populate({
          path: "player2.user",
          select: "fullName nickname displayName",
        })
        .lean();

      const regMap = new Map(regs.map((r) => [String(r._id), r]));

      const buildName = (reg) => {
        if (!reg) return "Chưa rõ";
        const p1 =
          reg.player1?.nickName ||
          reg.player1?.fullName ||
          reg.player1?.displayName ||
          reg.player1?.user?.nickname ||
          reg.player1?.user?.fullName ||
          "VĐV 1";
        const p2 =
          reg.player2?.nickName ||
          reg.player2?.fullName ||
          reg.player2?.displayName ||
          reg.player2?.user?.nickname ||
          reg.player2?.user?.fullName ||
          null;
        return p2 ? `${p1} & ${p2}` : p1;
      };

      const standing = {
        bracket: br.name || String(br._id),
        champion: championRegId
          ? buildName(regMap.get(String(championRegId)))
          : null,
        runnerUp: runnerUpRegId
          ? buildName(regMap.get(String(runnerUpRegId)))
          : null,
        thirdPlace: thirdRegIds.map((id) => buildName(regMap.get(String(id)))),
        fourthPlace: fourthRegIds.map((id) =>
          buildName(regMap.get(String(id))),
        ),
        isCoThird: thirdRegIds.length > 1,
      };

      allStandings.push(standing);
    }

    if (!allStandings.length)
      return { message: "Giải này chưa có kết quả xếp hạng." };
    return { standings: allStandings };
  } catch (err) {
    return { error: err.message };
  }
}
