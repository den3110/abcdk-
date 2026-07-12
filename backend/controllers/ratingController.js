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
 *   origDelta/origAfter); ScoreHistory hạ snapshot về mức trước trận, note chỉ còn
 *   "+0.000" — không lộ chuyện thu hồi ra hồ sơ công khai.
 * - match.ratingDelta -> 0 (ratingApplied giữ true để không bị áp lại).
 * - bracket.noRankDelta = true: trận TƯƠNG LAI trong bracket cũng không tính điểm
 *   (guard sẵn có trong applyRatingForFinishedMatch).
 * Idempotent: bấm lại chỉ xử lý log chưa revoked; log đã revoked mà lịch sử chưa
 * dịch (các lần thu hồi trước khi vá schema sourceMatch) thì được "sửa bù" phần
 * ScoreHistory theo origDelta — không đụng Ranking lần hai.
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

  const matches = await Match.find({ bracket: bracketId }).select(
    "_id finishedAt ratingAppliedAt"
  );
  const matchIds = matches.map((m) => m._id);
  const matchTime = new Map(matches.map((m) => [String(m._id), m]));

  // Log điểm CHƯA thu hồi của các trận trong bracket
  const logs = matchIds.length
    ? await RatingChange.find({
        match: { $in: matchIds },
        revoked: { $ne: true },
      }).select("user match kind before after delta")
    : [];

  // Log ĐÃ thu hồi các lần trước nhưng chuỗi lịch sử chưa được dịch (bug schema
  // sourceMatch cũ khiến bước sửa ScoreHistory bị skip lặng lẽ) -> lần này sửa bù,
  // tuyệt đối KHÔNG trừ Ranking lần nữa cho nhóm này.
  const logsBackfill = matchIds.length
    ? await RatingChange.find({
        match: { $in: matchIds },
        revoked: true,
        histShifted: { $ne: true },
      }).select("user match kind origDelta")
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
  // Neo xác định snapshot của trận, ưu tiên theo thứ tự:
  //   1. sourceMatch (data mới — schema đã vá);
  //   2. match.finishedAt (thuật toán đặt scoredAt = finishedAt, khớp chính xác);
  //   3. match.ratingAppliedAt (khi finishedAt trống, scoredAt = new Date() lúc áp
  //      điểm, chỉ sớm hơn ratingAppliedAt vài ms -> lùi 60s làm mốc an toàn).
  const REVOKE_TAG = "đã thu hồi điểm bracket";
  const shiftHistoryForLog = async (lg, delta) => {
    const d = Number(delta) || 0;
    if (!d) return 0;
    const key = lg.kind === "singles" ? "single" : "double";
    const mt = matchTime.get(String(lg.match)) || {};

    let anchorAt = null;
    let noteTo = null;
    const anchorDoc = await ScoreHistory.findOne({
      user: lg.user,
      sourceMatch: lg.match,
      [key]: { $ne: null },
    })
      .sort({ scoredAt: 1 })
      .select("scoredAt");
    if (anchorDoc?.scoredAt) {
      anchorAt = anchorDoc.scoredAt;
      noteTo = anchorAt;
    } else if (mt.finishedAt) {
      anchorAt = mt.finishedAt;
      noteTo = anchorAt;
    } else if (mt.ratingAppliedAt) {
      anchorAt = new Date(mt.ratingAppliedAt.getTime() - 60 * 1000);
      noteTo = mt.ratingAppliedAt;
    }
    if (!anchorAt) return 0; // không xác định được mốc -> bỏ qua an toàn

    const out = await ScoreHistory.updateMany(
      { user: lg.user, [key]: { $ne: null }, scoredAt: { $gte: anchorAt } },
      [
        {
          $set: {
            [key]: {
              $round: [
                {
                  $max: [
                    { $subtract: [{ $ifNull: [`$${key}`, 0] }, d] },
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

    // Note trên snapshot của CHÍNH trận: chỉ ghi "+0.000" — TUYỆT ĐỐI không lộ
    // chuyện thu hồi ra hồ sơ công khai (delta gốc vẫn còn ở RatingChange.origDelta
    // cho admin trace).
    await ScoreHistory.updateMany(
      {
        user: lg.user,
        [key]: { $ne: null },
        scoredAt: {
          $gte: anchorAt,
          $lte: new Date(noteTo.getTime() + 2000),
        },
        note: { $ne: "+0.000" },
      },
      { $set: { note: "+0.000" } }
    );
    return out.modifiedCount || 0;
  };

  let historyUpdated = 0;
  for (const lg of logs) {
    historyUpdated += await shiftHistoryForLog(lg, lg.delta);
  }

  // Sửa bù cho các lần thu hồi cũ: chỉ dịch lịch sử theo origDelta rồi đánh dấu
  let backfilled = 0;
  for (const lg of logsBackfill) {
    backfilled += await shiftHistoryForLog(lg, lg.origDelta);
  }
  if (logsBackfill.length) {
    await RatingChange.updateMany(
      { _id: { $in: logsBackfill.map((l) => l._id) } },
      { $set: { histShifted: true } }
    );
  }

  // Tự dọn các ghi chú thu hồi KIỂU CŨ còn sót trong DB (từng ghi lộ liễu
  // "đã thu hồi điểm bracket | gốc: ...") -> chỉ còn "+0.000". Chạy mỗi lần bấm,
  // quét toàn DB an toàn vì chuỗi tag này chỉ do chính flow thu hồi ghi ra.
  const noteCleanOut = await ScoreHistory.updateMany(
    { note: new RegExp(REVOKE_TAG) },
    { $set: { note: "+0.000" } }
  );
  const notesCleaned = noteCleanOut.modifiedCount || 0;

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
          histShifted: true, // chuỗi lịch sử đã dịch ngay trong request này
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
    logsBackfilled: logsBackfill.length,
    usersAffected: userIds.length,
    rankingUpdated,
    historyUpdated,
    backfilled,
    notesCleaned,
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
