// services/syncRankingService.js
// Service để sync các field denormalized trong Ranking model
import mongoose from "mongoose";
import Ranking from "../models/rankingModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import Assessment from "../models/assessmentModel.js";

/**
 * Tính số giải đã finished mà user tham gia
 * @param {ObjectId} userId
 * @returns {Promise<{ totalFinishedTours: number, lastFinishedTourAt: Date | null }>}
 */
async function getFinishedTournamentStatsForUser(userId) {
  const now = new Date();

  // Lấy tất cả registrations của user
  const registrations = await Registration.find({
    $or: [{ "player1.user": userId }, { "player2.user": userId }],
  })
    .select("tournament")
    .lean();

  if (!registrations.length) {
    return { totalFinishedTours: 0, lastFinishedTourAt: null };
  }

  const tournamentIds = [
    ...new Set(
      registrations.map((r) => r.tournament?.toString()).filter(Boolean),
    ),
  ];

  // Lấy các tournament đã finished để vừa đếm vừa lấy mốc gần nhất
  const finishedTours = await Tournament.find({
    _id: { $in: tournamentIds },
    $or: [
      { status: "finished" },
      { finishedAt: { $ne: null } },
      { endAt: { $lt: now } },
      { endDate: { $lt: now } },
    ],
  })
    .select("finishedAt endAt endDate updatedAt")
    .lean();

  const lastFinishedTourAt =
    finishedTours
      .flatMap((tour) => [
        tour.finishedAt,
        tour.endAt,
        tour.endDate,
        tour.updatedAt,
      ])
      .map((value) => (value ? new Date(value) : null))
      .filter((date) => date && Number.isFinite(date.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0] || null;

  return {
    totalFinishedTours: finishedTours.length,
    lastFinishedTourAt,
  };
}

/**
 * Lấy mốc chấm trình gần nhất và cờ staff assessment
 * @param {ObjectId} userId
 * @returns {Promise<{ hasStaffAssessment: boolean, lastAssessmentAt: Date | null, lastStaffAssessmentAt: Date | null }>}
 */
async function getAssessmentStatsForUser(userId) {
  const staffQuery = {
    user: userId,
    "meta.scoreBy": { $in: ["admin", "mod", "moderator"] },
  };
  const [latestAssessment, latestStaffAssessment, staffExists] =
    await Promise.all([
      Assessment.findOne({ user: userId })
        .sort({ scoredAt: -1, updatedAt: -1 })
        .select("scoredAt updatedAt")
        .lean(),
      Assessment.findOne(staffQuery)
        .sort({ scoredAt: -1, updatedAt: -1 })
        .select("scoredAt updatedAt")
        .lean(),
      Assessment.exists(staffQuery),
    ]);

  return {
    hasStaffAssessment: !!staffExists,
    lastAssessmentAt:
      latestAssessment?.scoredAt || latestAssessment?.updatedAt || null,
    lastStaffAssessmentAt:
      latestStaffAssessment?.scoredAt ||
      latestStaffAssessment?.updatedAt ||
      null,
  };
}

/**
 * Sync ranking data cho một user
 * @param {ObjectId} userId
 */
export async function syncRankingForUser(userId) {
  const [finishedStats, assessmentStats] = await Promise.all([
    getFinishedTournamentStatsForUser(userId),
    getAssessmentStatsForUser(userId),
  ]);

  // Upsert để đảm bảo ranking tồn tại
  const ranking = await Ranking.findOneAndUpdate(
    { user: userId },
    {
      $set: {
        totalFinishedTours: finishedStats.totalFinishedTours,
        lastFinishedTourAt: finishedStats.lastFinishedTourAt,
        hasStaffAssessment: assessmentStats.hasStaffAssessment,
        lastAssessmentAt: assessmentStats.lastAssessmentAt,
        lastStaffAssessmentAt: assessmentStats.lastStaffAssessmentAt,
      },
    },
    { upsert: true, new: true },
  );

  // Trigger recalculateTier nếu cần
  if (ranking) {
    ranking.recalculateTier();
    await ranking.save();
  }

  return ranking;
}

/**
 * Sync ranking data cho nhiều users
 * @param {ObjectId[]} userIds
 */
export async function syncRankingsForUsers(userIds) {
  const results = await Promise.all(
    userIds.map((userId) =>
      syncRankingForUser(userId).catch((err) => {
        console.error(`Error syncing ranking for user ${userId}:`, err);
        return null;
      }),
    ),
  );
  return results.filter(Boolean);
}

/**
 * Sync tất cả rankings trong database
 * Sử dụng khi cần migration hoặc fix data
 */
export async function syncAllRankings() {
  console.log("[syncAllRankings] Starting full sync...");

  // Lấy tất cả unique userIds từ Rankings
  const rankings = await Ranking.find({}, { user: 1 }).lean();
  const userIds = rankings.map((r) => r.user).filter(Boolean);

  console.log(`[syncAllRankings] Found ${userIds.length} rankings to sync`);

  // Batch process để tránh overload
  const BATCH_SIZE = 100;
  let processed = 0;

  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const batch = userIds.slice(i, i + BATCH_SIZE);
    await syncRankingsForUsers(batch);
    processed += batch.length;
    console.log(`[syncAllRankings] Processed ${processed}/${userIds.length}`);
  }

  console.log("[syncAllRankings] Sync completed!");
  return { total: userIds.length, processed };
}

/**
 * Sync rankings cho tất cả users tham gia một tournament
 * Gọi khi tournament kết thúc
 * @param {ObjectId} tournamentId
 */
export async function syncRankingsForTournament(tournamentId) {
  // Lấy tất cả registrations của tournament
  const registrations = await Registration.find({ tournament: tournamentId })
    .select("player1.user player2.user")
    .lean();

  // Collect unique userIds
  const userIds = new Set();
  for (const reg of registrations) {
    if (reg.player1?.user) userIds.add(reg.player1.user.toString());
    if (reg.player2?.user) userIds.add(reg.player2.user.toString());
  }

  const userIdArray = [...userIds].map((id) => new mongoose.Types.ObjectId(id));

  console.log(
    `[syncRankingsForTournament] Syncing ${userIdArray.length} users for tournament ${tournamentId}`,
  );

  return syncRankingsForUsers(userIdArray);
}

export default {
  syncRankingForUser,
  syncRankingsForUsers,
  syncAllRankings,
  syncRankingsForTournament,
};
