// services/mlpPoolService.js
// Helpers cho MLP group stage: pool key hoá, phân phối đội vào bảng,
// commit/reset draft. Không đụng dual matches — chỉ update MlpTeam.poolKey.

import mongoose from "mongoose";
import MlpTeam from "../models/mlpTeamModel.js";

// A, B, ..., Z, AA, AB, ...
export function poolKeyFromIndex(idx) {
  if (!Number.isFinite(idx) || idx < 0) return null;
  let n = idx;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// Fisher–Yates shuffle in-place (không dùng Math.random trực tiếp để dễ test).
export function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Chia đều n đội vào k bảng, cho phép bảng lệch. Trả về mảng
 * [{teamId, poolIndex, poolKey, seed}].
 *
 * Distribution: round-robin (deal card kiểu chia bài) — team i vào pool i % k.
 * seed trong bảng = số lần đội đã "được chia" đến pool đó (1-based).
 */
export function distributeRoundRobin(teamIds, poolCount) {
  const assignments = [];
  const seedCounter = new Array(poolCount).fill(0);
  for (let i = 0; i < teamIds.length; i++) {
    const poolIndex = i % poolCount;
    seedCounter[poolIndex] += 1;
    assignments.push({
      teamId: String(teamIds[i]),
      poolIndex,
      poolKey: poolKeyFromIndex(poolIndex),
      seed: seedCounter[poolIndex],
    });
  }
  return assignments;
}

/**
 * Snake seed distribution — đội mạnh trải đều theo hình rắn.
 * Input teamIds đã sort theo strength giảm dần (client tự sort hoặc BE
 * sort theo team.standing.wins/rating).
 *
 * Pattern: (poolCount=4) A1,B1,C1,D1, D2,C2,B2,A2, A3,B3,C3,D3, D4,C4,B4,A4...
 */
export function distributeSnake(teamIds, poolCount) {
  const assignments = [];
  const seedCounter = new Array(poolCount).fill(0);
  for (let i = 0; i < teamIds.length; i++) {
    const row = Math.floor(i / poolCount);
    const col = i % poolCount;
    const poolIndex = row % 2 === 0 ? col : poolCount - 1 - col;
    seedCounter[poolIndex] += 1;
    assignments.push({
      teamId: String(teamIds[i]),
      poolIndex,
      poolKey: poolKeyFromIndex(poolIndex),
      seed: seedCounter[poolIndex],
    });
  }
  return assignments;
}

/**
 * Áp dụng assignments (từ distribute* hoặc manual client) vào DB.
 * assignments: [{teamId, poolIndex, poolKey, seed}]
 * clearOthers: true → những team không có trong assignments sẽ được clear
 * poolKey về null (dùng khi draw lại toàn bộ).
 */
export async function applyPoolAssignments(
  tournamentId,
  assignments,
  { clearOthers = true } = {},
) {
  if (!mongoose.isValidObjectId(tournamentId)) return { updated: 0, cleared: 0 };
  const ops = [];
  const touched = new Set();
  for (const a of assignments || []) {
    if (!mongoose.isValidObjectId(a.teamId)) continue;
    const poolIndex = Number.isFinite(a.poolIndex) ? Number(a.poolIndex) : null;
    const poolKey =
      typeof a.poolKey === "string" && a.poolKey
        ? a.poolKey
        : poolKeyFromIndex(poolIndex);
    const seed = Number.isFinite(a.seed) ? Number(a.seed) : null;
    ops.push({
      updateOne: {
        filter: { _id: a.teamId, tournament: tournamentId },
        update: { $set: { poolKey, poolIndex, seed } },
      },
    });
    touched.add(String(a.teamId));
  }
  let cleared = 0;
  if (clearOthers) {
    const res = await MlpTeam.updateMany(
      {
        tournament: tournamentId,
        _id: { $nin: [...touched] },
        poolKey: { $ne: null },
      },
      { $set: { poolKey: null, poolIndex: null, seed: null } },
    );
    cleared = res.modifiedCount || 0;
  }
  let updated = 0;
  if (ops.length) {
    const r = await MlpTeam.bulkWrite(ops);
    updated = r.modifiedCount || r.matchedCount || 0;
  }
  return { updated, cleared };
}

/**
 * Xoá toàn bộ pool assignment của giải.
 */
export async function resetPoolAssignments(tournamentId) {
  if (!mongoose.isValidObjectId(tournamentId)) return 0;
  const res = await MlpTeam.updateMany(
    { tournament: tournamentId, poolKey: { $ne: null } },
    { $set: { poolKey: null, poolIndex: null, seed: null } },
  );
  return res.modifiedCount || 0;
}

/**
 * Lấy các đội đã chia bảng và nhóm theo poolKey.
 * Trả về mảng [{key, index, teams: [MlpTeam]}] sort theo poolIndex.
 */
export async function listPools(tournamentId, { includeUnassigned = true } = {}) {
  const teams = await MlpTeam.find({
    tournament: tournamentId,
    status: "approved",
  })
    .select("_id name shortName logo color captain poolKey poolIndex seed standing")
    .populate("captain", "_id name nickname avatar")
    .sort({ poolIndex: 1, seed: 1, name: 1 })
    .lean();
  const map = new Map();
  const unassigned = [];
  for (const t of teams) {
    if (t.poolKey == null || t.poolIndex == null) {
      unassigned.push(t);
      continue;
    }
    const key = t.poolKey;
    if (!map.has(key)) {
      map.set(key, { key, index: t.poolIndex, teams: [] });
    }
    map.get(key).teams.push(t);
  }
  const pools = [...map.values()].sort((a, b) => a.index - b.index);
  return includeUnassigned ? { pools, unassigned } : { pools };
}
