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
  // Rule mặc định cho toàn bộ KO
  rules = undefined,
  // rule riêng cho BÁN KẾT
  semiRules = null,
  // rule riêng cho CHUNG KẾT KO
  finalRules = null,
  // bật / tắt trận tranh hạng 3–4
  thirdPlace = false,
  // rule riêng cho trận 3–4 (optional)
  thirdPlaceRules = null,
  session = null,
}) {
  const size = Math.max(2, ceilPow2(drawSize || 2));
  const rounds = Math.round(Math.log2(size)); // VD size=8 => rounds=3
  const firstPairs = size / 2;

  const baseRules = sanitizeRules(rules);
  const semiOnly = semiRules ? sanitizeRules(semiRules) : null;
  const finalOnly = finalRules ? sanitizeRules(finalRules) : null;
  const bronzeOnly = thirdPlaceRules
    ? sanitizeRules(thirdPlaceRules)
    : finalOnly || semiOnly || baseRules;

  // ===================== tính labelRoundOffset kiểu adminGetMatchById =====================
  let labelRoundOffset = 0;
  try {
    const tournamentIdStr = String(tournamentId || "");
    const stageNum = Number(stage) || 0;
    const orderNum = Number(order) || 0;

    if (tournamentIdStr && stageNum > 0) {
      let q = Bracket.find({ tournament: tournamentIdStr })
        .select("_id type stage order meta")
        .sort({ stage: 1, order: 1, _id: 1 });
      if (session) q = q.session(session);
      const allBrackets = await q.lean();

      // y hệt idea: cộng dồn effRounds của các bracket ĐỨNG TRƯỚC
      for (const b of allBrackets) {
        const bStage = Number(b.stage) || 0;
        const bOrder = Number(b.order) || 0;

        // chỉ tính những bracket đứng trước (stage, order) hiện tại
        const isBefore =
          bStage < stageNum || (bStage === stageNum && bOrder < orderNum);
        if (!isBefore) continue;

        let add = 1;
        if (groupTypes.has(b.type)) {
          // group / round_robin / gsl => 1 vòng
          add = 1;
        } else {
          const mr = b?.meta?.maxRounds;
          add = Number.isFinite(Number(mr)) && Number(mr) > 0 ? Number(mr) : 1;
        }
        labelRoundOffset += add;
      }
    }
  } catch (e) {
    console.error(
      "[buildKnockoutBracket] labelRoundOffset error:",
      e?.message || e
    );
  }
  // =====================================================================

  // Helper chọn rule cho từng trận
  function pickRules(roundIndex, matchIndex) {
    // Trận CHUNG KẾT (vòng cuối, trận đầu tiên)
    if (roundIndex === rounds && matchIndex === 0 && finalOnly) {
      return finalOnly;
    }

    // Trận BÁN KẾT:
    // - Nếu có >= 2 vòng thì bán kết là vòng "rounds - 1"
    if (rounds >= 2 && roundIndex === rounds - 1 && semiOnly) {
      return semiOnly;
    }

    // Còn lại dùng rule mặc định
    return baseRules;
  }

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
      },
    ],
    { session }
  ).then((arr) => arr[0]);

  const created = {};

  // ===== R1 =====
  created[1] = await Match.insertMany(
    r1Seeds.map((s, idx) => ({
      tournament: tournamentId,
      bracket: bracket._id,
      format: "knockout",
      round: 1,
      order: idx,
      seedA: s.A || null,
      seedB: s.B || null,
      rules: pickRules(1, idx),
    })),
    { session }
  );

  // ===== R2..R =====
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
        rules: pickRules(r, i),
      });
    }

    created[r] = await Match.insertMany(ms, { session });
  }

  // Link nextMatch/nextSlot (giữ logic cũ cho đường đi WINNER)
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

  // ✅ Trận tranh hạng 3 – LOSER của 2 trận bán kết
  if (thirdPlace && rounds >= 2) {
    const semiMatches = created[rounds - 1] || [];
    if (semiMatches.length >= 2) {
      // x = vòng bán kết theo display: vOffset + round(bán kết)
      // VD: group(1 vòng) + PO(2 vòng) => KO semi là V3 ⇒ label L-V3-T1
      const semiVisualRound = labelRoundOffset + (rounds - 1);

      const bronzeArr = await Match.insertMany(
        [
          {
            tournament: tournamentId,
            bracket: bracket._id,
            format: "knockout",
            // cùng round với chung kết (round = rounds), khác order
            round: rounds,
            order: created[rounds]?.length || 1, // final đang order=0
            seedA: {
              type: "stageMatchLoser",
              ref: { stageIndex: stage, round: rounds - 1, order: 0 },
              label: `L-V${semiVisualRound}-T1`,
            },
            seedB: {
              type: "stageMatchLoser",
              ref: { stageIndex: stage, round: rounds - 1, order: 1 },
              label: `L-V${semiVisualRound}-T2`,
            },
            rules: bronzeOnly,
          },
        ],
        { session }
      );

      if (!created[rounds]) created[rounds] = [];
      created[rounds].push(bronzeArr[0]);
    }
  }

  // resolve seeds (nếu có static method)
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
  // ✅ base rule chung
  rules = undefined,
  // ✅ NEW: rule theo từng vòng: [ruleV1, ruleV2, ...]
  roundRules = undefined,
  session = null,
}) {
  const N = Math.max(0, Number(drawSize || 0));
  const R1Pairs = Math.max(1, Math.ceil(N / 2));
  const Rmax = Math.max(1, Number(maxRounds || 1));

  // rule gốc (nếu không có thì BO1, 11 điểm, win by 2, cap none)
  const baseRules = sanitizeRules(rules);

  // chuẩn hoá từng rule theo vòng
  const perRoundRules = Array.isArray(roundRules)
    ? roundRules.map((r) => sanitizeRules(r))
    : [];

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

  // ✅ lưu cả rules + roundRules vào bracket để auto-advance đọc được
  const bracket = await Bracket.create(
    [
      {
        tournament: tournamentId,
        name,
        type: "roundElim", // PO
        order,
        stage,
        rules: baseRules,
        meta: {
          drawSize: 0, // giữ hành vi cũ
          maxRounds: Rmax,
          expectedFirstRoundMatches: R1Pairs,
        },
        config: {
          drawSize: N,
          maxRounds: Rmax,
          roundRules: perRoundRules, // ✅ chỗ này autoAdvance sẽ đọc
        },
        prefill: { roundKey: `R1`, seeds: r1Seeds },
      },
    ],
    { session }
  ).then((arr) => arr[0]);

  const created = {};

  // helper chọn rule theo vòng
  const ruleForRound = (roundNum) => {
    const idx = Math.max(0, Number(roundNum || 1) - 1);
    return perRoundRules[idx] || baseRules;
  };

  // V1
  created[1] = await Match.insertMany(
    r1Seeds.map((s, idx) => {
      const rRule = ruleForRound(1);
      return {
        tournament: tournamentId,
        bracket: bracket._id,
        format: "roundElim",
        round: 1,
        order: idx,
        seedA: s.A || null,
        seedB: s.B || null,
        rules: rRule,
        // ✅ ghi ra field phẳng để client cũ xài
        bestOf: rRule.bestOf,
        pointsToWin: rRule.pointsToWin,
        winByTwo: rRule.winByTwo,
        capMode: rRule.cap?.mode ?? "none",
        capPoints: rRule.cap?.points ?? null,
      };
    }),
    { session }
  );

  // V2..Vmax: Loser cascade
  for (let r = 2; r <= Rmax; r++) {
    const pairs = poMatchesForRound(N, r);
    if (pairs <= 0) break;
    const prevPairs = poMatchesForRound(N, r - 1);
    const rRule = ruleForRound(r); // ✅ rule riêng của vòng này

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
        rules: rRule, // ✅ vòng này xài rule này
        bestOf: rRule.bestOf,
        pointsToWin: rRule.pointsToWin,
        winByTwo: rRule.winByTwo,
        capMode: rRule.cap?.mode ?? "none",
        capPoints: rRule.cap?.points ?? null,
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
