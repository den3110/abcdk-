import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import RatingChange from "../models/ratingChangeModel.js";
import User from "../models/userModel.js";
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import Ranking from "../models/rankingModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import {
  applyRatingForMatch,
  recomputeTournamentRatings,
  recomputeUserRatings,
} from "../services/ratingEngine.js";

const round3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000;

/** Áp dụng rating cho 1 match ngay lập tức chưa dùng */
export const applyMatchRating = asyncHandler(async (req, res) => {
  const { matchId } = req.params;
  const out = await applyRatingForMatch(matchId);
  res.json(out);
});

/** Recompute theo tournament */
export const recomputeTournament = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  const out = await recomputeTournamentRatings(tournamentId);
  res.json(out);
});

/** Recompute theo user */
export const recomputeUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const out = await recomputeUserRatings(userId);
  res.json(out);
});

/**
 * SUPER ADMIN — Thu hồi điểm của MỘT BRACKET:
 * - Hoàn lại toàn bộ điểm cộng/trừ đã áp từ các trận trong bracket (trừ đúng tổng delta
 *   từng user/kind trên Ranking — các trận sau đó ở nơi khác giữ nguyên mức tăng/giảm).
 * - Lịch sử VẪN GIỮ nhưng về 0 điểm: RatingChange.delta -> 0, after -> before (gốc lưu ở
 *   origDelta/origAfter); ScoreHistory hạ snapshot về mức trước trận + ghi chú thu hồi.
 * - match.ratingDelta -> 0 (ratingApplied giữ true để không bị áp lại).
 * - bracket.noRankDelta = true: trận TƯƠNG LAI trong bracket cũng không tính điểm
 *   (guard sẵn có trong applyRatingForFinishedMatch).
 * Idempotent: bấm lại chỉ xử lý log chưa revoked (lần 2 = no-op).
 */
export const revokeBracketRating = asyncHandler(async (req, res) => {
  const isSuper = Boolean(req.user?.isSuperAdmin || req.user?.isSuperUser);
  if (!isSuper) {
    res.status(403);
    throw new Error("Chỉ Super Admin mới được thu hồi điểm bracket");
  }

  const { bracketId } = req.params;
  if (!mongoose.isValidObjectId(bracketId)) {
    res.status(400);
    throw new Error("bracketId không hợp lệ");
  }

  const bracket = await Bracket.findById(bracketId).select(
    "name tournament noRankDelta"
  );
  if (!bracket) {
    res.status(404);
    throw new Error("Không tìm thấy bracket");
  }

  const matches = await Match.find({ bracket: bracketId }).select("_id");
  const matchIds = matches.map((m) => m._id);

  // Log điểm CHƯA thu hồi của các trận trong bracket
  const logs = matchIds.length
    ? await RatingChange.find({
        match: { $in: matchIds },
        revoked: { $ne: true },
      }).select("user match kind before after delta")
    : [];

  // ===== 1) Hoàn điểm trên Ranking: trừ đúng tổng delta từng user/kind =====
  const sumByUserKind = new Map();
  for (const lg of logs) {
    const k = `${lg.user}|${lg.kind}`;
    sumByUserKind.set(k, (sumByUserKind.get(k) || 0) + (Number(lg.delta) || 0));
  }
  const userIds = [...new Set(logs.map((l) => String(l.user)))];
  let rankingUpdated = 0;
  if (userIds.length) {
    const ranks = await Ranking.find({ user: { $in: userIds } }).select(
      "user single double"
    );
    const ops = [];
    for (const r of ranks) {
      const ds = sumByUserKind.get(`${r.user}|singles`) || 0;
      const dd = sumByUserKind.get(`${r.user}|doubles`) || 0;
      if (!ds && !dd) continue;
      const $set = {};
      if (ds) $set.single = round3(Math.max(0, (Number(r.single) || 0) - ds));
      if (dd) $set.double = round3(Math.max(0, (Number(r.double) || 0) - dd));
      ops.push({ updateOne: { filter: { user: r.user }, update: { $set } } });
    }
    if (ops.length) {
      const out = await Ranking.bulkWrite(ops);
      rankingUpdated = out.modifiedCount || 0;
    }
  }

  // ===== 2) ScoreHistory: DỊCH CẢ CHUỖI snapshot xuống theo delta =====
  // QUAN TRỌNG: điểm nền cho trận kế tiếp được thuật toán lấy từ SNAPSHOT ScoreHistory
  // MỚI NHẤT (Ranking chỉ là fallback — xem getLatestPointsMap trong
  // applyRatingForFinishedMatch). Vì vậy không thể chỉ hạ snapshot của trận bị thu hồi:
  // mọi snapshot CÙNG user/loại có scoredAt >= trận đó đều phải trừ delta, để nền của
  // các trận tương lai đúng như thể bracket chưa từng cộng/trừ. (Phép trừ giao hoán nên
  // thứ tự xử lý các log không ảnh hưởng kết quả cuối.)
  let historyUpdated = 0;
  for (const lg of logs) {
    const key = lg.kind === "singles" ? "single" : "double";
    const anchor = await ScoreHistory.findOne({
      user: lg.user,
      sourceMatch: lg.match,
      [key]: { $ne: null },
    })
      .sort({ scoredAt: 1 })
      .select("scoredAt");
    if (!anchor) continue; // trận không tạo snapshot -> Ranking đã trừ ở bước 1 là đủ

    const out = await ScoreHistory.updateMany(
      { user: lg.user, [key]: { $ne: null }, scoredAt: { $gte: anchor.scoredAt } },
      [
        {
          $set: {
            [key]: {
              $round: [
                {
                  $max: [
                    { $subtract: [{ $ifNull: [`$${key}`, 0] }, lg.delta] },
                    0,
                  ],
                },
                3,
              ],
            },
          },
        },
      ]
    );
    historyUpdated += out.modifiedCount || 0;

    // Note thu hồi chỉ ghi trên snapshot của CHÍNH trận bị thu hồi
    await ScoreHistory.updateMany(
      { user: lg.user, sourceMatch: lg.match, [key]: { $ne: null } },
      [
        {
          $set: {
            note: {
              $concat: [
                "+0.000 (đã thu hồi điểm bracket) | gốc: ",
                { $ifNull: ["$note", ""] },
              ],
            },
          },
        },
      ]
    );
  }

  // ===== 3) RatingChange về 0 điểm, giữ giá trị gốc để trace =====
  if (logs.length) {
    await RatingChange.updateMany({ _id: { $in: logs.map((l) => l._id) } }, [
      {
        $set: {
          origDelta: "$delta",
          origAfter: "$after",
          delta: 0,
          after: "$before",
          revoked: true,
          revokedAt: "$$NOW",
          revokedBy: req.user._id,
        },
      },
    ]);
  }

  // ===== 4) Trận trong bracket: ratingDelta -> 0 (giữ ratingApplied chống áp lại) =====
  if (matchIds.length) {
    await Match.updateMany(
      { _id: { $in: matchIds }, ratingApplied: true },
      { $set: { ratingDelta: 0 } }
    );
  }

  // ===== 5) Khoá bracket không tính điểm về sau =====
  if (!bracket.noRankDelta) {
    bracket.noRankDelta = true;
    await bracket.save();
  }

  res.json({
    ok: true,
    bracket: { _id: bracket._id, name: bracket.name, noRankDelta: true },
    matches: matchIds.length,
    logsRevoked: logs.length,
    usersAffected: userIds.length,
    rankingUpdated,
    historyUpdated,
  });
});

/** Lấy rating & history của user */
export const getUserRating = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const user = await User.findById(userId).select(
    "name nickname localRatings avatar"
  );
  if (!user) return res.status(404).json({ message: "User not found" });

  const history = await RatingChange.find({ user: userId })
    .populate({
      path: "match",
      select: "labelKey tournament bracket finishedAt",
    })
    .sort({ createdAt: -1 })
    .limit(200);

  res.json({
    user: {
      _id: user._id,
      name: user.name,
      nickname: user.nickname,
      avatar: user.avatar,
      localRatings: user.localRatings || {},
    },
    history,
  });
});
