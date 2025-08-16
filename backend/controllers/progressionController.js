// controllers/progressionController.js
// =====================================
import mongoose from "mongoose";
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
export const prefillAdvancement = expressAsyncHandler(async (req, res) => {
  const { targetId } = req.params;
  const target = await Bracket.findById(targetId).select(
    "_id tournament type name order config"
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
    round,
    topPerGroup = 1,
    limit = 0,
    seedMethod = "rating",
    fillMode = "pool", // "pool" = put entrants into pool for manual draw; "pairs" = pre-seat into pairs
    pairing = "standard", // only used when fillMode = "pairs"
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

  // Build board
  const entrants = seeded.map((s) => ({ regId: s.regId, seed: s.seed }));

  const mkPairsFromEntrants = (arr) => {
    const N = arr.length;
    const out = [];
    if (pairing === "standard") {
      for (let i = 0; i < N / 2; i++) {
        const A = arr[i];
        const B = arr[N - 1 - i];
        out.push({ a: A.regId, b: B.regId });
      }
    } else if (pairing === "snake") {
      const left = arr.slice(0, N / 2);
      const right = arr.slice(N / 2).reverse();
      for (let i = 0; i < left.length; i++)
        out.push({ a: left[i].regId, b: right[i].regId });
    } else {
      throw new Error(`Unsupported pairing: ${pairing}`);
    }
    return out;
  };

  const pairsNeeded = Math.floor(entrants.length / 2);

  let board;
  let pool;

  const roundKeyFromTeams = (t) => {
    const pow2 = (x) => (x & (x - 1)) === 0;
    if (t === 2) return "F";
    if (t === 4) return "SF";
    if (t === 8) return "QF";
    if (t >= 16 && pow2(t)) return `R${t}`;
    return null; // non power of two, leave null
  };

  if (fillMode === "pairs") {
    if (entrants.length % 2 !== 0) {
      res.status(400);
      throw new Error("fillMode 'pairs' requires an even number of entrants");
    }
    const pairs = mkPairsFromEntrants(entrants);
    board = {
      type: "knockout",
      roundKey: roundKeyFromTeams(entrants.length),
      pairs: pairs.map((p, i) => ({ index: i, a: p.a, b: p.b })),
    };
    pool = [];
  } else {
    board = {
      type: "knockout",
      roundKey: roundKeyFromTeams(entrants.length),
      pairs: Array.from({ length: Math.max(1, pairsNeeded) }, (_, i) => ({
        index: i,
        a: null,
        b: null,
      })),
    };
    pool = entrants.map((e) => e.regId);
  }

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
    settings: { seedMethod, pairing },
    history: [{ action: "start", by: req.user?._id || null }],
  });

  return res.json({
    ok: true,
    drawId: String(sess._id),
    target: { _id: target._id, name: target.name },
    source: { _id: source._id, name: source.name, type: source.type },
    fillMode,
    count: entrants.length,
    seeded,
  });
});
