import mongoose from "mongoose";
import User from "../models/userModel.js";
import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import Assessment from "../models/assessmentModel.js";
import RatingChange from "../models/ratingChangeModel.js";

/** ===================== Tunables (bạn có thể chỉnh) ===================== **/
const DUPR_MIN = 2.0;
const DUPR_MAX = 8.0;

// Độ dốc kỳ vọng thắng thua trên thang DUPR.
// Chênh ~0.6 level ~ 75% thắng.
const DIFF_SCALE = 0.6;

// K cơ bản (đơn vị: level). K hiệu dụng = baseK*(1 - reliability) + floorK
const BASE_K_SINGLES = 0.18;
const BASE_K_DOUBLES = 0.14;
const FLOOR_K = 0.04; // tránh K về 0 khi reliability=1

// Thưởng nhẹ theo margin (tổng điểm thắng - thua).
// Tối đa cộng/đè ~ +/- 25% K.
const MARGIN_MAX_BOOST = 0.25;

// Reliability tăng theo số trận, cap ở 1.0
const MATCHES_FOR_FULL_RELIABILITY = 25;

// Bonus/penalty cho team mất cân bằng kỹ năng (doubles)
const SYNERGY_WEIGHT = 0.05; // giảm ~0.05*(|p1-p2|) vào team rating

/** ===================== Helpers ===================== **/
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function expectedFromDiff(diff /* A - B trên thang DUPR */) {
  // logistic với base10 cho cảm giác "Elo"
  // E = 1 / (1 + 10^(-(diff / DIFF_SCALE)))
  return 1 / (1 + Math.pow(10, -(diff / DIFF_SCALE)));
}

function teamRatingDoubles(u1, u2) {
  const r1 = u1.localRatings?.doubles ?? 3.5;
  const r2 = u2?.localRatings?.doubles ?? r1; // nếu lẻ, dùng r1
  const mean = (r1 + r2) / 2;
  const imbalance = Math.abs(r1 - r2);
  // team rating giảm nhẹ nếu lệch trình lớn
  return mean - imbalance * SYNERGY_WEIGHT;
}

function ratingSingles(u) {
  return u.localRatings?.singles ?? 3.5;
}

function reliabilityFor(kind, user) {
  const played =
    kind === "singles"
      ? user.localRatings?.matchesSingles ?? 0
      : user.localRatings?.matchesDoubles ?? 0;
  return clamp(played / MATCHES_FOR_FULL_RELIABILITY, 0, 1);
}

function kFor(kind, reliability) {
  const base = kind === "singles" ? BASE_K_SINGLES : BASE_K_DOUBLES;
  return base * (1 - reliability) + FLOOR_K;
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

  // normalized margin in [-1..1]
  const m = clamp((winPts - losePts) / total, -1, 1);
  // map -> [-MARGIN_MAX_BOOST..+MARGIN_MAX_BOOST]
  return MARGIN_MAX_BOOST * m;
}

/** Lấy/seed rating ban đầu từ Assessment nếu user chưa có */
async function ensureSeedFromAssessment(userIds, kind, session) {
  const users = await User.find({ _id: { $in: userIds } }).session(session);
  for (const u of users) {
    const lr = u.localRatings || {};
    const field = kind === "singles" ? "singles" : "doubles";
    if (lr[field] && lr[field] > 0) continue;

    const latest = await Assessment.findOne({ user: u._id })
      .sort({ scoredAt: -1 })
      .session(session)
      .lean();

    const seed =
      kind === "singles"
        ? latest?.singleLevel || 3.5
        : latest?.doubleLevel || 3.5;

    u.localRatings = {
      ...lr,
      [field]: clamp(Number(seed) || 3.5, DUPR_MIN, DUPR_MAX),
    };
    await u.save({ session });
  }
}

/** Lấy user objects từ Registration (pairA/pairB) */
async function getUsersFromRegistration(regId, session) {
  const reg = await Registration.findById(regId)
    .select("player1.user player2.user")
    .session(session)
    .lean();
  if (!reg) return [];
  const ids = [reg.player1?.user, reg.player2?.user].filter(Boolean);
  return User.find({ _id: { $in: ids } }).session(session);
}

/** Cập nhật rating + log cho 1 user */
async function applyForUser({
  session,
  user,
  kind,
  teamExpected,
  score,
  marginBoost,
  overrideDelta, // NEW: nếu truyền vào thì dùng delta này (đảm bảo ± bằng nhau)
}) {
  const lr = user.localRatings || {};
  const field = kind === "singles" ? "singles" : "doubles";
  const matchesField = kind === "singles" ? "matchesSingles" : "matchesDoubles";
  const reliabilityField =
    kind === "singles" ? "reliabilitySingles" : "reliabilityDoubles";

  const before = lr[field] ?? 3.5;
  const reliability = reliabilityFor(kind, user);

  // Nếu có overrideDelta thì dùng nó (zero-sum, per-person equal).
  // Ngược lại fallback công thức K cá nhân (ít dùng sau khi bật equal delta).
  let delta;
  if (typeof overrideDelta === "number") {
    delta = overrideDelta;
  } else {
    const K = kFor(kind, reliability);
    const eff = K * (1 + marginBoost); // marginBoost ∈ [-0.25 .. +0.25]
    delta = eff * (score - teamExpected);
  }

  const after = clamp(
    before + delta,
    lr.minBound ?? DUPR_MIN,
    lr.maxBound ?? DUPR_MAX
  );
  const nextMatches = (lr[matchesField] ?? 0) + 1;
  const nextReliability = clamp(
    nextMatches / MATCHES_FOR_FULL_RELIABILITY,
    0,
    1
  );

  // mutate
  user.localRatings = {
    ...lr,
    [field]: after,
    [matchesField]: nextMatches,
    [reliabilityField]: nextReliability,
  };

  return {
    before,
    after,
    delta,
    reliabilityBefore: reliability,
    reliabilityAfter: nextReliability,
  };
}

/** ===================== API chính: áp dụng rating cho 1 trận ===================== **/
export async function applyRatingForMatch(matchId) {
  console.log(123)
  const session = await mongoose.startSession();
  let result = null;

  await session.withTransaction(async () => {
    const m = await Match.findById(matchId)
      .populate({ path: "tournament", select: "eventType" })
      .session(session);

    if (!m) throw new Error("Match not found");
    if (m.status !== "finished") throw new Error("Match not finished");
    if (m.ratingApplied) {
      result = { ok: true, alreadyApplied: true };
      return;
    }

    // BYE/missing pair → skip ghi cờ và thoát
    if (!m.pairA || !m.pairB) {
      m.ratingDelta = 0;
      m.ratingApplied = true;
      m.ratingAppliedAt = new Date();
      await m.save({ session });
      result = { ok: true, applied: false, reason: "BYE/missing pair" };
      return;
    }

    const kind = m.tournament?.eventType === "single" ? "singles" : "doubles";

    // Lấy user 2 phía
    const usersA = await getUsersFromRegistration(m.pairA, session);
    const usersB = await getUsersFromRegistration(m.pairB, session);

    const allUsers = [...usersA.map((u) => u._id), ...usersB.map((u) => u._id)];
    await ensureSeedFromAssessment(allUsers, kind, session);

    // Reload users sau seed
    const [UA, UB] = await Promise.all([
      getUsersFromRegistration(m.pairA, session),
      getUsersFromRegistration(m.pairB, session),
    ]);

    // Team rating & expected
    const teamA =
      kind === "singles"
        ? ratingSingles(UA[0] || {})
        : teamRatingDoubles(UA[0] || {}, UA[1] || UA[0] || {});
    const teamB =
      kind === "singles"
        ? ratingSingles(UB[0] || {})
        : teamRatingDoubles(UB[0] || {}, UB[1] || UB[0] || {});

    const expA = expectedFromDiff(teamA - teamB);
    const expB = 1 - expA;

    const winnerSide = m.winner; // "A" | "B"
    const sA = winnerSide === "A" ? 1 : 0;
    const sB = 1 - sA;

    const marginBoost = marginBonusFromScores(m, winnerSide);

    /* ============= ZERO-SUM & PER-PERSON EQUAL DELTA =============
       - K dùng CHUNG CHO TRẬN: dựa trên độ tin cậy trung bình của tất cả người chơi
       - Mỗi người bên thắng +D, mỗi người bên thua -D (|D| bằng nhau)
       - Phụ thuộc expected: D = K_match * (1 - E_win)
    ===============================================================*/
    const allUsersObjs = [...UA, ...UB];
    const avgReliability = allUsersObjs.length
      ? allUsersObjs
          .map((u) => reliabilityFor(kind, u))
          .reduce((s, x) => s + x, 0) / allUsersObjs.length
      : 0;

    const baseK = kind === "singles" ? BASE_K_SINGLES : BASE_K_DOUBLES;
    const K_match =
      (baseK * (1 - avgReliability) + FLOOR_K) * (1 + marginBoost);

    const E_win = winnerSide === "A" ? expA : expB;
    const deltaPerPersonWin = K_match * (1 - E_win); // dương
    const deltaPerPersonLose = -deltaPerPersonWin; // âm, |.| bằng nhau

    // Áp dụng cho từng user
    const updates = [];
    const logs = [];

    for (const u of UA) {
      const upd = await applyForUser({
        session,
        user: u,
        kind,
        teamExpected: expA,
        score: sA,
        marginBoost,
        overrideDelta:
          winnerSide === "A" ? deltaPerPersonWin : deltaPerPersonLose,
      });
      updates.push(u.save({ session }));
      logs.push({
        user: u._id,
        match: m._id,
        tournament: m.tournament?._id || m.tournament,
        kind,
        before: upd.before,
        after: upd.after,
        delta: upd.delta,
        expected: expA,
        score: sA,
        reliabilityBefore: upd.reliabilityBefore,
        reliabilityAfter: upd.reliabilityAfter,
        marginBonus: marginBoost,
      });
    }
    for (const u of UB) {
      const upd = await applyForUser({
        session,
        user: u,
        kind,
        teamExpected: expB,
        score: sB,
        marginBoost,
        overrideDelta:
          winnerSide === "B" ? deltaPerPersonWin : deltaPerPersonLose,
      });
      updates.push(u.save({ session }));
      logs.push({
        user: u._id,
        match: m._id,
        tournament: m.tournament?._id || m.tournament,
        kind,
        before: upd.before,
        after: upd.after,
        delta: upd.delta,
        expected: expB,
        score: sB,
        reliabilityBefore: upd.reliabilityBefore,
        reliabilityAfter: upd.reliabilityAfter,
        marginBonus: marginBoost,
      });
    }

    await Promise.all(updates);
    // insertMany idempotent nhờ unique idx (user,match,kind)
    await RatingChange.insertMany(logs, { ordered: false, session }).catch(
      () => {}
    );

    // cập nhật match flags
    const avgDelta = logs.length
      ? logs.reduce((s, x) => s + Math.abs(x.delta), 0) / logs.length
      : 0;
    m.ratingDelta = avgDelta;
    m.ratingApplied = true;
    m.ratingAppliedAt = new Date();
    await m.save({ session });

    result = {
      ok: true,
      applied: true,
      avgDelta,
      kind,
      expectedA: expA,
      expectedB: expB,
      marginBoost,
      K_match,
      deltaPerPersonWin,
    };
  });

  session.endSession();
  return result || { ok: true };
}

/** ===================== Recompute tiện ích ===================== **/
/** Recompute toàn bộ cho 1 tournament (theo thứ tự thời gian) */
export async function recomputeTournamentRatings(tournamentId) {
  const session = await mongoose.startSession();
  await session.withTransaction(async () => {
    // reset cục bộ tất cả user có tham gia giải
    const regs = await Registration.find({ tournament: tournamentId })
      .select("player1.user player2.user")
      .lean()
      .session(session);
    const userIds = [
      ...new Set(
        regs
          .flatMap((r) => [r.player1?.user, r.player2?.user])
          .filter(Boolean)
          .map(String)
      ),
    ];

    // Xóa log & reset cờ để replay
    await RatingChange.deleteMany({ tournament: tournamentId }).session(
      session
    );
    await Match.updateMany(
      { tournament: tournamentId },
      { $set: { ratingApplied: false, ratingAppliedAt: null } },
      { session }
    );

    // Reapply theo thứ tự thời gian
    const matches = await Match.find({ tournament: tournamentId })
      .sort({ startedAt: 1, finishedAt: 1, createdAt: 1 })
      .session(session);
    for (const m of matches) {
      if (m.status === "finished") {
        await applyRatingForMatch(m._id);
      }
    }
  });
  session.endSession();
  return { ok: true, recomputed: true };
}

/** Recompute theo user (replay tất cả trận có mặt user) */
export async function recomputeUserRatings(userId) {
  const session = await mongoose.startSession();
  await session.withTransaction(async () => {
    // Xóa log theo user
    await RatingChange.deleteMany({ user: userId }).session(session);

    // (optional) reset counters user này, không reset level
    const u = await User.findById(userId).session(session);
    if (u) {
      u.localRatings.matchesSingles = 0;
      u.localRatings.matchesDoubles = 0;
      u.localRatings.reliabilitySingles = 0;
      u.localRatings.reliabilityDoubles = 0;
      await u.save({ session });
    }

    // Tìm các match user tham gia
    const regs = await Registration.find({
      $or: [{ "player1.user": userId }, { "player2.user": userId }],
    })
      .select("_id tournament")
      .session(session);
    const regIds = regs.map((r) => r._id);
    const matches = await Match.find({
      $or: [{ pairA: { $in: regIds } }, { pairB: { $in: regIds } }],
      status: "finished",
    })
      .sort({ startedAt: 1, finishedAt: 1, createdAt: 1 })
      .session(session);

    for (const m of matches) {
      // để chắc ăn, reset flag match (chỉ khi user liên quan)
      if (
        regIds.some(
          (id) =>
            String(id) === String(m.pairA) || String(id) === String(m.pairB)
        )
      ) {
        m.ratingApplied = false;
        m.ratingAppliedAt = null;
        await m.save({ session });
        await applyRatingForMatch(m._id);
      }
    }
  });
  session.endSession();
  return { ok: true };
}
