// controllers/head2headController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import User from "../models/userModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";

/**
 * Xác định user thuộc side nào (A/B) trong 1 trận đấu
 * @returns "A" | "B" | null
 */
async function getUserSideInMatch(match, userId) {
  const uid = String(userId);

  // Nếu đã populate pairA/pairB
  if (match.pairA?.player1?.user || match.pairA?.player2?.user) {
    const p1A = String(
      match.pairA?.player1?.user?._id || match.pairA?.player1?.user || ""
    );
    const p2A = String(
      match.pairA?.player2?.user?._id || match.pairA?.player2?.user || ""
    );
    if (p1A === uid || p2A === uid) return "A";

    const p1B = String(
      match.pairB?.player1?.user?._id || match.pairB?.player1?.user || ""
    );
    const p2B = String(
      match.pairB?.player2?.user?._id || match.pairB?.player2?.user || ""
    );
    if (p1B === uid || p2B === uid) return "B";

    return null;
  }

  // Nếu chưa populate, query Registration
  if (match.pairA) {
    const regA = await Registration.findById(match.pairA)
      .select("player1.user player2.user")
      .lean();
    if (regA) {
      const p1 = String(regA.player1?.user || "");
      const p2 = String(regA.player2?.user || "");
      if (p1 === uid || p2 === uid) return "A";
    }
  }

  if (match.pairB) {
    const regB = await Registration.findById(match.pairB)
      .select("player1.user player2.user")
      .lean();
    if (regB) {
      const p1 = String(regB.player1?.user || "");
      const p2 = String(regB.player2?.user || "");
      if (p1 === uid || p2 === uid) return "B";
    }
  }

  return null;
}

/**
 * Tính stats từ gameScores
 */
function calculateMatchStats(match, player1Side) {
  const scores = match.gameScores || [];
  let player1Sets = 0;
  let player2Sets = 0;
  let player1Points = 0;
  let player2Points = 0;

  for (const game of scores) {
    const scoreA = game.a || 0;
    const scoreB = game.b || 0;

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

/**
 * @desc    Lấy thống kê đối đầu giữa 2 người chơi
 * @route   GET /api/head2head/:player1Id/:player2Id
 * @access  Public
 */
export const getHead2Head = asyncHandler(async (req, res) => {
  const { player1Id, player2Id } = req.params;

  if (
    !mongoose.Types.ObjectId.isValid(player1Id) ||
    !mongoose.Types.ObjectId.isValid(player2Id)
  ) {
    res.status(400);
    throw new Error("Invalid player IDs");
  }
  if (player1Id === player2Id) {
    res.status(400);
    throw new Error("Cannot compare a player with themselves");
  }

  const p1 = new mongoose.Types.ObjectId(player1Id);
  const p2 = new mongoose.Types.ObjectId(player2Id);

  const matches = await Match.find({
    status: "finished",
    participants: { $all: [p1, p2] }, // ✅ dùng ObjectId
  })
    .populate({
      path: "pairA",
      select: "player1 player2",
      populate: [
        { path: "player1.user", select: "nickname name avatar" },
        { path: "player2.user", select: "nickname name avatar" },
      ],
    })
    .populate({
      path: "pairB",
      select: "player1 player2",
      populate: [
        { path: "player1.user", select: "nickname name avatar" },
        { path: "player2.user", select: "nickname name avatar" },
      ],
    })
    .populate("tournament", "name image")
    .sort({ finishedAt: -1, updatedAt: -1 })
    .lean();

  // ... giữ nguyên phần tính stats
});


/**
 * @desc    Lấy lịch sử đối đầu chi tiết (pagination)
 * @route   GET /api/head2head/:player1Id/:player2Id/matches
 * @access  Public
 */
export const getHead2HeadMatches = asyncHandler(async (req, res) => {
  const { player1Id, player2Id } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const skip = (page - 1) * limit;

  if (
    !mongoose.Types.ObjectId.isValid(player1Id) ||
    !mongoose.Types.ObjectId.isValid(player2Id)
  ) {
    res.status(400);
    throw new Error("Invalid player IDs");
  }

  const filter = {
    status: "finished",
    participants: { $all: [player1Id, player2Id] },
  };

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
      .sort({ finishedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Match.countDocuments(filter),
  ]);

  const processedMatches = [];

  for (const match of matches) {
    const player1Side = await getUserSideInMatch(match, player1Id);
    if (!player1Side) continue;

    const isPlayer1Winner =
      (player1Side === "A" && match.winner === "A") ||
      (player1Side === "B" && match.winner === "B");

    const stats = calculateMatchStats(match, player1Side);

    processedMatches.push({
      _id: match._id,
      tournament: {
        _id: match.tournament?._id,
        name: match.tournament?.name,
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
      gameScores: match.gameScores?.map((g) => ({
        player1: player1Side === "A" ? g.a : g.b,
        player2: player1Side === "A" ? g.b : g.a,
      })),
      setsWon: {
        player1: stats.player1Sets,
        player2: stats.player2Sets,
      },
      totalPoints: {
        player1: stats.player1Points,
        player2: stats.player2Points,
      },
      winnerId: isPlayer1Winner ? player1Id : player2Id,
      isPlayer1Winner,
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

/**
 * @desc    Lấy danh sách đối thủ thường xuyên của 1 người chơi
 * @route   GET /api/head2head/:playerId/opponents
 * @access  Public
 */
export const getFrequentOpponents = asyncHandler(async (req, res) => {
  const { playerId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 10, 30);

  if (!mongoose.Types.ObjectId.isValid(playerId)) {
    res.status(400);
    throw new Error("Invalid player ID");
  }

  // Aggregate để tìm đối thủ thường xuyên
  const opponents = await Match.aggregate([
    {
      $match: {
        status: "finished",
        participants: new mongoose.Types.ObjectId(playerId),
      },
    },
    { $unwind: "$participants" },
    {
      $match: {
        participants: { $ne: new mongoose.Types.ObjectId(playerId) },
      },
    },
    {
      $group: {
        _id: "$participants",
        matchCount: { $sum: 1 },
        lastPlayed: { $max: "$finishedAt" },
        matchIds: { $push: "$_id" },
      },
    },
    { $sort: { matchCount: -1, lastPlayed: -1 } },
    { $limit: limit },
  ]);

  // Lấy thông tin user và tính win/loss
  const opponentDetails = await Promise.all(
    opponents.map(async (opp) => {
      const user = await User.findById(opp._id)
        .select("nickname name avatar province cccdStatus localRatings")
        .lean();

      if (!user) return null;

      // Tính win/loss với đối thủ này
      const h2hMatches = await Match.find({
        _id: { $in: opp.matchIds },
      })
        .select("pairA pairB winner")
        .populate("pairA", "player1.user player2.user")
        .populate("pairB", "player1.user player2.user")
        .lean();

      let wins = 0;
      let losses = 0;

      for (const match of h2hMatches) {
        const playerSide = await getUserSideInMatch(match, playerId);
        if (!playerSide) continue;

        const isWinner =
          (playerSide === "A" && match.winner === "A") ||
          (playerSide === "B" && match.winner === "B");

        if (isWinner) wins++;
        else if (match.winner) losses++;
      }

      return {
        user: {
          _id: user._id,
          nickname: user.nickname,
          name: user.name,
          avatar: user.avatar,
          province: user.province,
          cccdStatus: user.cccdStatus,
          double: user.localRatings?.doubles || 0,
          single: user.localRatings?.singles || 0,
        },
        matchCount: opp.matchCount,
        wins,
        losses,
        winRate:
          opp.matchCount > 0 ? ((wins / opp.matchCount) * 100).toFixed(1) : 0,
        lastPlayed: opp.lastPlayed,
      };
    })
  );

  res.json({
    success: true,
    data: opponentDetails.filter(Boolean),
  });
});

/**
 * @desc    Lấy stats tổng hợp của 1 người chơi
 * @route   GET /api/head2head/:playerId/stats
 * @access  Public
 */
export const getPlayerStats = asyncHandler(async (req, res) => {
  const { playerId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(playerId)) {
    res.status(400);
    throw new Error("Invalid player ID");
  }

  const playerObjId = new mongoose.Types.ObjectId(playerId);

  // Aggregate stats
  const [statsResult, user] = await Promise.all([
    Match.aggregate([
      {
        $match: {
          status: "finished",
          participants: playerObjId,
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
            $cond: {
              if: {
                $or: [
                  { $eq: ["$regA.player1.user", playerObjId] },
                  { $eq: ["$regA.player2.user", playerObjId] },
                ],
              },
              then: "A",
              else: "B",
            },
          },
        },
      },
      {
        $addFields: {
          isWinner: {
            $eq: ["$winner", "$playerSide"],
          },
        },
      },
      {
        $group: {
          _id: null,
          totalMatches: { $sum: 1 },
          wins: { $sum: { $cond: ["$isWinner", 1, 0] } },
          losses: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ["$winner", ""] }, { $not: "$isWinner" }] },
                1,
                0,
              ],
            },
          },
          totalGames: { $sum: { $size: { $ifNull: ["$gameScores", []] } } },
        },
      },
    ]),
    User.findById(playerId)
      .select("nickname name avatar province cccdStatus localRatings")
      .lean(),
  ]);

  const stats = statsResult[0] || {
    totalMatches: 0,
    wins: 0,
    losses: 0,
    totalGames: 0,
  };

  // Tính thêm một số metrics
  const winRate =
    stats.totalMatches > 0
      ? ((stats.wins / stats.totalMatches) * 100).toFixed(1)
      : 0;

  // Lấy streak hiện tại
  const recentMatches = await Match.find({
    status: "finished",
    participants: playerObjId,
  })
    .sort({ finishedAt: -1 })
    .limit(20)
    .select("pairA pairB winner")
    .populate("pairA", "player1.user player2.user")
    .populate("pairB", "player1.user player2.user")
    .lean();

  let currentStreak = 0;
  let streakType = null; // "win" or "loss"

  for (const match of recentMatches) {
    const playerSide = await getUserSideInMatch(match, playerId);
    if (!playerSide || !match.winner) break;

    const isWin =
      (playerSide === "A" && match.winner === "A") ||
      (playerSide === "B" && match.winner === "B");

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
        winRate: parseFloat(winRate),
        totalGames: stats.totalGames,
        currentStreak: {
          count: currentStreak,
          type: streakType,
        },
      },
    },
  });
});

/**
 * @desc    Tìm kiếm người chơi (dùng cho modal search)
 * @route   GET /api/head2head/search
 * @access  Public
 */
export const searchPlayers = asyncHandler(async (req, res) => {
  const { keyword } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  if (!keyword || keyword.length < 2) {
    return res.json({ success: true, data: [] });
  }

  const regex = new RegExp(keyword, "i");

  const users = await User.find({
    isDeleted: { $ne: true },
    $or: [{ nickname: regex }, { name: regex }, { phone: regex }],
  })
    .select("nickname name avatar province cccdStatus localRatings")
    .limit(limit)
    .lean();

  const result = users.map((u) => ({
    _id: u._id,
    nickname: u.nickname,
    name: u.name,
    avatar: u.avatar,
    province: u.province,
    cccdStatus: u.cccdStatus,
    double: u.localRatings?.doubles || 0,
    single: u.localRatings?.singles || 0,
  }));

  res.json({
    success: true,
    data: result,
  });
});
