// controllers/leaderboardController.js
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";
import User from "../models/userModel.js";

/**
 * GET /api/leaderboards
 * Query:
 *  - sinceDays: số ngày gần đây (default 90)
 *  - limit: lấy bao nhiêu VĐV (default 10)
 *  - minMatches: tối thiểu số trận tham gia (default 3)
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

    // 📊 PIPELINE CẢI TIẾN
    const pipeline = [
      // BƯỚC 1: Lọc matches đã kết thúc gần đây
      {
        $match: {
          status: "finished",
          $or: [
            { finishedAt: { $gte: since } },
            { finishedAt: { $exists: false }, updatedAt: { $gte: since } },
          ],
        },
      },

      // BƯỚC 2: Thêm các trường tính toán
      {
        $addFields: {
          matchTimestamp: { $ifNull: ["$finishedAt", "$updatedAt"] },
          isFinalMatch: {
            $or: [
              { $eq: ["$isFinal", true] },
              {
                $regexMatch: {
                  input: { $toString: { $ifNull: ["$roundLabel", ""] } },
                  regex: /(grand\s*)?final/i,
                },
              },
              {
                $regexMatch: {
                  input: { $toString: { $ifNull: ["$round", ""] } },
                  regex: /(final|chung kết|championship)/i,
                },
              },
            ],
          },
        },
      },

      // BƯỚC 3: Tạo 2 documents cho mỗi pair trong match
      // ✅ FIX: So sánh winner với "A"/"B" string, không phải ObjectId
      {
        $facet: {
          pairAStats: [
            {
              $project: {
                pairId: "$pairA",
                isWinner: { $eq: ["$winner", "A"] }, // ✅ FIX: So sánh với "A" string
                isFinal: "$isFinalMatch",
                timestamp: "$matchTimestamp",
                tournament: "$tournament",
              },
            },
          ],
          pairBStats: [
            {
              $project: {
                pairId: "$pairB",
                isWinner: { $eq: ["$winner", "B"] }, // ✅ FIX: So sánh với "B" string
                isFinal: "$isFinalMatch",
                timestamp: "$matchTimestamp",
                tournament: "$tournament",
              },
            },
          ],
        },
      },

      // BƯỚC 4: Merge 2 arrays lại
      {
        $project: {
          allPairs: { $concatArrays: ["$pairAStats", "$pairBStats"] },
        },
      },

      { $unwind: "$allPairs" },

      // BƯỚC 5: Thay thế root document
      { $replaceRoot: { newRoot: "$allPairs" } },

      // Lọc bỏ pairs null/undefined
      { $match: { pairId: { $ne: null, $exists: true } } },

      // BƯỚC 6: Group theo pairId để tính stats
      {
        $group: {
          _id: "$pairId",
          totalMatches: { $sum: 1 },
          totalWins: { $sum: { $cond: ["$isWinner", 1, 0] } },
          finalAppearances: { $sum: { $cond: ["$isFinal", 1, 0] } },
          finalWins: {
            $sum: {
              $cond: [{ $and: ["$isFinal", "$isWinner"] }, 1, 0],
            },
          },
          lastWinDate: {
            $max: {
              $cond: ["$isWinner", "$timestamp", new Date(0)],
            },
          },
          tournamentsPlayed: { $addToSet: "$tournament" },
        },
      },

      // BƯỚC 7: Lọc theo minMatches
      ...(minMatches > 0
        ? [{ $match: { totalMatches: { $gte: minMatches } } }]
        : []),

      // BƯỚC 8: Lookup Registration để lấy player1 và player2
      // ✅ FIX: Registration có player1.user và player2.user, không phải players array
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

      // BƯỚC 9: Tạo array chứa cả player1.user và player2.user
      // ✅ FIX: Extract user IDs từ player1.user và player2.user
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

      // BƯỚC 10: Unwind để có 1 dòng cho mỗi user
      {
        $unwind: {
          path: "$playerUsers",
          preserveNullAndEmptyArrays: false,
        },
      },

      // BƯỚC 11: Group theo từng player
      {
        $group: {
          _id: "$playerUsers", // userId
          totalMatches: { $sum: "$totalMatches" },
          totalWins: { $sum: "$totalWins" },
          finalAppearances: { $sum: "$finalAppearances" },
          finalWins: { $sum: "$finalWins" },
          lastWinDate: { $max: "$lastWinDate" },
          tournamentsPlayedArrays: { $push: "$tournamentsPlayed" },
          pairsCount: { $sum: 1 },
        },
      },

      // BƯỚC 12: Lookup User info
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

      // BƯỚC 13: Tính điểm và format
      {
        $addFields: {
          // Hệ thống tính điểm:
          // - Vô địch chung kết: 100 điểm
          // - Vào chung kết: 60 điểm
          // - Thắng trận thường: 3 điểm
          // - Tham gia trận: 0.5 điểm
          score: {
            $add: [
              { $multiply: ["$finalWins", 100] },
              { $multiply: ["$finalAppearances", 60] },
              { $multiply: ["$totalWins", 3] },
              { $multiply: ["$totalMatches", 0.5] },
            ],
          },
          winRate: {
            $cond: [
              { $gt: ["$totalMatches", 0] },
              {
                $multiply: [{ $divide: ["$totalWins", "$totalMatches"] }, 100],
              },
              0,
            ],
          },
        },
      },

      // BƯỚC 14: Sort theo điểm số
      {
        $sort: {
          score: -1,
          finalWins: -1,
          finalAppearances: -1,
          totalWins: -1,
          winRate: -1,
        },
      },

      // BƯỚC 15: Limit kết quả
      { $limit: limit },

      // BƯỚC 16: Project kết quả cuối
      {
        $project: {
          userId: "$_id",
          score: { $round: ["$score", 2] },
          totalMatches: 1,
          totalWins: 1,
          finalAppearances: 1,
          finalWins: 1,
          winRate: { $round: ["$winRate", 1] },
          lastWinDate: 1,
          pairsCount: 1,
          tournamentsPlayedArrays: 1,
          name: {
            $ifNull: [
              "$userInfo.name",
              "$userInfo.nickname",
              "$userInfo.nickName",
              "$userInfo.displayName",
              "Vận động viên",
            ],
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

    console.log(`✅ Found ${rows.length} athletes`);

    // 🔍 DEBUG: Show sample result
    if (rows.length > 0) {
      console.log("📊 First athlete:", JSON.stringify(rows[0], null, 2));
    }

    // 🎨 Xử lý kết quả cuối
    const result = rows.map((r, idx) => {
      // Flatten tournament arrays
      const tourIds = (r.tournamentsPlayedArrays || []).flat().filter(Boolean);
      const uniqueTournaments = [...new Set(tourIds.map(String))];

      // Tạo achievement text
      const sinceLabel = sinceDays === 1 ? "24h" : `${sinceDays} ngày`;
      const achievementParts = [];

      if (r.finalWins > 0) {
        achievementParts.push(`🏆 ${r.finalWins} danh hiệu`);
      }
      if (r.finalAppearances > 0) {
        achievementParts.push(`🎯 ${r.finalAppearances} chung kết`);
      }
      achievementParts.push(
        `✅ ${r.totalWins}/${r.totalMatches} thắng (${r.winRate}%)`
      );
      achievementParts.push(`📅 ${sinceLabel}`);

      return {
        userId: r.userId,
        rank: idx + 1,
        score: r.score,
        wins: r.totalWins,
        matches: r.totalMatches,
        winRate: r.winRate,
        finalApps: r.finalAppearances,
        finalWins: r.finalWins,
        tournaments: uniqueTournaments.length,
        lastWinAt: r.lastWinDate,
        name: r.name,
        avatar: r.avatar,
        achievement: achievementParts.join(" • "),
      };
    });

    res.json({
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

// 🆕 DEBUG ENDPOINT - Xóa khi production
export const debugLeaderboard = async (req, res, next) => {
  try {
    const matchCount = await Match.countDocuments({ status: "finished" });
    const regCount = await Registration.countDocuments();
    const userCount = await User.countDocuments();

    // Sample data
    const sampleMatch = await Match.findOne({ status: "finished" })
      .select("pairA pairB winner status finishedAt tournament")
      .lean();

    const sampleReg = await Registration.findOne()
      .select("players player1 player2")
      .lean();

    // ✅ Check Registration structure
    const regStructure = sampleReg
      ? {
          hasPlayersArray: Array.isArray(sampleReg.players),
          hasPlayer1: !!sampleReg.player1,
          hasPlayer2: !!sampleReg.player2,
          player1HasUser: !!sampleReg.player1?.user,
          player2HasUser: !!sampleReg.player2?.user,
          fields: Object.keys(sampleReg),
        }
      : null;

    res.json({
      counts: {
        finishedMatches: matchCount,
        registrations: regCount,
        users: userCount,
      },
      samples: {
        match: sampleMatch,
        registration: sampleReg,
      },
      registrationStructure: regStructure,
      modelStructure: {
        Match: Object.keys(Match.schema.paths),
        Registration: Object.keys(Registration.schema.paths),
      },
    });
  } catch (err) {
    next(err);
  }
};
