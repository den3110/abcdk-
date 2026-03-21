import mongoose from "mongoose";
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import Court from "../models/courtModel.js";
import {
  MATCH_LITE_SELECT,
  PAIR_SELECT,
  enrichCourtsWithManualAssignment,
  getManualAssignmentItems,
  getManualReservationMap,
  toMatchLite,
} from "./courtManualAssignment.service.js";

const GROUP_LIKE = new Set(["group", "round_robin", "gsl", "swiss"]);
const isGroupType = (type) => GROUP_LIKE.has(String(type || "").toLowerCase());
const resolveClusterKey = (bracket, cluster = "Main") =>
  bracket ? String(bracket) : String(cluster ?? "Main").trim() || "Main";

const safeTrim = (value) => (typeof value === "string" ? value.trim() : "");

const displayLabelKey = (match, bracketTypeMap) => {
  const bracketId = String(match?.bracket || "");
  const bracketType = bracketTypeMap.get(bracketId);
  if (!match?.labelKey) return "";
  return isGroupType(bracketType)
    ? match.labelKey.replace(/#R(\d+)/, "#B$1")
    : match.labelKey;
};

const extractT = (match) => {
  if (match?.labelKey && typeof match.labelKey === "string") {
    const hit = match.labelKey.match(/(\d+)$/);
    if (hit) return Number(hit[1]);
  }
  return Number.isFinite(match?.order) ? Number(match.order) + 1 : 1;
};

const computeDisplayCode = (match, offsetMap, bracketTypeMap) => {
  const bracketId = String(match?.bracket || "");
  const offset = offsetMap.get(bracketId) || 0;
  const bracketType = bracketTypeMap.get(bracketId);
  const t = extractT(match);

  if (isGroupType(bracketType)) {
    const b = Number(match?.rrRound || match?.round || 1);
    return `V${offset + 1}-B${b}-T${t}`;
  }

  const round = Number(match?.round || 1);
  return `V${offset + round}-T${t}`;
};

async function buildBracketRoundMeta(tournamentId) {
  const brackets = await Bracket.find({ tournament: tournamentId })
    .select("_id type order")
    .lean();

  if (!brackets.length) {
    return { offsetMap: new Map(), typeMap: new Map() };
  }

  const agg = await Match.aggregate([
    {
      $match: {
        tournament: new mongoose.Types.ObjectId(String(tournamentId)),
        bracket: { $in: brackets.map((bracket) => bracket._id) },
      },
    },
    { $group: { _id: "$bracket", maxRound: { $max: "$round" } } },
  ]);

  const maxRoundMap = new Map(
    agg.map((item) => [String(item._id), Number(item.maxRound || 1)])
  );

  const sorted = [...brackets].sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  );

  let cumulative = 0;
  const offsetMap = new Map();
  for (const bracket of sorted) {
    offsetMap.set(String(bracket._id), cumulative);
    cumulative += isGroupType(bracket.type)
      ? 1
      : maxRoundMap.get(String(bracket._id)) || 1;
  }

  const typeMap = new Map(brackets.map((bracket) => [String(bracket._id), bracket.type]));
  return { offsetMap, typeMap };
}

function decorateMatchForScheduler(match, offsetMap, bracketTypeMap, reservationMap) {
  const lite = toMatchLite(match);
  const reservation = reservationMap.get(String(match._id));

  return {
    ...lite,
    labelKeyDisplay: displayLabelKey(match, bracketTypeMap),
    codeDisplay: computeDisplayCode(match, offsetMap, bracketTypeMap),
    manualAssignmentCourtId: reservation?.courtId || null,
    manualAssignmentCourtName: reservation?.courtName || "",
    manualAssignmentReserved: !!reservation,
  };
}

export async function buildSchedulerStatePayload(
  tournamentId,
  { bracket = null, cluster = "Main" } = {}
) {
  const clusterKey = resolveClusterKey(bracket, cluster);
  const { offsetMap, typeMap } = await buildBracketRoundMeta(tournamentId);

  const courts = await Court.find({
    tournament: tournamentId,
    cluster: clusterKey,
  })
    .select(
      "tournament name cluster order isActive status currentMatch liveConfig defaultReferees manualAssignment"
    )
    .sort({ order: 1 })
    .lean();

  const currentIds = courts
    .map((court) => court.currentMatch)
    .filter(Boolean)
    .map((value) => String(value));

  const manualIds = courts.flatMap((court) =>
    getManualAssignmentItems(court)
      .map((item) => item.matchId)
      .filter(Boolean)
      .map((value) => String(value))
  );

  const baseFilter = {
    tournament: tournamentId,
    status: { $in: ["queued", "assigned", "live", "scheduled"] },
  };

  if (bracket && mongoose.Types.ObjectId.isValid(String(bracket))) {
    baseFilter.$or = [
      { courtCluster: clusterKey },
      { bracket: new mongoose.Types.ObjectId(String(bracket)) },
    ];
  } else {
    baseFilter.courtCluster = clusterKey;
  }

  let matches = await Match.find(baseFilter)
    .select(MATCH_LITE_SELECT)
    .populate({ path: "pairA", select: PAIR_SELECT })
    .populate({ path: "pairB", select: PAIR_SELECT })
    .sort({ status: 1, queueOrder: 1, round: 1, order: 1 })
    .lean();

  const includeIds = [...new Set([...currentIds, ...manualIds])].filter(Boolean);
  const existingIds = new Set(matches.map((match) => String(match._id)));
  const missingIds = includeIds.filter((id) => !existingIds.has(id));

  if (missingIds.length) {
    const extra = await Match.find({ _id: { $in: missingIds } })
      .select(MATCH_LITE_SELECT)
      .populate({ path: "pairA", select: PAIR_SELECT })
      .populate({ path: "pairB", select: PAIR_SELECT })
      .lean();
    matches = matches.concat(extra);
  }

  const reservationMap = await getManualReservationMap({
    tournamentId,
    bracketId:
      bracket && mongoose.Types.ObjectId.isValid(String(bracket)) ? bracket : null,
  });

  const matchesLite = matches.map((match) =>
    decorateMatchForScheduler(match, offsetMap, typeMap, reservationMap)
  );

  const matchMap = new Map(matchesLite.map((match) => [String(match._id), match]));
  const courtsWithManual = await enrichCourtsWithManualAssignment(courts, {
    matchLiteMap: matchMap,
  });

  const courtsWithCurrent = courtsWithManual.map((court) => {
    const currentMatch = court.currentMatch
      ? matchMap.get(String(court.currentMatch)) || null
      : null;

    return {
      ...court,
      currentMatchObj: currentMatch,
      currentMatchCode:
        currentMatch?.codeDisplay ||
        currentMatch?.labelKeyDisplay ||
        currentMatch?.labelKey ||
        currentMatch?.code ||
        null,
      currentMatchTeams: currentMatch
        ? { A: currentMatch.pairAName, B: currentMatch.pairBName }
        : null,
    };
  });

  return {
    clusterKey,
    courts: courtsWithCurrent,
    matches: matchesLite,
  };
}

export async function broadcastState(
  io,
  tournamentId,
  { bracket = null, cluster = "Main" } = {}
) {
  const payload = await buildSchedulerStatePayload(tournamentId, {
    bracket,
    cluster,
  });

  io.to(`tour:${tournamentId}:${payload.clusterKey}`).emit("scheduler:state", {
    courts: payload.courts,
    matches: payload.matches,
  });
}
