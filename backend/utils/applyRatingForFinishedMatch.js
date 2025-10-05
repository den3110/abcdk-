import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import Ranking from "../models/rankingModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import RatingChange from "../models/ratingChangeModel.js";

/* ===================== Tunables (core) ===================== */
const DUPR_MIN = 2;
const DUPR_MAX = 8.0;
const DIFF_SCALE = 0.6; // logistic scale cho expected

// Giảm K để hạ biên độ dao động — tăng nhẹ để KO sâu cộng nhiều hơn
const BASE_K_SINGLES = 0.6;
const BASE_K_DOUBLES = 0.4;
const FLOOR_K = 0.02;
const MATCHES_FOR_FULL_RELIABILITY = 25;
const SYNERGY_WEIGHT = 0.05; // phạt lệch trình trong đôi
const FORFEIT_K_SCALE = 0.25; // nếu forfeit → giảm K

/* ===================== Tunables (margin/phase/context) ===================== */
const MARGIN_MAX_BOOST = 0.25; // boost margin lớn hơn để 11-7 đáng kể hơn
const ROUND_PHASE_STEP = 0.08; // +8%/round
const ROUND_PHASE_CAP = 1.0; // cap đến +100%
const KO_STAGE_BONUS = 0.4; // tăng bonus cho KO

/* ===================== Tunables (form/history) ===================== */
const FORM_ENABLED = true;
const FORM_WINDOW_MATCHES = 10;
const FORM_WINDOW_DAYS = 180;
const FORM_ALPHA_WINS = 0.6;
const FORM_BETA_SETWINS = 0.4;
const FORM_GAMMA_STREAK = 0.05;
const FORM_DELTA_SOS = 0.2;
const FORM_CAP = 0.15;

/* ===================== Tunables (expected context shift) ===================== */
const CTX_RATING_DU = 0.15;

/* ===================== Upset ===================== */
const UPSET_UNDERDOG_MAX_EXPECTED = 0.35;
const UPSET_DIFF_THRESHOLD = 0.8;
const UPSET_DIFF_WIDTH = 0.6;
const UPSET_MAX_BOOST = 0.4;

/* ===================== Soft cap (TEAM level) ===================== */
const SOFT_TEAM_CAP = 0.2; // cho phép team delta lớn hơn
const SOFT_TEAM_SOFTNESS = 0.65;

// min epsilon theo K để không rơi về 0
const MIN_DELTA_EPS_MIN = 0.001;
const MIN_DELTA_EPS_MAX = 0.003;
const MIN_DELTA_EPS_FACTOR = 0.05; // epsilon theo K lớn hơn

// === Shapers ===
const MIDLINE_DAMPEN = true;
const MIDLINE_BETA = 0.65;
const EXP_GAMMA = 1.05; // giảm exponent để margin tác động hơi tuyến tính hơn
const DEFAULT_SEED_RATING = 2;

// === Win negative small ===
const MAX_WIN_NEG = 0.002; // per person
const QUALITY_DEFAULT_WIN = 0.75;

// === WIN-TAX ===
const WIN_TAX_COEF = 0.06;
const WIN_TAX_DIFF_THRESHOLD = 1.2;
const WIN_TAX_CLOSE_MARGIN = 0.08;

/* ===================== Helpers ===================== */
const round3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function harmonicMean(a, b) {
  if (a <= 0 || b <= 0) return Math.max(0, (a + b) / 2);
  return 2 / (1 / a + 1 / b);
}
function expectedFromDiff(diff /* A - B */) {
  return 1 / (1 + Math.pow(10, -(diff / DIFF_SCALE)));
}
function invExpectedToDiff(E) {
  const e = clamp(E, 1e-6, 1 - 1e-6);
  return DIFF_SCALE * (Math.log10(e) - Math.log10(1 - e));
}
function marginBoostFromScores(match, winnerSide /* "A" | "B" */) {
  const arr = Array.isArray(match.gameScores) ? match.gameScores : [];
  if (!arr.length) return 0;
  let winPts = 0,
    losePts = 0;
  for (const g of arr) {
    const a = Number(g.a || 0),
      b = Number(g.b || 0);
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
// điểm chất lượng thắng: 0.5..1, nếu thiếu điểm set → 0.75
function qualityScoreFromScores(match, winnerSide /* "A" | "B" */) {
  const arr = Array.isArray(match.gameScores) ? match.gameScores : [];
  if (!arr.length) return QUALITY_DEFAULT_WIN;
  let winPts = 0,
    losePts = 0;
  for (const g of arr) {
    const a = Number(g.a || 0),
      b = Number(g.b || 0);
    if (winnerSide === "A") {
      winPts += a;
      losePts += b;
    } else {
      winPts += b;
      losePts += a;
    }
  }
  const total = winPts + losePts;
  if (total <= 0) return QUALITY_DEFAULT_WIN;
  const m = clamp((winPts - losePts) / total, -1, 1);
  return clamp(0.5 + 0.5 * Math.max(0, m), 0.5, 1);
}
function teamRatingDoubles(r1, r2) {
  const mean = (r1 + r2) / 2;
  const imbalance = Math.abs(r1 - r2);
  return mean - imbalance * SYNERGY_WEIGHT;
}

// phaseMultiplier now accepts bracketMaxRound to differentiate shallow/deep brackets
function phaseMultiplier(match, bracketType, bracketMaxRound = 0) {
  const r = Math.max(1, Number(match.round) || 1);
  const roundMul = 1 + clamp((r - 1) * ROUND_PHASE_STEP, 0, ROUND_PHASE_CAP);
  const koMul =
    bracketType === "knockout" || bracketType === "roundElim"
      ? 1 + KO_STAGE_BONUS
      : 1;

  // try parse bracket stage/name depth
  let stageDepth = 0;
  try {
    const stage = (match?.bracket?.stage || match?.bracket?.name || "")
      .toString()
      .toUpperCase();
    if (stage) {
      const map = {
        R128: 0,
        R64: 1,
        R32: 2,
        R16: 3,
        R8: 4,
        R4: 5,
        QF: 4,
        SF: 5,
        F: 6,
        FINAL: 6,
      };
      if (map[stage] !== undefined) stageDepth = map[stage];
      else {
        const m = stage.match(/R?(\d+)/);
        if (m) {
          const n = Number(m[1]);
          stageDepth = Math.max(0, Math.floor(Math.log2(128 / Math.max(1, n))));
        }
      }
    }
  } catch (e) {
    stageDepth = 0;
  }

  // fallback to bracketMaxRound if stageDepth is unknown
  if (!stageDepth && bracketMaxRound && Number.isFinite(bracketMaxRound)) {
    stageDepth = Math.max(
      0,
      Math.floor(Math.log2(Math.max(1, bracketMaxRound)))
    );
  }

  // meta.depth override
  if (!stageDepth && match?.bracket?.meta && Number(match.bracket.meta.depth)) {
    stageDepth = Math.max(0, Number(match.bracket.meta.depth));
  }

  const BRACKET_DEPTH_SCALE = 0.2; // mỗi mức depth +20%
  const depthMul = 1 + clamp(stageDepth * BRACKET_DEPTH_SCALE, 0, 2.0);

  // additional depth extras for very deep rounds
  const depthExtra = 1 + clamp(Math.pow(Math.max(0, r - 1), 1.05) / 12, 0, 1.5);
  const deepRoundExtra = r >= 8 ? 1 + (r - 7) * 0.35 : 1;

  return roundMul * koMul * depthMul * depthExtra * deepRoundExtra;
}
function softCapTeam(delta) {
  const x = Math.abs(delta);
  const scaled = Math.tanh(x / (SOFT_TEAM_CAP * SOFT_TEAM_SOFTNESS));
  return Math.sign(delta) * SOFT_TEAM_CAP * scaled;
}
function nextRep(current) {
  return Math.min(100, (Number(current) || 0) + 10);
}
function upsetAmplification(absDiff, E_win) {
  if (E_win > 0.5) return 0;
  if (E_win > UPSET_UNDERDOG_MAX_EXPECTED) return 0;
  if (absDiff < UPSET_DIFF_THRESHOLD) return 0;
  const underdogDegree = clamp(
    (UPSET_UNDERDOG_MAX_EXPECTED - E_win) / UPSET_UNDERDOG_MAX_EXPECTED,
    0,
    1
  );
  const gapDegree = clamp(
    (absDiff - UPSET_DIFF_THRESHOLD) / UPSET_DIFF_WIDTH,
    0,
    1
  );
  return UPSET_MAX_BOOST * underdogDegree * gapDegree;
}
function midlineDampen(E) {
  const closeness = 1 - 4 * Math.pow(E - 0.5, 2); // ∈[0,1]
  return 1 - MIDLINE_BETA * Math.max(0, closeness);
}

/* ===== Weights per player (phân phối Δ theo độ tin cậy & rating) ===== */
function weightFor({ reliability, rating }) {
  const relTerm = Math.pow(1 - clamp(reliability ?? 0, 0, 1), 0.6);
  const pivot = 4.0;
  const over = Math.max(0, (rating ?? pivot) - pivot);
  const ratingTerm = 1 / (1 + over);
  return clamp(0.35 + 0.65 * relTerm * ratingTerm, 0.35, 1.0);
}
function distributeTeamDelta(
  deltaTeam,
  players /* [{uid, reliability, rating}] */
) {
  if (!players.length) return [];
  const ws = players.map(weightFor);
  const sumW = ws.reduce((s, x) => s + x, 0);
  return ws.map((w) =>
    sumW > 0 ? (deltaTeam * w) / sumW : deltaTeam / players.length
  );
}

/* ===================== Ratings & reliability ===================== */
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

/* ===================== Form/History ===================== */
async function getRecentStats(uid, key, cfg) {
  const userId = new mongoose.Types.ObjectId(String(uid));
  const timeFloor = new Date(Date.now() - cfg.FORM_WINDOW_DAYS * 86400000);

  const rc = await RatingChange.find({
    user: userId,
    kind: key === "single" ? "singles" : "doubles",
  })
    .sort({ _id: -1 })
    .limit(cfg.FORM_WINDOW_MATCHES * 2)
    .select("match score expected")
    .lean();

  if (!rc.length) return { winPct: 0.5, setWinPct: 0.5, streak01: 0.5, sos: 0 };

  const matchIds = rc.map((r) => r.match);
  const mlist = await Match.find({
    _id: { $in: matchIds },
    status: "finished",
    finishedAt: { $gte: timeFloor },
  })
    .select("gameScores pairA pairB")
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" })
    .lean();

  let wins = 0,
    total = 0;
  let setWins = 0,
    setTotal = 0;
  let streakSigned = 0;
  let sosSum = 0,
    sosCnt = 0;

  const inMatch = (m) => {
    const ids = [
      m?.pairA?.player1?.user,
      m?.pairA?.player2?.user,
      m?.pairB?.player1?.user,
      m?.pairB?.player2?.user,
    ]
      .filter(Boolean)
      .map(String);
    return ids.includes(String(uid));
  };

  for (const r of rc) {
    const mm = mlist.find((m) => String(m._id) === String(r.match));
    if (!mm || !inMatch(mm)) continue;

    total += 1;
    if (r.score === 1) {
      wins += 1;
      streakSigned = streakSigned >= 0 ? streakSigned + 1 : 1;
    } else {
      streakSigned = streakSigned <= 0 ? streakSigned - 1 : -1;
    }

    const games = Array.isArray(mm.gameScores) ? mm.gameScores : [];
    setTotal += games.length;

    const isA = [mm?.pairA?.player1?.user, mm?.pairA?.player2?.user]
      .map(String)
      .includes(String(uid));
    for (const g of games) {
      const a = Number(g.a || 0),
        b = Number(g.b || 0);
      const won = isA ? a > b : b > a;
      if (won) setWins += 1;
    }

    if (
      typeof r.expected === "number" &&
      isFinite(r.expected) &&
      r.expected > 0 &&
      r.expected < 1
    ) {
      const diff = invExpectedToDiff(r.expected); // myTeam - oppTeam
      sosSum += -diff; // opp - me
      sosCnt += 1;
    }

    if (total >= cfg.FORM_WINDOW_MATCHES) break;
  }

  const winPct = total ? wins / total : 0.5;
  const setWinPct = setTotal ? setWins / setTotal : 0.5;
  const sos = sosCnt ? sosSum / sosCnt : 0;
  const streak01 =
    0.5 +
    0.5 *
      Math.tanh((Math.abs(streakSigned) / 5) * (streakSigned >= 0 ? 1 : -1));

  return { winPct, setWinPct, streak01, sos };
}

function computeFormScore(stats, cfg) {
  const zWin = stats.winPct - 0.5;
  const zSet = stats.setWinPct - 0.5;
  const zStr = stats.streak01 - 0.5;
  const zSOS = clamp(stats.sos / 2.0, -1, 1) * 0.5;

  const raw =
    cfg.FORM_ALPHA_WINS * zWin +
    cfg.FORM_BETA_SETWINS * zSet +
    cfg.FORM_GAMMA_STREAK * zStr +
    cfg.FORM_DELTA_SOS * zSOS;
  const capped = clamp(raw, -FORM_CAP, FORM_CAP);
  return 0.5 + capped;
}

function teamFormScore(kind, formA, formB) {
  return kind === "singles" ? formA : harmonicMean(formA, formB);
}

/* ===================== Main ===================== */
export async function applyRatingForFinishedMatch(matchId) {
  const mt = await Match.findById(matchId)
    .populate({ path: "tournament", select: "eventType noRankDelta createdAt" })
    .populate({ path: "bracket", select: "type stage name meta noRankDelta" })
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" });

  if (!mt) return;
  if (mt.status !== "finished" || !mt.winner || !["A", "B"].includes(mt.winner))
    return;

  if (!mt.pairA || !mt.pairB) {
    await Match.findByIdAndUpdate(matchId, {
      ratingApplied: true,
      ratingAppliedAt: new Date(),
      ratingDelta: 0,
    });
    return;
  }
  if (mt.ratingApplied) return;

  const guardNoDelta =
    mt.noRankDelta === true ||
    mt?.bracket?.noRankDelta === true ||
    mt?.tournament?.noRankDelta === true;
  if (guardNoDelta) {
    await Match.findByIdAndUpdate(matchId, {
      ratingApplied: true,
      ratingAppliedAt: new Date(),
      ratingDelta: 0,
    });
    return;
  }

  const kind = mt.tournament?.eventType === "single" ? "singles" : "doubles";
  const key = mt.tournament?.eventType === "single" ? "single" : "double";
  const when = mt.finishedAt ? new Date(mt.finishedAt) : new Date();
  const winnerSide = mt.winner;
  const bracketType = mt.bracket?.type || "knockout";

  const usersA = [mt.pairA?.player1?.user, mt.pairA?.player2?.user]
    .filter(Boolean)
    .map(String);
  const usersB = [mt.pairB?.player1?.user, mt.pairB?.player2?.user]
    .filter(Boolean)
    .map(String);
  const allIds = [...new Set([...usersA, ...usersB])];

  const latest = await getLatestRatingsMap(allIds);
  const reliabilityMap = await getReliabilityMap(allIds, key);
  const getRating = (uid) => {
    const r = latest.get(uid) || { single: 0, double: 0 };
    const val = Number(r[key] || 0) || 0;
    return val > 0 ? val : DEFAULT_SEED_RATING;
  };

  const repDocs = await Ranking.find({ user: { $in: allIds } })
    .select("user reputation")
    .lean();
  const repMap = new Map(
    repDocs.map((d) => [String(d.user), Number(d.reputation) || 0])
  );

  // bracketMaxRound
  let bracketMaxRound = 0;
  try {
    if (mt?.bracket?._id) {
      const mx = await Match.find({
        tournament: mt.tournament?._id || mt.tournament,
        bracket: mt.bracket._id,
      })
        .sort({ round: -1 })
        .limit(1)
        .select("round")
        .lean();
      bracketMaxRound = mx && mx.length ? Number(mx[0].round) || 0 : 0;
    }
  } catch (e) {
    bracketMaxRound = 0;
  }

  let teamA = 0,
    teamB = 0;
  if (kind === "singles") {
    teamA = usersA[0] ? getRating(usersA[0]) : DEFAULT_SEED_RATING;
    teamB = usersB[0] ? getRating(usersB[0]) : DEFAULT_SEED_RATING;
  } else {
    const a1 = usersA[0] ? getRating(usersA[0]) : DEFAULT_SEED_RATING;
    const a2 = usersA[1] ? getRating(usersA[1]) : a1;
    const b1 = usersB[0] ? getRating(usersB[0]) : DEFAULT_SEED_RATING;
    const b2 = usersB[1] ? getRating(usersB[1]) : b1;
    teamA = teamRatingDoubles(a1, a2);
    teamB = teamRatingDoubles(b1, b2);
  }

  let formA = 0.5,
    formB = 0.5;
  let formDetails = { A: [], B: [] };
  if (FORM_ENABLED) {
    const [sA1, sA2, sB1, sB2] = await Promise.all([
      usersA[0]
        ? getRecentStats(usersA[0], key, {
            FORM_WINDOW_DAYS,
            FORM_WINDOW_MATCHES,
            FORM_ALPHA_WINS,
            FORM_BETA_SETWINS,
            FORM_GAMMA_STREAK,
            FORM_DELTA_SOS,
          })
        : null,
      usersA[1]
        ? getRecentStats(usersA[1], key, {
            FORM_WINDOW_DAYS,
            FORM_WINDOW_MATCHES,
            FORM_ALPHA_WINS,
            FORM_BETA_SETWINS,
            FORM_GAMMA_STREAK,
            FORM_DELTA_SOS,
          })
        : null,
      usersB[0]
        ? getRecentStats(usersB[0], key, {
            FORM_WINDOW_DAYS,
            FORM_WINDOW_MATCHES,
            FORM_ALPHA_WINS,
            FORM_BETA_SETWINS,
            FORM_GAMMA_STREAK,
            FORM_DELTA_SOS,
          })
        : null,
      usersB[1]
        ? getRecentStats(usersB[1], key, {
            FORM_WINDOW_DAYS,
            FORM_WINDOW_MATCHES,
            FORM_ALPHA_WINS,
            FORM_BETA_SETWINS,
            FORM_GAMMA_STREAK,
            FORM_DELTA_SOS,
          })
        : null,
    ]);

    const fA1 = sA1
      ? computeFormScore(sA1, {
          FORM_ALPHA_WINS,
          FORM_BETA_SETWINS,
          FORM_GAMMA_STREAK,
          FORM_DELTA_SOS,
        })
      : 0.5;
    const fA2 = sA2
      ? computeFormScore(sA2, {
          FORM_ALPHA_WINS,
          FORM_BETA_SETWINS,
          FORM_GAMMA_STREAK,
          FORM_DELTA_SOS,
        })
      : 0.5;
    const fB1 = sB1
      ? computeFormScore(sB1, {
          FORM_ALPHA_WINS,
          FORM_BETA_SETWINS,
          FORM_GAMMA_STREAK,
          FORM_DELTA_SOS,
        })
      : 0.5;
    const fB2 = sB2
      ? computeFormScore(sB2, {
          FORM_ALPHA_WINS,
          FORM_BETA_SETWINS,
          FORM_GAMMA_STREAK,
          FORM_DELTA_SOS,
        })
      : 0.5;

    formDetails = {
      A: [
        { uid: usersA[0], ...(sA1 || {}) },
        { uid: usersA[1], ...(sA2 || {}) },
      ].filter((x) => x.uid),
      B: [
        { uid: usersB[0], ...(sB1 || {}) },
        { uid: usersB[1], ...(sB2 || {}) },
      ].filter((x) => x.uid),
    };

    formA = kind === "singles" ? fA1 : teamFormScore(kind, fA1, fA2);
    formB = kind === "singles" ? fB1 : teamFormScore(kind, fB1, fB2);
  }

  const contextDU = CTX_RATING_DU * clamp(formA - formB, -1, 1);
  const diffRaw = teamA - teamB + contextDU;
  const expA = expectedFromDiff(diffRaw);
  const expB = 1 - expA;

  const isForfeit =
    Array.isArray(mt.liveLog) && mt.liveLog.some((e) => e?.type === "forfeit");
  const marginBoost = isForfeit ? 0 : marginBoostFromScores(mt, winnerSide);
  const phaseMul = phaseMultiplier(mt, bracketType, bracketMaxRound);
  const kScale =
    (isForfeit ? FORFEIT_K_SCALE : 1.0) * phaseMul * (1 + marginBoost);

  const relValues = allIds.map((uid) => reliabilityMap.get(uid) ?? 0);
  const avgReliability = relValues.length
    ? relValues.reduce((s, x) => s + x, 0) / relValues.length
    : 0;

  const baseK = kind === "singles" ? BASE_K_SINGLES : BASE_K_DOUBLES;
  const K_match = (baseK * (1 - avgReliability) + FLOOR_K) * kScale;

  const E_win = winnerSide === "A" ? expA : expB;
  const absDiff = Math.abs(teamA - teamB);
  const upsetBoost = upsetAmplification(absDiff, E_win);
  const S_win = qualityScoreFromScores(mt, winnerSide);
  const diffS = clamp(S_win - E_win, -1, 1);

  let D_team_raw =
    K_match * Math.sign(diffS) * Math.pow(Math.abs(diffS), EXP_GAMMA);

  if (diffS > 0) D_team_raw *= 1 + upsetBoost;

  if (MIDLINE_DAMPEN) D_team_raw *= midlineDampen(E_win);

  if (E_win > 0.5) {
    let winTax = 0;
    if (absDiff > WIN_TAX_DIFF_THRESHOLD && diffS < WIN_TAX_CLOSE_MARGIN) {
      winTax = K_match * WIN_TAX_COEF * (E_win - 0.5);
    }
    D_team_raw -= winTax;
  }

  const epsDyn = clamp(
    K_match * MIN_DELTA_EPS_FACTOR,
    MIN_DELTA_EPS_MIN,
    MIN_DELTA_EPS_MAX
  );
  if (Math.abs(D_team_raw) > 0 && Math.abs(D_team_raw) < epsDyn)
    D_team_raw = Math.sign(D_team_raw) * epsDyn;

  let D_team = softCapTeam(D_team_raw);

  const winnerUsers = (winnerSide === "A" ? usersA : usersB).map((uid) => ({
    uid,
    reliability: reliabilityMap.get(uid) ?? 0,
    rating: getRating(uid),
  }));
  const loserUsers = (winnerSide === "A" ? usersB : usersA).map((uid) => ({
    uid,
    reliability: reliabilityMap.get(uid) ?? 0,
    rating: getRating(uid),
  }));

  let winnerDeltas = distributeTeamDelta(D_team, winnerUsers);
  let loserDeltas = distributeTeamDelta(-D_team, loserUsers);

  const clampWinNeg = (d) => Math.max(d, -MAX_WIN_NEG);
  const totalWinBefore = winnerDeltas.reduce((s, x) => s + x, 0);
  let winnerClamped = winnerDeltas.map(clampWinNeg);
  const totalWinAfter = winnerClamped.reduce((s, x) => s + x, 0);
  if (totalWinAfter !== totalWinBefore) {
    const room = winnerClamped.map((val, i) =>
      Math.max(0, winnerDeltas[i] - -MAX_WIN_NEG)
    );
    const sumRoom = room.reduce((s, x) => s + x, 0);
    const deficit = totalWinBefore - totalWinAfter;
    if (sumRoom > 0 && deficit > 0) {
      winnerDeltas = winnerClamped.map(
        (val, i) => val + (room[i] / sumRoom) * deficit
      );
    } else {
      const n = winnerClamped.length || 1;
      winnerDeltas = winnerClamped.map((val) => val + deficit / n);
    }
  } else {
    winnerDeltas = winnerClamped;
  }

  const sumWin = winnerDeltas.reduce((s, x) => s + x, 0);
  const sumLose = loserDeltas.reduce((s, x) => s + x, 0);
  const drift = sumWin + sumLose;
  if (Math.abs(drift) > 1e-9) {
    const s = loserDeltas.reduce((a, b) => a + Math.abs(b), 0) || 1;
    loserDeltas = loserDeltas.map((d) => d - (drift * Math.abs(d)) / s);
  }

  // === APPLY ===
  const histDocs = [];
  const rankingOps = [];
  const logs = [];
  const perUserDeltasAbs = [];

  // caps
  const MAX_PER_TOUR_DELTA = 0.1; // tích lũy dương tối đa cho 1 VĐV trong 1 giải
  const PER_MATCH_CAP = 0.06; // mỗi trận không quá ±0.06

  // compute alreadyGiven per user (tổng delta dương đã cấp cho người đó trong tournament)
  const alreadyGivenMap = new Map();
  try {
    const agg = await RatingChange.aggregate([
      {
        $match: {
          tournament: mt.tournament?._id || mt.tournament,
          user: { $in: allIds.map((id) => new mongoose.Types.ObjectId(id)) },
          kind,
        },
      },
      {
        $group: {
          _id: "$user",
          sumPos: { $sum: { $cond: [{ $gt: ["$delta", 0] }, "$delta", 0] } },
        },
      },
    ]);
    for (const r of agg)
      alreadyGivenMap.set(String(r._id), Number(r.sumPos) || 0);
  } catch (e) {
    // ignore and leave map empty
  }

  const applySide = (users, deltas, isWinner) => {
    users.forEach((u, idx) => {
      const uid = u.uid;
      const current = latest.get(uid) || { single: 0, double: 0 };
      const curVal =
        (Number(current[key]) || 0) > 0
          ? Number(current[key])
          : DEFAULT_SEED_RATING;
      let delta = deltas[idx] ?? 0;

      // remaining allowance (only for positive increases)
      const already = alreadyGivenMap.get(String(uid)) || 0;
      const remain = Math.max(0, MAX_PER_TOUR_DELTA - already);

      if (delta > 0) delta = Math.min(delta, remain);
      if (delta < 0) delta = Math.max(delta, -MAX_PER_TOUR_DELTA);

      // per-match hard cap
      delta = Math.max(-PER_MATCH_CAP, Math.min(PER_MATCH_CAP, delta));

      const next = clamp(curVal + delta, DUPR_MIN, DUPR_MAX);
      perUserDeltasAbs.push(Math.abs(delta));

      const noteScore = isWinner ? S_win : 1 - S_win;
      const noteExp = isWinner ? E_win : 1 - E_win;

      histDocs.push({
        user: uid,
        [key]: round3(next),
        scoredAt: when,
        sourceMatch: mt._id,
        note: `${delta >= 0 ? "+" : ""}${round3(delta)} (S=${round3(
          noteScore
        )},E=${round3(noteExp)},K=${round3(
          K_match
        )},capTour=${MAX_PER_TOUR_DELTA},capMatch=${PER_MATCH_CAP})`,
      });

      const prevRep = repMap.get(String(uid)) ?? 0;
      rankingOps.push({
        updateOne: {
          filter: { user: uid },
          update: {
            $set: {
              single: key === "single" ? round3(next) : current.single ?? 0,
              double: key === "double" ? round3(next) : current.double ?? 0,
              reputation: nextRep(prevRep),
            },
          },
          upsert: true,
        },
      });

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
        expected: isWinner ? E_win : 1 - E_win,
        score: noteScore,
        reliabilityBefore: relBefore,
        reliabilityAfter: relAfter,
        marginBonus,
        contextDU: round3(contextDU),
        bracketType,
        round: mt.round || 1,
        createdAt: new Date(),
      });
    });
  };

  applySide(winnerSide === "A" ? usersA : usersB, winnerDeltas, true);
  applySide(winnerSide === "A" ? usersB : usersA, loserDeltas, false);

  if (histDocs.length) await ScoreHistory.insertMany(histDocs).catch(() => {});
  if (rankingOps.length) await Ranking.bulkWrite(rankingOps).catch(() => {});
  if (logs.length)
    await RatingChange.insertMany(logs, { ordered: false }).catch(() => {});

  const avgAbsDelta = perUserDeltasAbs.length
    ? perUserDeltasAbs.reduce((s, x) => s + x, 0) / perUserDeltasAbs.length
    : 0;
  await Match.findByIdAndUpdate(mt._id, {
    ratingDelta: round3(avgAbsDelta),
    ratingApplied: true,
    ratingAppliedAt: new Date(),
  });
}

/* ===================== Preview (mirror apply) ===================== */
export async function computeRatingPreviewFromParams({
  tournamentId,
  bracketId,
  round = 1,
  pairARegId,
  pairBRegId,
  winner = "A",
  gameScores = [],
  forfeit = false,
}) {
  const Tournament = (await import("../models/tournamentModel.js")).default;
  const Registration = (await import("../models/registrationModel.js")).default;
  const Bracket = (await import("../models/bracketModel.js")).default;

  const tour = await Tournament.findById(tournamentId)
    .select("eventType")
    .lean();
  if (!tour) throw new Error("Tournament not found");

  const br = bracketId
    ? await Bracket.findById(bracketId).select("type stage name meta").lean()
    : null;

  const [regA, regB] = await Promise.all([
    Registration.findById(pairARegId).select("player1 player2").lean(),
    Registration.findById(pairBRegId).select("player1 player2").lean(),
  ]);
  if (!regA || !regB) throw new Error("Registration not found");

  const fakeMatch = {
    _id: new mongoose.Types.ObjectId(),
    status: "finished",
    winner: winner === "A" ? "A" : "B",
    round: Number(round) || 1,
    finishedAt: new Date(),
    tournament: { _id: tournamentId, eventType: tour.eventType },
    bracket: br
      ? {
          _id: br._id,
          type: br.type,
          stage: br.stage,
          name: br.name,
          meta: br.meta,
        }
      : { type: "knockout" },
    pairA: regA,
    pairB: regB,
    gameScores: Array.isArray(gameScores) ? gameScores : [],
    liveLog: forfeit ? [{ type: "forfeit", at: new Date() }] : [],
  };

  const kind = tour.eventType === "single" ? "singles" : "doubles";
  const key = tour.eventType === "single" ? "single" : "double";
  const winnerSide = fakeMatch.winner;
  const bracketType = fakeMatch.bracket?.type || "knockout";

  const usersA = [regA?.player1?.user, regA?.player2?.user]
    .filter(Boolean)
    .map(String);
  const usersB = [regB?.player1?.user, regB?.player2?.user]
    .filter(Boolean)
    .map(String);
  const allIds = [...new Set([...usersA, ...usersB])];

  const latest = await getLatestRatingsMap(allIds);
  const reliabilityMap = await getReliabilityMap(allIds, key);
  const getRating = (uid) => {
    const r = latest.get(uid) || { single: 0, double: 0 };
    const val = Number(r[key] || 0) || 0;
    return val > 0 ? val : DEFAULT_SEED_RATING;
  };

  // bracketMaxRound for preview
  let bracketMaxRound = 0;
  try {
    if (br && br._id) {
      const mx = await Match.find({ tournament: tournamentId, bracket: br._id })
        .sort({ round: -1 })
        .limit(1)
        .select("round")
        .lean();
      bracketMaxRound = mx && mx.length ? Number(mx[0].round) || 0 : 0;
    }
  } catch (e) {
    bracketMaxRound = 0;
  }

  let teamA, teamB;
  if (kind === "singles") {
    teamA = usersA[0] ? getRating(usersA[0]) : DEFAULT_SEED_RATING;
    teamB = usersB[0] ? getRating(usersB[0]) : DEFAULT_SEED_RATING;
  } else {
    const a1 = usersA[0] ? getRating(usersA[0]) : DEFAULT_SEED_RATING;
    const a2 = usersA[1] ? getRating(usersA[1]) : a1;
    const b1 = usersB[0] ? getRating(usersB[0]) : DEFAULT_SEED_RATING;
    const b2 = usersB[1] ? getRating(usersB[1]) : b1;
    teamA = teamRatingDoubles(a1, a2);
    teamB = teamRatingDoubles(b1, b2);
  }

  let formA = 0.5,
    formB = 0.5,
    ctxDU = 0;
  const formDetails = { A: [], B: [] };
  if (FORM_ENABLED) {
    const [sA1, sA2, sB1, sB2] = await Promise.all([
      usersA[0]
        ? getRecentStats(usersA[0], key, {
            FORM_WINDOW_DAYS,
            FORM_WINDOW_MATCHES,
            FORM_ALPHA_WINS,
            FORM_BETA_SETWINS,
            FORM_GAMMA_STREAK,
            FORM_DELTA_SOS,
          })
        : null,
      usersA[1]
        ? getRecentStats(usersA[1], key, {
            FORM_WINDOW_DAYS,
            FORM_WINDOW_MATCHES,
            FORM_ALPHA_WINS,
            FORM_BETA_SETWINS,
            FORM_GAMMA_STREAK,
            FORM_DELTA_SOS,
          })
        : null,
      usersB[0]
        ? getRecentStats(usersB[0], key, {
            FORM_WINDOW_DAYS,
            FORM_WINDOW_MATCHES,
            FORM_ALPHA_WINS,
            FORM_BETA_SETWINS,
            FORM_GAMMA_STREAK,
            FORM_DELTA_SOS,
          })
        : null,
      usersB[1]
        ? getRecentStats(usersB[1], key, {
            FORM_WINDOW_DAYS,
            FORM_WINDOW_MATCHES,
            FORM_ALPHA_WINS,
            FORM_BETA_SETWINS,
            FORM_GAMMA_STREAK,
            FORM_DELTA_SOS,
          })
        : null,
    ]);

    const fA1 = sA1
      ? computeFormScore(sA1, {
          FORM_ALPHA_WINS,
          FORM_BETA_SETWINS,
          FORM_GAMMA_STREAK,
          FORM_DELTA_SOS,
        })
      : 0.5;
    const fA2 = sA2
      ? computeFormScore(sA2, {
          FORM_ALPHA_WINS,
          FORM_BETA_SETWINS,
          FORM_GAMMA_STREAK,
          FORM_DELTA_SOS,
        })
      : 0.5;
    const fB1 = sB1
      ? computeFormScore(sB1, {
          FORM_ALPHA_WINS,
          FORM_BETA_SETWINS,
          FORM_GAMMA_STREAK,
          FORM_DELTA_SOS,
        })
      : 0.5;
    const fB2 = sB2
      ? computeFormScore(sB2, {
          FORM_ALPHA_WINS,
          FORM_BETA_SETWINS,
          FORM_GAMMA_STREAK,
          FORM_DELTA_SOS,
        })
      : 0.5;

    formDetails.A = [
      { uid: usersA[0], ...(sA1 || {}) },
      { uid: usersA[1], ...(sA2 || {}) },
    ].filter((x) => x.uid);
    formDetails.B = [
      { uid: usersB[0], ...(sB1 || {}) },
      { uid: usersB[1], ...(sB2 || {}) },
    ].filter((x) => x.uid);

    formA = kind === "singles" ? fA1 : teamFormScore(kind, fA1, fA2);
    formB = kind === "singles" ? fB1 : teamFormScore(kind, fB1, fB2);
    ctxDU = CTX_RATING_DU * clamp(formA - formB, -1, 1);
  }

  const diffRawPreview = teamA - teamB + ctxDU;
  const expAPreview = expectedFromDiff(diffRawPreview);
  const expBPreview = 1 - expAPreview;

  const isForfeitPreview = forfeit;
  const marginBoostPreview = isForfeitPreview
    ? 0
    : marginBoostFromScores(fakeMatch, winnerSide);
  const phaseMulPreview = phaseMultiplier(
    fakeMatch,
    bracketType,
    bracketMaxRound
  );
  const kScalePreview =
    (isForfeitPreview ? FORFEIT_K_SCALE : 1.0) *
    phaseMulPreview *
    (1 + marginBoostPreview);

  const relValuesPreview = allIds.map((uid) => reliabilityMap.get(uid) ?? 0);
  const avgReliabilityPreview = relValuesPreview.length
    ? relValuesPreview.reduce((s, x) => s + x, 0) / relValuesPreview.length
    : 0;
  const baseKPreview = kind === "singles" ? BASE_K_SINGLES : BASE_K_DOUBLES;
  const K_matchPreview =
    (baseKPreview * (1 - avgReliabilityPreview) + FLOOR_K) * kScalePreview;

  const E_winPreview = winnerSide === "A" ? expAPreview : expBPreview;
  const absDiffPreview = Math.abs(teamA - teamB);
  const upBoostPreview = upsetAmplification(absDiffPreview, E_winPreview);

  const S_winPreview = qualityScoreFromScores(fakeMatch, winnerSide);
  const diffSPreview = clamp(S_winPreview - E_winPreview, -1, 1);

  let D_team_rawPreview =
    K_matchPreview *
    Math.sign(diffSPreview) *
    Math.pow(Math.abs(diffSPreview), EXP_GAMMA);
  if (diffSPreview > 0) D_team_rawPreview *= 1 + upBoostPreview;
  if (MIDLINE_DAMPEN) D_team_rawPreview *= midlineDampen(E_winPreview);
  if (E_winPreview > 0.5) {
    let winTax = 0;
    if (
      absDiffPreview > WIN_TAX_DIFF_THRESHOLD &&
      diffSPreview < WIN_TAX_CLOSE_MARGIN
    )
      winTax = K_matchPreview * WIN_TAX_COEF * (E_winPreview - 0.5);
    D_team_rawPreview -= winTax;
  }

  const epsDynPreview = clamp(
    K_matchPreview * MIN_DELTA_EPS_FACTOR,
    MIN_DELTA_EPS_MIN,
    MIN_DELTA_EPS_MAX
  );
  if (
    Math.abs(D_team_rawPreview) > 0 &&
    Math.abs(D_team_rawPreview) < epsDynPreview
  )
    D_team_rawPreview = Math.sign(D_team_rawPreview) * epsDynPreview;

  let D_teamPreview = softCapTeam(D_team_rawPreview);

  const winnerUsers2 = (winnerSide === "A" ? usersA : usersB).map((uid) => ({
    uid,
    reliability: reliabilityMap.get(uid) ?? 0,
    rating: getRating(uid),
  }));
  const loserUsers2 = (winnerSide === "A" ? usersB : usersA).map((uid) => ({
    uid,
    reliability: reliabilityMap.get(uid) ?? 0,
    rating: getRating(uid),
  }));

  let winnerDeltasPreview = distributeTeamDelta(D_teamPreview, winnerUsers2);
  let loserDeltasPreview = distributeTeamDelta(-D_teamPreview, loserUsers2);

  const clampWinNeg2 = (d) => Math.max(d, -MAX_WIN_NEG);
  const totalWinBefore2 = winnerDeltasPreview.reduce((s, x) => s + x, 0);
  const winnerClamped2 = winnerDeltasPreview.map(clampWinNeg2);
  const totalWinAfter2 = winnerClamped2.reduce((s, x) => s + x, 0);
  if (totalWinAfter2 !== totalWinBefore2) {
    const room = winnerClamped2.map((val, i) =>
      Math.max(0, winnerDeltasPreview[i] - -MAX_WIN_NEG)
    );
    const sumRoom = room.reduce((s, x) => s + x, 0);
    const deficit = totalWinBefore2 - totalWinAfter2;
    if (sumRoom > 0 && deficit > 0)
      winnerDeltasPreview = winnerClamped2.map(
        (val, i) => val + (room[i] / sumRoom) * deficit
      );
    else {
      const n = winnerClamped2.length || 1;
      winnerDeltasPreview = winnerClamped2.map((val) => val + deficit / n);
    }
  } else {
    winnerDeltasPreview = winnerClamped2;
  }

  const sumWin2 = winnerDeltasPreview.reduce((s, x) => s + x, 0);
  const sumLose2 = loserDeltasPreview.reduce((s, x) => s + x, 0);
  const drift2 = sumWin2 + sumLose2;
  if (Math.abs(drift2) > 1e-9) {
    const s = loserDeltasPreview.reduce((a, b) => a + Math.abs(b), 0) || 1;
    loserDeltasPreview = loserDeltasPreview.map(
      (d) => d - (drift2 * Math.abs(d)) / s
    );
  }

  // build perUser preview
  const perUser = [];
  const push = (uid, side, delta) => {
    const cur = latest.get(uid) || { single: 0, double: 0 };
    const curVal =
      (Number(cur[key]) || 0) > 0 ? Number(cur[key]) : DEFAULT_SEED_RATING;
    const next = clamp(curVal + delta, DUPR_MIN, DUPR_MAX);
    perUser.push({
      uid,
      side,
      before: round3(curVal),
      delta: round3(delta),
      after: round3(next),
    });
  };
  (winnerSide === "A" ? usersA : usersB).forEach((uid, i) =>
    push(uid, winnerSide, winnerDeltasPreview[i] ?? 0)
  );
  (winnerSide === "A" ? usersB : usersA).forEach((uid, i) =>
    push(uid, winnerSide === "A" ? "B" : "A", loserDeltasPreview[i] ?? 0)
  );

  return {
    params: {
      tournamentId,
      bracketId,
      round,
      pairARegId,
      pairBRegId,
      winner,
      gameScores,
      forfeit,
    },
    kind,
    key,
    teams: {
      teamA: round3(teamA),
      teamB: round3(teamB),
      diffRaw: round3(diffRawPreview),
    },
    expected: {
      expA: round3(expAPreview),
      expB: round3(expBPreview),
      E_win: round3(E_winPreview),
    },
    context: {
      formA: round3(formA),
      formB: round3(formB),
      contextDU: round3(ctxDU),
      formDetails,
    },
    multipliers: {
      baseK: round3(baseKPreview),
      avgReliability: round3(avgReliabilityPreview),
      marginBoost: round3(marginBoostPreview),
      phaseMul: round3(phaseMulPreview),
      upsetBoost: round3(upBoostPreview || 0),
      kScale: round3(kScalePreview),
      K_match: round3(K_matchPreview),
      shaper: {
        gamma: EXP_GAMMA,
        midFactor: round3(MIDLINE_DAMPEN ? midlineDampen(E_winPreview) : 1),
        epsDyn: round3(epsDynPreview),
      },
    },
    delta: {
      raw: round3(D_team_rawPreview),
      soft: round3(D_teamPreview),
      cap: SOFT_TEAM_CAP,
      softness: SOFT_TEAM_SOFTNESS,
    },
    perUser,
    zeroSumCheck: round3(perUser.reduce((s, u) => s + u.delta, 0)),
  };
}
