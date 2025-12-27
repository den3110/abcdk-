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

    /* -----------------------------
     * BƯỚC 1: Knockout brackets -> max round map
     * ----------------------------- */
    const knockoutBrackets = await Bracket.find({ type: "knockout" })
      .select("_id")
      .lean();
    const knockoutBracketIds = knockoutBrackets.map((b) => b._id);

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
    for (const item of maxRoundsAgg)
      maxRoundMap.set(String(item._id), item.maxRound);

    /* -----------------------------
     * BƯỚC 2: Pipeline chuẩn theo logic achievements
     * - Match -> lookup registrations(pairA/pairB) -> map users theo side A/B
     * - DEDUPE userId+matchId (chống nhân đôi)
     * ----------------------------- */
    const convOID = (expr) => ({
      $convert: { input: expr, to: "objectId", onError: null, onNull: null },
    });

    const pipeline = [
      // lọc thô trước để giảm data
      {
        $match: {
          status: "finished",
          winner: { $in: ["A", "B"] },
          $or: [{ pairA: { $ne: null } }, { pairB: { $ne: null } }],
        },
      },

      // dt giống matchDT: finishedAt -> startedAt -> scheduledAt -> createdAt -> updatedAt
      {
        $addFields: {
          dt: {
            $ifNull: [
              "$finishedAt",
              {
                $ifNull: [
                  "$startedAt",
                  {
                    $ifNull: [
                      "$scheduledAt",
                      { $ifNull: ["$createdAt", "$updatedAt"] },
                    ],
                  },
                ],
              },
            ],
          },
          isThirdPlaceSafe: { $ifNull: ["$isThirdPlace", false] },
          metaThirdPlaceSafe: { $ifNull: ["$meta.thirdPlace", false] },
        },
      },

      // lọc theo sinceDays
      {
        $match: {
          $expr: { $gte: ["$dt", since] },
        },
      },

      // lookup registrations của pairA/pairB (giống achievements map reg)
      {
        $lookup: {
          from: "registrations",
          let: { a: "$pairA", b: "$pairB" },
          pipeline: [
            {
              $match: {
                $expr: { $in: ["$_id", ["$$a", "$$b"]] },
              },
            },
            {
              $project: {
                _id: 1,
                "player1.user": 1,
                "player2.user": 1,
              },
            },
          ],
          as: "regs",
        },
      },

      // tách regA/regB
      {
        $addFields: {
          regA: {
            $first: {
              $filter: {
                input: "$regs",
                as: "r",
                cond: { $eq: ["$$r._id", "$pairA"] },
              },
            },
          },
          regB: {
            $first: {
              $filter: {
                input: "$regs",
                as: "r",
                cond: { $eq: ["$$r._id", "$pairB"] },
              },
            },
          },
        },
      },

      // build usersA/usersB (dedupe + convert ObjectId, xử lý user lưu string/oid lẫn lộn)
      {
        $addFields: {
          usersA: {
            $let: {
              vars: {
                u1: "$regA.player1.user",
                u2: "$regA.player2.user",
              },
              in: {
                $setUnion: [
                  {
                    $filter: {
                      input: [convOID("$$u1"), convOID("$$u2")],
                      as: "u",
                      cond: { $ne: ["$$u", null] },
                    },
                  },
                  [],
                ],
              },
            },
          },
          usersB: {
            $let: {
              vars: {
                u1: "$regB.player1.user",
                u2: "$regB.player2.user",
              },
              in: {
                $setUnion: [
                  {
                    $filter: {
                      input: [convOID("$$u1"), convOID("$$u2")],
                      as: "u",
                      cond: { $ne: ["$$u", null] },
                    },
                  },
                  [],
                ],
              },
            },
          },
        },
      },

      // tạo docs theo user (side A/B) giống achievements: onA/onB
      {
        $project: {
          allUsers: {
            $concatArrays: [
              {
                $map: {
                  input: "$usersA",
                  as: "u",
                  in: {
                    userId: "$$u",
                    matchId: "$_id",
                    isWinner: { $eq: ["$winner", "A"] },
                    dt: "$dt",
                    tournament: "$tournament",
                    bracket: "$bracket",
                    round: "$round",
                    isThirdPlace: "$isThirdPlaceSafe",
                    metaThirdPlace: "$metaThirdPlaceSafe",
                  },
                },
              },
              {
                $map: {
                  input: "$usersB",
                  as: "u",
                  in: {
                    userId: "$$u",
                    matchId: "$_id",
                    isWinner: { $eq: ["$winner", "B"] },
                    dt: "$dt",
                    tournament: "$tournament",
                    bracket: "$bracket",
                    round: "$round",
                    isThirdPlace: "$isThirdPlaceSafe",
                    metaThirdPlace: "$metaThirdPlaceSafe",
                  },
                },
              },
            ],
          },
        },
      },

      { $unwind: "$allUsers" },
      { $replaceRoot: { newRoot: "$allUsers" } },

      // ✅ DEDUPE userId + matchId (cực quan trọng, chống nhân đôi do data bẩn)
      {
        $group: {
          _id: { userId: "$userId", matchId: "$matchId" },
          userId: { $first: "$userId" },
          matchId: { $first: "$matchId" },
          isWinner: { $max: "$isWinner" },
          dt: { $max: "$dt" },
          tournament: { $first: "$tournament" },
          bracket: { $first: "$bracket" },
          round: { $first: "$round" },
          isThirdPlace: { $max: "$isThirdPlace" },
          metaThirdPlace: { $max: "$metaThirdPlace" },
        },
      },

      // group theo user để tính matches/wins chuẩn
      {
        $group: {
          _id: "$userId",
          totalMatches: { $sum: 1 },
          totalWins: { $sum: { $cond: ["$isWinner", 1, 0] } },
          lastWinDate: {
            $max: { $cond: ["$isWinner", "$dt", new Date(0)] },
          },
          tournamentsPlayed: { $addToSet: "$tournament" },
          allMatches: {
            $push: {
              bracket: "$bracket",
              round: "$round",
              isWinner: "$isWinner",
              isThirdPlace: "$isThirdPlace",
              metaThirdPlace: "$metaThirdPlace",
            },
          },
        },
      },

      ...(minMatches > 0
        ? [{ $match: { totalMatches: { $gte: minMatches } } }]
        : []),

      // lookup user info
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userInfo",
        },
      },
      { $unwind: { path: "$userInfo", preserveNullAndEmptyArrays: true } },

      // project giống output cũ của bạn
      {
        $project: {
          userId: "$_id",
          totalMatches: 1,
          totalWins: 1,
          lastWinDate: 1,
          uniqueTournamentIds: "$tournamentsPlayed",
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

    /* -----------------------------
     * BƯỚC 3: JS detect finals + score
     * ----------------------------- */
    const processedRows = rows.map((r) => {
      let finalAppearances = 0;
      let finalWins = 0;

      const allMatches = Array.isArray(r.allMatches) ? r.allMatches : [];

      for (const m of allMatches) {
        const bracketId = m?.bracket ? String(m.bracket) : null;
        if (!bracketId) continue;

        const maxRound = maxRoundMap.get(bracketId);
        if (maxRound == null) continue;

        const roundNum =
          typeof m.round === "number" ? m.round : Number(m.round);
        const maxRoundNum =
          typeof maxRound === "number" ? maxRound : Number(maxRound);

        const isFinal =
          Number.isFinite(roundNum) &&
          Number.isFinite(maxRoundNum) &&
          roundNum === maxRoundNum &&
          !m.isThirdPlace &&
          !m.metaThirdPlace;

        if (isFinal) {
          finalAppearances++;
          if (m.isWinner) finalWins++;
        }
      }

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

    processedRows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.finalWins !== a.finalWins) return b.finalWins - a.finalWins;
      if (b.finalAppearances !== a.finalAppearances)
        return b.finalAppearances - a.finalAppearances;
      if (b.totalWins !== a.totalWins) return b.totalWins - a.totalWins;
      return b.winRate - a.winRate;
    });

    const topRows = processedRows.slice(0, limit);

    /* -----------------------------
     * BƯỚC 4: lookup tournament details
     * ----------------------------- */
    const allTournamentIds = [
      ...new Set(
        topRows
          .map((r) => r.uniqueTournamentIds || [])
          .flat()
          .filter(Boolean)
          .map(String)
      ),
    ];

    const tournaments =
      allTournamentIds.length > 0
        ? await Tournament.find({ _id: { $in: allTournamentIds } })
            .select("_id name image location startDate endDate status")
            .lean()
        : [];

    const tournamentMap = new Map(tournaments.map((t) => [String(t._id), t]));

    const sinceLabel = sinceDays === 1 ? "24h" : `${sinceDays} ngày`;

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
