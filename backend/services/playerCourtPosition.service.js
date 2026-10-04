// services/playerCourtPosition.service.js
// Thống kê VỊ TRÍ SỞ TRƯỜNG (ô 1 / ô 2) của VĐV trong đánh đôi.
// ĐỊNH NGHĨA: ô 1 = vị trí GIAO bóng ở điểm đầu tiên ván 1 (0-0-2) — người giao
// luôn đứng ô chẵn/bên phải. Tín hiệu chắc chắn nhất = NGƯỜI GIAO mở màn (serverId):
//   • người giao mở màn → Ô 1
//   • đồng đội của người giao (cùng đội) → Ô 2
//   • đội ĐỠ giao: KHÔNG suy được chắc (liveLog không lưu receiverId) → BỎ QUA trận đó.
// KHÔNG dùng slots.base mặc định (hay bằng THỨ TỰ ĐĂNG KÝ p1=1/p2=2, không phải vị
// trí thật) để tránh tính sai.
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import PlayerCourtPosition from "../models/playerCourtPositionModel.js";

const MIN_SAMPLE = 3; // cần tối thiểu 3 trận xác định được mới kết luận sở trường

/** Quả GIAO mở màn của trận: ưu tiên serve có cờ opening; fallback serve đầu sau "start". */
function openingServe(m) {
  const log = (Array.isArray(m?.liveLog) ? m.liveLog : [])
    .filter((e) => e && e.at)
    .map((e) => ({ ...e, _t: new Date(e.at).getTime() }))
    .filter((e) => Number.isFinite(e._t))
    .sort((a, b) => a._t - b._t);
  const startEv = log.find((e) => e.type === "start");
  const tSt = startEv?._t ?? 0;
  let ns =
    log.find(
      (e) =>
        e.type === "serve" &&
        e.payload?.nextServe?.opening === true &&
        e.payload?.nextServe?.serverId,
    )?.payload?.nextServe ||
    log.find(
      (e) => e.type === "serve" && e._t >= tSt && e.payload?.nextServe?.serverId,
    )?.payload?.nextServe ||
    log.find((e) => e.type === "serve" && e.payload?.nextServe?.serverId)
      ?.payload?.nextServe;
  return ns || null;
}

/** Vị trí Ô 1/Ô 2 xác định CHẮC CHẮN cho 1 trận (chỉ ĐỘI GIAO mở màn).
 *  Trả { uid: 1|2 }; rỗng nếu không xác định được. */
function openingServingSlots(m) {
  const ns = openingServe(m);
  if (!ns?.serverId) return {};
  const serverId = String(ns.serverId);
  const side = ns.side === "B" ? "B" : "A";
  const team = m?.slots?.base?.[side] || {};
  const uids = Object.keys(team);
  const out = {};
  for (const u of uids) out[u] = u === serverId ? 1 : 2;
  if (!(serverId in out)) out[serverId] = 1; // đảm bảo người giao = Ô1
  return out;
}

/**
 * Gom vị trí sở trường cho 1 hoặc nhiều user.
 * @param {string[]} userIds
 * @param {{ onlyFinished?: boolean }} [opts]
 * @returns {Promise<Record<string,{slot1:number,slot2:number,total:number,preferred:1|2|null,preferredPct:number}>>}
 */
export async function getPlayerPreferredPositions(userIds = [], opts = {}) {
  const ids = [...new Set((userIds || []).map((x) => String(x || "")).filter(Boolean))];
  const result = {};
  for (const id of ids) {
    result[id] = { slot1: 0, slot2: 0, total: 0, preferred: null, preferredPct: 0 };
  }
  if (!ids.length) return result;

  const or = [];
  for (const id of ids) {
    or.push({ [`slots.base.A.${id}`]: { $in: [1, 2] } });
    or.push({ [`slots.base.B.${id}`]: { $in: [1, 2] } });
  }
  const filter = { $or: or };
  if (opts.onlyFinished) filter.status = "finished";

  const matches = await Match.find(filter).select("slots.base liveLog").lean();
  const idSet = new Set(ids);
  for (const m of matches) {
    const slots = openingServingSlots(m); // chỉ đội giao mở màn (chắc chắn)
    for (const [uid, slot] of Object.entries(slots)) {
      if (!idSet.has(uid)) continue;
      if (slot === 1) {
        result[uid].slot1 += 1;
        result[uid].total += 1;
      } else if (slot === 2) {
        result[uid].slot2 += 1;
        result[uid].total += 1;
      }
    }
  }

  for (const id of ids) finalizePositionStat(result[id]);
  return result;
}

/** Chốt preferred + % (và yêu cầu tối thiểu MIN_SAMPLE trận). */
function finalizePositionStat(r) {
  if (!r) return;
  if (r.total >= MIN_SAMPLE && r.slot1 !== r.slot2) {
    r.preferred = r.slot1 > r.slot2 ? 1 : 2;
    r.preferredPct = Math.round((Math.max(r.slot1, r.slot2) / r.total) * 100);
  } else {
    r.preferred = null;
    r.preferredPct = r.total > 0
      ? Math.round((Math.max(r.slot1, r.slot2) / r.total) * 100)
      : 0;
  }
}

/** Tiện ích cho 1 user. */
export async function getPlayerPreferredPosition(userId, opts = {}) {
  const map = await getPlayerPreferredPositions([userId], opts);
  return map[String(userId)] || {
    slot1: 0,
    slot2: 0,
    total: 0,
    preferred: null,
    preferredPct: 0,
  };
}

/** Nhãn hiển thị ngắn: "Ô 1" | "Ô 2" | "" (nếu chưa đủ dữ liệu / cân bằng). */
export function positionLabel(stat) {
  if (!stat || !stat.total || !stat.preferred) return "";
  return stat.preferred === 1 ? "Ô 1" : "Ô 2";
}

const EMPTY_POS = Object.freeze({
  slot1: 0,
  slot2: 0,
  total: 0,
  preferred: null,
  preferredPct: 0,
});

/** Đọc NHANH vị trí sở trường đã gom sẵn (collection) cho nhiều user — dùng cho
 *  bảng xếp hạng/hồ sơ/overlay. Trả { [userId]: {slot1,slot2,total,preferred,preferredPct,label} }. */
export async function getStoredPreferredPositions(userIds = []) {
  const ids = [...new Set((userIds || []).map((x) => String(x || "")).filter(Boolean))];
  const out = {};
  for (const id of ids) out[id] = { ...EMPTY_POS, label: "" };
  if (!ids.length) return out;
  const objIds = ids
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!objIds.length) return out;
  const docs = await PlayerCourtPosition.find({ user: { $in: objIds } })
    .select("user slot1 slot2 total preferred preferredPct")
    .lean();
  for (const d of docs) {
    const id = String(d.user);
    out[id] = {
      slot1: d.slot1 || 0,
      slot2: d.slot2 || 0,
      total: d.total || 0,
      preferred: d.preferred ?? null,
      preferredPct: d.preferredPct || 0,
      label: positionLabel(d),
    };
  }
  return out;
}

/** QUÉT TOÀN BỘ trận đã có lineup → gom vị trí sở trường theo từng VĐV (từ base MỞ MÀN)
 *  rồi lưu vào collection PlayerCourtPosition. Chạy 1 lần (hoặc job định kỳ). */
export async function rebuildAllPlayerCourtPositions({ onlyFinished = false } = {}) {
  const q = { "slots.base": { $exists: true, $ne: null } };
  if (onlyFinished) q.status = "finished";
  const cursor = Match.find(q).select("slots.base liveLog").lean().cursor();

  const tally = new Map(); // uid -> { slot1, slot2 }
  let scanned = 0;
  for (let m = await cursor.next(); m; m = await cursor.next()) {
    scanned += 1;
    const slots = openingServingSlots(m); // chỉ đội giao mở màn (chắc chắn)
    for (const [uid, slot] of Object.entries(slots)) {
      if (slot !== 1 && slot !== 2) continue;
      if (!mongoose.isValidObjectId(uid)) continue;
      if (!tally.has(uid)) tally.set(uid, { slot1: 0, slot2: 0 });
      const t = tally.get(uid);
      if (slot === 1) t.slot1 += 1;
      else t.slot2 += 1;
    }
  }

  const now = new Date();
  const ops = [];
  for (const [uid, t] of tally) {
    const stat = { slot1: t.slot1, slot2: t.slot2, total: t.slot1 + t.slot2 };
    finalizePositionStat(stat);
    ops.push({
      updateOne: {
        filter: { user: new mongoose.Types.ObjectId(uid) },
        update: {
          $set: {
            user: new mongoose.Types.ObjectId(uid),
            slot1: stat.slot1,
            slot2: stat.slot2,
            total: stat.total,
            preferred: stat.preferred,
            preferredPct: stat.preferredPct,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    });
  }
  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const res = await PlayerCourtPosition.bulkWrite(ops.slice(i, i + CHUNK), {
      ordered: false,
    });
    written += (res.upsertedCount || 0) + (res.modifiedCount || 0);
  }
  return { scanned, players: tally.size, written };
}
