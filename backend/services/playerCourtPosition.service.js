// services/playerCourtPosition.service.js
// Thống kê VỊ TRÍ SỞ TRƯỜNG (ô 1 / ô 2) của VĐV trong đánh đôi.
// ĐỊNH NGHĨA: ô 1 = vị trí giao/trả giao ở ĐIỂM ĐẦU TIÊN của VÁN ĐẦU (0-0-2),
// tức người đứng ô chẵn/bên phải lúc 0-0 (chính là baseSlot=1 khi mở màn).
// Lineup có thể đổi giữa các ván, nên KHÔNG dùng match.slots.base hiện tại mà dựng
// lại "base MỞ MÀN" từ liveLog: base ngay trước quả giao đầu tiên.
import Match from "../models/matchModel.js";

/** Base lúc MỞ MÀN (trước quả giao đầu tiên của ván 1). Trả { A:{uid:1|2}, B:{...} } hoặc null. */
function openingBaseOfMatch(m) {
  let base = null;
  for (const e of Array.isArray(m?.liveLog) ? m.liveLog : []) {
    const t = String(e?.type || "");
    if (t === "slots" && e?.payload?.nextBase) {
      base = e.payload.nextBase; // lineup trọng tài đặt (lần gần nhất trước quả giao đầu)
    } else if (t === "serve" || t === "point") {
      // Đã tới quả giao / điểm đầu tiên → chốt base mở màn.
      if (base) return base;
      break;
    }
  }
  // Không có slots trước quả giao đầu → fallback base đầu tiên từng ghi, hoặc base hiện tại.
  if (base) return base;
  const firstSlots = (Array.isArray(m?.liveLog) ? m.liveLog : []).find(
    (e) => String(e?.type) === "slots" && e?.payload?.nextBase,
  );
  return firstSlots?.payload?.nextBase || m?.slots?.base || null;
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
