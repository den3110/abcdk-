import asyncHandler from "express-async-handler";
import Match from "../../models/matchModel.js";
import RatingChange from "../../models/ratingChangeModel.js";
import { computeRatingPreviewFromParams } from "../../utils/applyRatingForFinishedMatch.js";
import mongoose from "mongoose";

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


// POST /admin/match/rating/preview
// body: { tournamentId, bracketId?, round?, pairARegId, pairBRegId, winner, gameScores:[{a,b}], forfeit? }
export const previewRatingDelta = asyncHandler(async (req, res) => {
  const { tournamentId, bracketId, round, pairARegId, pairBRegId, winner, gameScores, forfeit } = req.body || {};
  if (!tournamentId || !pairARegId || !pairBRegId || !winner) {
    res.status(400);
    throw new Error("tournamentId, pairARegId, pairBRegId, winner là bắt buộc");
  }
  const details = await computeRatingPreviewFromParams({
    tournamentId, bracketId, round, pairARegId, pairBRegId, winner,
    gameScores: Array.isArray(gameScores) ? gameScores : [],
    forfeit: !!forfeit,
  });
  res.json(details);
});


/**
 * POST /api/matches/:id/reset-scores
 * Reset bảng điểm về 0–0: xoá gameScores[], currentGame=0, (tuỳ chọn) reset serve, xoá liveLog
 * - KHÔNG tự ý đổi status (FE sẽ đổi trước nếu muốn)
 * - Nếu status !== 'finished' thì winner = "" và finishedAt = null.
 *   Nếu status !== 'live' thì startedAt = null (vì về scheduled/queued).
 * - Không đụng ratingApplied/ratingDelta.
 * Body options (tuỳ chọn):
 *   - clearLiveLog?: boolean (default false)
 *   - resetServe?: boolean (default true)
 *   - bumpVersion?: boolean (default true)
 */
export const resetMatchScores = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    clearLiveLog = false,
    resetServe = true,
    bumpVersion = true,
  } = req.body || {};

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid match id" });
  }

  const match = await Match.findById(id);
  if (!match) {
    return res.status(404).json({ message: "Match not found" });
  }

  // ===== Reset scoreboard theo schema hiện tại =====
  match.gameScores = [];              // xoá toàn bộ ván
  match.currentGame = 0;              // quay về game 0 (chưa bắt đầu)

  if (resetServe) {
    // về default theo schema
    match.serve = { side: "A", server: 2 };
  }

  // Nếu không còn finished, đảm bảo winner & mốc thời gian hợp lý
  if (match.status !== "finished") {
    match.winner = "";                // clear winner (enum: ["A","B",""])
    match.finishedAt = null;
    if (match.status !== "live") {
      match.startedAt = null;
    }
  }

  if (clearLiveLog && Array.isArray(match.liveLog)) {
    match.liveLog = [];
  }

  // Bump version để client biết có thay đổi live state
  if (bumpVersion) {
    match.liveVersion = (match.liveVersion || 0) + 1;
  }

  await match.save();

  // Phát socket để UI cập nhật ngay (optional)
  const io = req.app.get("io");
  try {
    const payload = {
      matchId: match._id,
      gameScores: match.gameScores,
      currentGame: match.currentGame,
      serve: match.serve,
      status: match.status,
      winner: match.winner,
      liveVersion: match.liveVersion,
    };
    io?.to(String(match._id)).emit("score:reset", payload);
    io?.to(String(match._id)).emit("match:patched", { matchId: match._id });
  } catch (_) {
    // socket optional, không chặn request
  }

  return res.json({
    message: "Đã reset tỉ số về 0–0 (xoá toàn bộ gameScores).",
    matchId: match._id,
    status: match.status,
    winner: match.winner,
    liveVersion: match.liveVersion,
  });
});