// services/bracketBuilder.js
import mongoose from "mongoose";
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

function normalizeKoRoundKey(value) {
  if (!value) return "";
  const upper = String(value).trim().toUpperCase();
  if (["F", "SF", "QF", "R16", "R32", "R64", "R128", "R256", "R512", "R1024"].includes(upper)) {
    return upper;
  }
  return "";
}

// Tạo seed BYE hợp lệ cho validation
const SEED_BYE = { type: "bye", ref: null, label: "BYE" };

// ✅ groupTypes: dùng cho tính labelRoundOffset giống adminGetMatchById
const groupTypes = new Set(["group", "round_robin", "gsl"]);

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

function toObjectIdString(value) {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") {
    const trimmed = value.trim();
    return mongoose.isValidObjectId(trimmed) ? trimmed : "";
  }

  if (mongoose.isValidObjectId(value)) {
    return String(value);
  }

  if (value && typeof value === "object") {
    const nested =
      value._id ?? value.id ?? value.registration ?? value.reg ?? value.value ?? null;
    if (nested && nested !== value) return toObjectIdString(nested);
  }

  return "";
}

function sanitizeSeedSource(seed, fallback = null) {
  if (!seed?.type) return fallback;

  const type = String(seed.type);
  const label = String(seed.label || "");
  const ref = seed?.ref && typeof seed.ref === "object" ? seed.ref : {};

  if (type === "bye") {
    return { type: "bye", ref: null, label: label || "BYE" };
  }

  if (type === "registration") {
    const registration = toObjectIdString(
      ref.registration ?? ref.reg ?? seed.registration ?? seed.reg
    );
    return {
      type,
      ref: registration ? { registration } : {},
      label,
    };
  }

  if (type === "groupRank") {
    return {
      type,
      ref: {
        stage: Number(ref.stage ?? ref.stageIndex ?? 1) || 1,
        groupCode: ref.groupCode ? String(ref.groupCode) : "",
        rank: Number(ref.rank ?? ref.place ?? 0) || 0,
        wildcardOrder: Number(ref.wildcardOrder ?? ref.pick ?? ref.index ?? 0) || 0,
      },
      label,
    };
  }

  if (type === "stageMatchWinner" || type === "stageMatchLoser") {
    return {
      type,
      ref: {
        stageIndex: Number(ref.stageIndex ?? ref.stage ?? 0) || 0,
        round: Number(ref.round ?? 0) || 0,
        order: Number(ref.order ?? 0) || 0,
      },
      label,
    };
  }

  return {
    type,
    ref,
    label,
  };
}

function isByeSeed(seed) {
  if (!seed) return false;
  const type = String(seed?.type || "").toLowerCase();
  if (type === "bye") return true;
  return String(seed?.label || "").trim().toUpperCase() === "BYE";
}

function buildDoubleElimRoundMap(winnersRounds) {
  const wb = {};
  const lb = {};
  let cursor = 1;

  wb[1] = cursor++;
  lb[1] = cursor++;

  for (let roundIndex = 2; roundIndex < winnersRounds; roundIndex += 1) {
    wb[roundIndex] = cursor++;
    lb[roundIndex * 2 - 2] = cursor++;
    lb[roundIndex * 2 - 1] = cursor++;
  }

  wb[winnersRounds] = cursor++;
  lb[winnersRounds * 2 - 2] = cursor++;

  return {
    wb,
    lb,
    gf: cursor++,
  };
}

function createMatchLoserSeed(round, order, label) {
  return {
    type: "matchLoser",
    ref: { round, order },
    label: label || `L-V${round}-T${Number(order) + 1}`,
  };
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

      // cộng dồn effRounds của các bracket ĐỨNG TRƯỚC (stage, order) hiện tại
      for (const b of allBrackets) {
        const bStage = Number(b.stage) || 0;
        const bOrder = Number(b.order) || 0;

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
    const A =
      found?.A && found.A.type ? sanitizeSeedSource(found.A, SEED_BYE) || SEED_BYE : SEED_BYE;
    const B =
      found?.B && found.B.type ? sanitizeSeedSource(found.B, SEED_BYE) || SEED_BYE : SEED_BYE;
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
        config: {
          rules: baseRules,
          blueprint: {
            drawSize: size,
            seeds: r1Seeds,
            rules: baseRules,
            semiRules: semiOnly,
            finalRules: finalOnly,
            thirdPlaceEnabled: !!thirdPlace,
            thirdPlaceRules: bronzeOnly,
          },
        },
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
            // ⚠️ ĐÁNH DẤU TRẬN TRANH 3–4
            isThirdPlace: true,

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

/* ====================== Double Elimination Builder ====================== */
export async function buildDoubleElimBracket({
  tournamentId,
  name = "Double Elimination",
  order = 1,
  stage = 1,
  drawSize,
  startRoundKey = "",
  firstRoundSeeds = [],
  rules = undefined,
  semiRules = null,
  finalRules = null,
  hasGrandFinalReset = false,
  session = null,
}) {
  const size = Math.max(4, ceilPow2(drawSize || 4));
  const winnersRounds = Math.round(Math.log2(size));
  const firstPairs = size / 2;
  const baseRules = sanitizeRules(rules);
  const finalOnly = finalRules ? sanitizeRules(finalRules) : null;
  const roundMap = buildDoubleElimRoundMap(winnersRounds);
  const resolvedStartRoundKey = normalizeKoRoundKey(startRoundKey) || roundTitleByPairs(firstPairs);

  const r1Seeds = Array.from({ length: firstPairs }, (_, i) => {
    const found = firstRoundSeeds.find((seed) => Number(seed.pair) === i + 1);
    const A =
      found?.A && found.A.type ? sanitizeSeedSource(found.A, SEED_BYE) || SEED_BYE : SEED_BYE;
    const B =
      found?.B && found.B.type ? sanitizeSeedSource(found.B, SEED_BYE) || SEED_BYE : SEED_BYE;
    return { pair: i + 1, A, B };
  });

  const bracket = await Bracket.create(
    [
      {
        tournament: tournamentId,
        name,
        type: "double_elim",
        order,
        stage,
        config: {
          rules: baseRules,
          doubleElim: {
            hasGrandFinalReset: !!hasGrandFinalReset,
            startRoundKey: resolvedStartRoundKey,
          },
          blueprint: {
            format: "double_elim",
            drawSize: size,
            seeds: r1Seeds,
            rules: baseRules,
            semiRules: semiRules ? sanitizeRules(semiRules) : null,
            finalRules: finalOnly,
            doubleElim: {
              hasGrandFinalReset: !!hasGrandFinalReset,
              startRoundKey: resolvedStartRoundKey,
            },
          },
        },
        meta: {
          drawSize: size,
          maxRounds: roundMap.gf,
          expectedFirstRoundMatches: firstPairs,
        },
        prefill: {
          roundKey: resolvedStartRoundKey,
          seeds: r1Seeds,
        },
      },
    ],
    { session }
  ).then((arr) => arr[0]);

  const createdWB = {};
  const createdLB = {};

  const setWinnerLink = async (matchDoc, nextMatch, slot) => {
    if (!matchDoc?._id || !nextMatch?._id) return;
    matchDoc.nextMatch = nextMatch._id;
    matchDoc.nextSlot = slot;
    await matchDoc.save({ session });
  };

  createdWB[1] = await Match.insertMany(
    r1Seeds.map((seed, idx) => ({
      tournament: tournamentId,
      bracket: bracket._id,
      format: "double_elim",
      branch: "wb",
      phase: "winners",
      round: roundMap.wb[1],
      order: idx,
      seedA: seed.A || null,
      seedB: seed.B || null,
      rules: baseRules,
    })),
    { session }
  );

  for (let roundIndex = 2; roundIndex <= winnersRounds; roundIndex += 1) {
    const prev = createdWB[roundIndex - 1] || [];
    const pairs = Math.ceil(prev.length / 2);
    createdWB[roundIndex] = await Match.insertMany(
      Array.from({ length: pairs }, (_, idx) => ({
        tournament: tournamentId,
        bracket: bracket._id,
        format: "double_elim",
        branch: "wb",
        phase: "winners",
        round: roundMap.wb[roundIndex],
        order: idx,
        previousA: prev[idx * 2]?._id || null,
        previousB: prev[idx * 2 + 1]?._id || null,
        rules: baseRules,
      })),
      { session }
    );
  }

  for (let roundIndex = 1; roundIndex < winnersRounds; roundIndex += 1) {
    const current = createdWB[roundIndex] || [];
    const next = createdWB[roundIndex + 1] || [];
    for (let idx = 0; idx < next.length; idx += 1) {
      await setWinnerLink(current[idx * 2], next[idx], "A");
      await setWinnerLink(current[idx * 2 + 1], next[idx], "B");
    }
  }

  createdLB[1] = await Match.insertMany(
    Array.from({ length: Math.max(1, createdWB[1].length / 2) }, (_, idx) => {
      const leftSeed = r1Seeds[idx * 2];
      const rightSeed = r1Seeds[idx * 2 + 1];
      const leftLoser =
        isByeSeed(leftSeed?.A) || isByeSeed(leftSeed?.B)
          ? SEED_BYE
          : createMatchLoserSeed(roundMap.wb[1], idx * 2, `L-WB1-T${idx * 2 + 1}`);
      const rightLoser =
        isByeSeed(rightSeed?.A) || isByeSeed(rightSeed?.B)
          ? SEED_BYE
          : createMatchLoserSeed(roundMap.wb[1], idx * 2 + 1, `L-WB1-T${idx * 2 + 2}`);

      return {
        tournament: tournamentId,
        bracket: bracket._id,
        format: "double_elim",
        branch: "lb",
        phase: "losers",
        round: roundMap.lb[1],
        order: idx,
        seedA: leftLoser,
        seedB: rightLoser,
        rules: baseRules,
      };
    }),
    { session }
  );

  for (let winnersRound = 2; winnersRound < winnersRounds; winnersRound += 1) {
    const entryRoundIndex = winnersRound * 2 - 2;
    const consolidateRoundIndex = winnersRound * 2 - 1;
    const prevLbRound = createdLB[entryRoundIndex - 1] || [];
    const wbRound = createdWB[winnersRound] || [];

    createdLB[entryRoundIndex] = await Match.insertMany(
      Array.from({ length: wbRound.length }, (_, idx) => ({
        tournament: tournamentId,
        bracket: bracket._id,
        format: "double_elim",
        branch: "lb",
        phase: "losers",
        round: roundMap.lb[entryRoundIndex],
        order: idx,
        previousA: prevLbRound[idx]?._id || null,
        seedB: createMatchLoserSeed(
          roundMap.wb[winnersRound],
          idx,
          `L-WB${winnersRound}-T${idx + 1}`
        ),
        rules: baseRules,
      })),
      { session }
    );

    createdLB[consolidateRoundIndex] = await Match.insertMany(
      Array.from({ length: Math.ceil(createdLB[entryRoundIndex].length / 2) }, (_, idx) => ({
        tournament: tournamentId,
        bracket: bracket._id,
        format: "double_elim",
        branch: "lb",
        phase: "losers",
        round: roundMap.lb[consolidateRoundIndex],
        order: idx,
        previousA: createdLB[entryRoundIndex][idx * 2]?._id || null,
        previousB: createdLB[entryRoundIndex][idx * 2 + 1]?._id || null,
        rules: baseRules,
      })),
      { session }
    );
  }

  const finalLbRoundIndex = winnersRounds * 2 - 2;
  const finalLbSourceRoundIndex = winnersRounds === 2 ? 1 : finalLbRoundIndex - 1;
  createdLB[finalLbRoundIndex] = await Match.insertMany(
    [
      {
        tournament: tournamentId,
        bracket: bracket._id,
        format: "double_elim",
        branch: "lb",
        phase: "losers",
        round: roundMap.lb[finalLbRoundIndex],
        order: 0,
        previousA: createdLB[finalLbSourceRoundIndex]?.[0]?._id || null,
        seedB: createMatchLoserSeed(
          roundMap.wb[winnersRounds],
          0,
          `L-WB${winnersRounds}-T1`
        ),
        rules: baseRules,
      },
    ],
    { session }
  );

  const grandFinal = await Match.insertMany(
    [
      {
        tournament: tournamentId,
        bracket: bracket._id,
        format: "double_elim",
        branch: "gf",
        phase: "grand_final",
        round: roundMap.gf,
        order: 0,
        previousA: createdWB[winnersRounds]?.[0]?._id || null,
        previousB: createdLB[finalLbRoundIndex]?.[0]?._id || null,
        rules: finalOnly || baseRules,
      },
    ],
    { session }
  ).then((arr) => arr[0]);

  if (createdLB[1]?.length) {
    const nextRound = createdLB[2] || [];
    for (let idx = 0; idx < createdLB[1].length; idx += 1) {
      await setWinnerLink(createdLB[1][idx], nextRound[idx], "A");
    }
  }

  for (let winnersRound = 2; winnersRound < winnersRounds; winnersRound += 1) {
    const entryRoundIndex = winnersRound * 2 - 2;
    const consolidateRoundIndex = winnersRound * 2 - 1;
    const entryRound = createdLB[entryRoundIndex] || [];
    const consolidateRound = createdLB[consolidateRoundIndex] || [];

    for (let idx = 0; idx < consolidateRound.length; idx += 1) {
      await setWinnerLink(entryRound[idx * 2], consolidateRound[idx], "A");
      await setWinnerLink(entryRound[idx * 2 + 1], consolidateRound[idx], "B");
    }

    const nextEntryRound = createdLB[consolidateRoundIndex + 1] || [];
    for (let idx = 0; idx < nextEntryRound.length; idx += 1) {
      await setWinnerLink(consolidateRound[idx], nextEntryRound[idx], "A");
    }
  }

  await setWinnerLink(createdWB[winnersRounds]?.[0], grandFinal, "A");
  await setWinnerLink(createdLB[finalLbRoundIndex]?.[0], grandFinal, "B");

  if (typeof Match.compileSeedsForBracket === "function") {
    await Match.compileSeedsForBracket(bracket._id);
  }

  return {
    bracket,
    matchesByRound: {
      wb: createdWB,
      lb: createdLB,
      gf: grandFinal,
    },
  };
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
        ? sanitizeSeedSource(found.A, { type: "registration", ref: {}, label: `Đội ${idxA}` })
        : { type: "registration", ref: {}, label: `Đội ${idxA}` };
    const B =
      found.B && found.B.type
        ? sanitizeSeedSource(found.B, idxB <= N ? { type: "registration", ref: {}, label: `Đội ${idxB}` } : SEED_BYE)
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
        meta: {
          drawSize: 0, // giữ hành vi cũ
          maxRounds: Rmax,
          expectedFirstRoundMatches: R1Pairs,
        },
        config: {
          rules: baseRules,
          roundElim: {
            drawSize: N,
            cutRounds: Rmax,
          },
          blueprint: {
            drawSize: N,
            maxRounds: Rmax,
            seeds: r1Seeds,
            rules: baseRules,
            roundRules: perRoundRules,
          },
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
  qualifiersPerGroup, // optional
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

  // Giữ nguyên logic tạo bracket, chỉ thêm config.rules (schema đã tồn tại)
  const bracket = await Bracket.create(
    [
      {
        tournament: tournamentId,
        name,
        type: "group",
        order,
        stage,
        groups,
        config: {
          rules: sanitizeRules(rules),
          roundRobin: {
            groupSize:
              Number(groupSize) > 0
                ? Math.max(0, Number(groupSize) || 0)
                : Math.max(0, sizes[0] || 0),
          },
          blueprint: {
            groupCount,
            groupSize: Number(groupSize) || 0,
            totalTeams: Number(totalTeams) || 0,
            groupSizes: sizes,
            qualifiersPerGroup: Number(qualifiersPerGroup) || 1,
            rules: sanitizeRules(rules),
          },
        },
      },
    ],
    { session }
  ).then((arr) => arr[0]);

  return bracket;
}
