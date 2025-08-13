import ScoreHistory from "../models/scoreHistoryModel.js";

async function latestSnapshot(userId) {
  const last = await ScoreHistory
    .find({ user: userId })
    .sort({ scoredAt: -1, createdAt: -1 })
    .limit(1);
  if (!last.length) return { single: 0, double: 0 };
  const { single = 0, double = 0 } = last[0];
  return { single, double };
}

export default latestSnapshot;