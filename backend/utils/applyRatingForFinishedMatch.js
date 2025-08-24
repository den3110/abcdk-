// utils/applyRatingForFinishedMatch.js
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import Ranking from "../models/rankingModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import RatingChange from "../models/ratingChangeModel.js"; // ⬅️ NEW

/* ===================== Tunables ===================== */
const DUPR_MIN = 2.0;
const DUPR_MAX = 8.0;
const DIFF_SCALE = 0.6; // logistic scale cho expected
const BASE_K_SINGLES = 0.18;
const BASE_K_DOUBLES = 0.14;
const FLOOR_K = 0.04; // K tối thiểu
const MATCHES_FOR_FULL_RELIABILITY = 25;
const MARGIN_MAX_BOOST = 0.25; // cap ±25% K theo margin
const SYNERGY_WEIGHT = 0.05; // phạt lệch trình trong đôi
const FORFEIT_K_SCALE = 0.25; // nếu forfeit → giảm K

const round3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ===================== Helpers ===================== */
function expectedFromDiff(diff /* A - B (DUPR) */) {
  // E = 1 / (1 + 10^(-(diff / DIFF_SCALE)))
  return 1 / (1 + Math.pow(10, -(diff / DIFF_SCALE)));
}

function marginBonusFromScores(match, winnerSide /* "A" | "B" */) {
  const arr = Array.isArray(match.gameScores) ? match.gameScores : [];
  if (!arr.length) return 0;

  let winPts = 0,
    losePts = 0;
  for (const g of arr) {
    const a = Number(g.a || 0);
    const b = Number(g.b || 0);
    if (winnerSide === "A") {
      winPts += a;
      losePts += b;
    } else {
      winPts += b;
      losePts += a;
    }
  }
  const total = winPts + losePts;
  if (total <= 0) return 0;
  const m = clamp((winPts - losePts) / total, -1, 1);
  return MARGIN_MAX_BOOST * m;
}

function teamRatingDoubles(r1, r2) {
  const mean = (r1 + r2) / 2;
  const imbalance = Math.abs(r1 - r2);
  return mean - imbalance * SYNERGY_WEIGHT;
}

/** Lấy điểm hiện tại (single/double) của user từ ScoreHistory (mới nhất) hoặc fallback Ranking */
async function getLatestRatingsMap(userIds) {
  const ids = [...new Set(userIds.map(String))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );

  // lấy record mới nhất từ ScoreHistory
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

  // fallback từ Ranking nếu chưa có lịch sử
  const ranks = await Ranking.find({ user: { $in: ids } }).select(
    "user single double"
  );
  ranks.forEach((r) => {
    const k = String(r.user);
    if (!map.has(k)) {
      map.set(k, {
        single: Number.isFinite(r.single) ? r.single : 0,
        double: Number.isFinite(r.double) ? r.double : 0,
      });
    }
  });

  // đảm bảo đủ key
  userIds.forEach((uid) => {
    if (!map.has(String(uid))) map.set(String(uid), { single: 0, double: 0 });
  });

  return map;
}

/** Đếm số lần đã chấm (để suy ra reliability) theo key "single"/"double" */
async function getReliabilityMap(userIds, key /* "single"|"double" */) {
  const ids = [...new Set(userIds.map(String))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  const existsKey = {};
  existsKey[key] = { $exists: true };

  const agg = await ScoreHistory.aggregate([
    { $match: { user: { $in: ids }, ...existsKey } },
    { $group: { _id: "$user", c: { $sum: 1 } } },
  ]);

  const map = new Map(agg.map((r) => [String(r._id), r.c]));
  const rel = new Map();
  for (const uid of userIds.map(String)) {
    const c = map.get(uid) || 0;
    rel.set(uid, clamp(c / MATCHES_FOR_FULL_RELIABILITY, 0, 1));
  }
  return rel;
}

function kFor(kind, reliability) {
  const base = kind === "singles" ? BASE_K_SINGLES : BASE_K_DOUBLES;
  return base * (1 - reliability) + FLOOR_K;
}

/** Tăng reputation hiện tại thêm 10 (như logic cũ) – bạn có thể thay đổi theo ReputationEvent nếu muốn */
function nextRep(current) {
  return Math.min(100, (Number(current) || 0) + 10);
}

/* ===================== Main ===================== */
export async function applyRatingForFinishedMatch(matchId) {
  const mt = await Match.findById(matchId)
    .populate({ path: "tournament", select: "eventType" })
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" });

  if (!mt) return;
  if (mt.status !== "finished" || !mt.winner || !["A", "B"].includes(mt.winner))
    return;

  // BYE/missing pair → skip, đánh dấu đã áp
  if (!mt.pairA || !mt.pairB) {
    mt.ratingApplied = true;
    mt.ratingAppliedAt = new Date();
    mt.ratingDelta = 0;
    await mt.save();
    return;
  }

  if (mt.ratingApplied) return; // đã áp dụng rồi thì thôi

  // singles hay doubles?
  const kind = mt.tournament?.eventType === "single" ? "singles" : "doubles"; // dùng cho log
  const key = mt.tournament?.eventType === "single" ? "single" : "double";    // dùng cho Ranking/ScoreHistory
  const when = mt.finishedAt || new Date();
  const winnerSide = mt.winner; // "A" | "B"

  const regWin = winnerSide === "A" ? mt.pairA : mt.pairB;
  const regLose = winnerSide === "A" ? mt.pairB : mt.pairA;

  const winUsers = [regWin?.player1?.user, regWin?.player2?.user]
    .filter(Boolean)
    .map(String);
  const loseUsers = [regLose?.player1?.user, regLose?.player2?.user]
    .filter(Boolean)
    .map(String);
  const allIds = [...new Set([...winUsers, ...loseUsers])];

  // Lấy điểm hiện tại
  const latest = await getLatestRatingsMap(allIds);

  // Reliability (đếm lịch sử ScoreHistory)
  const reliabilityMap = await getReliabilityMap(allIds, key);

  // Team rating & expected
  const getRating = (uid) => {
    const r = latest.get(uid) || { single: 0, double: 0 };
    const val = Number(r[key] || 0) || 0;
    // nếu hệ cũ bắt đầu từ 0, seed tạm 3.5 cho hợp lý
    return val > 0 ? val : 3.5;
  };

  // tính team rating
  let teamA = 0,
    teamB = 0;
  if (kind === "singles") {
    const ua = mt.pairA?.player1?.user ? String(mt.pairA.player1.user) : null;
    const ub = mt.pairB?.player1?.user ? String(mt.pairB.player1.user) : null;
    teamA = ua ? getRating(ua) : 3.5;
    teamB = ub ? getRating(ub) : 3.5;
  } else {
    const a1 = mt.pairA?.player1?.user
      ? getRating(String(mt.pairA.player1.user))
      : 3.5;
    const a2 = mt.pairA?.player2?.user
      ? getRating(String(mt.pairA.player2.user))
      : a1;
    const b1 = mt.pairB?.player1?.user
      ? getRating(String(mt.pairB.player1.user))
      : 3.5;
    const b2 = mt.pairB?.player2?.user
      ? getRating(String(mt.pairB.player2.user))
      : b1;
    teamA = teamRatingDoubles(a1, a2);
    teamB = teamRatingDoubles(b1, b2);
  }

  const expA = expectedFromDiff(teamA - teamB);
  const expB = 1 - expA;

  // margin + forfeit policy
  const isForfeit =
    Array.isArray(mt.liveLog) && mt.liveLog.some((e) => e?.type === "forfeit");
  const marginBoost = isForfeit ? 0 : marginBonusFromScores(mt, winnerSide);
  const kScale = isForfeit ? FORFEIT_K_SCALE : 1.0;

  /* ============= ZERO-SUM & PER-PERSON EQUAL DELTA =============
     - K dùng CHUNG CHO TRẬN: dựa trên độ tin cậy trung bình của tất cả người chơi
     - Mỗi người bên thắng +D, mỗi người bên thua -D (|D| bằng nhau)
     - Vẫn phụ thuộc expected: D = K_match * (1 - E_win)  (E_win = expA/expB)
  ===============================================================*/
  const relValues = allIds.map((uid) => reliabilityMap.get(uid) ?? 0);
  const avgReliability = relValues.length
    ? relValues.reduce((s, x) => s + x, 0) / relValues.length
    : 0;

  const baseK = kind === "singles" ? BASE_K_SINGLES : BASE_K_DOUBLES;
  const K_match =
    (baseK * (1 - avgReliability) + FLOOR_K) * (1 + marginBoost) * kScale;

  const E_win = winnerSide === "A" ? expA : expB;
  const D_perPerson = K_match * (1 - E_win); // cùng độ lớn cho cả 2 bên

  // Tính delta và cập nhật
  const histDocs = [];
  const rankingUpdates = [];
  const logs = []; // ⬅️ NEW: log vào RatingChange

  const perUserDeltas = []; // để tính match.ratingDelta

  // winner side users (cộng cùng +D_perPerson)
  for (const uid of winUsers) {
    const current = latest.get(uid) || { single: 0, double: 0 };
    const curVal = (Number(current[key]) || 0) > 0 ? Number(current[key]) : 3.5;

    const delta = D_perPerson; // + (dương)
    const next = clamp(curVal + delta, DUPR_MIN, DUPR_MAX);
    perUserDeltas.push(Math.abs(delta));

    histDocs.push({
      user: uid,
      [key]: round3(next),
      scoredAt: when,
      sourceMatch: mt._id,
      note: `+${round3(delta)} (E=${round3(E_win)},K=${round3(K_match)})`,
    });

    // cập nhật Ranking
    const repDoc = await Ranking.findOne({ user: uid })
      .select("reputation")
      .lean();
    rankingUpdates.push({
      updateOne: {
        filter: { user: uid },
        update: {
          $set: {
            single: key === "single" ? round3(next) : current.single ?? 0,
            double: key === "double" ? round3(next) : current.double ?? 0,
            reputation: nextRep(repDoc?.reputation),
          },
        },
        upsert: true,
      },
    });

    // === LOG vào RatingChange (idempotent nhờ unique idx) ===
    const relBefore = reliabilityMap.get(uid) ?? 0;
    const relAfter = clamp(
      relBefore + 1 / MATCHES_FOR_FULL_RELIABILITY,
      0,
      1
    );
    logs.push({
      user: uid,
      match: mt._id,
      tournament: mt.tournament?._id || mt.tournament,
      kind, // "singles" | "doubles"
      before: round3(curVal),
      after: round3(next),
      delta: round3(delta),
      expected: E_win,
      score: 1,
      reliabilityBefore: relBefore,
      reliabilityAfter: relAfter,
      marginBonus: marginBoost,
    });
  }

  // loser side users (trừ cùng -D_perPerson)
  for (const uid of loseUsers) {
    const current = latest.get(uid) || { single: 0, double: 0 };
    const curVal = (Number(current[key]) || 0) > 0 ? Number(current[key]) : 3.5;

    const delta = -D_perPerson; // - (âm)
    const next = clamp(curVal + delta, DUPR_MIN, DUPR_MAX);
    perUserDeltas.push(Math.abs(delta));

    const E_lose = 1 - E_win; // chỉ để note cho rõ
    histDocs.push({
      user: uid,
      [key]: round3(next),
      scoredAt: when,
      sourceMatch: mt._id,
      note: `${round3(delta)} (E=${round3(E_lose)},K=${round3(K_match)})`,
    });

    // cập nhật Ranking
    const repDoc = await Ranking.findOne({ user: uid })
      .select("reputation")
      .lean();
    rankingUpdates.push({
      updateOne: {
        filter: { user: uid },
        update: {
          $set: {
            single: key === "single" ? round3(next) : current.single ?? 0,
            double: key === "double" ? round3(next) : current.double ?? 0,
            reputation: nextRep(repDoc?.reputation),
          },
        },
        upsert: true,
      },
    });

    // === LOG vào RatingChange
    const relBefore = reliabilityMap.get(uid) ?? 0;
    const relAfter = clamp(
      relBefore + 1 / MATCHES_FOR_FULL_RELIABILITY,
      0,
      1
    );
    logs.push({
      user: uid,
      match: mt._id,
      tournament: mt.tournament?._id || mt.tournament,
      kind,
      before: round3(curVal),
      after: round3(next),
      delta: round3(delta),
      expected: E_lose,
      score: 0,
      reliabilityBefore: relBefore,
      reliabilityAfter: relAfter,
      marginBonus: marginBoost,
    });
  }

  // Ghi lịch sử & cập nhật Ranking
  if (histDocs.length) await ScoreHistory.insertMany(histDocs);
  if (rankingUpdates.length) await Ranking.bulkWrite(rankingUpdates);

  // ⬅️ NEW: Ghi log vào RatingChange (idempotent)
  if (logs.length) {
    await RatingChange.insertMany(logs, { ordered: false }).catch(() => {});
  }

  // Lưu delta trung bình vào match và đánh dấu đã áp
  const avgAbsDelta = perUserDeltas.length
    ? perUserDeltas.reduce((s, x) => s + x, 0) / perUserDeltas.length
    : 0;

  mt.ratingDelta = round3(avgAbsDelta);
  mt.ratingApplied = true;
  mt.ratingAppliedAt = new Date();
  await mt.save();
}
