// services/playerCourtPosition.service.js
// Thống kê VỊ TRÍ SỞ TRƯỜNG (ô 1 / ô 2) của VĐV trong đánh đôi.
// Dữ liệu gốc đã được trọng tài ghi sẵn trên mỗi trận: match.slots.base.{A,B}[userId] = 1|2
// (ô 1 = sân chẵn/bên phải khi điểm chẵn; ô 2 = bên còn lại). Hàm dưới gom lại
// theo từng VĐV để biết họ hay đứng ô nào → phục vụ phân tích/hiển thị sau này.
import Match from "../models/matchModel.js";

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

  const matches = await Match.find(filter).select("slots.base").lean();
  for (const m of matches) {
    const bA = m?.slots?.base?.A || {};
    const bB = m?.slots?.base?.B || {};
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
