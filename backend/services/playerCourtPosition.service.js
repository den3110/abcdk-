// services/playerCourtPosition.service.js
// Thống kê VỊ TRÍ SỞ TRƯỜNG (ô 1 / ô 2) của VĐV trong đánh đôi.
// ĐỊNH NGHĨA: ô 1 = vị trí giao/trả giao ở ĐIỂM ĐẦU TIÊN của VÁN ĐẦU (0-0-2),
// tức người đứng ô chẵn/bên phải lúc 0-0 (chính là baseSlot=1 khi mở màn).
// Lineup có thể đổi giữa các ván, nên KHÔNG dùng match.slots.base hiện tại mà dựng
// lại "base MỞ MÀN" từ liveLog: base ngay trước quả giao đầu tiên.
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import PlayerCourtPosition from "../models/playerCourtPositionModel.js";

/** Base lúc MỞ MÀN ván 1 = lineup trọng tài CHỐT khi trận bắt đầu.
 *  LƯU Ý: trước khi bấm "start", trọng tài hay test giao bóng + chỉnh lineup (slots)
 *  nhiều lần → KHÔNG lấy ở quả giao đầu, mà lấy base ngay trước ĐIỂM đầu tiên
 *  (fallback: trước "start"). liveLog sắp theo thời gian `at`. */
function openingBaseOfMatch(m) {
  const log = (Array.isArray(m?.liveLog) ? m.liveLog : [])
    .filter((e) => e && e.at)
    .map((e) => ({ ...e, _t: new Date(e.at).getTime() }))
    .filter((e) => Number.isFinite(e._t))
    .sort((a, b) => a._t - b._t);

  // Mốc "mở màn" = điểm đầu tiên (rally thật đầu tiên); fallback: sự kiện "start".
  const firstPoint = log.find((e) => e.type === "point");
  const startEv = log.find((e) => e.type === "start");
  const tOpen = firstPoint?._t ?? startEv?._t ?? null;

  let base = null;
  for (const e of log) {
    if (tOpen != null && e._t > tOpen) break;
    if (e.type === "slots" && e.payload?.nextBase) base = e.payload.nextBase;
  }
  if (base) return base;

  // Không có slots trước mốc mở màn → base mặc định (lineup chưa chỉnh) = base hiện tại,
  // hoặc slots event đầu tiên nếu có.
  if (m?.slots?.base) return m.slots.base;
  const firstSlots = log.find(
    (e) => e.type === "slots" && e.payload?.nextBase,
  );
  return firstSlots?.payload?.nextBase || null;
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
  for (const m of matches) {
    const base = openingBaseOfMatch(m) || {};
    const bA = base.A || {};
    const bB = base.B || {};
    for (const id of ids) {
      const slot = Number(bA[id] ?? bB[id]);
      if (slot === 1) {
        result[id].slot1 += 1;
        result[id].total += 1;
      } else if (slot === 2) {
        result[id].slot2 += 1;
        result[id].total += 1;
      }
    }
  }

  for (const id of ids) {
    const r = result[id];
    if (r.total > 0) {
      r.preferred = r.slot1 === r.slot2 ? null : r.slot1 > r.slot2 ? 1 : 2;
      const max = Math.max(r.slot1, r.slot2);
      r.preferredPct = Math.round((max / r.total) * 100);
    }
  }
  return result;
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
    const base = openingBaseOfMatch(m);
    if (!base) continue;
    for (const side of ["A", "B"]) {
      const map = base[side] || {};
      for (const [uid, slot] of Object.entries(map)) {
        const s = Number(slot);
        if (s !== 1 && s !== 2) continue;
        if (!mongoose.isValidObjectId(uid)) continue;
        if (!tally.has(uid)) tally.set(uid, { slot1: 0, slot2: 0 });
        const t = tally.get(uid);
        if (s === 1) t.slot1 += 1;
        else t.slot2 += 1;
      }
    }
  }

  const now = new Date();
  const ops = [];
  for (const [uid, t] of tally) {
    const total = t.slot1 + t.slot2;
    const preferred = t.slot1 === t.slot2 ? null : t.slot1 > t.slot2 ? 1 : 2;
    const preferredPct = total > 0 ? Math.round((Math.max(t.slot1, t.slot2) / total) * 100) : 0;
    ops.push({
      updateOne: {
        filter: { user: new mongoose.Types.ObjectId(uid) },
        update: {
          $set: {
            user: new mongoose.Types.ObjectId(uid),
            slot1: t.slot1,
            slot2: t.slot2,
            total,
            preferred,
            preferredPct,
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
