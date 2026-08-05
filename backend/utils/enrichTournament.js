// Enrich populated linkedTournament với registrationCount (số cặp đã đăng ký).
// Dùng cho chat message + feed post rendering "tournament card".
import mongoose from "mongoose";
import Registration from "../models/registrationModel.js";

/**
 * Gắn thêm field registrationCount vào linkedTournament của mỗi item.
 * @param {Array<{linkedTournament?: object}>} items - array of DTOs
 */
export async function attachTournamentRegCounts(items) {
  if (!items?.length) return;
  const ids = new Set();
  for (const it of items) {
    const t = it?.linkedTournament;
    if (t?._id) ids.add(String(t._id));
  }
  if (!ids.size) return;

  const idList = Array.from(ids).map(
    (id) => new mongoose.Types.ObjectId(String(id))
  );
  const agg = await Registration.aggregate([
    { $match: { tournament: { $in: idList } } },
    { $group: { _id: "$tournament", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(agg.map((r) => [String(r._id), r.count]));

  for (const it of items) {
    const t = it?.linkedTournament;
    if (t?._id) {
      t.registrationCount = countMap.get(String(t._id)) || 0;
    }
  }
}
