// services/reputationService.js
import Ranking from "../models/rankingModel.js";
import ReputationEvent from "../models/reputationEventModel.js";

/**
 * Cộng uy tín cho danh sách user khi 1 giải kết thúc (idempotent).
 * - Tạo event (unique) -> nếu insert thành công thì mới cộng.
 */
export async function addTournamentReputationBonus({ userIds = [], tournamentId, amount = 10 }) {
  if (!userIds.length || !tournamentId) return { applied: 0 };

  let applied = 0;
  for (const uid of userIds) {
    try {
      // upsert event (unique theo user+tournament)
      await ReputationEvent.create({
        user: uid,
        type: "TOURNAMENT_FINISHED",
        tournament: tournamentId,
        amount,
      });

      // nếu tạo được event => cộng uy tín
      await Ranking.findOneAndUpdate(
        { user: uid },
        {
          $setOnInsert: { user: uid, reputation: 0 },
          $inc: { "repMeta.tournamentsFinished": 1 },
          $set: { lastUpdated: new Date() },
        },
        { upsert: true, new: true }
      );

      // tăng reputation + cap 100 (pipeline update cần MongoDB >= 4.2; fallback 2 bước nếu muốn)
      await Ranking.updateOne(
        { user: uid },
        [
          {
            $set: {
              reputation: {
                $min: [100, { $add: [{ $ifNull: ["$reputation", 0] }, amount] }],
              },
            },
          },
        ]
      );

      applied++;
    } catch (e) {
      // duplicate event => bỏ qua (đã cộng trước đó)
      if (e.code !== 11000) throw e;
    }
  }
  return { applied };
}
