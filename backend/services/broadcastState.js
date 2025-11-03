// ===== Adjust the import paths to your project structure =====
import mongoose from "mongoose";
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import Court from "../models/courtModel.js";

/** -------------------------------------------
 *  Utils & type guards
 * ------------------------------------------*/
const GROUP_LIKE = new Set(["group", "round_robin", "gsl", "swiss"]);
const isGroupType = (t) => GROUP_LIKE.has(String(t || "").toLowerCase());

// Courts theo giải -> cluster chỉ lấy từ tham số, KHÔNG phụ thuộc bracket
const resolveClusterKey = (cluster = "Main") =>
  String(cluster ?? "Main").trim() || "Main";

const safeTrim = (s) => (typeof s === "string" ? s.trim() : "");

const nameOfPerson = (p) =>
  safeTrim(p?.fullName || p?.nickName || p?.name || p?.displayName || "");

const nameOfPair = (pair) => {
  if (!pair) return "";
  if (pair.displayName || pair.name)
    return safeTrim(pair.displayName || pair.name);
  const n1 = nameOfPerson(pair.player1);
  const n2 = nameOfPerson(pair.player2);
  return [n1, n2].filter(Boolean).join(" & ");
};

/** -------------------------------------------
 *  Label helpers
 * ------------------------------------------*/
/**
 * Chỉ đổi "#R{n}" -> "#B{n}" khi bracket là group-like.
 */
const displayLabelKey = (m, bracketTypeMap) => {
  const bId = String(m?.bracket || "");
  const bType = bracketTypeMap.get(bId);
  if (!m?.labelKey) return "";
  return isGroupType(bType)
    ? m.labelKey.replace(/#R(\d+)/, "#B$1")
    : m.labelKey;
};

/**
 * Lấy chỉ số T (thứ tự trận trong vòng).
 * Ưu tiên bóc từ labelKey (đuôi số), fallback m.order.
 */
const extractT = (m) => {
  const lk = m?.labelKey;
  if (lk && typeof lk === "string") {
    const mm = lk.match(/(\d+)$/);
    if (mm) return Number(mm[1]);
  }
  return Number.isFinite(m?.order) ? Number(m.order) : 1;
};

/**
 * Tính mã hiển thị:
 * - group-like:  V{offset+1}-B{b}-T{t}  (b = rrRound|round)
 * - KO:          V{offset+round}-T{t}
 */
const computeDisplayCode = (m, offsetMap, bracketTypeMap) => {
  const bId = String(m?.bracket || "");
  const offset = offsetMap.get(bId) || 0;
  const bType = bracketTypeMap.get(bId);
  const t = extractT(m);

  if (isGroupType(bType)) {
    const b = Number(m?.rrRound || m?.round || 1);
    const v = offset + 1; // group-like luôn 1 vòng
    return `V${v}-B${b}-T${t}`;
  } else {
    const r = Number(m?.round || 1);
    const v = offset + r; // KO cộng theo round của chính m
    return `V${v}-T${t}`;
  }
};

/** -------------------------------------------
 *  V offsets & type map
 * ------------------------------------------*/
/**
 * Trả về:
 *  - offsetMap: bracketId -> tổng số vòng của các bracket đứng trước (theo order)
 *  - typeMap:   bracketId -> type
 *
 * roundsCount:
 *  - group-like: 1
 *  - KO: maxRound của bracket (scan từ Match)
 */
async function buildBracketRoundMeta(tournamentId) {
  const brackets = await Bracket.find({ tournament: tournamentId })
    .select("_id type order")
    .lean();

  if (!brackets.length) {
    return { offsetMap: new Map(), typeMap: new Map() };
  }

  // Max round per bracket (dành cho KO)
  const agg = await Match.aggregate([
    {
      $match: {
        tournament: new mongoose.Types.ObjectId(String(tournamentId)),
        bracket: { $in: brackets.map((b) => b._id) },
      },
    },
    { $group: { _id: "$bracket", maxRound: { $max: "$round" } } },
  ]);

  const maxRoundMap = new Map(
    agg.map((x) => [String(x._id), Number(x.maxRound || 1)])
  );

  const roundsCountMap = new Map(
    brackets.map((b) => [
      String(b._id),
      isGroupType(b.type) ? 1 : maxRoundMap.get(String(b._id)) || 1,
    ])
  );

  const sorted = [...brackets].sort(
    (a, b) => (a.order ?? 9999) - (b.order ?? 9999)
  );

  let cum = 0;
  const offsetMap = new Map();
  for (const b of sorted) {
    offsetMap.set(String(b._id), cum);
    cum += roundsCountMap.get(String(b._id)) || 1;
  }

  const typeMap = new Map(brackets.map((b) => [String(b._id), b.type]));
  return { offsetMap, typeMap };
}

/** -------------------------------------------
 *  Main: broadcastState
 * ------------------------------------------*/
/**
 * Phát trạng thái điều phối cho 1 cluster của giải (courts theo GIẢI):
 *  - courts: kèm currentMatchCode/Teams
 *  - matches: bản rút gọn + codeDisplay chuẩn (tính theo bracket của match)
 *
 * @param {import("socket.io").Server} io
 * @param {string|mongoose.Types.ObjectId} tournamentId
 * @param {{ cluster?: string }} options
 */
export const broadcastState = async (
  io,
  tournamentId,
  { cluster = "Main" } = {}
) => {
  const clusterKey = resolveClusterKey(cluster);

  // 0) Meta phục vụ tính "V" cho codeDisplay
  const { offsetMap: roundOffsetMap, typeMap: bracketTypeMap } =
    await buildBracketRoundMeta(tournamentId);

  // 1) SÂN THEO GIẢI + CLUSTER (KHÔNG lọc theo bracket nữa)
  const courts = await Court.find({
    tournament: tournamentId,
    cluster: clusterKey,
  })
    .sort({ order: 1 })
    .lean();

  // 2) Id các currentMatch trên sân
  const currentIds = courts
    .map((c) => c.currentMatch)
    .filter(Boolean)
    .map((x) => String(x));

  // 3) Danh sách các trận trong cluster này (xếp hàng/đang thi đấu)
  const baseMatchFilter = {
    tournament: tournamentId,
    status: { $in: ["queued", "assigned", "live", "scheduled"] },
    courtCluster: clusterKey, // matches đã được gán vào cluster này bởi queue builder
  };

  const MATCH_BASE_SELECT =
    "_id tournament bracket format type status queueOrder " +
    "court courtLabel pool rrRound round order code labelKey " +
    "scheduledAt startedAt finishedAt";

  let matches = await Match.find(baseMatchFilter)
    .select(MATCH_BASE_SELECT)
    .populate({
      path: "pairA",
      select:
        "displayName name player1.fullName player1.nickName player2.fullName player2.nickName",
    })
    .populate({
      path: "pairB",
      select:
        "displayName name player1.fullName player1.nickName player2.fullName player2.nickName",
    })
    .sort({ status: 1, queueOrder: 1 })
    .lean();

  // 4) Bảo đảm include cả currentMatch trên sân (dù không trùng filter trên)
  const missingIds = currentIds.filter(
    (id) => !matches.some((m) => String(m._id) === id)
  );
  if (missingIds.length) {
    const extra = await Match.find({ _id: { $in: missingIds } })
      .select(MATCH_BASE_SELECT)
      .populate({
        path: "pairA",
        select:
          "displayName name player1.fullName player1.nickName player2.fullName player2.nickName",
      })
      .populate({
        path: "pairB",
        select:
          "displayName name player1.fullName player1.nickName player2.fullName player2.nickName",
      })
      .lean();
    matches = matches.concat(extra);
  }

  // 5) Rút gọn + tính mã hiển thị chuẩn
  const matchesLite = matches.map((m) => {
    const pairAName = nameOfPair(m.pairA);
    const pairBName = nameOfPair(m.pairB);
    const labelKeyDisplay = displayLabelKey(m, bracketTypeMap);
    const codeDisplay = computeDisplayCode(m, roundOffsetMap, bracketTypeMap);

    return {
      _id: m._id,
      status: m.status,
      queueOrder: m.queueOrder,
      court: m.court,
      courtLabel: m.courtLabel,
      pool: m.pool,
      rrRound: m.rrRound,
      round: m.round,
      order: m.order,
      code: m.code, // raw
      labelKey: m.labelKey, // raw
      labelKeyDisplay, // R→B cho group-like
      codeDisplay, // ✅ CHUẨN: group-like có B, KO không có B
      type: m.type,
      format: m.format,
      scheduledAt: m.scheduledAt,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt,

      pairA: m.pairA,
      pairB: m.pairB,
      pairAName,
      pairBName,
    };
  });

  const matchMap = new Map(matchesLite.map((m) => [String(m._id), m]));

  // 6) Gắn thông tin current vào sân
  const courtsWithCurrent = courts.map((c) => {
    const m = matchMap.get(String(c.currentMatch));
    return {
      ...c,
      currentMatchObj: m || null,
      currentMatchCode:
        m?.codeDisplay || m?.labelKeyDisplay || m?.labelKey || m?.code || null,
      currentMatchTeams: m ? { A: m.pairAName, B: m.pairBName } : null,
    };
  });

  // 7) Emit ra room theo tournament + cluster
  io.to(`tour:${tournamentId}:${clusterKey}`).emit("scheduler:state", {
    courts: courtsWithCurrent,
    matches: matchesLite,
  });
};
