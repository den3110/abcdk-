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

  return { tournaments: docs, count: docs.length };
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
export async function search_users({ name, limit = 5 }) {
  if (!name) return { error: "Cần nhập tên để tìm" };

  const users = await User.find({
    name: { $regex: escapeRegex(name), $options: "i" },
    isDeleted: false,
  })
    .select("name nickname gender dob province localRatings")
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

  const pairName = (pair) => {
    if (!pair) return null;
    const p1 = pair.player1?.user?.name || pair.player1?.fullName || "";
    const p2 = pair.player2?.user?.name || pair.player2?.fullName || "";
    return p2 ? `${p1} & ${p2}` : p1;
  };

  return {
    round: match.round,
    code: match.code,
    status: match.status,
    winner: match.winner,
    courtLabel: match.courtLabel,
    format: match.format,
    teamA: pairName(match.pairA),
    teamB: pairName(match.pairB),
    gameScores: match.gameScores,
    startedAt: match.startedAt,
    finishedAt: match.finishedAt,
  };
}

/**
 * Bảng xếp hạng — dùng cùng sort order với trang ranking V2
 * Sort: colorRank ASC → double DESC → single DESC → points DESC
 */
export async function get_leaderboard({ limit = 10 }) {
  const list = await Ranking.aggregate([
    // Normalize nulls
    {
      $addFields: {
        points: { $ifNull: ["$points", 0] },
        single: { $ifNull: ["$single", 0] },
        double: { $ifNull: ["$double", 0] },
        mix: { $ifNull: ["$mix", 0] },
        reputation: { $ifNull: ["$reputation", 0] },
        colorRank: { $ifNull: ["$colorRank", 2] },
        tierColor: { $ifNull: ["$tierColor", "grey"] },
      },
    },
    // Same sort as ranking page V2
    {
      $sort: {
        colorRank: 1,
        double: -1,
        single: -1,
        points: -1,
        updatedAt: -1,
        _id: 1,
      },
    },
    // Lookup user info
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
    // Limit AFTER filtering
    { $limit: Number(limit) || 10 },
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
    players: list.map((u, i) => ({
      rank: i + 1,
      name: u.name,
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

  // Đếm tổng trận + thắng (Match model dùng participants[] và winner: "A"/"B")
  const uid = user._id;

  const [totalMatches, totalTournaments] = await Promise.all([
    Match.countDocuments({
      status: "finished",
      participants: uid,
    }),
    Registration.countDocuments({
      $or: [{ "player1.user": uid }, { "player2.user": uid }],
    }),
  ]);

  // Đếm thắng: user trong pairA và winner=A, hoặc user trong pairB và winner=B
  const wonMatches = await Match.countDocuments({
    status: "finished",
    participants: uid,
    $or: [
      {
        winner: "A",
        pairA: {
          $in: await Registration.find({
            $or: [{ "player1.user": uid }, { "player2.user": uid }],
          }).distinct("_id"),
        },
      },
      {
        winner: "B",
        pairB: {
          $in: await Registration.find({
            $or: [{ "player1.user": uid }, { "player2.user": uid }],
          }).distinct("_id"),
        },
      },
    ],
  });

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
