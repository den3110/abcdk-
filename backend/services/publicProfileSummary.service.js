import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";

const DEFAULT_SCORE_SUMMARY = Object.freeze({
  single: 0,
  double: 0,
  scoredAt: null,
});

const DEFAULT_MATCH_SUMMARY = Object.freeze({
  total: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  lastPlayedAt: null,
});

const toNumberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toNumberOrZero = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveLevelPointValue = (user, key) => {
  if (!user || typeof user !== "object") return null;
  const levelPoint = user.levelPoint || {};
  if (key === "single") {
    return toNumberOrNull(levelPoint.single ?? levelPoint.score);
  }
  return toNumberOrNull(levelPoint.double);
};

const resolveMatchTimestamp = (match) =>
  match?.finishedAt ||
  match?.startedAt ||
  match?.scheduledAt ||
  match?.createdAt ||
  null;

export const buildFallbackPublicProfileSummary = (user = null) => ({
  score: {
    ...DEFAULT_SCORE_SUMMARY,
    single: resolveLevelPointValue(user, "single") ?? DEFAULT_SCORE_SUMMARY.single,
    double: resolveLevelPointValue(user, "double") ?? DEFAULT_SCORE_SUMMARY.double,
  },
  matches: { ...DEFAULT_MATCH_SUMMARY },
});

export async function buildPublicProfileSummary(user = null) {
  const userId = user?._id || user?.id || user;
  if (!userId) return buildFallbackPublicProfileSummary(user);

  const fallback = buildFallbackPublicProfileSummary(user);

  const [lastScore, regs] = await Promise.all([
    ScoreHistory.findOne({ user: userId })
      .sort({ scoredAt: -1, _id: -1 })
      .select("single double scoredAt")
      .lean(),
    Registration.find({
      $or: [{ "player1.user": userId }, { "player2.user": userId }],
    })
      .select("_id")
      .lean(),
  ]);

  const regIds = regs.map((reg) => reg._id).filter(Boolean);

  let matches = fallback.matches;
  if (regIds.length) {
    const baseFilter = {
      status: "finished",
      winner: { $in: ["A", "B"] },
      $or: [{ pairA: { $in: regIds } }, { pairB: { $in: regIds } }],
    };

    const [total, wins, lastMatch] = await Promise.all([
      Match.countDocuments(baseFilter),
      Match.countDocuments({
        status: "finished",
        winner: { $in: ["A", "B"] },
        $or: [
          { pairA: { $in: regIds }, winner: "A" },
          { pairB: { $in: regIds }, winner: "B" },
        ],
      }),
      Match.findOne(baseFilter)
        .sort({ finishedAt: -1, createdAt: -1 })
        .select("finishedAt startedAt scheduledAt createdAt")
        .lean(),
    ]);

    const losses = Math.max(0, total - wins);
    matches = {
      total: toNumberOrZero(total),
      wins: toNumberOrZero(wins),
      losses,
      winRate: total > 0 ? (wins / total) * 100 : 0,
      lastPlayedAt: resolveMatchTimestamp(lastMatch),
    };
  }

  return {
    score: {
      single: toNumberOrZero(lastScore?.single ?? fallback.score.single),
      double: toNumberOrZero(lastScore?.double ?? fallback.score.double),
      scoredAt: lastScore?.scoredAt ?? fallback.score.scoredAt,
    },
    matches,
  };
}
