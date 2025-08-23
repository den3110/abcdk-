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

const SEED_BYE = { type: "bye", ref: null, label: "BYE" };

/* ====================== KO Builder (2^n) ====================== */
export async function buildKnockoutBracket({
  tournamentId,
  name = "Knockout",
  order = 1,
  stage = 1,
  drawSize,
  firstRoundSeeds = [],
  session = null,
}) {
  const size = Math.max(2, ceilPow2(drawSize || 2));
  const rounds = Math.round(Math.log2(size));
  const firstPairs = size / 2;

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
        prefill: {
          roundKey: roundTitleByPairs(firstPairs),
          seeds: r1Seeds,
        },
      },
    ],
    { session }
  ).then((arr) => arr[0]);

  const created = {};
  created[1] = await Match.insertMany(
    r1Seeds.map((s, idx) => ({
      tournament: tournamentId,
      bracket: bracket._id,
      format: "knockout",
      round: 1,
      order: idx,
      seedA: s.A || null,
      seedB: s.B || null,
    })),
    { session }
  );

  for (let r = 2; r <= rounds; r++) {
    const prev = created[r - 1];
    const pairs = Math.ceil(prev.length / 2);
    const ms = [];
    for (let i = 0; i < pairs; i++) {
      const aPrev = prev[i * 2];
      const bPrev = prev[i * 2 + 1];
      ms.push({
        tournament: tournamentId,
        bracket: bracket._id,
        format: "knockout",
        round: r,
        order: i,
        previousA: aPrev?._id || null,
        previousB: bPrev?._id || null,
      });
    }
    created[r] = await Match.insertMany(ms, { session });
  }

  // set nextMatch/nextSlot
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

  // 👇 NEW: resolve seed ngay cho bracket này
  await Match.compileSeedsForBracket(bracket._id);

  return { bracket, matchesByRound: created };
}

/* ====================== Round-Elim (PO) ====================== */
function poMatchesForRound(N, r) {
  const n = Math.max(0, Number(N) || 0);
  const round = Math.max(1, Number(r) || 1);
  if (round === 1) return Math.max(1, Math.ceil(n / 2));
  let prevMatches = poMatchesForRound(n, round - 1);
  return Math.floor(prevMatches / 2);
}

export async function buildRoundElimBracket({
  tournamentId,
  name = "Play-off",
  order = 2,
  stage = 1,
  drawSize,
  maxRounds = 1,
  firstRoundSeeds = [],
  session = null,
}) {
  const N = Math.max(0, Number(drawSize || 0));
  const R1Pairs = Math.max(1, Math.ceil(N / 2));
  const Rmax = Math.max(1, Number(maxRounds || 1));

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
        type: "roundElim", // 👈 NEW
        order,
        stage,
        meta: {
          drawSize: N,
          maxRounds: Rmax,
          expectedFirstRoundMatches: R1Pairs,
        },
        prefill: {
          roundKey: `R1`,
          seeds: r1Seeds,
        },
      },
    ],
    { session }
  ).then((arr) => arr[0]);

  const created = {};
  created[1] = await Match.insertMany(
    r1Seeds.map((s, idx) => ({
      tournament: tournamentId,
      bracket: bracket._id,
      format: "roundElim",
      round: 1,
      order: idx,
      seedA: s.A || null,
      seedB: s.B || null,
    })),
    { session }
  );

  for (let r = 2; r <= Rmax; r++) {
    const pairs = poMatchesForRound(N, r);
    if (pairs <= 0) break;
    const prevPairs = poMatchesForRound(N, r - 1);

    const ms = [];
    for (let i = 0; i < pairs; i++) {
      const leftOrder = 2 * i;
      const rightOrder = 2 * i + 1;

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
      });
    }

    created[r] = await Match.insertMany(ms, { session });
  }

  // 👇 NEW: resolve seed ngay cho bracket này
  await Match.compileSeedsForBracket(bracket._id);

  return { bracket, matchesByRound: created };
}

/* ====================== Group Builder ====================== */
export async function buildGroupBracket({
  tournamentId,
  name = "Group Stage",
  order = 0,
  stage = 1,
  groupCount,
  groupSize,
  session = null,
}) {
  const letters = Array.from({ length: groupCount }, (_, i) =>
    String.fromCharCode(65 + i)
  );
  // giữ cấu trúc groups cũ; nếu cần bạn có thể thêm meta/regCount tuỳ spec
  const groups = letters.map((code) => ({ name: code, regIds: [] }));

  const bracket = await Bracket.create(
    [
      {
        tournament: tournamentId,
        name,
        type: "group",
        order,
        stage,
        groups,
        // gợi ý config để FE/BXH dùng
        config: {
          roundRobin: {
            points: { win: 3, draw: 1, loss: 0 },
            tiebreakers: ["h2h", "setsDiff", "pointsDiff", "pointsFor"],
          },
        },
      },
    ],
    { session }
  ).then((arr) => arr[0]);

  return bracket;
}
