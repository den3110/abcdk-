// controllers/leaderboardController.js
import mongoose from "mongoose";
import Match from "../models/matchModel.js"; // chỉnh path theo dự án của bạn
import Registration from "../models/registrationModel.js";
import User from "../models/userModel.js";

/**
 * GET /api/leaderboards/featured
 * Query:
 *  - sinceDays: số ngày gần đây (default 90)
 *  - limit: lấy bao nhiêu VĐV (default 10)
 *  - minMatches: tối thiểu số trận tham gia để lọc nhiễu (default 3)
 *  - sportType: nếu có, lọc theo loại môn (vd: "2" cho pickleball)
 */
export const getFeaturedLeaderboard = async (req, res, next) => {
  try {
    const sinceDays = Math.max(parseInt(req.query.sinceDays ?? "90", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit ?? "10", 10), 1),
      50
    );
    const minMatches = Math.max(parseInt(req.query.minMatches ?? "3", 10), 0);
    const sportType = req.query.sportType?.trim(); // tuỳ model của bạn có field này không

    const since = new Date(Date.now() - sinceDays * 864e5);

    // Điều kiện filter trận đã kết thúc gần đây
    const baseMatch = {
      status: "finished",
      $or: [
        { finishedAt: { $gte: since } },
        // fallback nếu không có finishedAt thì dùng updatedAt
        { finishedAt: { $exists: false }, updatedAt: { $gte: since } },
      ],
    };
    if (sportType) {
      baseMatch.sportType = sportType; // chỉ chạy nếu hệ CSDL của bạn có field này
    }

    // Pipeline:
    // - Nhận dạng "chung kết": dùng isFinal=true, hoặc regex roundLabel/round
    // - Biến mỗi match thành 2 dòng "participants" (pairA, pairB) -> group theo pair -> join Registration -> unwind players -> group theo player
    const pipeline = [
      { $match: baseMatch },

      {
        $addFields: {
          _ts: { $ifNull: ["$finishedAt", "$updatedAt"] },
          _isFinal: {
            $or: [
              { $eq: ["$isFinal", true] },
              {
                $regexMatch: {
                  input: { $ifNull: ["$roundLabel", ""] },
                  regex: /(grand\s*)?final/i,
                },
              },
              {
                $regexMatch: {
                  input: { $ifNull: ["$round", ""] },
                  regex: /(final|champ)/i,
                },
              },
            ],
          },
        },
      },

      {
        $project: {
          tournament: 1,
          _ts: 1,
          _isFinal: 1,
          participants: [
            {
              pair: "$pairA",
              isWinner: { $eq: ["$winner", "$pairA"] },
              isFinal: "$_isFinal",
              ts: "$_ts",
              tournament: "$tournament",
            },
            {
              pair: "$pairB",
              isWinner: { $eq: ["$winner", "$pairB"] },
              isFinal: "$_isFinal",
              ts: "$_ts",
              tournament: "$tournament",
            },
          ],
        },
      },

      { $unwind: "$participants" },
      { $match: { "participants.pair": { $ne: null } } },

      {
        $group: {
          _id: "$participants.pair", // thống kê theo cặp
          matches: { $sum: 1 },
          wins: {
            $sum: { $cond: ["$participants.isWinner", 1, 0] },
          },
          finalApps: {
            $sum: { $cond: ["$participants.isFinal", 1, 0] },
          },
          finalWins: {
            $sum: {
              $cond: [
                { $and: ["$participants.isFinal", "$participants.isWinner"] },
                1,
                0,
              ],
            },
          },
          lastWinAt: {
            $max: {
              $cond: [
                "$participants.isWinner",
                "$participants.ts",
                new Date(0),
              ],
            },
          },
          tournaments: { $addToSet: "$participants.tournament" },
        },
      },

      // Chốt điều kiện tối thiểu số trận để loại nhiễu
      ...(minMatches > 0
        ? [{ $match: { matches: { $gte: minMatches } } }]
        : []),

      // Join sang Registration để lấy danh sách user trong cặp
      {
        $lookup: {
          from: Registration.collection.name,
          localField: "_id",
          foreignField: "_id",
          as: "reg",
        },
      },
      { $unwind: { path: "$reg", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          matches: 1,
          wins: 1,
          finalApps: 1,
          finalWins: 1,
          lastWinAt: 1,
          tournaments: 1,
          players: { $ifNull: ["$reg.players", []] }, // [ObjectId User]
        },
      },

      { $unwind: "$players" }, // mỗi user một dòng

      {
        $group: {
          _id: "$players", // về cá nhân
          matches: { $sum: "$matches" },
          wins: { $sum: "$wins" },
          finalApps: { $sum: "$finalApps" },
          finalWins: { $sum: "$finalWins" },
          lastWinAt: { $max: "$lastWinAt" },
          allTournaments: { $push: "$tournaments" }, // array of array -> sẽ flatten ở JS
          pairsCount: { $sum: 1 },
        },
      },

      // Join user info
      {
        $lookup: {
          from: User.collection.name,
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      // Điểm quy đổi
      {
        $addFields: {
          score: {
            $add: [
              { $multiply: ["$finalWins", 100] },
              { $multiply: ["$finalApps", 60] },
              { $multiply: ["$wins", 3] },
            ],
          },
        },
      },

      { $sort: { score: -1, wins: -1, finalApps: -1 } },
      { $limit: limit },
    ];

    const rows = await Match.aggregate(pipeline);

    // Hậu xử lý: flatten tournament set & format output
    const result = rows.map((r, idx) => {
      const tourIds = (r.allTournaments || []).flat().filter(Boolean);
      const uniqueTours = [...new Set(tourIds.map(String))];

      const name =
        r.user?.name ||
        r.user?.nickname ||
        r.user?.nickName ||
        r.user?.displayName ||
        "Vận động viên";

      const avatar =
        r.user?.avatar || r.user?.avatarUrl || r.user?.photo || null;

      const sinceLabel = sinceDays === 1 ? "24h" : `${sinceDays} ngày`;

      // Achievement text ngắn gọn cho UI
      const achievementParts = [];
      if (r.finalWins > 0) achievementParts.push(`🏆 ${r.finalWins} danh hiệu`);
      if (r.finalApps > 0) achievementParts.push(`🎯 ${r.finalApps} chung kết`);
      achievementParts.push(`✅ ${r.wins} trận thắng/${sinceLabel}`);
      const achievement = achievementParts.join(" • ");

      return {
        userId: r._id,
        rank: idx + 1,
        score: r.score,
        wins: r.wins,
        finalApps: r.finalApps,
        finalWins: r.finalWins,
        tournaments: uniqueTours.length,
        lastWinAt: r.lastWinAt,
        name,
        avatar,
        achievement,
      };
    });

    res.json({
      sinceDays,
      generatedAt: new Date(),
      items: result,
    });
  } catch (err) {
    next(err);
  }
};
