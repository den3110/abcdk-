// chỉnh lại các path import theo dự án của bạn
import Match from "../models/matchModel.js";
import Court from "../models/courtModel.js";

const resolveClusterKey = (bracket, cluster = "Main") =>
  bracket ? String(bracket) : cluster ?? "Main";

const nameOfPerson = (p) =>
  (p?.fullName || p?.nickName || p?.name || p?.displayName || "").trim();

const nameOfPair = (pair) => {
  if (!pair) return "";
  if (pair.displayName || pair.name) return pair.displayName || pair.name;
  const n1 = nameOfPerson(pair.player1);
  const n2 = nameOfPerson(pair.player2);
  return [n1, n2].filter(Boolean).join(" & ");
};

// Đổi nhãn hiển thị cho vòng bảng: ...#R{round}#... -> ...#B{round}#...
const displayLabelKey = (m) => {
  if (!m?.labelKey) return "";
  const isGroup = m.format === "group" || m.type === "group" || !!m.pool?.name;
  return isGroup ? m.labelKey.replace(/#R(\d+)/, "#B$1") : m.labelKey;
};

export const broadcastState = async (
  io,
  tournamentId,
  { bracket, cluster = "Main" } = {}
) => {
  const clusterKey = resolveClusterKey(bracket, cluster);

  // 1) Sân theo bracket/cluster
  const courtsQuery = bracket
    ? { tournament: tournamentId, bracket }
    : { tournament: tournamentId, cluster: clusterKey };
  const courts = await Court.find(courtsQuery).sort({ order: 1 }).lean();

  // 2) Id các trận đang nằm trên sân để đảm bảo include
  const currentIds = courts
    .map((c) => c.currentMatch)
    .filter(Boolean)
    .map((x) => String(x));

  // 3) Trận cần cho điều phối
  const baseMatchFilter = {
    tournament: tournamentId,
    status: { $in: ["queued", "assigned", "live", "scheduled"] },
    ...(bracket ? { bracket } : { courtCluster: clusterKey }),
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

  // 4) Bảo đảm include mọi currentMatch
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

  // 5) Thu gọn để FE bơm thẳng
  const matchesLite = matches.map((m) => ({
    _id: m._id,
    status: m.status,
    queueOrder: m.queueOrder,
    court: m.court,
    courtLabel: m.courtLabel,
    pool: m.pool, // { id, name }
    rrRound: m.rrRound,
    round: m.round,
    order: m.order,
    code: m.code,
    labelKey: m.labelKey,
    labelKeyDisplay: displayLabelKey(m), // 👈 thêm nhãn hiển thị B cho vòng bảng
    type: m.type,
    format: m.format,
    scheduledAt: m.scheduledAt,
    startedAt: m.startedAt,
    finishedAt: m.finishedAt,
    pairA: m.pairA,
    pairB: m.pairB,
  }));

  const matchMap = new Map(matchesLite.map((m) => [String(m._id), m]));

  // 6) Gắn info gọn vào từng sân
  const courtsWithCurrent = courts.map((c) => {
    const m = matchMap.get(String(c.currentMatch));
    return {
      ...c,
      currentMatchObj: m || null,
      currentMatchCode: m?.labelKeyDisplay || m?.labelKey || m?.code || null,
      currentMatchTeams: m ? { A: m.pairAName, B: m.pairBName } : null,
    };
  });

  // 7) Emit
  io.to(`tour:${tournamentId}:${clusterKey}`).emit("scheduler:state", {
    courts: courtsWithCurrent,
    matches: matchesLite,
  });
};
