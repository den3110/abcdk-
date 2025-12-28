// controllers/head2headController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import User from "../models/userModel.js";
import Registration from "../models/registrationModel.js";

/* =========================
 * Helpers
 * ========================= */
const OID = (v) => new mongoose.Types.ObjectId(String(v));

const isValidOid = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const FINISHED_FILTER = {
  status: "finished",
  winner: { $in: ["A", "B"] }, // chỉ tính trận có winner rõ
};

const sumGamePoints = (gameScores, key) =>
  (gameScores || []).reduce((sum, g) => sum + (Number(g?.[key]) || 0), 0);

const toUserIdString = (v) => String(v?._id || v || "");

/**
 * match.pairA/pairB đã populate Registration:
 * - pair.player1.user / pair.player2.user có thể là ObjectId hoặc object user
 */
function getUserSideInPopulatedMatch(match, userId) {
  const uid = String(userId);

  const p1A = toUserIdString(match?.pairA?.player1?.user);
  const p2A = toUserIdString(match?.pairA?.player2?.user);
  if (p1A === uid || p2A === uid) return "A";

  const p1B = toUserIdString(match?.pairB?.player1?.user);
  const p2B = toUserIdString(match?.pairB?.player2?.user);
  if (p1B === uid || p2B === uid) return "B";

  return null;
}

function calculateMatchStats(match, player1Side) {
  const scores = match.gameScores || [];
  let player1Sets = 0;
  let player2Sets = 0;
  let player1Points = 0;
  let player2Points = 0;

  for (const game of scores) {
    const scoreA = Number(game?.a) || 0;
    const scoreB = Number(game?.b) || 0;

    if (player1Side === "A") {
      player1Points += scoreA;
      player2Points += scoreB;
      if (scoreA > scoreB) player1Sets++;
      else if (scoreB > scoreA) player2Sets++;
    } else {
      player1Points += scoreB;
      player2Points += scoreA;
      if (scoreB > scoreA) player1Sets++;
      else if (scoreA > scoreB) player2Sets++;
    }
  }

  return { player1Sets, player2Sets, player1Points, player2Points };
}

async function getRegistrationIdsOfUser(userId) {
  const uid = OID(userId);
  const regs = await Registration.find({
    $or: [{ "player1.user": uid }, { "player2.user": uid }],
  })
    .select("_id")
    .lean();

  return regs.map((r) => r._id);
}

function buildH2HPairsFilter(regIds1, regIds2) {
  // chỉ build nếu đủ reg ids
  if (!Array.isArray(regIds1) || !regIds1.length) return null;
  if (!Array.isArray(regIds2) || !regIds2.length) return null;

  return {
    ...FINISHED_FILTER,
    $or: [
      { pairA: { $in: regIds1 }, pairB: { $in: regIds2 } },
      { pairA: { $in: regIds2 }, pairB: { $in: regIds1 } },
    ],
  };
}

/* =========================
 * 1) Head to Head summary
 * GET /api/head2head/:player1Id/:player2Id
 * ========================= */
export const getHead2Head = asyncHandler(async (req, res) => {
  const { player1Id, player2Id } = req.params;

  if (!isValidOid(player1Id) || !isValidOid(player2Id)) {
    res.status(400);
    throw new Error("Invalid player IDs");
  }
  if (String(player1Id) === String(player2Id)) {
    res.status(400);
    throw new Error("Cannot compare a player with themselves");
  }

  const [regIds1, regIds2] = await Promise.all([
    getRegistrationIdsOfUser(player1Id),
    getRegistrationIdsOfUser(player2Id),
  ]);

  const filter = buildH2HPairsFilter(regIds1, regIds2);
  if (!filter) {
    // 1 trong 2 user không có registration => chắc chắn không có match đối đầu kiểu pairA/pairB
    return res.json({
      success: true,
      data: {
        totalMatches: 0,
        player1Wins: 0,
        player2Wins: 0,
        player1Sets: 0,
        player2Sets: 0,
        player1Points: 0,
        player2Points: 0,
        player1AvgScore: 0,
        player2AvgScore: 0,
        winRate: 0,
        lastMatch: null,
        matches: [],
      },
    });
  }

  const matches = await Match.find(filter)
    .populate({
      path: "pairA",
      select: "player1 player2 teamName",
      populate: [
        { path: "player1.user", select: "nickname name avatar" },
        { path: "player2.user", select: "nickname name avatar" },
      ],
    })
    .populate({
      path: "pairB",
      select: "player1 player2 teamName",
      populate: [
        { path: "player1.user", select: "nickname name avatar" },
        { path: "player2.user", select: "nickname name avatar" },
      ],
    })
    .populate("tournament", "name image")
    .sort({ finishedAt: -1, updatedAt: -1 })
    .lean();

  let player1Wins = 0;
  let player2Wins = 0;
  let player1Sets = 0;
  let player2Sets = 0;
  let player1Points = 0;
  let player2Points = 0;

  const processedMatches = [];

  for (const match of matches) {
    const player1Side = getUserSideInPopulatedMatch(match, player1Id);
    if (!player1Side) continue;

    const isPlayer1Winner =
      (player1Side === "A" && match.winner === "A") ||
      (player1Side === "B" && match.winner === "B");

    if (isPlayer1Winner) player1Wins++;
    else player2Wins++;

    const stats = calculateMatchStats(match, player1Side);
    player1Sets += stats.player1Sets;
    player2Sets += stats.player2Sets;
    player1Points += stats.player1Points;
    player2Points += stats.player2Points;

    const scoreA = sumGamePoints(match.gameScores, "a");
    const scoreB = sumGamePoints(match.gameScores, "b");

    processedMatches.push({
      _id: match._id,
      tournamentId: match.tournament?._id,
      tournamentName: match.tournament?.name || "Trận giao hữu",
      tournamentImage: match.tournament?.image,
      date: match.finishedAt || match.updatedAt,
      score1: player1Side === "A" ? scoreA : scoreB,
      score2: player1Side === "A" ? scoreB : scoreA,
      gameScores: (match.gameScores || []).map((g) => ({
        player1: player1Side === "A" ? g?.a || 0 : g?.b || 0,
        player2: player1Side === "A" ? g?.b || 0 : g?.a || 0,
      })),
      winnerId: isPlayer1Winner ? String(player1Id) : String(player2Id),
      player1Side,
      winner: match.winner,
    });
  }

  const totalMatches = player1Wins + player2Wins;

  const player1AvgScore =
    totalMatches > 0 ? Number((player1Points / totalMatches).toFixed(1)) : 0;
  const player2AvgScore =
    totalMatches > 0 ? Number((player2Points / totalMatches).toFixed(1)) : 0;

  res.json({
    success: true,
    data: {
      totalMatches,
      player1Wins,
      player2Wins,
      player1Sets,
      player2Sets,
      player1Points,
      player2Points,
      player1AvgScore,
      player2AvgScore,
      winRate:
        totalMatches > 0
          ? Number(((player1Wins / totalMatches) * 100).toFixed(1))
          : 0,
      lastMatch: processedMatches[0]?.date || null,
      matches: processedMatches.slice(0, 10),
    },
  });
});

/* =========================
 * 2) Head to Head matches (pagination)
 * GET /api/head2head/:player1Id/:player2Id/matches?page=&limit=
 * ========================= */
export const getHead2HeadMatches = asyncHandler(async (req, res) => {
  const { player1Id, player2Id } = req.params;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const skip = (page - 1) * limit;

  if (!isValidOid(player1Id) || !isValidOid(player2Id)) {
    res.status(400);
    throw new Error("Invalid player IDs");
  }
  if (String(player1Id) === String(player2Id)) {
    res.status(400);
    throw new Error("Cannot compare a player with themselves");
  }

  const [regIds1, regIds2] = await Promise.all([
    getRegistrationIdsOfUser(player1Id),
    getRegistrationIdsOfUser(player2Id),
  ]);

  const filter = buildH2HPairsFilter(regIds1, regIds2);
  if (!filter) {
    return res.json({
      success: true,
      data: {
        matches: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasMore: false,
        },
      },
    });
  }

  const [matches, total] = await Promise.all([
    Match.find(filter)
      .populate({
        path: "pairA",
        select: "player1 player2 teamName",
        populate: [
          { path: "player1.user", select: "nickname name avatar" },
          { path: "player2.user", select: "nickname name avatar" },
        ],
      })
      .populate({
        path: "pairB",
        select: "player1 player2 teamName",
        populate: [
          { path: "player1.user", select: "nickname name avatar" },
          { path: "player2.user", select: "nickname name avatar" },
        ],
      })
      .populate("tournament", "name image location")
      .populate("bracket", "name type")
      .sort({ finishedAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Match.countDocuments(filter),
  ]);

  const processedMatches = [];

  for (const match of matches) {
    const player1Side = getUserSideInPopulatedMatch(match, player1Id);
    if (!player1Side) continue;

    const isPlayer1Winner =
      (player1Side === "A" && match.winner === "A") ||
      (player1Side === "B" && match.winner === "B");

    const stats = calculateMatchStats(match, player1Side);

    processedMatches.push({
      _id: match._id,
      tournament: {
        _id: match.tournament?._id,
        name: match.tournament?.name || "Trận giao hữu",
        image: match.tournament?.image,
        location: match.tournament?.location,
      },
      bracket: {
        _id: match.bracket?._id,
        name: match.bracket?.name,
        type: match.bracket?.type,
      },
      date: match.finishedAt || match.updatedAt,
      round: match.round,
      code: match.code,
      rules: match.rules,
      gameScores: (match.gameScores || []).map((g) => ({
        player1: player1Side === "A" ? g?.a || 0 : g?.b || 0,
        player2: player1Side === "A" ? g?.b || 0 : g?.a || 0,
      })),
      setsWon: {
        player1: stats.player1Sets,
        player2: stats.player2Sets,
      },
      totalPoints: {
        player1: stats.player1Points,
        player2: stats.player2Points,
      },
      winnerId: isPlayer1Winner ? String(player1Id) : String(player2Id),
      isPlayer1Winner,
      player1Side,
      duration:
        match.startedAt && match.finishedAt
          ? Math.round(
              (new Date(match.finishedAt) - new Date(match.startedAt)) / 60000
            )
          : null,
    });
  }

  res.json({
    success: true,
    data: {
      matches: processedMatches,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    },
  });
});

/* =========================
 * 3) Frequent Opponents
 * GET /api/head2head/:playerId/opponents?limit=
 * ========================= */
export const getFrequentOpponents = asyncHandler(async (req, res) => {
  const { playerId } = req.params;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 30);

  if (!isValidOid(playerId)) {
    res.status(400);
    throw new Error("Invalid player ID");
  }

  const playerObjId = OID(playerId);

  // ✅ Không phụ thuộc participants nữa, dùng lookup registrations để xác định side + opponents
  const rows = await Match.aggregate([
    {
      $match: {
        ...FINISHED_FILTER,
        pairA: { $ne: null },
        pairB: { $ne: null },
      },
    },
    {
      $lookup: {
        from: "registrations",
        localField: "pairA",
        foreignField: "_id",
        as: "regA",
      },
    },
    {
      $lookup: {
        from: "registrations",
        localField: "pairB",
        foreignField: "_id",
        as: "regB",
      },
    },
    {
      $addFields: {
        regA: { $arrayElemAt: ["$regA", 0] },
        regB: { $arrayElemAt: ["$regB", 0] },
      },
    },
    {
      $addFields: {
        playerSide: {
          $switch: {
            branches: [
              {
                case: {
                  $or: [
                    { $eq: ["$regA.player1.user", playerObjId] },
                    { $eq: ["$regA.player2.user", playerObjId] },
                  ],
                },
                then: "A",
              },
              {
                case: {
                  $or: [
                    { $eq: ["$regB.player1.user", playerObjId] },
                    { $eq: ["$regB.player2.user", playerObjId] },
                  ],
                },
                then: "B",
              },
            ],
            default: null,
          },
        },
      },
    },
    { $match: { playerSide: { $in: ["A", "B"] } } },
    {
      $addFields: {
        isWinner: { $eq: ["$winner", "$playerSide"] },
        opponents: {
          $cond: [
            { $eq: ["$playerSide", "A"] },
            ["$regB.player1.user", "$regB.player2.user"],
            ["$regA.player1.user", "$regA.player2.user"],
          ],
        },
      },
    },
    { $unwind: "$opponents" },
    {
      $match: {
        $expr: {
          $and: [
            { $ne: ["$opponents", null] },
            { $ne: ["$opponents", playerObjId] },
          ],
        },
      },
    },
    {
      $group: {
        _id: "$opponents",
        matchCount: { $sum: 1 },
        wins: { $sum: { $cond: ["$isWinner", 1, 0] } },
        losses: { $sum: { $cond: ["$isWinner", 0, 1] } },
        lastPlayed: { $max: "$finishedAt" },
      },
    },
    { $sort: { matchCount: -1, lastPlayed: -1 } },
    { $limit: limit },
  ]);

  const oppIds = rows.map((r) => r._id).filter(Boolean);

  const users = await User.find({
    _id: { $in: oppIds },
    isDeleted: { $ne: true },
  })
    .select("nickname name avatar province cccdStatus localRatings")
    .lean();

  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const data = rows
    .map((r) => {
      const u = userMap.get(String(r._id));
      if (!u) return null;

      const matchCount = Number(r.matchCount) || 0;
      const wins = Number(r.wins) || 0;
      const losses = Number(r.losses) || 0;

      return {
        user: {
          _id: u._id,
          nickname: u.nickname,
          name: u.name,
          avatar: u.avatar,
          province: u.province,
          cccdStatus: u.cccdStatus,
          double: u.localRatings?.doubles || 0,
          single: u.localRatings?.singles || 0,
        },
        matchCount,
        wins,
        losses,
        winRate:
          matchCount > 0 ? Number(((wins / matchCount) * 100).toFixed(1)) : 0,
        lastPlayed: r.lastPlayed || null,
      };
    })
    .filter(Boolean);

  res.json({ success: true, data });
});

/* =========================
 * 4) Player Stats
 * GET /api/head2head/:playerId/stats
 * ========================= */
export const getPlayerStats = asyncHandler(async (req, res) => {
  const { playerId } = req.params;

  if (!isValidOid(playerId)) {
    res.status(400);
    throw new Error("Invalid player ID");
  }

  const playerObjId = OID(playerId);

  const [statsResult, user] = await Promise.all([
    Match.aggregate([
      {
        $match: {
          ...FINISHED_FILTER,
          pairA: { $ne: null },
          pairB: { $ne: null },
        },
      },
      {
        $lookup: {
          from: "registrations",
          localField: "pairA",
          foreignField: "_id",
          as: "regA",
        },
      },
      {
        $lookup: {
          from: "registrations",
          localField: "pairB",
          foreignField: "_id",
          as: "regB",
        },
      },
      {
        $addFields: {
          regA: { $arrayElemAt: ["$regA", 0] },
          regB: { $arrayElemAt: ["$regB", 0] },
        },
      },
      {
        $addFields: {
          playerSide: {
            $switch: {
              branches: [
                {
                  case: {
                    $or: [
                      { $eq: ["$regA.player1.user", playerObjId] },
                      { $eq: ["$regA.player2.user", playerObjId] },
                    ],
                  },
                  then: "A",
                },
                {
                  case: {
                    $or: [
                      { $eq: ["$regB.player1.user", playerObjId] },
                      { $eq: ["$regB.player2.user", playerObjId] },
                    ],
                  },
                  then: "B",
                },
              ],
              default: null,
            },
          },
        },
      },
      { $match: { playerSide: { $in: ["A", "B"] } } },
      {
        $addFields: {
          isWinner: { $eq: ["$winner", "$playerSide"] },
          totalGamesInMatch: { $size: { $ifNull: ["$gameScores", []] } },
        },
      },
      {
        $group: {
          _id: null,
          totalMatches: { $sum: 1 },
          wins: { $sum: { $cond: ["$isWinner", 1, 0] } },
          losses: { $sum: { $cond: ["$isWinner", 0, 1] } },
          totalGames: { $sum: "$totalGamesInMatch" },
        },
      },
    ]),
    User.findById(playerId)
      .select("nickname name avatar province cccdStatus localRatings")
      .lean(),
  ]);

  const stats = statsResult?.[0] || {
    totalMatches: 0,
    wins: 0,
    losses: 0,
    totalGames: 0,
  };

  const winRate =
    stats.totalMatches > 0
      ? Number(((stats.wins / stats.totalMatches) * 100).toFixed(1))
      : 0;

  // streak: lấy 20 trận gần nhất có pairA/pairB
  const regIds = await getRegistrationIdsOfUser(playerId);
  let currentStreak = 0;
  let streakType = null; // "win" | "loss"

  if (regIds.length) {
    const recentMatches = await Match.find({
      ...FINISHED_FILTER,
      $or: [{ pairA: { $in: regIds } }, { pairB: { $in: regIds } }],
    })
      .sort({ finishedAt: -1, updatedAt: -1 })
      .limit(20)
      .select("pairA pairB winner finishedAt updatedAt")
      .populate("pairA", "player1.user player2.user")
      .populate("pairB", "player1.user player2.user")
      .lean();

    for (const match of recentMatches) {
      const side = getUserSideInPopulatedMatch(match, playerId);
      if (!side || !match.winner) break;

      const isWin =
        (side === "A" && match.winner === "A") ||
        (side === "B" && match.winner === "B");

      if (streakType === null) {
        streakType = isWin ? "win" : "loss";
        currentStreak = 1;
      } else if (
        (streakType === "win" && isWin) ||
        (streakType === "loss" && !isWin)
      ) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  res.json({
    success: true,
    data: {
      user: user
        ? {
            _id: user._id,
            nickname: user.nickname,
            name: user.name,
            avatar: user.avatar,
            province: user.province,
            cccdStatus: user.cccdStatus,
            double: user.localRatings?.doubles || 0,
            single: user.localRatings?.singles || 0,
          }
        : null,
      stats: {
        totalMatches: stats.totalMatches,
        wins: stats.wins,
        losses: stats.losses,
        winRate,
        totalGames: stats.totalGames,
        currentStreak: {
          count: currentStreak,
          type: streakType,
        },
      },
    },
  });
});

/* =========================
 * 5) Search Players
 * GET /api/head2head/search?keyword=&limit=
 * ========================= */
export const searchPlayers = asyncHandler(async (req, res) => {
  const { keyword } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

  const kw = String(keyword || "").trim();
  if (!kw || kw.length < 2) {
    return res.json({ success: true, data: [] });
  }

  const regex = new RegExp(kw, "i");

  const users = await User.find({
    isDeleted: { $ne: true },
    $or: [{ nickname: regex }, { name: regex }, { phone: regex }],
  })
    .select("nickname name avatar province cccdStatus localRatings")
    .limit(limit)
    .lean();

  res.json({
    success: true,
    data: users.map((u) => ({
      _id: u._id,
      nickname: u.nickname,
      name: u.name,
      avatar: u.avatar,
      province: u.province,
      cccdStatus: u.cccdStatus,
      double: u.localRatings?.doubles || 0,
      single: u.localRatings?.singles || 0,
    })),
  });
});
