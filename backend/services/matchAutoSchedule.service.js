// Tự động tính giờ bắt đầu (scheduledAt) cho toàn bộ trận của 1 giải.
//
// Xếp trận lần lượt vào N sân theo kiểu "sân nào rảnh sớm nhất nhận trận kế".
// Tôn trọng phụ thuộc vòng loại (previousA/previousB phải kết thúc trước).
//
// 2 chế độ:
//  - "plan" (mặc định): tính từ giờ bắt đầu trận đầu (opts.startAt →
//    tour.firstMatchStartAt → startDate lúc 7h). Dùng thời lượng ước lượng theo
//    thể thức: 11→10', 15→15', 21→20' (× số set cần thắng theo bestOf) + 5' nghỉ.
//  - "live": tính LẠI từ THỜI ĐIỂM HIỆN TẠI cho các trận chưa đá, dựa trên
//    thời lượng TRUNG BÌNH THỰC TẾ đo được từ các trận đã kết thúc (linh hoạt
//    theo tiến độ giải). Trận đang live được tính chiếm sân tới lúc dự kiến xong.
import { DateTime } from "luxon";
import Match from "../models/matchModel.js";
import Bracket from "../models/bracketModel.js";
import Court from "../models/courtModel.js";
import Tournament from "../models/tournamentModel.js";

const PER_SET_MINUTES = { 11: 10, 15: 15, 21: 20 };
const DEFAULT_SET_MINUTES = 15;
const TURNOVER_BUFFER_MIN = 5; // nghỉ/chuyển sân giữa 2 trận cùng sân
const START_HOUR = 7; // mặc định 7h nếu chưa cấu hình
const MIN_SAMPLES = 3; // số trận tối thiểu để dùng trung bình thực tế

function gamesToWin(bestOf) {
  const b = Number(bestOf) || 1;
  if (b >= 5) return 3;
  if (b >= 3) return 2;
  return 1;
}

function staticPlayMinutes(m) {
  const pts = Number(m?.rules?.pointsToWin) || 11;
  const perSet = PER_SET_MINUTES[pts] || DEFAULT_SET_MINUTES;
  return perSet * gamesToWin(m?.rules?.bestOf);
}

// Đo thời lượng trung bình thực tế (phút) của các trận đã kết thúc.
async function measureAvgDurations(tournamentId) {
  const finished = await Match.find({
    tournament: tournamentId,
    status: "finished",
    startedAt: { $ne: null },
    finishedAt: { $ne: null },
  })
    .select("rules.pointsToWin startedAt finishedAt")
    .lean();

  const byPts = {};
  let allSum = 0;
  let allN = 0;
  for (const m of finished) {
    const dur =
      (new Date(m.finishedAt).getTime() - new Date(m.startedAt).getTime()) /
      60000;
    if (!(dur > 0 && dur < 240)) continue; // loại nhiễu (âm / quá 4 tiếng)
    const pts = Number(m?.rules?.pointsToWin) || 11;
    byPts[pts] = byPts[pts] || { sum: 0, n: 0 };
    byPts[pts].sum += dur;
    byPts[pts].n += 1;
    allSum += dur;
    allN += 1;
  }
  const avgByPts = {};
  const countByPts = {};
  for (const k of Object.keys(byPts)) {
    avgByPts[k] = byPts[k].sum / byPts[k].n;
    countByPts[k] = byPts[k].n;
  }
  return {
    avgByPts,
    countByPts,
    avgAll: allN > 0 ? allSum / allN : null,
    sampleCount: allN,
  };
}

// Thời lượng dự kiến (phút) của 1 trận, ưu tiên trung bình thực tế ở chế độ live.
function playMinutes(m, mode, measured) {
  if (mode === "live" && measured) {
    const pts = Number(m?.rules?.pointsToWin) || 11;
    if ((measured.countByPts[pts] || 0) >= MIN_SAMPLES && measured.avgByPts[pts]) {
      return measured.avgByPts[pts];
    }
    if (measured.sampleCount >= MIN_SAMPLES && measured.avgAll) {
      return measured.avgAll;
    }
  }
  return staticPlayMinutes(m);
}

/**
 * @param {string} tournamentId
 * @param {{ courts?: number, startAt?: string|Date, mode?: "plan"|"live", persistStartAt?: boolean }} [opts]
 * @returns {Promise<{updated:number, courtCount:number, mode:string, baseStart:Date, lastEnd:Date|null, avgUsedMin:number|null, sampleCount:number}>}
 */
export async function autoScheduleTournament(tournamentId, opts = {}) {
  const { mode = "plan", persistStartAt = false } = opts;
  const tour = await Tournament.findById(tournamentId)
    .select("startDate startAt timezone firstMatchStartAt")
    .lean();
  if (!tour) {
    const e = new Error("Tournament not found");
    e.status = 404;
    throw e;
  }
  const tz = tour.timezone || "Asia/Ho_Chi_Minh";

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

  // Giờ mốc.
  let baseMs;
  if (mode === "live") {
    baseMs = DateTime.now()
      .setZone(tz)
      .set({ second: 0, millisecond: 0 })
      .toMillis();
  } else {
    let base;
    if (opts.startAt) {
      base = DateTime.fromJSDate(new Date(opts.startAt)).setZone(tz);
    } else if (tour.firstMatchStartAt) {
      base = DateTime.fromJSDate(new Date(tour.firstMatchStartAt)).setZone(tz);
    } else {
      base = (
        tour.startDate
          ? DateTime.fromJSDate(new Date(tour.startDate))
          : DateTime.now()
      )
        .setZone(tz)
        .set({ hour: START_HOUR, minute: 0, second: 0, millisecond: 0 });
    }
    baseMs = base.toMillis();
  }

  // Lưu lại giờ trận đầu để lần auto (sau bốc thăm) dùng đúng giờ đã cấu hình.
  if (persistStartAt && opts.startAt && mode !== "live") {
    await Tournament.updateOne(
      { _id: tournamentId },
      { $set: { firstMatchStartAt: new Date(baseMs) } },
    );
  }

  const measured = mode === "live" ? await measureAvgDurations(tournamentId) : null;

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
    status: { $in: ["scheduled", "queued", "assigned"] },
  })
    .select("_id bracket round rrRound order previousA previousB rules")
    .lean();

  if (!matches.length) {
    return {
      updated: 0,
      courtCount,
      mode,
      baseStart: new Date(baseMs),
      lastEnd: null,
      avgUsedMin: measured?.avgAll ? Math.round(measured.avgAll) : null,
      sampleCount: measured?.sampleCount || 0,
    };
  }

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

  const courtFreeAt = new Array(courtCount).fill(baseMs);
  const endMsById = new Map();

  // Chế độ live: trận đang live chiếm sân tới lúc dự kiến xong.
  if (mode === "live") {
    const liveMatches = await Match.find({
      tournament: tournamentId,
      status: "live",
      startedAt: { $ne: null },
    })
      .select("_id rules startedAt")
      .lean();
    const liveEnds = [];
    for (const lm of liveMatches) {
      const durMs = playMinutes(lm, mode, measured) * 60000;
      const est = new Date(lm.startedAt).getTime() + durMs;
      const endMs = Math.max(est, baseMs);
      endMsById.set(String(lm._id), endMs); // để trận phụ thuộc chờ đúng
      liveEnds.push(endMs);
    }
    liveEnds.sort((a, b) => b - a);
    for (let i = 0; i < Math.min(courtCount, liveEnds.length); i++) {
      courtFreeAt[i] = liveEnds[i];
    }
  }

  const ops = [];
  let lastEnd = baseMs;

  for (const m of matches) {
    const playMs = playMinutes(m, mode, measured) * 60000;

    let depReady = baseMs;
    for (const p of [m.previousA, m.previousB]) {
      if (p && endMsById.has(String(p))) {
        depReady = Math.max(depReady, endMsById.get(String(p)));
      }
    }

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
        update: { $set: { scheduledAt: new Date(start), autoCourtNo: ci + 1 } },
      },
    });
  }

  if (ops.length) await Match.bulkWrite(ops, { ordered: false });

  return {
    updated: ops.length,
    courtCount,
    mode,
    baseStart: new Date(baseMs),
    lastEnd: new Date(lastEnd),
    avgUsedMin: measured?.avgAll ? Math.round(measured.avgAll) : null,
    sampleCount: measured?.sampleCount || 0,
  };
}

export default autoScheduleTournament;
