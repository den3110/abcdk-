// services/reputationService.js
import mongoose from "mongoose";
import Ranking from "../models/rankingModel.js";
import ReputationEvent from "../models/reputationEventModel.js";

const { isValidObjectId } = mongoose;

export async function addTournamentReputationBonus({
  userIds = [],
  tournamentId,
  amount = 10,
}) {
  if (!userIds.length || !tournamentId) return { applied: 0 };

  let applied = 0;

  // Chuẩn hoá tournamentId (cho chắc)
  const tid =
    typeof tournamentId === "string" ? tournamentId : String(tournamentId);

  for (const uidRaw of userIds) {
    // Chuẩn hoá UID về string 24-hex; bỏ qua nếu không hợp lệ
    const uid = typeof uidRaw === "string" ? uidRaw : String(uidRaw);
    if (!isValidObjectId(uid)) continue;

    try {
      // 1) Tạo event (unique theo user + type + tournament)
      await ReputationEvent.create({
        user: uid,
        type: "TOURNAMENT_FINISHED",
        tournament: tid,
        amount,
      });

      // 2) Find-or-create Ranking row
      await Ranking.findOneAndUpdate(
        { user: uid },
        {
          $setOnInsert: { user: uid, reputation: 0 },
          $inc: { "repMeta.tournamentsFinished": 1 },
          $set: { lastUpdated: new Date() },
        },
        { upsert: true, new: true }
      );

      // 3) Tăng reputation + cap 100 (pipeline)
      await Ranking.updateOne({ user: uid }, [
        {
          $set: {
            reputation: {
              $min: [100, { $add: [{ $ifNull: ["$reputation", 0] }, amount] }],
            },
          },
        },
      ]);

      applied++;
    } catch (e) {
      // Nếu trùng (unique key), bỏ qua; lỗi khác ném ra
      if (e?.code !== 11000) throw e;
    }
  }

  return { applied };
}
