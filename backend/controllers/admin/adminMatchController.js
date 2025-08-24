import asyncHandler from "express-async-handler";
import Match from "../../models/matchModel.js";
import RatingChange from "../../models/ratingChangeModel.js";

/** Chuẩn hoá DTO match (đủ dữ liệu để render) */
const toDTO = (m) => ({
  _id: m._id,
  tournament:
    typeof m.tournament === "object"
      ? {
          _id: m.tournament._id,
          name: m.tournament.name,
        }
      : m.tournament,
  bracket:
    typeof m.bracket === "object"
      ? {
          _id: m.bracket._id,
          name: m.bracket.name,
          type: m.bracket.type,
          stage: m.bracket.stage,
        }
      : m.bracket,
  format: m.format,
  branch: m.branch,
  round: m.round,
  order: m.order,
  code: m.code,
  labelKey: m.labelKey,
  pairA: m.pairA,
  pairB: m.pairB,
  rules: m.rules,
  gameScores: m.gameScores,
  status: m.status,
  winner: m.winner,
  referee: m.referee,
  startedAt: m.startedAt,
  finishedAt: m.finishedAt,
  scheduledAt: m.scheduledAt,
  court: m.court,
  courtLabel: m.courtLabel,
  ratingDelta: m.ratingDelta,
  ratingApplied: m.ratingApplied,
  ratingAppliedAt: m.ratingAppliedAt,
  liveVersion: m.liveVersion ?? 0,
});

/** GET /api/admin/matches/:id */
export const getMatchAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const m = await Match.findById(id)
    .populate({ path: "tournament", select: "name" })
    .populate({ path: "bracket", select: "name type stage" })
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" })
    .populate({ path: "referee", select: "name nickname avatar" });
  if (!m) return res.status(404).json({ message: "Match not found" });
  res.json({ ok: true, match: toDTO(m) });
});

/** GET /api/admin/matches/:id/logs  (liveLog embedded + formatted) */
export const getMatchLogs = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const m = await Match.findById(id)
    .select("liveLog")
    .populate({ path: "liveLog.by", select: "name nickname avatar" });
  if (!m) return res.status(404).json({ message: "Match not found" });

  const logs = (m.liveLog || [])
    .slice()
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map((e, idx) => ({
      idx,
      type: e.type,
      at: e.at,
      by: e.by
        ? {
            _id: e.by._id,
            name: e.by.name,
            nickname: e.by.nickname,
            avatar: e.by.avatar,
          }
        : null,
      payload: e.payload ?? null,
    }));

  res.json({ ok: true, count: logs.length, logs });
});

/** GET /api/admin/matches/:id/rating-changes */
export const getMatchRatingChanges = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const rows = await RatingChange.find({ match: id })
    .populate({ path: "user", select: "name nickname avatar" })
    .sort({ createdAt: 1 });

  res.json({
    ok: true,
    list: rows.map((r) => ({
      _id: r._id,
      user: r.user
        ? {
            _id: r.user._id,
            name: r.user.name,
            nickname: r.user.nickname,
            avatar: r.user.avatar,
          }
        : r.user,
      kind: r.kind, // "singles" | "doubles"
      before: r.before,
      after: r.after,
      delta: r.delta,
      expected: r.expected,
      score: r.score,
      reliabilityBefore: r.reliabilityBefore,
      reliabilityAfter: r.reliabilityAfter,
      marginBonus: r.marginBonus,
      createdAt: r.createdAt,
    })),
  });
});
