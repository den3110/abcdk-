// controllers/leaderboardController.js
// Version SIMPLE - Detect final từ bracket knockout (tính max round)
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";
import User from "../models/userModel.js";
import Bracket from "../models/bracketModel.js";
import Tournament from "../models/tournamentModel.js";

/**
 * GET /api/leaderboards/featured
 * Tự động detect final match từ bracket knockout:
 * - Final = round cao nhất trong bracket knockout
 * - Không phải trận tranh hạng 3
 */
export const getFeaturedLeaderboard = async (req, res, next) => {
  try {
    const sinceDays = Math.max(parseInt(req.query.sinceDays ?? "90", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit ?? "10", 10), 1),
      50
    );
    const minMatches = Math.max(parseInt(req.query.minMatches ?? "3", 10), 0);

    const since = new Date(Date.now() - sinceDays * 864e5);

    console.log("🔍 Leaderboard Query:", {
      sinceDays,
      limit,
      minMatches,
      sinceDate: since,
    });

    // 📊 BƯỚC 1: Tìm tất cả brackets knockout và max round của chúng
    const knockoutBrackets = await Bracket.find({ type: "knockout" })
      .select("_id")
      .lean();

    const knockoutBracketIds = knockoutBrackets.map((b) => b._id);

    console.log(`📊 Found ${knockoutBracketIds.length} knockout brackets`);

    // Tìm max round cho mỗi bracket knockout
    const maxRoundsAgg =
      knockoutBracketIds.length > 0
        ? await Match.aggregate([
            {
              $match: {
                bracket: { $in: knockoutBracketIds },
                status: "finished",
              },
            },
            {
              $group: {
                _id: "$bracket",
                maxRound: { $max: "$round" },
              },
            },
          ])
        : [];

    const maxRoundMap = new Map();
    for (const item of maxRoundsAgg) {
      maxRoundMap.set(String(item._id), item.maxRound);
    }

    console.log(`📊 Max rounds map size: ${maxRoundMap.size}`);

    // 📊 BƯỚC 2: Pipeline chính
    const pipeline = [
      // ✅ FIX: lọc thời gian bằng (finishedAt ?? updatedAt) để không bị lọt case finishedAt=null
      {
        $match: {
          status: "finished",
          winner: { $in: ["A", "B"] },
          $expr: {
            $gte: [{ $ifNull: ["$finishedAt", "$updatedAt"] }, since],
          },
        },
      },

      // (optional) tránh data lỗi pairA == pairB gây đếm x2
      {
        $match: {
          $expr: { $ne: ["$pairA", "$pairB"] },
        },
      },

      // Tạo 2 documents cho mỗi match (pairA & pairB)
      {
        $facet: {
          pairAStats: [
            {
              $project: {
                matchId: "$_id", // ✅ ADD để dedupe
                pairId: "$pairA",
                isWinner: { $eq: ["$winner", "A"] },
                timestamp: { $ifNull: ["$finishedAt", "$updatedAt"] },
                tournament: "$tournament",
                bracket: "$bracket",
                round: "$round",
                isThirdPlace: { $ifNull: ["$isThirdPlace", false] },
                metaThirdPlace: { $ifNull: ["$meta.thirdPlace", false] },
              },
            },
          ],
          pairBStats: [
            {
              $project: {
                matchId: "$_id", // ✅ ADD để dedupe
                pairId: "$pairB",
                isWinner: { $eq: ["$winner", "B"] },
                timestamp: { $ifNull: ["$finishedAt", "$updatedAt"] },
                tournament: "$tournament",
                bracket: "$bracket",
                round: "$round",
                isThirdPlace: { $ifNull: ["$isThirdPlace", false] },
                metaThirdPlace: { $ifNull: ["$meta.thirdPlace", false] },
              },
            },
          ],
        },
      },

      // Merge arrays
      {
        $project: {
          allPairs: { $concatArrays: ["$pairAStats", "$pairBStats"] },
        },
      },
      { $unwind: "$allPairs" },
      { $replaceRoot: { newRoot: "$allPairs" } },
      { $match: { pairId: { $ne: null, $exists: true } } },

      // ✅ FIX: DEDUPE theo (pairId, matchId) để không bị đếm trùng
      {
        $group: {
          _id: { pairId: "$pairId", matchId: "$matchId" },
          pairId: { $first: "$pairId" },
          matchId: { $first: "$matchId" },
          isWinner: { $max: "$isWinner" },
          timestamp: { $max: "$timestamp" },
          tournament: { $first: "$tournament" },
          bracket: { $first: "$bracket" },
          round: { $first: "$round" },
          isThirdPlace: { $max: "$isThirdPlace" },
          metaThirdPlace: { $max: "$metaThirdPlace" },
        },
      },

      // Group theo pairId
      {
        $group: {
          _id: "$pairId",
          totalMatches: { $sum: 1 },
          totalWins: { $sum: { $cond: ["$isWinner", 1, 0] } },
          lastWinDate: {
            $max: {
              $cond: ["$isWinner", "$timestamp", new Date(0)],
            },
          },
          tournamentsPlayed: { $addToSet: "$tournament" },
          matches: {
            $push: {
              matchId: "$matchId",
              bracket: "$bracket",
              round: "$round",
              isWinner: "$isWinner",
              isThirdPlace: "$isThirdPlace",
              metaThirdPlace: "$metaThirdPlace",
            },
          },
        },
      },

      // Lọc theo minMatches
      ...(minMatches > 0
        ? [{ $match: { totalMatches: { $gte: minMatches } } }]
        : []),

      // Lookup Registration (pair)
      {
        $lookup: {
          from: "registrations",
          localField: "_id",
          foreignField: "_id",
          as: "registration",
        },
      },
      {
        $unwind: {
          path: "$registration",
          preserveNullAndEmptyArrays: true,
        },
      },

      // Extract user IDs của 2 người trong pair
      {
        $addFields: {
          playerUsers: {
            $filter: {
              input: [
                "$registration.player1.user",
                "$registration.player2.user",
              ],
              as: "userId",
              cond: { $ne: ["$$userId", null] },
            },
          },
        },
      },
      {
        $unwind: {
          path: "$playerUsers",
          preserveNullAndEmptyArrays: false,
        },
      },

      // Group theo player (cộng stats của các pairs mà player đã chơi)
      {
        $group: {
          _id: "$playerUsers",
          totalMatches: { $sum: "$totalMatches" },
          totalWins: { $sum: "$totalWins" },
          lastWinDate: { $max: "$lastWinDate" },
          tournamentsPlayedArrays: { $push: "$tournamentsPlayed" },
          pairsCount: { $sum: 1 },
          allMatches: { $push: "$matches" },
        },
      },

      // Lookup User
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userInfo",
        },
      },
      {
        $unwind: {
          path: "$userInfo",
          preserveNullAndEmptyArrays: true,
        },
      },

      // Flatten tournament IDs để lookup
      {
        $addFields: {
          uniqueTournamentIds: {
            $reduce: {
              input: "$tournamentsPlayedArrays",
              initialValue: [],
              in: { $setUnion: ["$$value", "$$this"] },
            },
          },
        },
      },

      // Project
      {
        $project: {
          userId: "$_id",
          totalMatches: 1,
          totalWins: 1,
          lastWinDate: 1,
          pairsCount: 1,
          uniqueTournamentIds: 1,
          allMatches: 1,
          name: {
            $ifNull: [
              "$userInfo.name",
              "$userInfo.nickname",
              "$userInfo.nickName",
              "$userInfo.displayName",
              "Vận động viên",
            ],
          },
          nickname: {
            $ifNull: ["$userInfo.nickname", "$userInfo.nickName", ""],
          },
          avatar: {
            $ifNull: [
              "$userInfo.avatar",
              "$userInfo.avatarUrl",
              "$userInfo.photo",
              null,
            ],
          },
        },
      },
    ];

    const rows = await Match.aggregate(pipeline);

    console.log(`✅ Found ${rows.length} athletes (before processing)`);

    // 📊 BƯỚC 3: Process final wins ở JavaScript
    const processedRows = rows.map((r) => {
      let finalAppearances = 0;
      let finalWins = 0;

      // Flatten allMatches (vì mỗi pair có array matches)
      const allMatches = (r.allMatches || []).flat();

      for (const match of allMatches) {
        const bracketId = match?.bracket ? String(match.bracket) : null;
        if (!bracketId) continue;

        const maxRound = maxRoundMap.get(bracketId);

        const roundNum =
          typeof match.round === "number" ? match.round : Number(match.round);
        const maxRoundNum =
          typeof maxRound === "number" ? maxRound : Number(maxRound);

        const isThirdPlace = !!match.isThirdPlace;
        const metaThirdPlace = !!match.metaThirdPlace;

        // ✅ Check if this is a final match
        const isFinal =
          Number.isFinite(roundNum) &&
          Number.isFinite(maxRoundNum) &&
          roundNum === maxRoundNum &&
          !isThirdPlace &&
          !metaThirdPlace;

        if (isFinal) {
          finalAppearances++;
          if (match.isWinner) finalWins++;
        }
      }

      // Tính điểm
      const score =
        finalWins * 100 +
        finalAppearances * 60 +
        r.totalWins * 3 +
        r.totalMatches * 0.5;

      const winRate =
        r.totalMatches > 0
          ? Math.round((r.totalWins / r.totalMatches) * 1000) / 10
          : 0;

      return {
        ...r,
        finalAppearances,
        finalWins,
        score: Math.round(score * 100) / 100,
        winRate,
      };
    });

    // Sort
    processedRows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.finalWins !== a.finalWins) return b.finalWins - a.finalWins;
      if (b.finalAppearances !== a.finalAppearances)
        return b.finalAppearances - a.finalAppearances;
      if (b.totalWins !== a.totalWins) return b.totalWins - a.totalWins;
      return b.winRate - a.winRate;
    });

    // Take top N
    const topRows = processedRows.slice(0, limit);

    console.log(
      `📊 Athletes with final wins: ${
        topRows.filter((r) => r.finalWins > 0).length
      }`
    );

    // ✅ BƯỚC 4: Lookup tournament details cho top athletes
    const allTournamentIds = [
      ...new Set(
        topRows
          .map((r) => r.uniqueTournamentIds || [])
          .flat()
          .filter(Boolean)
          .map(String)
      ),
    ];

    console.log(`📊 Looking up ${allTournamentIds.length} unique tournaments`);

    const tournaments = await Tournament.find({
      _id: { $in: allTournamentIds },
    })
      .select("_id name image location startDate endDate status")
      .lean();

    const tournamentMap = new Map(tournaments.map((t) => [String(t._id), t]));

    // Format kết quả cuối
    const result = topRows.map((r, idx) => {
      const tourIds = (r.uniqueTournamentIds || []).filter(Boolean).map(String);
      const uniqueTournamentIds = [...new Set(tourIds)];

      const tournamentsDetails = uniqueTournamentIds
        .map((tid) => tournamentMap.get(tid))
        .filter(Boolean)
        .map((t) => ({
          id: t._id,
          name: t.name,
          image: t.image,
          location: t.location,
          startDate: t.startDate,
          endDate: t.endDate,
          status: t.status,
        }));

      const sinceLabel = sinceDays === 1 ? "24h" : `${sinceDays} ngày`;

      const achievements = [];

      if (r.finalWins > 0) {
        achievements.push({
          type: "champion",
          icon: "🏆",
          label: "Chức vô địch",
          value: r.finalWins,
        });
      }

      if (r.finalAppearances > 0) {
        achievements.push({
          type: "finalist",
          icon: "🎯",
          label: "Chung kết",
          value: r.finalAppearances,
        });
      }

      achievements.push({
        type: "wins",
        icon: "✅",
        label: "Trận thắng",
        value: r.totalWins,
        total: r.totalMatches,
        winRate: r.winRate,
      });

      if (tournamentsDetails.length > 0) {
        achievements.push({
          type: "tournaments",
          icon: "🏆",
          label: "Giải đấu",
          value: tournamentsDetails.length,
        });
      }

      achievements.push({
        type: "period",
        icon: "📅",
        label: "Thời gian",
        value: sinceLabel,
      });

      return {
        userId: r.userId,
        rank: idx + 1,
        score: r.score,
        wins: r.totalWins,
        matches: r.totalMatches,
        winRate: r.winRate,
        finalApps: r.finalAppearances,
        finalWins: r.finalWins,
        tournaments: tournamentsDetails,
        lastWinAt: r.lastWinDate,
        name: r.name,
        nickname: r.nickname,
        avatar: r.avatar,
        achievements,
      };
    });

    return res.json({
      success: true,
      sinceDays,
      generatedAt: new Date(),
      count: result.length,
      items: result,
    });
  } catch (err) {
    console.error("❌ Leaderboard Error:", err);
    next(err);
  }
};

// DEBUG ENDPOINT
export const debugLeaderboard = async (req, res, next) => {
  try {
    const matchCount = await Match.countDocuments({ status: "finished" });
    const withWinner = await Match.countDocuments({
      status: "finished",
      winner: { $in: ["A", "B"] },
    });

    // Knockout brackets info
    const knockoutBrackets = await Bracket.find({ type: "knockout" })
      .select("_id name")
      .lean();

    const knockoutBracketIds = knockoutBrackets.map((b) => b._id);

    // Max rounds per bracket
    const maxRoundsAgg = await Match.aggregate([
      {
        $match: {
          bracket: { $in: knockoutBracketIds },
          status: "finished",
        },
      },
      {
        $group: {
          _id: "$bracket",
          maxRound: { $max: "$round" },
          matchCount: { $sum: 1 },
        },
      },
    ]);

    const regCount = await Registration.countDocuments();
    const userCount = await User.countDocuments();

    const sampleMatch = await Match.findOne({ status: "finished" })
      .select(
        "pairA pairB winner status finishedAt tournament bracket round isThirdPlace"
      )
      .lean();

    const sampleReg = await Registration.findOne()
      .select("players player1 player2")
      .lean();

    const regStructure = sampleReg
      ? {
          hasPlayersArray: Array.isArray(sampleReg.players),
          hasPlayer1: !!sampleReg.player1,
          hasPlayer2: !!sampleReg.player2,
          player1HasUser: !!sampleReg.player1?.user,
          player2HasUser: !!sampleReg.player2?.user,
        }
      : null;

    res.json({
      counts: {
        totalMatches: matchCount,
        matchesWithWinner: withWinner,
        registrations: regCount,
        users: userCount,
        knockoutBrackets: knockoutBrackets.length,
      },
      knockoutInfo: {
        brackets: knockoutBrackets.map((b) => ({
          id: b._id,
          name: b.name,
        })),
        maxRounds: maxRoundsAgg.map((r) => ({
          bracket: r._id,
          maxRound: r.maxRound,
          matches: r.matchCount,
        })),
      },
      samples: {
        match: sampleMatch,
        registration: sampleReg,
      },
      registrationStructure: regStructure,
      finalDetectionLogic: {
        method: "Max round per knockout bracket",
        rules: [
          "1. Find all knockout brackets",
          "2. Calculate max round for each bracket",
          "3. Match with (round = maxRound) AND (isThirdPlace != true) = Final",
        ],
        scoringFormula: {
          finalWin: "100 points",
          finalApp: "60 points",
          win: "3 points",
          match: "0.5 points",
        },
      },
    });
  } catch (err) {
    next(err);
  }
};
