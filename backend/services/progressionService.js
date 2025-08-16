// =================================
// services/progressionService.js
// =================================
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import { seedCompare } from "../utils/sorters.js";

/** Compute winners of a specific round from a KO-like bracket */
export async function computeQualifiersFromKO({ sourceBracketId, round, limit = 0, session }) {
  const matches = await Match.find({ bracket: sourceBracketId, round, status: "finished", winner: { $in: ["A", "B"] } })
    .select("pairA pairB winner order round pool.id")
    .sort({ order: 1 })
    .session(session || null)
    .lean();

  const qualifiers = [];
  for (const m of matches) {
    const regId = m.winner === "A" ? m.pairA : m.pairB;
    if (regId) qualifiers.push({ regId: String(regId), from: { matchId: String(m._id), round: m.round } });
    if (limit > 0 && qualifiers.length >= limit) break;
  }
  return { qualifiers, meta: { round, matchCount: matches.length } };
}

/** Compute top N from each group in a group/round-robin style bracket */
export async function computeQualifiersFromGroups({ sourceBracketId, topPerGroup = 1, limit = 0, session }) {
  const bracket = await Bracket.findById(sourceBracketId).select("groups config type").session(session || null).lean();
  if (!bracket) throw new Error("Source bracket not found");

  const ptsWin = bracket?.config?.roundRobin?.points?.win ?? 1;
  const ptsLoss = bracket?.config?.roundRobin?.points?.loss ?? 0;
  const tiebreakers = bracket?.config?.roundRobin?.tiebreakers || ["h2h", "setsDiff", "pointsDiff", "pointsFor"]; // order only used for deterministic sort; h2h partly supported

  const matches = await Match.find({ bracket: sourceBracketId, status: "finished" })
    .select("pairA pairB winner gameScores pool.id pool.name")
    .session(session || null)
    .lean();

  // Accumulate per group
  const byGroup = new Map(); // groupId -> regId -> stats
  for (const m of matches) {
    if (!m?.pool?.id || !m.pairA || !m.pairB || !m.winner) continue;
    const gid = String(m.pool.id);
    if (!byGroup.has(gid)) byGroup.set(gid, new Map());
    const g = byGroup.get(gid);

    // safe init helper
    const init = (id) => {
      if (!g.has(id)) g.set(id, { regId: id, played: 0, wins: 0, losses: 0, setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0, opponents: new Map() });
      return g.get(id);
    };

    const aId = String(m.pairA);
    const bId = String(m.pairB);
    const a = init(aId);
    const b = init(bId);

    a.played++; b.played++;

    // winner/loser
    if (m.winner === "A") { a.wins++; b.losses++; } else if (m.winner === "B") { b.wins++; a.losses++; }

    // sets & points from gameScores
    for (const gs of m.gameScores || []) {
      const pa = typeof gs?.a === "number" ? gs.a : 0;
      const pb = typeof gs?.b === "number" ? gs.b : 0;
      a.pointsFor += pa; a.pointsAgainst += pb;
      b.pointsFor += pb; b.pointsAgainst += pa;
      if (pa > pb) { a.setsFor++; b.setsAgainst++; } else if (pb > pa) { b.setsFor++; a.setsAgainst++; }
    }

    // simple head-to-head record
    const oppA = a.opponents.get(bId) || { wins: 0, losses: 0 };
    const oppB = b.opponents.get(aId) || { wins: 0, losses: 0 };
    if (m.winner === "A") { oppA.wins++; oppB.losses++; } else if (m.winner === "B") { oppB.wins++; oppA.losses++; }
    a.opponents.set(bId, oppA);
    b.opponents.set(aId, oppB);
  }

  // Rank in each group
  const qualifiers = [];
  for (const [gid, gmap] of byGroup) {
    const rows = Array.from(gmap.values()).map((s) => ({
      ...s,
      points: s.wins * ptsWin + s.losses * ptsLoss,
      setsDiff: s.setsFor - s.setsAgainst,
      pointsDiff: s.pointsFor - s.pointsAgainst,
    }));

    rows.sort((x, y) => {
      // primary by points (wins/loss points)
      if (y.points !== x.points) return y.points - x.points;
      // optional h2h (only if just 2 tied)
      const tied = rows.filter((r) => r.points === x.points);
      if (tied.length === 2 && (tied[0].regId === x.regId || tied[1].regId === x.regId)) {
        const other = tied[0].regId === x.regId ? tied[1] : tied[0];
        const vs = x.opponents.get(other.regId) || { wins: 0, losses: 0 };
        const vs2 = other.opponents.get(x.regId) || { wins: 0, losses: 0 };
        const diff = (vs.wins - vs.losses) - (vs2.wins - vs2.losses);
        if (diff !== 0) return -diff; // if x has better h2h, x should come first
      }
      // then setsDiff, then pointsDiff, then pointsFor
      if (y.setsDiff !== x.setsDiff) return y.setsDiff - x.setsDiff;
      if (y.pointsDiff !== x.pointsDiff) return y.pointsDiff - x.pointsDiff;
      if (y.pointsFor !== x.pointsFor) return y.pointsFor - x.pointsFor;
      // final stable tie-breaker by regId to avoid random jitter
      return x.regId.localeCompare(y.regId);
    });

    const n = Math.max(1, topPerGroup);
    for (let i = 0; i < Math.min(n, rows.length); i++) {
      qualifiers.push({ regId: rows[i].regId, from: { groupId: gid, rank: i + 1 } });
      if (limit > 0 && qualifiers.length >= limit) break;
    }
    if (limit > 0 && qualifiers.length >= limit) break;
  }

  return { qualifiers, meta: { groups: byGroup.size, topPerGroup } };
}

/** Assign seeds & basic ordering. Extend here to support protected draws, etc. */
export async function buildSeeding({ qualifiers, seedMethod = "rating", tournamentId, session }) {
  // Fetch registrations w/ score for sorting if needed
  const ids = [...new Set(qualifiers.map(q => q.regId))];
  const regs = await Registration.find({ _id: { $in: ids } })
    .select("_id player1.score player2.score")
    .session(session || null)
    .lean();
  const scoreOf = (reg) => (reg?.player1?.score || 0) + (reg?.player2?.score || 0);
  const regMap = new Map(regs.map((r) => [String(r._id), r]));

  let seeded = ids.map((id) => ({ regId: id, seedScore: scoreOf(regMap.get(id)) }));

  if (seedMethod === "rating" || seedMethod === "tiered") {
    seeded.sort(seedCompare);
  } else if (seedMethod === "random") {
    for (let i = seeded.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seeded[i], seeded[j]] = [seeded[j], seeded[i]];
    }
  }
  // TODO: implement protected draws (clubs, regions, etc.) if needed

  // assign seed number
  seeded = seeded.map((x, idx) => ({ ...x, seed: idx + 1 }));
  return seeded;
}

/** Create round 1 matches in target bracket using a seeding/pairing strategy */
export async function createRound1Matches({ targetBracket, entrants, pairing = "standard", session }) {
  if (!Array.isArray(entrants) || entrants.length < 2) throw new Error("Not enough entrants to create matches");
  const pairs = [];
  const N = entrants.length;

  // standard KO pairing: 1 vs N, 2 vs N-1, ...
  if (pairing === "standard") {
    for (let i = 0; i < N / 2; i++) {
      const A = entrants[i];
      const B = entrants[N - 1 - i];
      pairs.push([A, B]);
    }
  } else if (pairing === "snake") {
    // snake seeding: (1 v 2N), (2 v 2N-1), then reverse etc.
    const left = entrants.slice(0, N / 2);
    const right = entrants.slice(N / 2).reverse();
    for (let i = 0; i < left.length; i++) pairs.push([left[i], right[i]]);
  } else {
    throw new Error(`Unsupported pairing: ${pairing}`);
  }

  let created = 0;
  const rules = targetBracket?.config?.rules || { bestOf: 3, pointsToWin: 11, winByTwo: true };

  for (let i = 0; i < pairs.length; i++) {
    const [A, B] = pairs[i];
    await Match.create([
      {
        tournament: targetBracket.tournament,
        bracket: targetBracket._id,
        format: targetBracket.type,
        round: 1,
        order: i + 1,
        rules,
        pairA: new mongoose.Types.ObjectId(A.regId),
        pairB: new mongoose.Types.ObjectId(B.regId),
        status: "scheduled",
      },
    ], { session });
    created++;
  }
  return { matchesCreated: created };
}

// ==================


// =============================
// server registration snippet
// =============================
// In your main server file (e.g., server.js / app.js):
// import progressionRoutes from "./routes/progressionRoutes.js";
// app.use("/api", progressionRoutes);
