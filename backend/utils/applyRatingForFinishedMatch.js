// utils/applyRatingForFinishedMatch.js
import Match from "../models/matchModel.js";
import Ranking from "../models/rankingModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import mongoose from "mongoose";

const round3 = (x) => Math.round(x * 1000) / 1000;

async function getLatestRatingsMap(userIds) {
  const ids = [...new Set(userIds.map(String))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );

  const lastHist = await ScoreHistory.aggregate([
    { $match: { user: { $in: ids } } },
    { $sort: { scoredAt: -1, _id: -1 } },
    {
      $group: {
        _id: "$user",
        single: { $first: "$single" },
        double: { $first: "$double" },
      },
    },
  ]);

  const map = new Map(
    lastHist.map((r) => [
      String(r._id),
      {
        single: Number.isFinite(r.single) ? r.single : 0,
        double: Number.isFinite(r.double) ? r.double : 0,
      },
    ])
  );

  const ranks = await Ranking.find({ user: { $in: ids } }).select(
    "user single double"
  );
  ranks.forEach((r) => {
    const k = String(r.user);
    if (!map.has(k))
      map.set(k, {
        single: Number.isFinite(r.single) ? r.single : 0,
        double: Number.isFinite(r.double) ? r.double : 0,
      });
  });

  userIds.forEach((uid) => {
    if (!map.has(String(uid))) map.set(String(uid), { single: 0, double: 0 });
  });
  return map;
}

export async function applyRatingForFinishedMatch(matchId) {
  const mt = await Match.findById(matchId)
    .populate({ path: "tournament", select: "eventType" })
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" });

  if (!mt) return;
  if (mt.status !== "finished" || !mt.winner) return;
  if (mt.ratingApplied) return; // đã áp dụng rồi thì thôi

  const key = mt.tournament?.eventType === "single" ? "single" : "double";
  const delta = Number.isFinite(Number(mt.ratingDelta))
    ? Number(mt.ratingDelta)
    : 0.01;
  const when = mt.finishedAt || new Date();

  const regWin = mt.winner === "A" ? mt.pairA : mt.pairB;
  const regLose = mt.winner === "A" ? mt.pairB : mt.pairA;

  const winUsers = [regWin?.player1?.user, regWin?.player2?.user]
    .filter(Boolean)
    .map(String);
  const loseUsers = [regLose?.player1?.user, regLose?.player2?.user]
    .filter(Boolean)
    .map(String);
  const allIds = [...new Set([...winUsers, ...loseUsers])];

  // map điểm gần nhất từ lịch sử (fallback Ranking)
  const latest = await getLatestRatingsMap(allIds);

  // lấy reputation hiện tại từ Ranking
  const repDocs = await Ranking.find({ user: { $in: allIds } }).select(
    "user reputation"
  );
  const repMap = new Map(
    repDocs.map((r) => [String(r.user), Number(r.reputation) || 0])
  );

  const nextRep = (uid) => Math.min(100, (repMap.get(uid) || 0) + 10);

  // build ScoreHistory + cập nhật Ranking ngay
  const histDocs = [];
  for (const uid of winUsers) {
    const cur = latest.get(uid) || { single: 0, double: 0 };
    const next = { ...cur, [key]: round3((cur[key] ?? 0) + delta) };
    histDocs.push({
      user: uid,
      [key]: next[key],
      scoredAt: when,
      sourceMatch: mt._id,
      note: `+${delta}`,
    });

    await Ranking.updateOne(
      { user: uid },
      {
        $set: {
          single: next.single ?? cur.single ?? 0,
          double: next.double ?? cur.double ?? 0,
          reputation: nextRep(uid),
        },
      },
      { upsert: true }
    );
  }
  for (const uid of loseUsers) {
    const cur = latest.get(uid) || { single: 0, double: 0 };
    const val = Math.max(0, (cur[key] ?? 0) - delta);
    const next = { ...cur, [key]: round3(val) };
    histDocs.push({
      user: uid,
      [key]: next[key],
      scoredAt: when,
      sourceMatch: mt._id,
      note: `-${delta}`,
    });

    await Ranking.updateOne(
      { user: uid },
      {
        $set: {
          single: next.single ?? cur.single ?? 0,
          double: next.double ?? cur.double ?? 0,
          reputation: nextRep(uid),
        },
      },
      { upsert: true }
    );
  }

  if (histDocs.length) await ScoreHistory.insertMany(histDocs);
  mt.ratingApplied = true;
  mt.ratingAppliedAt = new Date();
  await mt.save();
}
