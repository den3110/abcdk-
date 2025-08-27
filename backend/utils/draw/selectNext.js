// utils/draw/selectNext.js
import { getSkillMap } from "./skill.js";
import Match from "../../models/matchModel.js";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
function seededRand(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function getSettings(session) {
  const s = session?.settings || {};
  return {
    seed: Number(s.seed ?? Date.now()),
    randomness: Number(s.randomness ?? 0.02),
    lookahead: {
      enabled: Boolean(s?.lookahead?.enabled ?? true),
      width: Number(s?.lookahead?.width ?? 5),
    },
    constraints: {
      balanceSkillAcrossGroups:
        s?.constraints?.balanceSkillAcrossGroups !== false,
      targetGroupAvgSkill: Number(s?.constraints?.targetGroupAvgSkill ?? 0.5),
      usePots: Boolean(s?.constraints?.usePots ?? false),
      potBy: String(s?.constraints?.potBy ?? "skill"),
      potCount: Number.isFinite(s?.constraints?.potCount)
        ? Number(s?.constraints?.potCount)
        : null,
      protectTopSeeds: Number(s?.constraints?.protectTopSeeds ?? 0),
      avoidRematchWithinDays: Number(
        s?.constraints?.avoidRematchWithinDays ?? 90
      ),

      balanceSkillInPair: s?.constraints?.balanceSkillInPair !== false,
      pairTargetSkillDiff: Number(s?.constraints?.pairTargetSkillDiff ?? 0.12),
      maxRoundsSeedSeparation: Number(
        s?.constraints?.maxRoundsSeedSeparation ?? 1
      ),
    },
    weights: {
      skillAvgVariance: Number(s?.weights?.skillAvgVariance ?? 1.0),
      skillStd: Number(s?.weights?.skillStd ?? 0.6),
      potClash: Number(s?.weights?.potClash ?? 0.7),
      seedClash: Number(s?.weights?.seedClash ?? 1.2),
      rematch: Number(s?.weights?.rematch ?? 1.0),
      koSkillDiff: Number(s?.weights?.koSkillDiff ?? 0.9),
    },
    recent: { days: Number(s?.recent?.days ?? 120) },
  };
}

function groupStats(groupSlots, skillMap) {
  const ids = (groupSlots || []).filter(Boolean).map(String);
  if (!ids.length) return { avg: 0.5, std: 0, size: 0, pots: {}, topSeeds: 0 };
  let sum = 0,
    pots = {},
    topSeeds = 0;
  for (const id of ids) {
    const v = skillMap.get(id) || {};
    const sk = Number(v.skill ?? 0.5);
    sum += sk;
    const pot = v.meta?.pot ?? null;
    if (pot !== null) pots[pot] = (pots[pot] || 0) + 1;
    const seed = Number(v.meta?.seed ?? 0);
    if (seed && seed > 0) topSeeds += 1;
  }
  const avg = sum / ids.length;
  let vs = 0;
  for (const id of ids) {
    const sk = Number((skillMap.get(id) || {}).skill ?? 0.5);
    vs += (sk - avg) * (sk - avg);
  }
  const std = Math.sqrt(vs / ids.length);
  return { avg, std, size: ids.length, pots, topSeeds };
}

function assignPots(skillMap, session, gCount) {
  const st = getSettings(session);
  if (!st.constraints.usePots) return;
  const potCount = st.constraints.potCount || gCount || 4;
  const arr = [];
  for (const [id, v] of skillMap.entries()) {
    const metric =
      st.constraints.potBy === "rank"
        ? Number(v.meta?.rank ?? 0) * -1
        : Number(v.skill ?? 0);
    arr.push({ id, metric });
  }
  arr.sort((a, b) => b.metric - a.metric);
  const chunk = Math.ceil(arr.length / potCount);
  arr.forEach((o, idx) => {
    const pot = Math.min(Math.floor(idx / chunk), potCount - 1);
    const cur = skillMap.get(o.id);
    cur.meta = cur.meta || {};
    cur.meta.pot = pot;
  });
}

function ensureSeeds(skillMap, protectTopSeeds) {
  if (!protectTopSeeds || protectTopSeeds <= 0) return;
  let needAuto = 0,
    total = 0;
  for (const [, v] of skillMap.entries()) {
    total++;
    if (v?.meta?.seed == null) needAuto++;
  }
  if (needAuto / Math.max(1, total) < 0.6) return;
  const list = [...skillMap.entries()].map(([id, v]) => ({
    id,
    s: v.skill ?? 0.5,
  }));
  list.sort((a, b) => b.s - a.s);
  list.forEach((o, i) => {
    const cur = skillMap.get(o.id);
    cur.meta = cur.meta || {};
    cur.meta.seed = i + 1;
  });
}

async function getRecentOpponentsMap(regIds, days) {
  if (!days || days <= 0 || !regIds?.length) return new Map();
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const matches = await Match.find({
    status: "finished",
    updatedAt: { $gte: since },
    $or: [{ pairA: { $in: regIds } }, { pairB: { $in: regIds } }],
  })
    .select("pairA pairB updatedAt")
    .lean();

  const map = new Map();
  for (const m of matches) {
    const A = m.pairA ? String(m.pairA) : null;
    const B = m.pairB ? String(m.pairB) : null;
    if (!A || !B) continue;
    if (!map.has(A)) map.set(A, new Set());
    if (!map.has(B)) map.set(B, new Set());
    map.get(A).add(B);
    map.get(B).add(A);
  }
  return map;
}

function hardFail() {
  return Number.POSITIVE_INFINITY;
}

/** scoreCandidate: lower is better */
function scoreCandidate({
  candidateId,
  mode,
  board,
  cursor,
  skillMap,
  settings,
  aux,
}) {
  const v = skillMap.get(candidateId) || { skill: 0.5, meta: {} };
  const sk = Number(v.skill ?? 0.5);
  const pot = v.meta?.pot ?? null;
  const seed = Number(v.meta?.seed ?? 0);

  if (mode === "group") {
    const gi = cursor.gIndex;
    const g = board.groups[gi];
    const members = (g.slots || []).filter(Boolean).map(String);
    const cur = groupStats(g.slots, skillMap);

    let penalty = 0;

    // 1) Skill balancing (avg & std)
    if (settings.constraints.balanceSkillAcrossGroups) {
      const newAvg = (cur.avg * cur.size + sk) / (cur.size + 1);
      const delta = Math.abs(newAvg - settings.constraints.targetGroupAvgSkill);
      penalty += settings.weights.skillAvgVariance * delta;
      const newStdApprox = Math.abs(sk - newAvg);
      penalty += settings.weights.skillStd * newStdApprox;
    }

    // 2) Pots: trải đều theo nồi
    if (settings.constraints.usePots && pot !== null) {
      const potCount =
        settings.constraints.potCount || board.groups.length || 4;
      const curPotCount = cur.pots[pot] || 0;
      const ideal = Math.ceil((cur.size + 1) / potCount);
      if (curPotCount + 1 > ideal)
        penalty += settings.weights.potClash * (curPotCount + 1 - ideal);
    }

    // 3) Protect top seeds: hạn chế 2 top seed trong một bảng
    if (
      settings.constraints.protectTopSeeds > 0 &&
      seed > 0 &&
      seed <= settings.constraints.protectTopSeeds
    ) {
      if (cur.topSeeds > 0) penalty += settings.weights.seedClash;
    }

    // 4) Avoid rematch trong group
    if (
      settings.constraints.avoidRematchWithinDays > 0 &&
      aux.recentOpponents &&
      members.length
    ) {
      for (const m of members) {
        if (aux.recentOpponents.get(candidateId)?.has(m))
          penalty += settings.weights.rematch;
      }
    }

    return penalty;
  }

  // ===== KO
  const pi = cursor.pairIndex;
  const p = board.pairs[pi] || {};
  const rivalId = cursor.side === "A" ? p.b : p.a;

  if (!rivalId) return Math.abs(sk - 0.5) * 0.1; // dàn đều khi đặt bên đầu

  const rv = skillMap.get(String(rivalId)) || { skill: 0.5, meta: {} };
  const diff = Math.abs(sk - Number(rv.skill ?? 0.5));
  const rSeed = Number(rv.meta?.seed ?? 0);

  // Hard: tách top seeds vòng 1
  if (
    settings.constraints.maxRoundsSeedSeparation > 0 &&
    settings.constraints.protectTopSeeds > 0
  ) {
    const isTopA = seed > 0 && seed <= settings.constraints.protectTopSeeds;
    const isTopB = rSeed > 0 && rSeed <= settings.constraints.protectTopSeeds;
    if (isTopA && isTopB) return hardFail();
  }

  let penalty = 0;
  if (settings.constraints.balanceSkillInPair !== false) {
    const target = settings.constraints.pairTargetSkillDiff;
    penalty += settings.weights.koSkillDiff * Math.max(0, diff - target);
  }
  if (settings.constraints.avoidRematchWithinDays > 0 && aux.recentOpponents) {
    if (aux.recentOpponents.get(candidateId)?.has(String(rivalId)))
      penalty += settings.weights.rematch;
  }
  return penalty;
}

function oneStepLookahead(
  baseDto,
  baseScore,
  chosenId,
  skillMap,
  settings,
  aux
) {
  try {
    const dto = JSON.parse(JSON.stringify(baseDto));
    if (dto.mode === "group") {
      const gi = dto.cursor.gIndex,
        si = dto.cursor.slotIndex;
      dto.board.groups[gi].slots[si] = chosenId;
    } else {
      const pi = dto.cursor.pairIndex;
      if (dto.cursor.side === "A") dto.board.pairs[pi].a = chosenId;
      else dto.board.pairs[pi].b = chosenId;
    }
    dto.pool = dto.pool.filter((x) => String(x) !== String(chosenId));
    advanceCursor(dto);

    const K = Math.min(settings.lookahead.width, dto.pool.length);
    const candidates = dto.pool.slice(0, Math.max(1, K));
    let bestNext = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const cid = String(candidates[i]);
      const sc = scoreCandidate({
        candidateId: cid,
        mode: dto.mode,
        board: dto.board,
        cursor: dto.cursor,
        skillMap,
        settings,
        aux,
      });
      if (sc < bestNext) bestNext = sc;
    }
    if (!isFinite(bestNext)) bestNext = 0;
    return baseScore + 0.5 * bestNext;
  } catch {
    return baseScore;
  }
}

/** Chọn candidate tốt nhất (áp cho đơn & đôi) */
export async function selectNextCandidate(session) {
  const settings = getSettings(session);
  // PO → xử lý như knockout
  const mode =
    session.mode === "po" || session.mode === "playoff"
      ? "knockout"
      : session.mode;
  const { board, cursor, pool } = session;
  if (!pool?.length) return null;

  const regIds = pool.map(String);
  const skillMap = await getSkillMap(regIds, session.__eventType || "double", {
    recentDays: settings.recent.days,
  });

  // Pots & Seeds
  if (mode === "group")
    assignPots(skillMap, session, (board?.groups || []).length);
  ensureSeeds(skillMap, settings.constraints.protectTopSeeds);

  const recentOpponents =
    settings.constraints.avoidRematchWithinDays > 0
      ? await getRecentOpponentsMap(
          regIds,
          settings.constraints.avoidRematchWithinDays
        )
      : null;

  let scored = pool.map((rid) => {
    const id = String(rid);
    const base = scoreCandidate({
      candidateId: id,
      mode,
      board,
      cursor,
      skillMap,
      settings,
      aux: { recentOpponents },
    });
    return { id, s: base };
  });

  // randomness (seeded)
  const seed = settings.seed,
    noiseAmp = settings.randomness;
  scored.forEach((o, i) => {
    o.s += (seededRand(seed + i) - 0.5) * noiseAmp;
  });
  scored.sort((a, b) => a.s - b.s);

  if (settings.lookahead.enabled && scored.length > 1) {
    const width = Math.min(settings.lookahead.width, scored.length);
    const refined = [];
    for (let i = 0; i < width; i++) {
      const cand = scored[i];
      const withLA = oneStepLookahead(
        session,
        cand.s,
        cand.id,
        skillMap,
        settings,
        { recentOpponents }
      );
      refined.push({ id: cand.id, s: withLA });
    }
    refined.sort((a, b) => a.s - b.s);
    return refined[0]?.id || scored[0]?.id || null;
  }
  return scored[0]?.id || null;
}

/** Move cursor tới slot tiếp theo */
export function advanceCursor(session) {
  const isGroup = session.mode === "group";
  if (isGroup) {
    const g = session.board.groups;
    for (let gi = 0; gi < g.length; gi++) {
      for (let si = 0; si < g[gi].size; si++) {
        if (!g[gi].slots[si]) {
          session.cursor.gIndex = gi;
          session.cursor.slotIndex = si;
          return;
        }
      }
    }
    session.cursor.gIndex = g.length - 1;
    session.cursor.slotIndex = g[g.length - 1].size - 1;
    return;
  }
  const p = session.board.pairs;
  for (let pi = 0; pi < p.length; pi++) {
    if (!p[pi].a) {
      session.cursor.pairIndex = pi;
      session.cursor.side = "A";
      return;
    }
    if (!p[pi].b) {
      session.cursor.pairIndex = pi;
      session.cursor.side = "B";
      return;
    }
  }
  session.cursor.pairIndex = p.length - 1;
  session.cursor.side = "B";
}
