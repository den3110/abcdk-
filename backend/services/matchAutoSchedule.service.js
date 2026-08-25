// Tự động tính giờ bắt đầu (scheduledAt) cho toàn bộ trận của 1 giải.
//
// Ý tưởng: xếp trận lần lượt vào N sân theo kiểu "sân nào rảnh sớm nhất nhận
// trận kế tiếp". Với N sân + các trận cùng thời lượng, N trận đầu khởi động
// cùng lúc (7h), N trận sau nối tiếp… đúng như mong đợi của BTC. Tôn trọng
// phụ thuộc vòng loại (previousA/previousB phải kết thúc trước).
//
// Thời lượng 1 trận = phút/set (theo pointsToWin) × số set cần thắng (bestOf)
//   11 → 10', 15 → 15', 21 → 20'   (mặc định 15' nếu lạ)
//   bestOf 1 → ×1, 3 → ×2, 5 → ×3
// Giữa 2 trận cùng sân cộng thêm TURNOVER_BUFFER_MIN phút nghỉ/chuyển sân.
import { DateTime } from "luxon";
import Match from "../models/matchModel.js";
import Bracket from "../models/bracketModel.js";
import Court from "../models/courtModel.js";
import Tournament from "../models/tournamentModel.js";

const PER_SET_MINUTES = { 11: 10, 15: 15, 21: 20 };
const DEFAULT_SET_MINUTES = 15;
const TURNOVER_BUFFER_MIN = 5; // nghỉ/chuyển sân giữa 2 trận cùng sân
const START_HOUR = 7; // bắt đầu 7h sáng ngày khai mạc

function gamesToWin(bestOf) {
  const b = Number(bestOf) || 1;
  if (b >= 5) return 3;
  if (b >= 3) return 2;
  return 1;
}

function matchPlayMinutes(m) {
  const pts = Number(m?.rules?.pointsToWin) || 11;
  const perSet = PER_SET_MINUTES[pts] || DEFAULT_SET_MINUTES;
  return perSet * gamesToWin(m?.rules?.bestOf);
}

/**
 * @param {string} tournamentId
 * @param {{ courts?: number }} [opts] courts: ép số sân (khi giải chưa tạo Court)
 * @returns {Promise<{updated:number, courtCount:number, baseStart:Date, lastEnd:Date|null}>}
 */
export async function autoScheduleTournament(tournamentId, opts = {}) {
  const tour = await Tournament.findById(tournamentId)
    .select("startDate startAt timezone")
    .lean();
  if (!tour) {
    const e = new Error("Tournament not found");
    e.status = 404;
    throw e;
  }
  const tz = tour.timezone || "Asia/Ho_Chi_Minh";

  // Số sân: ưu tiên override, nếu không thì đếm Court active của giải.
  let courtCount =
    Number(opts.courts) > 0 ? Math.floor(Number(opts.courts)) : 0;
  if (!courtCount) {
    courtCount = await Court.countDocuments({
      tournament: tournamentId,
      isActive: { $ne: false },
    });
  }
  if (!courtCount) {
    const e = new Error("Giải chưa có sân — vui lòng nhập số sân.");
    e.code = "NO_COURTS";
    e.status = 400;
    throw e;
  }

  const brackets = await Bracket.find({ tournament: tournamentId })
    .select("_id stage order")
    .lean();
  const bOrder = new Map(
    brackets.map((b) => [
      String(b._id),
      { stage: Number(b.stage) || 0, order: Number(b.order) || 0 },
    ]),
  );

  // Chỉ xếp các trận chưa đá (không đụng trận đang live / đã xong).
  const matches = await Match.find({
    tournament: tournamentId,
    status: { $nin: ["finished", "live"] },
  })
    .select("_id bracket round rrRound order previousA previousB rules")
    .lean();

  if (!matches.length) {
    return { updated: 0, courtCount, baseStart: null, lastEnd: null };
  }

  // Thứ tự thi đấu: vòng bảng (stage nhỏ) trước KO; trong bracket theo round, order.
  matches.sort((a, b) => {
    const ba = bOrder.get(String(a.bracket)) || { stage: 0, order: 0 };
    const bb = bOrder.get(String(b.bracket)) || { stage: 0, order: 0 };
    return (
      ba.stage - bb.stage ||
      ba.order - bb.order ||
      (a.round || 0) - (b.round || 0) ||
      (a.rrRound || 0) - (b.rrRound || 0) ||
      (a.order || 0) - (b.order || 0)
    );
  });

  const baseDt = (
    tour.startDate
      ? DateTime.fromJSDate(new Date(tour.startDate))
      : DateTime.now()
  )
    .setZone(tz)
    .set({ hour: START_HOUR, minute: 0, second: 0, millisecond: 0 });
  const baseMs = baseDt.toMillis();

  const courtFreeAt = new Array(courtCount).fill(baseMs);
  const endMsById = new Map();
  const ops = [];
  let lastEnd = baseMs;

  for (const m of matches) {
    const playMs = matchPlayMinutes(m) * 60000;

    // Trận phụ thuộc: chỉ bắt đầu khi cả 2 feeder kết thúc.
    let depReady = baseMs;
    for (const p of [m.previousA, m.previousB]) {
      if (p && endMsById.has(String(p))) {
        depReady = Math.max(depReady, endMsById.get(String(p)));
      }
    }

    // Chọn sân rảnh sớm nhất.
    let ci = 0;
    for (let i = 1; i < courtCount; i++) {
      if (courtFreeAt[i] < courtFreeAt[ci]) ci = i;
    }

    const start = Math.max(depReady, courtFreeAt[ci]);
    const end = start + playMs;
    courtFreeAt[ci] = end + TURNOVER_BUFFER_MIN * 60000;
    endMsById.set(String(m._id), end);
    if (end > lastEnd) lastEnd = end;

    ops.push({
      updateOne: {
        filter: { _id: m._id },
        update: { $set: { scheduledAt: new Date(start) } },
      },
    });
  }

  if (ops.length) await Match.bulkWrite(ops, { ordered: false });

  return {
    updated: ops.length,
    courtCount,
    baseStart: new Date(baseMs),
    lastEnd: new Date(lastEnd),
  };
}

export default autoScheduleTournament;
