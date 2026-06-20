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

const envValue = (key) =>
  typeof process !== "undefined" ? process.env?.[key] : undefined;
const readPositiveInt = (key, fallback, { max = 1000 } = {}) => {
  const value = Number(envValue(key));
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(max, Math.trunc(value));
};
const SCHEDULER_STATE_FLUSH_MS = readPositiveInt(
  "SOCKET_SCHEDULER_STATE_FLUSH_MS",
  1000,
  { max: 2000 }
);
const SCHEDULER_STATE_MAX_WAIT_MS = readPositiveInt(
  "SOCKET_SCHEDULER_STATE_MAX_WAIT_MS",
  2000,
  { max: 5000 }
);
const MAX_PENDING_SCHEDULER_STATES = readPositiveInt(
  "SOCKET_MAX_PENDING_SCHEDULER_STATES",
  1000,
  { max: 10000 }
);
const SCHEDULER_STATE_FLUSH_CONCURRENCY = readPositiveInt(
  "SOCKET_SCHEDULER_STATE_FLUSH_CONCURRENCY",
  2,
  { max: 10 }
);
const pendingSchedulerStates = new Map();
let schedulerStateFlushTimer = null;

const safeTrim = (value) => (typeof value === "string" ? value.trim() : "");

const nowMs = () => Date.now();

const scheduleTimer = (timerRef, callback, delayMs) =>
  timerRef || setTimeout(callback, Math.max(0, Number(delayMs) || 0));

const debounceFlushAt = (entry, delayMs, maxWaitMs) => {
  const now = nowMs();
  const firstAt = entry?.firstAt || now;
  const trailingAt = now + Math.max(0, Number(delayMs) || 0);
  const maxAt = firstAt + Math.max(0, Number(maxWaitMs) || 0);
  return Math.min(trailingAt, maxAt);
};

const schedulerStateKey = (tournamentId, clusterKey) =>
  `${String(tournamentId || "").trim()}:${String(clusterKey || "").trim()}`;

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

async function emitSchedulerStateNow(
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
  return payload;
}

async function flushSchedulerStateEntry(key, entry = pendingSchedulerStates.get(key)) {
  if (!entry) return null;
  pendingSchedulerStates.delete(key);
  try {
    return await emitSchedulerStateNow(entry.io, entry.tournamentId, {
      bracket: entry.bracket,
      cluster: entry.cluster,
    });
  } catch (error) {
    console.error("[scheduler] broadcastState error:", error?.message || error);
    return null;
  }
}

const scheduleSchedulerStateFlush = () => {
  if (schedulerStateFlushTimer) return;
  schedulerStateFlushTimer = scheduleTimer(
    schedulerStateFlushTimer,
    flushDueSchedulerStates,
    SCHEDULER_STATE_FLUSH_MS
  );
};

async function flushSchedulerStateEntries(entries) {
  if (!entries.length) return;
  let index = 0;
  const workerCount = Math.min(
    Math.max(1, SCHEDULER_STATE_FLUSH_CONCURRENCY),
    entries.length
  );
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < entries.length) {
      const current = entries[index];
      index += 1;
      await flushSchedulerStateEntry(current[0], current[1]);
    }
  });
  await Promise.all(workers);
}

async function flushDueSchedulerStates() {
  schedulerStateFlushTimer = null;
  const now = nowMs();
  let nextDelay = null;
  const due = [];

  for (const [key, entry] of pendingSchedulerStates.entries()) {
    if (entry.flushAt <= now) {
      due.push([key, entry]);
      continue;
    }
    const delay = entry.flushAt - now;
    nextDelay = nextDelay == null ? delay : Math.min(nextDelay, delay);
  }

  await flushSchedulerStateEntries(due);

  if (pendingSchedulerStates.size > 0) {
    schedulerStateFlushTimer = scheduleTimer(
      schedulerStateFlushTimer,
      flushDueSchedulerStates,
      nextDelay == null ? SCHEDULER_STATE_FLUSH_MS : nextDelay
    );
  }
}

export async function broadcastState(
  io,
  tournamentId,
  { bracket = null, cluster = "Main" } = {}
) {
  if (!io || !tournamentId) return null;
  const clusterKey = resolveClusterKey(bracket, cluster);
  const key = schedulerStateKey(tournamentId, clusterKey);
  const existing = pendingSchedulerStates.get(key);
  const firstAt = existing?.firstAt || nowMs();
  const entry = {
    io,
    tournamentId,
    bracket,
    cluster,
    firstAt,
    flushAt: debounceFlushAt(
      { firstAt },
      SCHEDULER_STATE_FLUSH_MS,
      SCHEDULER_STATE_MAX_WAIT_MS
    ),
  };

  pendingSchedulerStates.set(key, entry);

  if (pendingSchedulerStates.size > MAX_PENDING_SCHEDULER_STATES) {
    const [oldestKey, oldestEntry] =
      pendingSchedulerStates.entries().next().value || [];
    if (oldestKey) void flushSchedulerStateEntry(oldestKey, oldestEntry);
  }

  scheduleSchedulerStateFlush();
  return null;
}
