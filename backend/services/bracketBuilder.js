// services/bracketBuilder.js
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";

/* ====================== Helpers ====================== */
const ceilPow2 = (n) => (n <= 1 ? 1 : 1 << Math.ceil(Math.log2(n)));

function roundTitleByPairs(pairs) {
  if (pairs === 1) return "F";
  if (pairs === 2) return "SF";
  if (pairs === 4) return "QF";
  return `R${pairs * 2}`;
}

// Tạo seed BYE hợp lệ cho validation
const SEED_BYE = { type: "bye", ref: null, label: "BYE" };

// ✅ NEW: rule defaults + sanitizer (không đổi schema)
const DEFAULT_RULES = { bestOf: 3, pointsToWin: 11, winByTwo: true };
function sanitizeRules(r) {
  if (!r || typeof r !== "object") return DEFAULT_RULES;
  const bo = [1, 3, 5].includes(Number(r.bestOf))
    ? Number(r.bestOf)
    : DEFAULT_RULES.bestOf;
  const pt = [11, 15, 21].includes(Number(r.pointsToWin))
    ? Number(r.pointsToWin)
    : DEFAULT_RULES.pointsToWin;
  const w2 = !!r.winByTwo;
  return { bestOf: bo, pointsToWin: pt, winByTwo: w2 };
}

/* ====================== KO Builder (2^n) ====================== */
export async function buildKnockoutBracket({
  tournamentId,
  name = "Knockout",
  order = 1,
  stage = 1,
  drawSize,
  firstRoundSeeds = [],
  // ✅ NEW:
  rules = undefined, // rule mặc định cho KO
  finalRules = null, // rule áp riêng trận chung kết KO
  session = null,
}) {
  const size = Math.max(2, ceilPow2(drawSize || 2));
  const rounds = Math.round(Math.log2(size));
  const firstPairs = size / 2;

  const baseRules = sanitizeRules(rules);
  const finalOnly = finalRules ? sanitizeRules(finalRules) : null;

  // Chuẩn hoá seeds cho R1: thiếu -> BYE
  const r1Seeds = Array.from({ length: firstPairs }, (_, i) => {
    const found = firstRoundSeeds.find((s) => Number(s.pair) === i + 1);
    const A = found?.A && found.A.type ? found.A : SEED_BYE;
    const B = found?.B && found.B.type ? found.B : SEED_BYE;
    return { pair: i + 1, A, B };
  });

  const bracket = await Bracket.create(
    [
      {
        tournament: tournamentId,
        name,
        type: "knockout",
        order,
        stage,
        meta: {
          drawSize: size,
          maxRounds: rounds,
          expectedFirstRoundMatches: firstPairs,
        },
        prefill: { roundKey: roundTitleByPairs(firstPairs), seeds: r1Seeds },
        // (không đổi schema/logic; không cần lưu rules vào config nếu không muốn)
      },
    ],
    { session }
  ).then((arr) => arr[0]);

  const created = {};
  // R1
  created[1] = await Match.insertMany(
    r1Seeds.map((s, idx) => {
      const isFinal = rounds === 1 && idx === 0; // trường hợp size=2
      return {
        tournament: tournamentId,
        bracket: bracket._id,
        format: "knockout",
        round: 1,
        order: idx,
        seedA: s.A || null,
        seedB: s.B || null,
        rules: isFinal && finalOnly ? finalOnly : baseRules, // ✅ NEW
      };
    }),
    { session }
  );

  // R2..R
  for (let r = 2; r <= rounds; r++) {
    const prev = created[r - 1];
    const pairs = Math.ceil(prev.length / 2);
    const ms = [];
    for (let i = 0; i < pairs; i++) {
      const aPrev = prev[i * 2];
      const bPrev = prev[i * 2 + 1];
      const isFinal = r === rounds && i === 0; // ✅ NEW: chỉ trận duy nhất vòng cuối
      ms.push({
        tournament: tournamentId,
        bracket: bracket._id,
        format: "knockout",
        round: r,
        order: i,
        previousA: aPrev?._id || null,
        previousB: bPrev?._id || null,
        rules: isFinal && finalOnly ? finalOnly : baseRules, // ✅ NEW
      });
    }
    created[r] = await Match.insertMany(ms, { session });
  }

  // Link nextMatch/nextSlot (giữ nguyên logic cũ)
  for (let r = 1; r < rounds; r++) {
    const cur = created[r];
    const nxt = created[r + 1];
    for (let i = 0; i < nxt.length; i++) {
      const mNext = nxt[i];
      const mA = cur[i * 2];
      const mB = cur[i * 2 + 1];
      if (mA) {
        mA.nextMatch = mNext._id;
        mA.nextSlot = "A";
        await mA.save({ session });
      }
      if (mB) {
        mB.nextMatch = mNext._id;
        mB.nextSlot = "B";
        await mB.save({ session });
      }
    }
  }

  // resolve seeds (giữ như cũ)
  if (typeof Match.compileSeedsForBracket === "function") {
    await Match.compileSeedsForBracket(bracket._id);
  }

  return { bracket, matchesByRound: created };
}

/* ====================== PO Builder (non-2^n round-elim) ====================== */
// #matches of round r
function poMatchesForRound(N, r) {
  const n = Math.max(0, Number(N) || 0);
  const round = Math.max(1, Number(r) || 1);
  if (round === 1) return Math.max(1, Math.ceil(n / 2));
  const prevMatches = poMatchesForRound(n, round - 1);
  return Math.floor(prevMatches / 2);
}

/**
 * PO: vòng sau đấu giữa LOSER của vòng trước (không ép 2^n)
 */
export async function buildRoundElimBracket({
  tournamentId,
  name = "Play-off",
  order = 2,
  stage = 1,
  drawSize,
  maxRounds = 1,
  firstRoundSeeds = [],
  // ✅ NEW:
  rules = undefined,
  session = null,
}) {
  const N = Math.max(0, Number(drawSize || 0));
  const R1Pairs = Math.max(1, Math.ceil(N / 2));
  const Rmax = Math.max(1, Number(maxRounds || 1));

  const baseRules = sanitizeRules(rules);

  // R1 seeds: nếu thiếu hoặc N lẻ -> BYE cho slot B
  const r1Seeds = Array.from({ length: R1Pairs }, (_, i) => {
    const found = firstRoundSeeds.find((s) => Number(s.pair) === i + 1) || {};
    const idxA = i * 2 + 1;
    const idxB = i * 2 + 2;
    const A =
      found.A && found.A.type
        ? found.A
        : { type: "registration", ref: {}, label: `Đội ${idxA}` };
    const B =
      found.B && found.B.type
        ? found.B
        : idxB <= N
        ? { type: "registration", ref: {}, label: `Đội ${idxB}` }
        : SEED_BYE;
    return { pair: i + 1, A, B };
  });

  const bracket = await Bracket.create(
    [
      {
        tournament: tournamentId,
        name,
        type: "roundElim", // ⭐ PO là roundElim, không phải knockout
        order,
        stage,
        meta: {
          drawSize: 0, // (giữ đúng bản #1) KHÔNG ép 2^n
          maxRounds: Rmax,
          expectedFirstRoundMatches: R1Pairs,
        },
        prefill: { roundKey: `R1`, seeds: r1Seeds },
      },
    ],
    { session }
  ).then((arr) => arr[0]);

  const created = {};

  // V1
  created[1] = await Match.insertMany(
    r1Seeds.map((s, idx) => ({
      tournament: tournamentId,
      bracket: bracket._id,
      format: "roundElim",
      round: 1,
      order: idx,
      seedA: s.A || null,
      seedB: s.B || null,
      rules: baseRules, // ✅ NEW
    })),
    { session }
  );

  // V2..Vmax: Loser cascade
  for (let r = 2; r <= Rmax; r++) {
    const pairs = poMatchesForRound(N, r);
    if (pairs <= 0) break;
    const prevPairs = poMatchesForRound(N, r - 1);

    const ms = [];
    for (let i = 0; i < pairs; i++) {
      const leftOrder = 2 * i; // 0-based
      const rightOrder = 2 * i + 1; // 0-based

      const seedA = {
        type: "stageMatchLoser",
        ref: { stageIndex: stage, round: r - 1, order: leftOrder },
        label: `L-V${r - 1}-T${leftOrder + 1}`,
      };
      const seedB =
        rightOrder < prevPairs
          ? {
              type: "stageMatchLoser",
              ref: { stageIndex: stage, round: r - 1, order: rightOrder },
              label: `L-V${r - 1}-T${rightOrder + 1}`,
            }
          : SEED_BYE;

      ms.push({
        tournament: tournamentId,
        bracket: bracket._id,
        format: "roundElim",
        round: r,
        order: i,
        seedA,
        seedB,
        rules: baseRules, // ✅ NEW
      });
    }

    created[r] = await Match.insertMany(ms, { session });
  }

  // resolve seed (giữ như cũ)
  if (typeof Match.compileSeedsForBracket === "function") {
    await Match.compileSeedsForBracket(bracket._id);
  }

  return { bracket, matchesByRound: created };
}

/* ====================== Group Builder (có expectedSize) ====================== */
/**
 * - Nếu truyền groupSizes (array độ dài = groupCount) -> dùng trực tiếp
 * - Else nếu truyền totalTeams > 0 -> chia đều, phần dư dồn vào bảng CUỐI
 * - Else nếu truyền groupSize -> mọi bảng = groupSize
 * - Else -> expectedSize = 0
 */
export async function buildGroupBracket({
  tournamentId,
  name = "Group Stage",
  order = 0,
  stage = 1,
  groupCount,
  groupSize, // optional
  totalTeams, // optional
  groupSizes, // optional array
  // ✅ NEW:
  rules = undefined, // rule mặc định cho các trận vòng bảng (sẽ được dùng khi tạo match ở nơi khác)
  session = null,
}) {
  const letters = Array.from({ length: groupCount }, (_, i) =>
    String.fromCharCode(65 + i)
  );

  let sizes = new Array(groupCount).fill(0);

  if (Array.isArray(groupSizes) && groupSizes.length === groupCount) {
    sizes = groupSizes.map((x) => Math.max(0, Number(x) || 0));
  } else if (Number(totalTeams) > 0) {
    const N = Math.max(0, Number(totalTeams) || 0);
    const base = Math.floor(N / groupCount);
    const remainder = N - base * groupCount;
    sizes = new Array(groupCount).fill(base);
    // ⭐ dồn phần dư vào bảng cuối
    sizes[groupCount - 1] += remainder;
  } else if (Number(groupSize) > 0) {
    sizes = new Array(groupCount).fill(Math.max(0, Number(groupSize) || 0));
  }

  const groups = letters.map((code, i) => ({
    name: code,
    expectedSize: sizes[i] || 0,
    regIds: [],
  }));

  // Giữ nguyên logic tạo bracket, chỉ thêm config.rules (schema đã có sẵn)
  const bracket = await Bracket.create(
    [
      {
        tournament: tournamentId,
        name,
        type: "group",
        order,
        stage,
        groups,
        // LƯU Ý: Không thay đổi schema. Trường config.rules đã tồn tại, ta set làm mặc định cho phase này
        config: { rules: sanitizeRules(rules) },
      },
    ],
    { session }
  ).then((arr) => arr[0]);

  return bracket;
}
