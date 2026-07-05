// utils/applyRatingForFinishedMatch.js
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import Ranking from "../models/rankingModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import RatingChange from "../models/ratingChangeModel.js";
import User from "../models/userModel.js";

/* ===================== Tunables (core) ===================== */
const DUPR_MIN = 1.6;
const DUPR_MAX = 8.0;
const DIFF_SCALE = 0.8; // logistic scale cho expected

// Smart rating factors; outcome is primary, context scales magnitude.
const BASE_K_SINGLES = 0.22;
const BASE_K_DOUBLES = 0.24;
const FLOOR_K = 0.05;
const MATCHES_FOR_FULL_RELIABILITY = 40;
const RELIABILITY_DECAY = 0.65;
const SYNERGY_WEIGHT = 0.05;
const FORFEIT_K_SCALE = 0.25;

const MARGIN_MAX_BOOST = 0.35;

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
const UPSET_MAX_BOOST = 0.55;

/* ===================== Soft cap (TEAM level) ===================== */
const SOFT_TEAM_CAP = 0.22;
const SOFT_TEAM_SOFTNESS = 0.9;

// === Shapers ===
const MIDLINE_DAMPEN = false;
const MIDLINE_BETA = 0.65;
const EXP_GAMMA = 1;
const DEFAULT_SEED_RATING = 2.5;
const MALE_DEFAULT_SEED_RATING = 2.1;
const NEW_PLAYER_WEIGHT_BONUS = 0.75;

// === Win negative limit ===
// ⭐ Đội thắng CHỈ bị trừ tối đa 0.001/người, chỉ khi kèo QUÁ LỆCH + thắng yếu
const MAX_WIN_NEG = -0.001;

// === ⭐ Giảm độ lớn thay đổi điểm trình cho các vòng KHÔNG phải knockout ===
// Chỉ vòng loại trực tiếp (knockout / loại kép) giữ nguyên độ lớn (= 1.0);
// vòng bảng, playoff, roundelim, prequalifying, swiss/gsl... cộng/trừ NHẸ hơn
// (vẫn zero-sum: giảm đều cả điểm cộng của người thắng lẫn điểm trừ của người thua).
// Muốn nặng/nhẹ hơn: chỉ đổi đúng 1 số NON_KNOCKOUT_DELTA_SCALE (1.0 = như knockout, càng nhỏ càng nhẹ).
const NON_KNOCKOUT_DELTA_SCALE = 0.6;
const KNOCKOUT_FAMILY_TYPES = new Set(["knockout", "double_elim"]);
function formatDeltaScale(bracketType) {
  const type = String(bracketType || "").toLowerCase();
  return KNOCKOUT_FAMILY_TYPES.has(type) ? 1 : NON_KNOCKOUT_DELTA_SCALE;
}

// Quality mặc định khi thiếu điểm set
const QUALITY_DEFAULT_WIN = 0.5;
const TOURNAMENT_DELTA_ABSOLUTE_GUARDRAIL = 0.1;
const MALE_LOW_RATING_LOSS_FLOOR = 2.1;

const RATING_FEATURE_WEIGHTS = Object.freeze({
  expectedOutcome: 1.0,
  phaseImportance: 0.2,
  scoreQuality: 0.16,
  pointMargin: 0.08,
  gameControl: 0.08,
  upset: 0.24,
  underdog: 0.1,
  reliabilityVolatility: 0.18,
  newPlayerSignal: 0.14,
  favoritePenalty: 0.18,
  ratingGapPenalty: 0.08,
  formMomentum: 0.1,
  partnerBalance: 0.06,
});

const TOURNAMENT_BUDGET_WEIGHTS = Object.freeze({
  formatImportance: 0.34,
  progressionDepth: 0.2,
  upsetSignal: 0.14,
  scoreSignal: 0.1,
  opponentStrength: 0.08,
  pathPressure: 0.07,
  formMomentum: 0.05,
  reliabilitySignal: 0.04,
  partnerBalance: 0.04,
  favoriteDrag: 0.08,
});

// === Favorite drag ===
const WIN_TAX_COEF = 0.18;

/* ===================== Helpers ===================== */
const round3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isMaleGender = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "male" || normalized === "nam";
};
const hasStoredRating = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
};
const seedRatingForGender = (gender) =>
  isMaleGender(gender) ? MALE_DEFAULT_SEED_RATING : DEFAULT_SEED_RATING;
const effectiveRatingForGender = (value, gender) => {
  const seed = seedRatingForGender(gender);
  const rating = hasStoredRating(value) ? Number(value) : seed;
  return isMaleGender(gender)
    ? Math.max(rating, MALE_DEFAULT_SEED_RATING)
    : rating;
};
const ratingFloorForGender = (gender) =>
  isMaleGender(gender) ? MALE_DEFAULT_SEED_RATING : DUPR_MIN;
const smoothstep01 = (x) => {
  const t = clamp(Number(x) || 0, 0, 1);
  return t * t * (3 - 2 * t);
};
const positiveNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function readMatchMaxRounds(match) {
  return (
    positiveNumber(match?.bracket?.meta?.maxRounds) ||
    positiveNumber(match?.bracket?.drawRounds) ||
    positiveNumber(match?.bracket?.config?.roundElim?.maxRounds) ||
    positiveNumber(match?.bracket?.config?.roundElim?.cutRounds)
  );
}

function readMatchDrawSize(match) {
  return (
    positiveNumber(match?.bracket?.meta?.drawSize) ||
    positiveNumber(match?.bracket?.drawSize) ||
    positiveNumber(match?.bracket?.config?.blueprint?.drawSize) ||
    positiveNumber(match?.bracket?.config?.doubleElim?.drawSize) ||
    positiveNumber(match?.bracket?.config?.roundElim?.drawSize)
  );
}

function matchContextSignals(match, bracketType) {
  const type = String(bracketType || match?.bracket?.type || "").toLowerCase();
  const round = Math.max(1, Number(match?.round) || 1);
  const configuredRounds = readMatchMaxRounds(match);
  const drawSize = readMatchDrawSize(match);
  const inferredRounds = drawSize > 1 ? Math.ceil(Math.log2(drawSize)) : 0;
  const maxRounds = Math.max(configuredRounds, inferredRounds, round);
  const progress = maxRounds > 0 ? clamp(round / maxRounds, 0, 1) : 0;
  const stage = positiveNumber(match?.bracket?.stage ?? match?.stageIndex);
  const stagePressure = stage ? clamp(stage / (stage + 2), 0, 1) : 0;
  const thirdPlaceSignal =
    match?.isThirdPlace || match?.meta?.thirdPlace ? 1 : 0;

  const knockoutSignal =
    type === "knockout" ? 1 : type === "double_elim" ? 0.8 : 0;
  const playoffSignal =
    type === "roundelim" || type === "playoff" || type === "prequalifying"
      ? 1
      : 0;
  const neutralSignal = clamp(1 - Math.max(knockoutSignal, playoffSignal), 0, 1);
  const smoothProgress = smoothstep01(progress);

  const survivalPressure = clamp(
    knockoutSignal * smoothProgress +
      playoffSignal * (1 - smoothProgress) * 0.72 +
      neutralSignal * (0.35 + smoothProgress * 0.3) +
      stagePressure * 0.12 -
      thirdPlaceSignal * 0.34,
    0,
    1
  );
  const formatImportance = clamp(
    knockoutSignal * (0.22 + smoothProgress * 0.78) +
      playoffSignal * (0.58 - smoothProgress * 0.36) +
      neutralSignal * (0.38 + smoothProgress * 0.28) +
      stagePressure * 0.1 -
      thirdPlaceSignal * 0.24,
    0,
    1
  );
  const progressionDepth = clamp(
    knockoutSignal * Math.pow(progress, 1.35) +
      playoffSignal * Math.pow(1 - progress * 0.62, 1.15) +
      neutralSignal * smoothProgress * 0.65,
    0,
    1
  );
  const pathPressure = clamp(
    survivalPressure * 0.52 +
      formatImportance * 0.3 +
      progressionDepth * 0.18,
    0,
    1
  );

  return {
    type,
    round,
    maxRounds,
    progress,
    smoothProgress,
    stagePressure,
    thirdPlaceSignal,
    knockoutSignal,
    playoffSignal,
    neutralSignal,
    survivalPressure,
    formatImportance,
    progressionDepth,
    pathPressure,
    consolationDrag: thirdPlaceSignal * (0.55 + progress * 0.25),
  };
}

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

function scoreShapeFromScores(match, winnerSide /* "A" | "B" */) {
  const arr = Array.isArray(match.gameScores) ? match.gameScores : [];
  if (!arr.length) {
    return {
      qualityScore: QUALITY_DEFAULT_WIN,
      qualityMultiplier: 1,
      pointMarginRatio: 0,
      gameMarginRatio: 0,
      gameCount: 0,
      scoreCompleteness: 0,
    };
  }
  let winPts = 0,
    losePts = 0,
    winGames = 0,
    loseGames = 0;
  for (const g of arr) {
    const a = Number(g.a || 0),
      b = Number(g.b || 0);
    let w = 0,
      l = 0;
    if (winnerSide === "A") {
      w = a;
      l = b;
    } else {
      w = b;
      l = a;
    }
    winPts += w;
    losePts += l;
    if (w > l) winGames += 1;
    else if (l > w) loseGames += 1;
  }
  const total = winPts + losePts;
  if (total <= 0) {
    return {
      qualityScore: QUALITY_DEFAULT_WIN,
      qualityMultiplier: 1,
      pointMarginRatio: 0,
      gameMarginRatio: 0,
      gameCount: 0,
      scoreCompleteness: 0,
    };
  }
  const pointMarginRatio = clamp((winPts - losePts) / total, 0, 1);
  const gameTotal = winGames + loseGames;
  const gameMarginRatio = gameTotal
    ? clamp((winGames - loseGames) / gameTotal, 0, 1)
    : 0;
  const qualityScore = clamp(0.5 + 0.5 * pointMarginRatio, 0.5, 1);
  const qualityMultiplier = clamp(
    0.92 + pointMarginRatio * 0.28 + gameMarginRatio * 0.08,
    0.9,
    1.28
  );
  return {
    qualityScore,
    qualityMultiplier,
    pointMarginRatio,
    gameMarginRatio,
    gameCount: gameTotal,
    scoreCompleteness: 1,
  };
}

function isForfeitResult(match) {
  return (
    match?.meta?.resultType === "forfeit" ||
    (Array.isArray(match?.liveLog) &&
      match.liveLog.some((entry) => entry?.type === "forfeit")) ||
    /^\[forfeit/.test(String(match?.note || "").trim().toLowerCase())
  );
}

function teamRatingDoubles(r1, r2) {
  const mean = (r1 + r2) / 2;
  const imbalance = Math.abs(r1 - r2);
  return mean - imbalance * SYNERGY_WEIGHT;
}

function phaseMultiplier(match, bracketType) {
  const ctx = matchContextSignals(match, bracketType);
  const phaseSignal =
    ctx.survivalPressure * 0.48 +
    ctx.formatImportance * 0.28 +
    ctx.pathPressure * 0.18 +
    ctx.stagePressure * 0.06 -
    ctx.consolationDrag * 0.28;
  return clamp(1 + Math.tanh(phaseSignal * 1.65) * 0.42, 0.72, 1.48);
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
  const underdogDegree = clamp((0.5 - E_win) / 0.5, 0, 1);
  const gapDegree = clamp(absDiff / (Math.abs(absDiff) + DIFF_SCALE), 0, 1);
  return (
    UPSET_MAX_BOOST *
    Math.pow(underdogDegree, 1.15) *
    Math.pow(gapDegree, 0.8)
  );
}

function midlineDampen(E) {
  const closeness = 1 - 4 * Math.pow(E - 0.5, 2);
  return 1 - MIDLINE_BETA * Math.max(0, closeness);
}

function weightedFeatureMultiplier(features) {
  const w = RATING_FEATURE_WEIGHTS;
  const positive =
    w.phaseImportance * features.phaseImportance +
    w.scoreQuality * features.scoreQuality +
    w.pointMargin * features.pointMargin +
    w.gameControl * features.gameControl +
    w.upset * features.upset +
    w.underdog * features.underdog +
    w.reliabilityVolatility * features.reliabilityVolatility +
    w.newPlayerSignal * features.newPlayerSignal +
    w.formMomentum * features.formMomentum +
    w.partnerBalance * features.partnerBalance;
  const negative =
    w.favoritePenalty * features.favoritePenalty +
    w.ratingGapPenalty * features.ratingGapPenalty;
  return clamp(1 + positive - negative, 0.55, 1.85);
}

function computeSmartTeamDelta({
  baseK,
  avgReliability,
  phaseMul,
  marginBoost,
  E_win,
  absDiff,
  scoreShape,
  formEdge = 0,
  winnerTeamSpread = 0,
  isForfeit = false,
}) {
  const reliabilityScale = clamp(
    1 - RELIABILITY_DECAY * avgReliability,
    1 - RELIABILITY_DECAY,
    1
  );
  const newPlayerBoost = 1 + NEW_PLAYER_WEIGHT_BONUS * (1 - avgReliability);
  const kScale =
    (isForfeit ? FORFEIT_K_SCALE : 1) *
    phaseMul *
    (1 + marginBoost) *
    newPlayerBoost;
  const K_match = (baseK * reliabilityScale + FLOOR_K) * kScale;
  const expectedGain = Math.pow(clamp(1 - E_win, 0, 1), EXP_GAMMA);
  const upsetBoost = upsetAmplification(absDiff, E_win);
  const favoritePressure = Math.pow(clamp((E_win - 0.5) / 0.5, 0, 1), 1.7);
  const favoriteTax = clamp(1 - WIN_TAX_COEF * favoritePressure, 0.7, 1);
  const midFactor = MIDLINE_DAMPEN ? midlineDampen(E_win) : 1;
  const features = {
    expectedOutcome: expectedGain,
    phaseImportance: clamp(phaseMul - 1, -0.35, 0.6),
    scoreQuality: clamp((scoreShape.qualityMultiplier || 1) - 1, -0.2, 0.35),
    pointMargin: clamp(scoreShape.pointMarginRatio || 0, 0, 1),
    gameControl: clamp(scoreShape.gameMarginRatio || 0, 0, 1),
    upset: clamp(upsetBoost / Math.max(UPSET_MAX_BOOST, 0.001), 0, 1),
    underdog: clamp((0.5 - E_win) / 0.5, 0, 1),
    reliabilityVolatility: clamp(1 - avgReliability, 0, 1),
    newPlayerSignal: clamp(
      (newPlayerBoost - 1) / Math.max(NEW_PLAYER_WEIGHT_BONUS, 0.001),
      0,
      1
    ),
    favoritePenalty: favoritePressure,
    ratingGapPenalty: clamp((E_win - 0.5) / 0.5, 0, 1),
    formMomentum: clamp(formEdge / 0.3, -1, 1),
    partnerBalance: clamp(1 - winnerTeamSpread / 1.5, 0, 1),
  };
  const weightedMultiplier = weightedFeatureMultiplier(features);

  let raw =
    K_match *
    expectedGain *
    weightedMultiplier *
    favoriteTax *
    midFactor;

  return {
    raw,
    soft: softCapTeam(raw),
    K_match,
    kScale,
    expectedGain,
    upsetBoost,
    favoriteTax,
    reliabilityScale,
    newPlayerBoost,
    weightedMultiplier,
    features,
    weights: RATING_FEATURE_WEIGHTS,
    midFactor,
    epsDyn: 0,
  };
}

function toObjectIdOrNull(value) {
  const raw = value?._id || value;
  if (!raw) return null;
  try {
    return new mongoose.Types.ObjectId(String(raw));
  } catch {
    return null;
  }
}

async function getUserGenderMap(userIds = []) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))]
    .map((id) => toObjectIdOrNull(id))
    .filter(Boolean);
  if (!ids.length) return new Map();

  const rows = await User.find({ _id: { $in: ids } })
    .select("_id gender")
    .lean();

  return new Map(rows.map((row) => [String(row._id), row.gender || ""]));
}

function shouldProtectMaleLowRatingLoss({ currentRating, delta, gender, isWinner }) {
  return (
    !isWinner &&
    Number(delta) < 0 &&
    Number(currentRating) <= MALE_LOW_RATING_LOSS_FLOOR &&
    isMaleGender(gender)
  );
}

async function getTournamentDeltaMap({
  userIds,
  tournamentId,
  kind,
  excludeMatchId = null,
}) {
  const users = [...new Set((userIds || []).filter(Boolean).map(String))]
    .map((id) => toObjectIdOrNull(id))
    .filter(Boolean);
  const tournamentObjectId = toObjectIdOrNull(tournamentId);
  if (!users.length || !tournamentObjectId || !kind) return new Map();

  const match = {
    user: { $in: users },
    tournament: tournamentObjectId,
    kind,
  };
  const excludeObjectId = toObjectIdOrNull(excludeMatchId);
  if (excludeObjectId) match.match = { $ne: excludeObjectId };

  const rows = await RatingChange.aggregate([
    { $match: match },
    { $group: { _id: "$user", delta: { $sum: "$delta" } } },
  ]);

  return new Map(rows.map((row) => [String(row._id), Number(row.delta) || 0]));
}

function capTeamDeltaByTournament({
  deltaTeam,
  winnerUserIds,
  loserUserIds,
  tournamentDeltaMap,
  tournamentCap = TOURNAMENT_DELTA_ABSOLUTE_GUARDRAIL,
}) {
  const cap = clamp(tournamentCap, 0, TOURNAMENT_DELTA_ABSOLUTE_GUARDRAIL);
  const winnerIds = (winnerUserIds || []).map(String);
  const loserIds = (loserUserIds || []).map(String);
  if (deltaTeam <= 0 || !winnerIds.length || !loserIds.length) {
    return {
      deltaTeam: 0,
      applied: deltaTeam > 0,
      winnerRemaining: 0,
      loserRemaining: 0,
      cap,
    };
  }

  const remainingGain = (uid) =>
    Math.max(0, cap - (tournamentDeltaMap.get(uid) || 0));
  const remainingLoss = (uid) =>
    Math.max(0, cap + (tournamentDeltaMap.get(uid) || 0));

  const winnerRemaining = Math.min(...winnerIds.map(remainingGain));
  const loserRemaining = Math.min(...loserIds.map(remainingLoss));
  const maxTeamByWinners = winnerRemaining * winnerIds.length;
  const maxTeamByLosers = loserRemaining * loserIds.length;
  const maxTeam = Math.max(0, Math.min(maxTeamByWinners, maxTeamByLosers));
  const cappedDeltaTeam = Math.min(deltaTeam, maxTeam);

  return {
    deltaTeam: cappedDeltaTeam,
    applied: cappedDeltaTeam < deltaTeam,
    winnerRemaining,
    loserRemaining,
    cap,
  };
}

function tournamentDeltaCapForMatch({
  match,
  bracketType,
  phaseMul,
  E_win,
  ratingCalc,
  scoreShape,
}) {
  const context = matchContextSignals(match, bracketType);
  const features = ratingCalc?.features || {};
  const budgetWeights = TOURNAMENT_BUDGET_WEIGHTS;
  const getFeature = (name, fallback = 0) => {
    const value = Number(features[name]);
    return Number.isFinite(value) ? value : fallback;
  };

  const upsetSignal = clamp(getFeature("upset"), 0, 1);
  const scoreQuality = clamp(
    (getFeature(
      "scoreQuality",
      (Number(scoreShape?.qualityMultiplier) || 1) - 1
    ) +
      0.2) /
      0.55,
    0,
    1
  );
  const pointMargin = clamp(
    getFeature("pointMargin", Number(scoreShape?.pointMarginRatio) || 0),
    0,
    1
  );
  const gameControl = clamp(
    getFeature("gameControl", Number(scoreShape?.gameMarginRatio) || 0),
    0,
    1
  );
  const scoreCompleteness = clamp(Number(scoreShape?.scoreCompleteness) || 0, 0, 1);
  const scoreSignal = clamp(
    (scoreQuality * 0.36 + pointMargin * 0.34 + gameControl * 0.3) *
      (0.45 + scoreCompleteness * 0.55),
    0,
    1
  );
  const opponentStrength = clamp((0.5 - E_win) / 0.5, 0, 1);
  const phaseSignal = clamp((phaseMul - 0.72) / 0.76, 0, 1);
  const formMomentum = clamp(getFeature("formMomentum") * 0.5 + 0.5, 0, 1);
  const reliabilitySignal = clamp(getFeature("reliabilityVolatility"), 0, 1);
  const partnerBalance = clamp(getFeature("partnerBalance", 0.5), 0, 1);
  const favoriteDrag = clamp(
    getFeature("favoritePenalty") * 0.62 +
      getFeature("ratingGapPenalty") * 0.38,
    0,
    1
  );

  const budgetScore =
    budgetWeights.formatImportance * context.formatImportance +
    budgetWeights.progressionDepth * context.progressionDepth +
    budgetWeights.upsetSignal * upsetSignal +
    budgetWeights.scoreSignal * scoreSignal +
    budgetWeights.opponentStrength * opponentStrength +
    budgetWeights.pathPressure * context.pathPressure +
    budgetWeights.formMomentum * formMomentum +
    budgetWeights.reliabilitySignal * reliabilitySignal +
    budgetWeights.partnerBalance * partnerBalance -
    budgetWeights.favoriteDrag * favoriteDrag -
    context.consolationDrag * 0.14 -
    context.playoffSignal * context.smoothProgress * 0.08;

  const normalizedBudget = clamp(budgetScore, 0, 1);
  const raritySignal = clamp(
    upsetSignal * 0.42 +
      opponentStrength * 0.2 +
      scoreSignal * 0.16 +
      context.pathPressure * 0.14 +
      phaseSignal * 0.08,
    0,
    1
  );
  const confidenceSignal = clamp(
    scoreCompleteness * 0.36 +
      scoreSignal * 0.28 +
      reliabilitySignal * 0.2 +
      partnerBalance * 0.16,
    0,
    1
  );
  const curvedBudget = Math.pow(
    normalizedBudget,
    1.08 + (1 - confidenceSignal) * 0.28
  );
  const adaptiveCeiling =
    TOURNAMENT_DELTA_ABSOLUTE_GUARDRAIL *
    curvedBudget *
    (0.72 + raritySignal * 0.22 + confidenceSignal * 0.06);

  return clamp(adaptiveCeiling, 0, TOURNAMENT_DELTA_ABSOLUTE_GUARDRAIL);
}

/* ===== ⭐ PHÂN PHỐI ĐIỂM ĐỀU CHO ĐỒNG ĐỘI ===== */
/**
 * Chia đều deltaTeam cho tất cả VĐV trong đội
 * Không phân biệt reliability hay rating
 */
function distributeTeamDeltaEvenly(deltaTeam, playerCount) {
  if (!playerCount || playerCount <= 0) return [];
  const perPlayer = deltaTeam / playerCount;
  return Array(playerCount).fill(perPlayer);
}

/* ===================== Ratings & reliability ===================== */
/**
 * ⭐ FIX: Query single và double RIÊNG BIỆT
 *
 * Vấn đề cũ: Dùng $first chung cho cả single và double từ doc mới nhất
 * -> Nếu doc mới nhất chỉ có double (từ trận đôi), single sẽ = undefined -> bị set = 0
 *
 * Fix: Query riêng từng field, lấy doc mới nhất CÓ field đó (không null)
 *
 * Ví dụ với data:
 * - Doc 20/12/2025: { double: 3.884 } (không có single)
 * - Doc 24/09/2025: { single: 3.5, double: 3.9 }
 *
 * Kết quả:
 * - single = 3.5 (từ doc 24/09)
 * - double = 3.884 (từ doc 20/12)
 */
async function getLatestRatingsMap(userIds) {
  const ids = [...new Set(userIds.map(String))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );

  // Lấy điểm SINGLE mới nhất (chỉ từ docs có field single tồn tại và không null)
  const lastSingle = await ScoreHistory.aggregate([
    { $match: { user: { $in: ids }, single: { $exists: true, $ne: null } } },
    { $sort: { scoredAt: -1, _id: -1 } },
    { $group: { _id: "$user", single: { $first: "$single" } } },
  ]);

  // Lấy điểm DOUBLE mới nhất (chỉ từ docs có field double tồn tại và không null)
  const lastDouble = await ScoreHistory.aggregate([
    { $match: { user: { $in: ids }, double: { $exists: true, $ne: null } } },
    { $sort: { scoredAt: -1, _id: -1 } },
    { $group: { _id: "$user", double: { $first: "$double" } } },
  ]);

  // Tạo map từ kết quả
  const singleMap = new Map(lastSingle.map((r) => [String(r._id), r.single]));
  const doubleMap = new Map(lastDouble.map((r) => [String(r._id), r.double]));

  // Merge vào map chính
  const map = new Map();
  for (const uid of ids.map(String)) {
    const s = singleMap.get(uid);
    const d = doubleMap.get(uid);
    map.set(uid, {
      single: Number.isFinite(s) ? s : 0,
      double: Number.isFinite(d) ? d : 0,
    });
  }

  // Fallback từ Ranking nếu ScoreHistory không có
  const ranks = await Ranking.find({ user: { $in: ids } }).select(
    "user single double"
  );
  ranks.forEach((r) => {
    const k = String(r.user);
    const existing = map.get(k) || { single: 0, double: 0 };
    // Chỉ lấy từ Ranking nếu ScoreHistory không có giá trị
    map.set(k, {
      single: existing.single || (Number.isFinite(r.single) ? r.single : 0),
      double: existing.double || (Number.isFinite(r.double) ? r.double : 0),
    });
  });

  // Đảm bảo tất cả userIds đều có entry
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
    if (Number(r.score) >= 0.5) {
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
      const diff = invExpectedToDiff(r.expected);
      sosSum += -diff;
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
    .populate({ path: "tournament", select: "eventType noRankDelta" })
    .populate({ path: "bracket", select: "type stage name meta noRankDelta" })
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" });

  if (!mt) return;
  if (mt.status !== "finished" || !mt.winner || !["A", "B"].includes(mt.winner))
    return;

  // BYE/missing pair
  if (!mt.pairA || !mt.pairB) {
    mt.ratingApplied = true;
    mt.ratingAppliedAt = new Date();
    mt.ratingDelta = 0;
    await mt.save();
    return;
  }
  if (mt.ratingApplied) return;

  const isForfeit = isForfeitResult(mt);
  if (isForfeit) {
    mt.ratingApplied = true;
    mt.ratingAppliedAt = new Date();
    mt.ratingDelta = 0;
    await mt.save();
    return;
  }

  // ⭐ RATING GUARD
  const guardNoDelta =
    mt.noRankDelta === true ||
    mt?.bracket?.noRankDelta === true ||
    mt?.tournament?.noRankDelta === true;

  if (guardNoDelta) {
    mt.ratingApplied = true;
    mt.ratingAppliedAt = new Date();
    mt.ratingDelta = 0;
    await mt.save();
    return;
  }

  const kind = mt.tournament?.eventType === "single" ? "singles" : "doubles";
  const key = mt.tournament?.eventType === "single" ? "single" : "double";
  const when = mt.finishedAt || new Date();
  const winnerSide = mt.winner;
  const bracketType = mt.bracket?.type || "knockout";

  // user ids
  const usersA = [mt.pairA?.player1?.user, mt.pairA?.player2?.user]
    .filter(Boolean)
    .map(String);
  const usersB = [mt.pairB?.player1?.user, mt.pairB?.player2?.user]
    .filter(Boolean)
    .map(String);
  const allIds = [...new Set([...usersA, ...usersB])];
  const genderMap = await getUserGenderMap(allIds);

  // ratings & reliability
  const latest = await getLatestRatingsMap(allIds);
  const reliabilityMap = await getReliabilityMap(allIds, key);
  const getRating = (uid) => {
    const r = latest.get(uid) || { single: 0, double: 0 };
    const val = Number(r[key] || 0) || 0;
    return effectiveRatingForGender(val, genderMap.get(String(uid)));
  };

  // prefetch reputation map
  const repDocs = await Ranking.find({ user: { $in: allIds } })
    .select("user reputation")
    .lean();
  const repMap = new Map(
    repDocs.map((d) => [String(d.user), Number(d.reputation) || 0])
  );

  // team ratings
  let teamA = 0,
    teamB = 0,
    teamSpreadA = 0,
    teamSpreadB = 0;
  if (kind === "singles") {
    const ua = usersA[0],
      ub = usersB[0];
    teamA = ua ? getRating(ua) : DEFAULT_SEED_RATING;
    teamB = ub ? getRating(ub) : DEFAULT_SEED_RATING;
  } else {
    const a1 = usersA[0] ? getRating(usersA[0]) : DEFAULT_SEED_RATING;
    const a2 = usersA[1] ? getRating(usersA[1]) : a1;
    const b1 = usersB[0] ? getRating(usersB[0]) : DEFAULT_SEED_RATING;
    const b2 = usersB[1] ? getRating(usersB[1]) : b1;
    teamSpreadA = Math.abs(a1 - a2);
    teamSpreadB = Math.abs(b1 - b2);
    teamA = teamRatingDoubles(a1, a2);
    teamB = teamRatingDoubles(b1, b2);
  }

  // form
  let formA = 0.5,
    formB = 0.5;
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

    formA = kind === "singles" ? fA1 : teamFormScore(kind, fA1, fA2);
    formB = kind === "singles" ? fB1 : teamFormScore(kind, fB1, fB2);
  }

  // expected with context
  const contextDU = CTX_RATING_DU * clamp(formA - formB, -1, 1);
  const diffRaw = teamA - teamB + contextDU;
  const expA = expectedFromDiff(diffRaw);
  const expB = 1 - expA;

  // K scale
  const marginBoost = isForfeit ? 0 : marginBoostFromScores(mt, winnerSide);
  const phaseMul = phaseMultiplier(mt, bracketType);
  const relValues = allIds.map((uid) => reliabilityMap.get(uid) ?? 0);
  const avgReliability = relValues.length
    ? relValues.reduce((s, x) => s + x, 0) / relValues.length
    : 0;

  const baseK = kind === "singles" ? BASE_K_SINGLES : BASE_K_DOUBLES;

  // quality vs expected
  const E_win = winnerSide === "A" ? expA : expB;
  const absDiff = Math.abs(teamA - teamB);
  const scoreShape = isForfeit
    ? {
        qualityScore: 0.5,
        qualityMultiplier: 0,
        pointMarginRatio: 0,
        gameMarginRatio: 0,
        gameCount: 0,
        scoreCompleteness: 0,
      }
    : scoreShapeFromScores(mt, winnerSide);
  const ratingCalc = computeSmartTeamDelta({
    baseK,
    avgReliability,
    phaseMul,
    marginBoost,
    E_win,
    absDiff,
    scoreShape,
    formEdge: winnerSide === "A" ? formA - formB : formB - formA,
    winnerTeamSpread: winnerSide === "A" ? teamSpreadA : teamSpreadB,
    isForfeit,
  });
  const K_match = ratingCalc.K_match;
  const S_win = scoreShape.qualityScore;
  const tournamentCap = tournamentDeltaCapForMatch({
    match: mt,
    bracketType,
    phaseMul,
    E_win,
    ratingCalc,
    scoreShape,
  });

  const D_team_raw = ratingCalc.raw;
  let D_team = ratingCalc.soft;

  // ⭐ Giảm độ lớn cho các vòng KHÔNG phải knockout (giữ zero-sum: nhân đều nên
  // cả điểm cộng của người thắng lẫn điểm trừ của người thua đều nhẹ đi cùng tỉ lệ).
  D_team = D_team * formatDeltaScale(bracketType);

  // ===== ⭐ PHÂN PHỐI ĐỀU CHO ĐỒNG ĐỘI =====
  const winnerUserIds = winnerSide === "A" ? usersA : usersB;
  const loserUserIds = winnerSide === "A" ? usersB : usersA;
  const tournamentDeltaMap = await getTournamentDeltaMap({
    userIds: allIds,
    tournamentId: mt.tournament?._id || mt.tournament,
    kind,
    excludeMatchId: mt._id,
  });
  const tournamentCapInfo = capTeamDeltaByTournament({
    deltaTeam: D_team,
    winnerUserIds,
    loserUserIds,
    tournamentDeltaMap,
    tournamentCap,
  });
  D_team = tournamentCapInfo.deltaTeam;

  let winnerDeltas = distributeTeamDeltaEvenly(D_team, winnerUserIds.length);
  let loserDeltas = distributeTeamDeltaEvenly(-D_team, loserUserIds.length);

  // ⭐ Kẹp biên âm cho đội THẮNG: mỗi người không âm quá MAX_WIN_NEG
  const totalWinBefore = winnerDeltas.reduce((s, x) => s + x, 0);
  const winnerClamped = winnerDeltas.map((d) => Math.max(d, MAX_WIN_NEG));
  const totalWinAfter = winnerClamped.reduce((s, x) => s + x, 0);

  // Nếu bị kẹp, cần redistribute phần thừa
  if (Math.abs(totalWinAfter - totalWinBefore) > 1e-9) {
    const deficit = totalWinBefore - totalWinAfter;
    // Phân phối đều deficit cho bên thua
    const perLoser = deficit / (loserUserIds.length || 1);
    loserDeltas = loserDeltas.map((d) => d - perLoser);
  }

  winnerDeltas = winnerClamped;

  // Ensure zero-sum strict
  const sumWin = winnerDeltas.reduce((s, x) => s + x, 0);
  const sumLose = loserDeltas.reduce((s, x) => s + x, 0);
  const drift = sumWin + sumLose;
  if (Math.abs(drift) > 1e-9) {
    const n = loserDeltas.length || 1;
    loserDeltas = loserDeltas.map((d) => d - drift / n);
  }

  // === APPLY ===
  const histDocs = [];
  const rankingOps = [];
  const logs = [];
  const perUserDeltasAbs = [];

  const applySide = (userIds, deltas, isWinner) => {
    userIds.forEach((uid, idx) => {
      const current = latest.get(uid) || { single: 0, double: 0 };
      const gender = genderMap.get(String(uid));
      const curVal = effectiveRatingForGender(current[key], gender);
      const rawDelta = deltas[idx] ?? 0;
      const protectedLoss = shouldProtectMaleLowRatingLoss({
        currentRating: curVal,
        delta: rawDelta,
        gender,
        isWinner,
      });
      const delta = protectedLoss ? 0 : rawDelta;
      const next = protectedLoss
        ? curVal
        : clamp(curVal + delta, ratingFloorForGender(gender), DUPR_MAX);
      perUserDeltasAbs.push(Math.abs(delta));

      const noteScore = isWinner ? S_win : 1 - S_win;
      const noteExp = isWinner ? E_win : 1 - E_win;

      histDocs.push({
        user: uid,
        [key]: round3(next),
        scoredAt: when,
        sourceMatch: mt._id,
        note: `${delta >= 0 ? "+" : ""}${round3(delta)} (result=${
          isWinner ? 1 : 0
        },Q=${round3(noteScore)},E=${round3(noteExp)},K=${round3(
          K_match
        )},qMul=${round3(scoreShape.qualityMultiplier)},up=${round3(
          ratingCalc.upsetBoost
        )},fav=${round3(ratingCalc.favoriteTax)},new=${round3(
          ratingCalc.newPlayerBoost
        )},wMul=${round3(ratingCalc.weightedMultiplier)},form=${round3(
          ratingCalc.features.formMomentum
        )},bal=${round3(ratingCalc.features.partnerBalance)},rel=${round3(
          ratingCalc.reliabilityScale
        )},tCap=${
          tournamentCapInfo.applied ? 1 : 0
        },cap=${round3(tournamentCapInfo.cap)},ctxDU=${round3(contextDU)}${
          protectedLoss ? ",protected=male_under_2_1_loss" : ""
        })`,
      });

      const prevRep = repMap.get(String(uid)) ?? 0;

      // ⭐ FIX: Chỉ update field đang thay đổi (single hoặc double)
      // KHÔNG đụng đến field còn lại để tránh ghi đè bằng 0
      rankingOps.push({
        updateOne: {
          filter: { user: uid },
          update: {
            $set: {
              [key]: round3(next),
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
        expected: noteExp,
        score: isWinner ? 1 : 0,
        reliabilityBefore: relBefore,
        reliabilityAfter: relAfter,
        marginBonus: marginBoost,
        contextDU: round3(contextDU),
        bracketType,
        round: mt.round || 1,
        createdAt: new Date(),
      });
    });
  };

  applySide(winnerUserIds, winnerDeltas, true);
  applySide(loserUserIds, loserDeltas, false);

  if (histDocs.length) await ScoreHistory.insertMany(histDocs);
  if (rankingOps.length) await Ranking.bulkWrite(rankingOps);
  if (logs.length) {
    await RatingChange.insertMany(logs, { ordered: false }).catch(() => {});
  }

  const avgAbsDelta = perUserDeltasAbs.length
    ? perUserDeltasAbs.reduce((s, x) => s + x, 0) / perUserDeltasAbs.length
    : 0;
  mt.ratingDelta = round3(avgAbsDelta);
  mt.ratingApplied = true;
  mt.ratingAppliedAt = new Date();
  await mt.save();
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
  const genderMap = await getUserGenderMap(allIds);

  const latest = await getLatestRatingsMap(allIds);
  const reliabilityMap = await getReliabilityMap(allIds, key);
  const getRating = (uid) => {
    const r = latest.get(uid) || { single: 0, double: 0 };
    const val = Number(r[key] || 0) || 0;
    return effectiveRatingForGender(val, genderMap.get(String(uid)));
  };

  let teamA,
    teamB,
    teamSpreadA = 0,
    teamSpreadB = 0;
  if (kind === "singles") {
    teamA = usersA[0] ? getRating(usersA[0]) : DEFAULT_SEED_RATING;
    teamB = usersB[0] ? getRating(usersB[0]) : DEFAULT_SEED_RATING;
  } else {
    const a1 = usersA[0] ? getRating(usersA[0]) : DEFAULT_SEED_RATING;
    const a2 = usersA[1] ? getRating(usersA[1]) : a1;
    const b1 = usersB[0] ? getRating(usersB[0]) : DEFAULT_SEED_RATING;
    const b2 = usersB[1] ? getRating(usersB[1]) : b1;
    teamSpreadA = Math.abs(a1 - a2);
    teamSpreadB = Math.abs(b1 - b2);
    teamA = teamRatingDoubles(a1, a2);
    teamB = teamRatingDoubles(b1, b2);
  }

  // form/context
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

  const diffRaw = teamA - teamB + ctxDU;
  const expA = expectedFromDiff(diffRaw);
  const expB = 1 - expA;

  const isForfeit = forfeit;
  const marginBoost = isForfeit
    ? 0
    : marginBoostFromScores(fakeMatch, winnerSide);
  const phaseMul = phaseMultiplier(fakeMatch, bracketType);
  const relValues = allIds.map((uid) => reliabilityMap.get(uid) ?? 0);
  const avgReliability = relValues.length
    ? relValues.reduce((s, x) => s + x, 0) / relValues.length
    : 0;
  const baseK = kind === "singles" ? BASE_K_SINGLES : BASE_K_DOUBLES;

  const E_win = winnerSide === "A" ? expA : expB;
  const absDiff = Math.abs(teamA - teamB);
  const scoreShape = isForfeit
    ? {
        qualityScore: 0.5,
        qualityMultiplier: 0,
        pointMarginRatio: 0,
        gameMarginRatio: 0,
        gameCount: 0,
        scoreCompleteness: 0,
      }
    : scoreShapeFromScores(fakeMatch, winnerSide);
  const ratingCalc = computeSmartTeamDelta({
    baseK,
    avgReliability,
    phaseMul,
    marginBoost,
    E_win,
    absDiff,
    scoreShape,
    formEdge: winnerSide === "A" ? formA - formB : formB - formA,
    winnerTeamSpread: winnerSide === "A" ? teamSpreadA : teamSpreadB,
    isForfeit,
  });
  const kScale = ratingCalc.kScale;
  const K_match = ratingCalc.K_match;
  const upBoost = ratingCalc.upsetBoost;
  const S_win = scoreShape.qualityScore;
  const epsDyn = ratingCalc.epsDyn;
  const tournamentCap = tournamentDeltaCapForMatch({
    match: fakeMatch,
    bracketType,
    phaseMul,
    E_win,
    ratingCalc,
    scoreShape,
  });
  const matchContext = matchContextSignals(fakeMatch, bracketType);

  const D_team_raw = ratingCalc.raw;
  let D_team = ratingCalc.soft;

  // ⭐ Giảm độ lớn cho các vòng KHÔNG phải knockout (khớp với applyRatingForFinishedMatch để preview đúng)
  D_team = D_team * formatDeltaScale(bracketType);

  const winnerUserIds = winnerSide === "A" ? usersA : usersB;
  const loserUserIds = winnerSide === "A" ? usersB : usersA;
  const tournamentDeltaMap = await getTournamentDeltaMap({
    userIds: allIds,
    tournamentId,
    kind,
  });
  const tournamentCapInfo = capTeamDeltaByTournament({
    deltaTeam: D_team,
    winnerUserIds,
    loserUserIds,
    tournamentDeltaMap,
    tournamentCap,
  });
  D_team = tournamentCapInfo.deltaTeam;

  let winnerDeltas = distributeTeamDeltaEvenly(D_team, winnerUserIds.length);
  let loserDeltas = distributeTeamDeltaEvenly(-D_team, loserUserIds.length);

  // Clamp win negative
  const totalWinBefore = winnerDeltas.reduce((s, x) => s + x, 0);
  const winnerClamped = winnerDeltas.map((d) => Math.max(d, MAX_WIN_NEG));
  const totalWinAfter = winnerClamped.reduce((s, x) => s + x, 0);
  if (Math.abs(totalWinAfter - totalWinBefore) > 1e-9) {
    const deficit = totalWinBefore - totalWinAfter;
    const perLoser = deficit / (loserUserIds.length || 1);
    loserDeltas = loserDeltas.map((d) => d - perLoser);
  }
  winnerDeltas = winnerClamped;

  // Zero-sum
  const sumWin = winnerDeltas.reduce((s, x) => s + x, 0);
  const sumLose = loserDeltas.reduce((s, x) => s + x, 0);
  const drift = sumWin + sumLose;
  if (Math.abs(drift) > 1e-9) {
    const n = loserDeltas.length || 1;
    loserDeltas = loserDeltas.map((d) => d - drift / n);
  }

  const perUser = [];
  const push = (uid, side, delta, isWinner) => {
    const cur = latest.get(uid) || { single: 0, double: 0 };
    const gender = genderMap.get(String(uid));
    const curVal = effectiveRatingForGender(cur[key], gender);
    const protectedLoss = shouldProtectMaleLowRatingLoss({
      currentRating: curVal,
      delta,
      gender,
      isWinner,
    });
    const effectiveDelta = protectedLoss ? 0 : delta;
    const next = protectedLoss
      ? curVal
      : clamp(curVal + effectiveDelta, ratingFloorForGender(gender), DUPR_MAX);
    perUser.push({
      uid,
      side,
      before: round3(curVal),
      delta: round3(effectiveDelta),
      after: round3(next),
      protectedLoss,
    });
  };
  winnerUserIds.forEach((uid, i) =>
    push(uid, winnerSide, winnerDeltas[i] ?? 0, true)
  );
  loserUserIds.forEach((uid, i) =>
    push(uid, winnerSide === "A" ? "B" : "A", loserDeltas[i] ?? 0, false)
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
      diffRaw: round3(diffRaw),
    },
    expected: { expA: round3(expA), expB: round3(expB), E_win: round3(E_win) },
    context: {
      formA: round3(formA),
      formB: round3(formB),
      contextDU: round3(ctxDU),
      formDetails,
    },
    multipliers: {
      baseK: round3(baseK),
      avgReliability: round3(avgReliability),
      marginBoost: round3(marginBoost),
      phaseMul: round3(phaseMul),
      upsetBoost: round3(upBoost),
      qualityScore: round3(S_win),
      qualityMultiplier: round3(scoreShape.qualityMultiplier),
      pointMarginRatio: round3(scoreShape.pointMarginRatio),
      gameMarginRatio: round3(scoreShape.gameMarginRatio),
      scoreCompleteness: round3(scoreShape.scoreCompleteness),
      expectedGain: round3(ratingCalc.expectedGain),
      favoriteTax: round3(ratingCalc.favoriteTax),
      reliabilityScale: round3(ratingCalc.reliabilityScale),
      newPlayerBoost: round3(ratingCalc.newPlayerBoost),
      weightedMultiplier: round3(ratingCalc.weightedMultiplier),
      tournamentHardGuardrail: TOURNAMENT_DELTA_ABSOLUTE_GUARDRAIL,
      tournamentCap: round3(tournamentCap),
      tournamentCapApplied: tournamentCapInfo.applied,
      winnerRemainingBeforeCap: round3(tournamentCapInfo.winnerRemaining),
      loserRemainingBeforeCap: round3(tournamentCapInfo.loserRemaining),
      kScale: round3(kScale),
      K_match: round3(K_match),
      matchContext: Object.fromEntries(
        Object.entries(matchContext).map(([name, value]) => [
          name,
          typeof value === "number" ? round3(value) : value,
        ])
      ),
      features: Object.fromEntries(
        Object.entries(ratingCalc.features).map(([name, value]) => [
          name,
          round3(value),
        ])
      ),
      weights: RATING_FEATURE_WEIGHTS,
      shaper: {
        gamma: EXP_GAMMA,
        midFactor: round3(MIDLINE_DAMPEN ? midlineDampen(E_win) : 1),
        epsDyn: round3(epsDyn),
      },
    },
    delta: {
      raw: round3(D_team_raw),
      soft: round3(D_team),
      cap: SOFT_TEAM_CAP,
      softness: SOFT_TEAM_SOFTNESS,
    },
    perUser,
    floorProtection: {
      maleLossNoDecreaseBelow: MALE_LOW_RATING_LOSS_FLOOR,
      maleDefaultSeedRating: MALE_DEFAULT_SEED_RATING,
      appliedCount: perUser.filter((item) => item.protectedLoss).length,
    },
    zeroSumCheck: round3(perUser.reduce((s, u) => s + u.delta, 0)),
  };
}
