// =================================
// services/progressionService.js
// =================================
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import { seedCompare } from "../utils/sorters.js";
import mongoose from "mongoose";

/** Compute winners of a specifice round from a KO-like bracket */
export async function computeQualifiersFromKO({
  sourceBracketId,
  round,
  limit = 0,
  session,
}) {
  const matches = await Match.find({
    bracket: sourceBracketId,
    round,
    status: "finished",
    winner: { $in: ["A", "B"] },
  })
    .select("pairA pairB winner order round pool.id")
    .sort({ order: 1 })
    .session(session || null)
    .lean();

  const qualifiers = [];
  for (const m of matches) {
    const regId = m.winner === "A" ? m.pairA : m.pairB;
    if (regId)
      qualifiers.push({
        regId: String(regId),
        from: { matchId: String(m._id), round: m.round },
      });
    if (limit > 0 && qualifiers.length >= limit) break;
  }
  return { qualifiers, meta: { round, matchCount: matches.length } };
}

/** Compute top N from each group in a group/round-robin style bracket */

export async function computeQualifiersFromGroups({
  sourceBracketId,
  topPerGroup = 1,
  limit = 0,
  session,
}) {
  const bracket = await Bracket.findById(sourceBracketId)
    .select("groups config type")
    .session(session || null)
    .lean();
  if (!bracket) throw new Error("Source bracket not found");

  // 🛠 CHANGED: đọc điểm win/loss từ config, mặc định win=1, loss=0
  const ptsWin = bracket?.config?.roundRobin?.points?.win ?? 1;
  const ptsLoss = bracket?.config?.roundRobin?.points?.loss ?? 0;

  // 🛠 CHANGED: đọc tiebreakers từ config (nếu có), có thể gồm: h2h, setsDiff, pointsDiff, pointsFor, wins
  const tiebreakers =
    Array.isArray(bracket?.config?.roundRobin?.tiebreakers) &&
    bracket.config.roundRobin.tiebreakers.length
      ? bracket.config.roundRobin.tiebreakers
      : ["h2h", "setsDiff", "pointsDiff", "pointsFor"]; // ⭐ ADDED default

  // Lấy tất cả trận đã kết thúc trong bracket nguồn
  const matches = await Match.find({
    bracket: sourceBracketId,
    status: "finished",
  })
    .select("pairA pairB winner gameScores pool.id pool.name")
    .session(session || null)
    .lean();

  // Gom theo nhóm: groupId -> (regId -> stats)
  const byGroup = new Map();

  for (const m of matches) {
    if (!m?.pool?.id || !m.pairA || !m.pairB || !m.winner) continue;

    const gid = String(m.pool.id);
    if (!byGroup.has(gid)) byGroup.set(gid, new Map());
    const g = byGroup.get(gid);

    const init = (id) => {
      if (!g.has(id)) {
        g.set(id, {
          regId: id,
          played: 0,
          wins: 0,
          losses: 0,
          setsFor: 0,
          setsAgainst: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          opponents: new Map(), // regId -> { wins, losses }
        });
      }
      return g.get(id);
    };

    const aId = String(m.pairA);
    const bId = String(m.pairB);
    const A = init(aId);
    const B = init(bId);

    A.played++;
    B.played++;

    // thắng/thua
    if (m.winner === "A") {
      A.wins++;
      B.losses++;
    } else if (m.winner === "B") {
      B.wins++;
      A.losses++;
    }

    // cộng điểm/sets từ gameScores
    for (const gs of m.gameScores || []) {
      const pa = typeof gs?.a === "number" ? gs.a : 0;
      const pb = typeof gs?.b === "number" ? gs.b : 0;

      A.pointsFor += pa;
      A.pointsAgainst += pb;
      B.pointsFor += pb;
      B.pointsAgainst += pa;

      if (pa > pb) {
        A.setsFor++;
        B.setsAgainst++;
      } else if (pb > pa) {
        B.setsFor++;
        A.setsAgainst++;
      }
    }

    // head-to-head đơn giản (chỉ lưu record)
    const oppA = A.opponents.get(bId) || { wins: 0, losses: 0 };
    const oppB = B.opponents.get(aId) || { wins: 0, losses: 0 };
    if (m.winner === "A") {
      oppA.wins++;
      oppB.losses++;
    } else if (m.winner === "B") {
      oppB.wins++;
      oppA.losses++;
    }
    A.opponents.set(bId, oppA);
    B.opponents.set(aId, oppB);
  }

  // 🛠 CHANGED: thứ tự nhóm theo bracket.groups để ổn định; fallback theo thứ tự xuất hiện
  const declared = (bracket?.groups || []).map((g) => String(g._id));
  const present = new Set(Array.from(byGroup.keys()));
  const groupOrder = [
    ...declared.filter((id) => present.has(id)),
    ...Array.from(present).filter((id) => !declared.includes(id)),
  ];

  // comparator xếp hạng trong từng nhóm
  const cmp = (x, y, rowsAtSameGroup) => {
    // 1) Điểm tổng (từ wins/losses theo ptsWin/ptsLoss)
    if (y.points !== x.points) return y.points - x.points;

    // 2) Áp dụng tiebreakers theo config (⭐ ADDED)
    for (const tb of tiebreakers) {
      if (tb === "h2h") {
        // chỉ áp dụng khi đúng 2 đội đang đồng điểm
        const tied = rowsAtSameGroup.filter((r) => r.points === x.points);
        if (
          tied.length === 2 &&
          (tied[0].regId === x.regId || tied[1].regId === x.regId)
        ) {
          const other = tied[0].regId === x.regId ? tied[1] : tied[0];
          const vs = x.opponents.get(other.regId) || { wins: 0, losses: 0 };
          const vs2 = other.opponents.get(x.regId) || { wins: 0, losses: 0 };
          const diff = vs.wins - vs.losses - (vs2.wins - vs2.losses);
          if (diff !== 0) return -diff; // x tốt hơn h2h -> x trước
        }
      } else if (tb === "setsDiff") {
        if (y.setsDiff !== x.setsDiff) return y.setsDiff - x.setsDiff;
      } else if (tb === "pointsDiff") {
        if (y.pointsDiff !== x.pointsDiff) return y.pointsDiff - x.pointsDiff;
      } else if (tb === "pointsFor") {
        if (y.pointsFor !== x.pointsFor) return y.pointsFor - x.pointsFor;
      } else if (tb === "wins") {
        if (y.wins !== x.wins) return y.wins - x.wins;
      }
      // (bỏ qua key không hỗ trợ)
    }

    // 3) chốt ổn định cuối cùng
    return String(x.regId).localeCompare(String(y.regId));
  };

  const qualifiers = [];

  for (const gid of groupOrder) {
    const gmap = byGroup.get(gid);
    if (!gmap || gmap.size === 0) continue;

    // tính các cột phụ trợ
    const rows = Array.from(gmap.values()).map((s) => ({
      ...s,
      points: s.wins * ptsWin + s.losses * ptsLoss,
      setsDiff: s.setsFor - s.setsAgainst,
      pointsDiff: s.pointsFor - s.pointsAgainst,
    }));

    // sort theo comparator
    rows.sort((x, y) => cmp(x, y, rows));

    // 🛠 CHANGED: nhóm có đúng 2 đội -> lấy cả 2; còn lại theo topPerGroup (>=1)
    const desired = rows.length === 2 ? 2 : Math.max(1, topPerGroup); // ⭐ ADDED

    for (let i = 0; i < Math.min(desired, rows.length); i++) {
      qualifiers.push({
        regId: rows[i].regId,
        from: { groupId: gid, rank: i + 1 },
      });
      if (limit > 0 && qualifiers.length >= limit) break;
    }
    if (limit > 0 && qualifiers.length >= limit) break;
  }

  return {
    qualifiers,
    meta: { groups: groupOrder.length, topPerGroup },
  };
}

/** Assign seeds & basic ordering. Extend here to support protected draws, etc. */
// 🛠 CHANGED: viết lại đầy đủ, không phụ thuộc seedCompare bên ngoài
export async function buildSeeding({
  qualifiers,
  seedMethod = "rating",
  tournamentId, // hiện chưa dùng, giữ để mở rộng protected draw theo giải
  session,
}) {
  // Chuẩn hoá & loại trùng theo thứ tự xuất hiện
  // ví dụ qualifiers: [{ regId, from: {...} }, ...]
  const uniqueIds = [];
  const seen = new Set();
  for (const q of Array.isArray(qualifiers) ? qualifiers : []) {
    const id = q?.regId ? String(q.regId) : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniqueIds.push(id);
  }

  if (uniqueIds.length === 0) return [];

  // Lấy thông tin Registration để tính điểm/tier
  // ⭐ ADDED: chọn thêm vài field "có thể có" nhưng không bắt buộc (tier…)
  const regs = await Registration.find({ _id: { $in: uniqueIds } })
    .select("_id player1.score player2.score player1.tier player2.tier tier")
    .session(session || null)
    .lean();

  const regMap = new Map(regs.map((r) => [String(r._id), r]));

  // Helpers: tính score & tier (nếu có)
  const scoreOf = (reg) => {
    if (!reg) return 0;
    const s1 = Number(reg?.player1?.score) || 0;
    const s2 = Number(reg?.player2?.score) || 0;
    return s1 + s2;
  };

  // Tier nhỏ hơn = mạnh hơn (ưu tiên xếp trước). Không có tier → +∞
  const tierOf = (reg) => {
    if (!reg) return Number.POSITIVE_INFINITY;
    if (typeof reg?.tier === "number") return reg.tier;
    const t1 =
      typeof reg?.player1?.tier === "number"
        ? reg.player1.tier
        : Number.POSITIVE_INFINITY;
    const t2 =
      typeof reg?.player2?.tier === "number"
        ? reg.player2.tier
        : Number.POSITIVE_INFINITY;
    return Math.min(t1, t2);
  };

  // Tạo mảng seeding thô
  let seeded = uniqueIds.map((id) => {
    const reg = regMap.get(id);
    return {
      regId: id,
      seedScore: scoreOf(reg), // dùng cho "rating"/"tiered" tie-break
      seedTier: tierOf(reg), // dùng cho "tiered"
    };
  });

  // Comparator mặc định theo "rating": seedScore desc, rồi regId asc để ổn định
  const cmpRating = (a, b) => {
    if (b.seedScore !== a.seedScore) return b.seedScore - a.seedScore;
    return String(a.regId).localeCompare(String(b.regId));
  };

  // Comparator cho "tiered": tier asc, rồi rating desc, rồi regId asc
  const cmpTiered = (a, b) => {
    if (a.seedTier !== b.seedTier) return a.seedTier - b.seedTier;
    if (b.seedScore !== a.seedScore) return b.seedScore - a.seedScore;
    return String(a.regId).localeCompare(String(b.regId));
  };

  // Shuffle Fisher–Yates
  const shuffleInPlace = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  // Áp dụng phương pháp seeding
  switch (String(seedMethod || "rating").toLowerCase()) {
    case "keep":
      // ⭐ ADDED: giữ nguyên thứ tự qualifiers (dùng cho "carry bracket")
      // không sort, chỉ gán seed theo thứ tự hiện có
      break;

    case "random":
      shuffleInPlace(seeded);
      break;

    case "tiered":
      // Nếu không có tier thực, logic này sẽ rơi về giống "rating" nhờ tie-break seedScore
      seeded.sort(cmpTiered);
      break;

    case "rating":
    default:
      seeded.sort(cmpRating);
      break;
  }

  // Gán số hạt giống 1..N
  seeded = seeded.map((x, idx) => ({
    ...x,
    seed: idx + 1,
  }));

  // TODO (tuỳ chọn tương lai):
  // - Protected draw (tránh cùng CLB/vùng/seedTier gặp sớm)
  // - Bốc thăm nhóm hạt giống (seed banding) thay vì sort cứng

  return seeded;
}

/** Create round 1 matches in target bracket using a seeding/pairing strategy */
export async function createRound1Matches({
  targetBracket,
  entrants,
  pairing = "standard",
  session,
}) {
  if (!targetBracket || !targetBracket._id) {
    throw new Error("targetBracket is required");
  }
  if (!Array.isArray(entrants) || entrants.length < 2) {
    throw new Error("Not enough entrants to create matches");
  }

  // Kiểm tra trùng/chẵn
  const ids = entrants.map((e) => String(e?.regId || ""));
  const seen = new Set();
  for (const id of ids) {
    if (!id) throw new Error("Entrant missing regId");
    if (seen.has(id)) throw new Error(`Duplicated entrant regId: ${id}`);
    seen.add(id);
  }
  if (ids.length % 2 !== 0) {
    throw new Error(`Entrants must be even. Got ${ids.length}`);
  }

  const N = entrants.length;
  const pairs = [];

  const byOrder = (arr) => {
    for (let i = 0; i < arr.length; i += 2) {
      const A = arr[i];
      const B = arr[i + 1];
      if (!B) throw new Error("Odd number of entrants for by_order/adjacent");
      pairs.push([A, B]);
    }
  };

  const shuffleInPlace = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  switch (String(pairing || "standard").toLowerCase()) {
    case "standard":
      for (let i = 0; i < N / 2; i++) {
        pairs.push([entrants[i], entrants[N - 1 - i]]);
      }
      break;
    case "snake":
      // R1 của snake ≈ standard
      for (let i = 0; i < N / 2; i++) {
        pairs.push([entrants[i], entrants[N - 1 - i]]);
      }
      break;
    case "adjacent":
      byOrder(entrants);
      break;
    case "cross":
      for (let i = 0; i < N / 2; i++) {
        pairs.push([entrants[i], entrants[i + N / 2]]);
      }
      break;
    case "by_order":
      byOrder(entrants);
      break;
    case "random":
      {
        const arr = [...entrants];
        shuffleInPlace(arr);
        byOrder(arr);
      }
      break;
    default:
      throw new Error(`Unsupported pairing: ${pairing}`);
  }

  const rules = targetBracket?.config?.rules || {
    bestOf: 3,
    pointsToWin: 11,
    winByTwo: true,
  };

  let created = 0;
  for (let i = 0; i < pairs.length; i++) {
    const [A, B] = pairs[i];
    await Match.create(
      [
        {
          tournament: targetBracket.tournament,
          bracket: targetBracket._id,
          format: targetBracket.type,
          round: 1,
          // 🛠 CHANGED: order bắt đầu từ 0 (trước đây là i + 1)
          order: i,
          rules,
          pairA: new mongoose.Types.ObjectId(String(A.regId)),
          pairB: new mongoose.Types.ObjectId(String(B.regId)),
          status: "scheduled",
        },
      ],
      { session }
    );
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
