// controllers/progressionController.js
// =====================================
import expressAsyncHandler from "express-async-handler";
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import DrawSession from "../models/drawSessionModel.js";
import {
  computeQualifiersFromKO,
  computeQualifiersFromGroups,
  buildSeeding,
  createRound1Matches,
} from "../services/progressionService.js";
import mongoose from "mongoose";

export const listTournamentStages = expressAsyncHandler(async (req, res) => {
  const { tid } = req.params;
  const brackets = await Bracket.find({ tournament: tid })
    .select("_id name type order stage teamsCount matchesCount groups config")
    .sort({ order: 1, createdAt: 1 })
    .lean();
  return res.json({ ok: true, brackets });
});

export const listSourcesForTarget = expressAsyncHandler(async (req, res) => {
  const { bid } = req.params;
  const target = await Bracket.findById(bid)
    .select("_id tournament order name type")
    .lean();
  if (!target) {
    res.status(404);
    throw new Error("Target bracket not found");
  }

  const sources = await Bracket.find({
    tournament: target.tournament,
    $or: [{ order: { $lt: target.order } }, { order: target.order - 1 }],
  })
    .select("_id name type order stage groups config")
    .sort({ order: 1 })
    .lean();

  return res.json({ ok: true, target, sources });
});

/**
 * Preview body examples:
 *  - KO round winners -> KO: {
 *      fromBracket: "...", mode: "KO_ROUND_WINNERS", round: 1, limit: 0, seedMethod: "rating|random|tiered"
 *    }
 *  - Group top N -> KO/Playoff: {
 *      fromBracket: "...", mode: "GROUP_TOP", topPerGroup: 2, limit: 0, seedMethod: "rating|random|tiered"
 *    }
 */
export const previewAdvancement = expressAsyncHandler(async (req, res) => {
  const { targetId } = req.params;
  const target = await Bracket.findById(targetId)
    .select("_id tournament type name order config")
    .lean();
  if (!target) {
    res.status(404);
    throw new Error("Target bracket not found");
  }

  const {
    fromBracket,
    mode, // "KO_ROUND_WINNERS" | "GROUP_TOP"
    round,
    topPerGroup = 1,
    limit = 0,
    seedMethod = "rating", // rating|random|tiered|protected
  } = req.body || {};

  if (!fromBracket || !mode) {
    res.status(400);
    throw new Error("fromBracket and mode are required");
  }

  const source = await Bracket.findById(fromBracket).lean();
  if (!source) {
    res.status(404);
    throw new Error("Source bracket not found");
  }
  if (String(source.tournament) !== String(target.tournament)) {
    res.status(400);
    throw new Error("Source & target must be in the same tournament");
  }

  let qualifiers = [];
  let meta = {};

  if (mode === "KO_ROUND_WINNERS") {
    if (!round || typeof round !== "number") {
      res.status(400);
      throw new Error("round (Number) is required for KO_ROUND_WINNERS");
    }
    ({ qualifiers, meta } = await computeQualifiersFromKO({
      sourceBracketId: source._id,
      round,
      limit,
    }));
  } else if (mode === "GROUP_TOP") {
    ({ qualifiers, meta } = await computeQualifiersFromGroups({
      sourceBracketId: source._id,
      topPerGroup,
      limit,
    }));
  } else {
    res.status(400);
    throw new Error(`Unsupported mode: ${mode}`);
  }

  const seeded = await buildSeeding({
    qualifiers,
    seedMethod,
    tournamentId: target.tournament,
  });

  return res.json({
    ok: true,
    source: { _id: source._id, name: source.name, type: source.type },
    target: { _id: target._id, name: target.name, type: target.type },
    meta,
    count: seeded.length,
    seeded,
  });
});

/**
 * Commit body = same as preview + pairing & validateOnly
 * pairing: "standard" | "snake"
 * validateOnly: true -> only validate seeding fits target
 */
export const commitAdvancement = expressAsyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { targetId } = req.params;
    const target = await Bracket.findById(targetId).session(session);
    if (!target) {
      res.status(404);
      throw new Error("Target bracket not found");
    }

    const {
      fromBracket,
      mode,
      round,
      topPerGroup = 1,
      limit = 0,
      seedMethod = "rating",
      pairing = "standard",
      validateOnly = false,
    } = req.body || {};

    if (!fromBracket || !mode) {
      res.status(400);
      throw new Error("fromBracket and mode are required");
    }

    const source = await Bracket.findById(fromBracket).session(session);
    if (!source) {
      res.status(404);
      throw new Error("Source bracket not found");
    }
    if (String(source.tournament) !== String(target.tournament)) {
      res.status(400);
      throw new Error("Source & target must be in the same tournament");
    }

    let qualifiers = [];
    if (mode === "KO_ROUND_WINNERS") {
      if (!round || typeof round !== "number") {
        res.status(400);
        throw new Error("round (Number) is required for KO_ROUND_WINNERS");
      }
      ({ qualifiers } = await computeQualifiersFromKO({
        sourceBracketId: source._id,
        round,
        limit,
        session,
      }));
    } else if (mode === "GROUP_TOP") {
      ({ qualifiers } = await computeQualifiersFromGroups({
        sourceBracketId: source._id,
        topPerGroup,
        limit,
        session,
      }));
    } else {
      res.status(400);
      throw new Error(`Unsupported mode: ${mode}`);
    }

    const seeded = await buildSeeding({
      qualifiers,
      seedMethod,
      tournamentId: target.tournament,
      session,
    });

    // Basic validations: require even number of entrants for KO
    if (target.type === "knockout" || target.type === "double_elim") {
      if (seeded.length % 2 !== 0) {
        res.status(400);
        throw new Error(
          `Target bracket ${target.name}: entrants must be even for KO/DE. Got ${seeded.length}`
        );
      }
    }

    if (validateOnly) {
      await session.commitTransaction();
      return res.json({
        ok: true,
        validated: true,
        entrants: seeded.length,
        seeded,
      });
    }

    // Create Round 1 matches for target using seeding
    const { matchesCreated } = await createRound1Matches({
      targetBracket: target,
      entrants: seeded,
      pairing,
      session,
    });

    // Update quick counters
    target.teamsCount = seeded.length;
    target.matchesCount = (target.matchesCount || 0) + matchesCreated;
    await target.save({ session });

    await session.commitTransaction();
    return res.json({
      ok: true,
      committed: true,
      entrants: seeded.length,
      matchesCreated,
    });
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
});

// --- NEW: Prefill a DrawSession for the target bracket using qualifiers from a previous stage ---
/* ===== Helpers ===== */

/* ================= Helpers (tối thiểu) ================= */

function buildKoLabels(B) {
  const labels = [];
  for (let s = B; s >= 2; s >>= 1) {
    if (s === 8) labels.push("QF");
    else if (s === 4) labels.push("SF");
    else if (s === 2) labels.push("F");
    else labels.push(`R${s}`);
  }
  return labels;
}

function buildKoMeta(n) {
  const entrants = Number(n) || 0;
  if (entrants <= 0) {
    return {
      entrants: 0,
      bracketSize: 0,
      rounds: 0,
      labels: [],
      startKey: null,
      byes: 0,
    };
  }
  if (entrants === 1) {
    return {
      entrants: 1,
      bracketSize: 1,
      rounds: 0,
      labels: [],
      startKey: null,
      byes: 0,
    };
  }
  const B = 1 << Math.ceil(Math.log2(entrants));
  const byes = B - entrants;
  const labels = buildKoLabels(B);
  return {
    entrants,
    bracketSize: B,
    rounds: Math.log2(B),
    labels,
    startKey: labels[0],
    byes,
  };
}

function expectedWinnersCount(drawSize, round) {
  const r = Math.max(1, round | 0);
  if (!drawSize || drawSize < 2) return 0;
  return Math.max(1, Math.floor(drawSize / Math.pow(2, r)));
}

// Lấy danh sách regId đang ở bracket nguồn (PO)
async function getSourceEntrantRegIds(source) {
  if (Array.isArray(source.groups) && source.groups.length) {
    const ids = [];
    for (const g of source.groups)
      if (Array.isArray(g.regIds)) ids.push(...g.regIds);
    if (ids.length) return ids.map((x) => new mongoose.Types.ObjectId(x));
  }
  // tuỳ schema của bạn: ví dụ Registration có field brackets: [bracketId]
  const regs = await Registration.find({
    tournament: source.tournament,
    brackets: source._id,
  })
    .select("_id")
    .lean();
  return regs.map((r) => r._id);
}

// Winner của round r (roundIndex = r-1)
async function getWinnersOfRound(sourceBracketId, round) {
  const idx = Math.max(0, (round | 0) - 1);
  const matches = await Match.find({
    bracket: sourceBracketId,
    roundIndex: idx,
  })
    .select("winner.regId")
    .lean();
  return matches.map((m) => m?.winner?.regId).filter(Boolean);
}

function mkPairsFromEntrants(arr, pairing = "standard") {
  const N = arr.length;
  const out = [];
  if (pairing === "standard") {
    for (let i = 0; i < Math.floor(N / 2); i++) {
      const A = arr[i];
      const B = arr[N - 1 - i];
      out.push({ a: A?.regId ?? null, b: B?.regId ?? null });
    }
  } else if (pairing === "snake") {
    const left = arr.slice(0, Math.floor(N / 2));
    const right = arr.slice(Math.floor(N / 2)).reverse();
    for (let i = 0; i < left.length; i++)
      out.push({ a: left[i]?.regId ?? null, b: right[i]?.regId ?? null });
  } else {
    throw new Error(`Unsupported pairing: ${pairing}`);
  }
  return out;
}

function padWithByesBySeededOrder(seeded, bracketSize) {
  const arr = [...seeded];
  while (arr.length < bracketSize)
    arr.push({ regId: null, seed: null, bye: true });
  return arr;
}

/* ================= Controller ================= */

export const prefillAdvancement = expressAsyncHandler(async (req, res) => {
  const { targetId } = req.params;

  const target = await Bracket.findById(targetId).select(
    "_id tournament type name config groups"
  );
  if (!target) {
    res.status(404);
    throw new Error("Target bracket not found");
  }
  if (target.type !== "knockout") {
    res.status(400);
    throw new Error("Prefill currently supports target type 'knockout' only");
  }

  const {
    fromBracket,
    mode, // "KO_ROUND_WINNERS" | "GROUP_TOP"
    round, // round=1 => lấy winners sau round 1
    topPerGroup = 1,
    limit = 0,
    seedMethod = "rating",
    fillMode = "pairs", // mặc định vẽ sẵn cặp
    pairing = "standard",
    padPairsToBracketSize = true,
    virtualIfEmpty = true,
  } = req.body || {};

  if (!fromBracket || !mode) {
    res.status(400);
    throw new Error("fromBracket and mode are required");
  }

  const source = await Bracket.findById(fromBracket).lean();
  if (!source) {
    res.status(404);
    throw new Error("Source bracket not found");
  }
  if (String(source.tournament) !== String(target.tournament)) {
    res.status(400);
    throw new Error("Source & target must be in the same tournament");
  }

  let qualifiers = [];
  let meta = {};
  let flags = { virtual: false };

  if (mode === "KO_ROUND_WINNERS") {
    if (!round || typeof round !== "number") {
      res.status(400);
      throw new Error("round (Number) is required for KO_ROUND_WINNERS");
    }

    // 1) Winners thực tế (nếu đã có)
    const realWinnerRegIds = await getWinnersOfRound(source._id, round);

    if (realWinnerRegIds.length > 0) {
      qualifiers = realWinnerRegIds.map((regId) => ({ regId }));
      meta = {
        sourceRound: round,
        expected: realWinnerRegIds.length,
        actual: realWinnerRegIds.length,
        virtual: false,
      };
    } else if (virtualIfEmpty) {
      // 2) Prefill ảo theo seeding của PO
      const drawSize =
        source?.meta?.drawSize || source?.config?.roundElim?.drawSize || 0;
      const expect = expectedWinnersCount(drawSize, round); // ví dụ 16/2=8

      const entrantRegIds = await getSourceEntrantRegIds(source);
      if (!entrantRegIds.length) {
        qualifiers = [];
        meta = {
          sourceRound: round,
          expected: expect,
          actual: 0,
          virtual: true,
        };
      } else {
        const seededAll = await buildSeeding({
          qualifiers: entrantRegIds.map((id) => ({ regId: id })),
          seedMethod,
          tournamentId: target.tournament,
        });
        const take = limit > 0 ? Math.min(expect, limit) : expect;
        qualifiers = seededAll.slice(0, take).map((s) => ({ regId: s.regId }));
        meta = {
          sourceRound: round,
          expected: expect,
          actual: 0,
          virtual: true,
        };
        flags.virtual = true;
      }
    } else {
      qualifiers = [];
      meta = { sourceRound: round, expected: 0, actual: 0, virtual: false };
    }
  } else if (mode === "GROUP_TOP") {
    res.status(400);
    throw new Error("Use KO_ROUND_WINNERS for PO → KO prefill");
  } else {
    res.status(400);
    throw new Error(`Unsupported mode: ${mode}`);
  }

  // Seed lại qualifiers (thực/ảo) để xếp vào KO
  const seeded = await buildSeeding({
    qualifiers,
    seedMethod,
    tournamentId: target.tournament,
  });
  const entrants = seeded.map((s) => ({ regId: s.regId, seed: s.seed }));

  // Tính meta KO từ entrants hiện có
  let koMeta = buildKoMeta(entrants.length);

  // ===== Skeleton fallback: vẫn vẽ bracket khi entrants=0 =====
  let board, pool;
  if (virtualIfEmpty && entrants.length === 0) {
    const drawSize =
      source?.meta?.drawSize || source?.config?.roundElim?.drawSize || 0;
    const expect = expectedWinnersCount(drawSize, round); // ví dụ 16/2=8
    if (expect >= 2) {
      const B = 1 << Math.ceil(Math.log2(expect));
      const labels = buildKoLabels(B);
      koMeta = {
        entrants: 0,
        bracketSize: B,
        rounds: Math.log2(B),
        labels,
        startKey: labels[0],
        byes: B,
      };

      // pairs skeleton (toàn null) để FE vẽ khung
      const blankSeeded = Array.from({ length: B }, () => ({
        regId: null,
        seed: null,
      }));
      const pairs = mkPairsFromEntrants(blankSeeded, pairing);

      board = {
        type: "knockout",
        roundKey: koMeta.startKey,
        pairs: pairs.map((p, i) => ({ index: i, a: p.a, b: p.b })), // đều null = BYE
      };
      pool = []; // không có pool trong skeleton
    }
  }

  // Nếu chưa có board (có entrants hoặc không dùng skeleton) → build bình thường
  if (!board) {
    if (fillMode === "pairs") {
      let entrantsForPairs = entrants;
      if (padPairsToBracketSize && koMeta.bracketSize >= 2) {
        entrantsForPairs = padWithByesBySeededOrder(seeded, koMeta.bracketSize);
      } else if (entrants.length % 2 !== 0) {
        res.status(400);
        throw new Error(
          "fillMode 'pairs' requires an even number of entrants when padPairsToBracketSize=false"
        );
      }
      const pairs = mkPairsFromEntrants(entrantsForPairs, pairing);
      board = {
        type: "knockout",
        roundKey: koMeta.startKey,
        pairs: pairs.map((p, i) => ({ index: i, a: p.a, b: p.b })),
      };
      pool = [];
    } else {
      // pool: cũng có thể vẽ khung đủ B/2 nếu đã biết bracketSize
      const nPairs =
        koMeta.bracketSize >= 2
          ? koMeta.bracketSize / 2
          : Math.max(1, Math.floor(entrants.length / 2));
      board = {
        type: "knockout",
        roundKey: koMeta.startKey,
        pairs: Array.from({ length: nPairs }, (_, i) => ({
          index: i,
          a: null,
          b: null,
        })),
      };
      pool = entrants.map((e) => e.regId);
    }
  }

  // ===== Lưu DrawSession (NHỚ: source tách riêng, không nhét vào computedMeta) =====
  const sess = await DrawSession.create({
    tournament: target.tournament,
    bracket: target._id,
    mode: "knockout",

    board,
    pool,
    taken: [],
    targetRound: board.roundKey || null,
    cursor: { pairIndex: 0, side: "A" },
    status: "active",

    settings: { seedMethod, pairing, padPairsToBracketSize, virtualIfEmpty },

    source: {
      fromBracket: source._id,
      fromName: source.name,
      fromType: source.type,
      mode, // "KO_ROUND_WINNERS"
      params: { round, topPerGroup, limit },
      seedMethod,
      fillMode,
      pairing,
      virtualIfEmpty,
      resolved: {
        entrants: koMeta.entrants,
        byes: koMeta.byes,
        expected: meta?.expected ?? null,
        actual: meta?.actual ?? null,
        virtual: !!flags.virtual,
      },
      sampleQualifiers: seeded.slice(0, 32).map((s) => s.regId),
    },

    computedMeta: { ko: koMeta, flags },

    history: [{ action: "start", by: req.user?._id || null }],
  });

  // ===== Response =====
  return res.json({
    ok: true,
    drawId: String(sess._id),
    target: { _id: target._id, name: target.name },
    source: { _id: source._id, name: source.name, type: source.type },
    fillMode,
    count: entrants.length,
    seeded, // [{ regId, seed }]
    meta: {
      source: meta, // info lấy từ PO (expected/actual/virtual)
      ko: koMeta, // labels/startKey/bracketSize/byes…
      flags, // { virtual: true/false }
    },
  });
});
