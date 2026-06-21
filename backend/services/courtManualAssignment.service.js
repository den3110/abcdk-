import mongoose from "mongoose";
import Court from "../models/courtModel.js";
import Match from "../models/matchModel.js";

export const MANUAL_ASSIGNMENT_PENDING = "pending";
export const MANUAL_ASSIGNMENT_DONE = "done";
export const MANUAL_ASSIGNMENT_SKIPPED = "skipped";
export const MANUAL_ASSIGNMENT_ITEM_STATES = [
  MANUAL_ASSIGNMENT_PENDING,
  MANUAL_ASSIGNMENT_DONE,
  MANUAL_ASSIGNMENT_SKIPPED,
];

export const MATCH_LITE_SELECT =
  "_id tournament bracket format type status queueOrder " +
  "court courtLabel pool rrRound round order code labelKey " +
  "scheduledAt startedAt finishedAt assignedAt createdAt";

export const PAIR_SELECT =
  "displayName name nickname nickName shortName code " +
  "player1.fullName player1.nickName player2.fullName player2.nickName participants";

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const withSession = (query, session) => (session ? query.session(session) : query);

const nameOfPerson = (person) =>
  (
    person?.nickName ||
    person?.nickname ||
    person?.fullName ||
    person?.displayName ||
    person?.name ||
    ""
  ).trim();

const nameOfPair = (pair) => {
  if (!pair) return "";
  if (pair.displayName || pair.name) {
    return String(pair.displayName || pair.name).trim();
  }
  const names = [nameOfPerson(pair.player1), nameOfPerson(pair.player2)].filter(Boolean);
  return names.join(" & ");
};

export const sortManualAssignmentItems = (items = []) =>
  [...items].sort(
    (a, b) =>
      Number(a?.order ?? Number.MAX_SAFE_INTEGER) -
        Number(b?.order ?? Number.MAX_SAFE_INTEGER) ||
      toIdString(a?.matchId).localeCompare(toIdString(b?.matchId))
  );

export const normalizeManualAssignment = (court) => {
  const manual = court?.manualAssignment || {};
  return {
    enabled: !!manual.enabled,
    bracketId: manual.bracketId || null,
    fallbackToAuto:
      typeof manual.fallbackToAuto === "boolean" ? manual.fallbackToAuto : true,
    updatedBy: manual.updatedBy || null,
    updatedAt: manual.updatedAt || null,
    items: sortManualAssignmentItems(
      Array.isArray(manual.items)
        ? manual.items.map((item, index) => ({
            matchId: item?.matchId || null,
            order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
            state: MANUAL_ASSIGNMENT_ITEM_STATES.includes(item?.state)
              ? item.state
              : MANUAL_ASSIGNMENT_PENDING,
            actedAt: item?.actedAt || null,
          }))
        : []
    ),
  };
};

export const isManualAssignmentEnabled = (court) =>
  normalizeManualAssignment(court).enabled;

export const getManualAssignmentItems = (court) =>
  normalizeManualAssignment(court).items;

export const getCurrentManualAssignmentItem = (court) => {
  const currentMatchId = toIdString(court?.currentMatch);
  if (!currentMatchId) return null;
  return (
    getManualAssignmentItems(court).find(
      (item) => toIdString(item.matchId) === currentMatchId
    ) || null
  );
};

export const getUpcomingManualAssignmentItems = (
  court,
  { includeCurrent = false } = {}
) => {
  const currentMatchId = toIdString(court?.currentMatch);
  return getManualAssignmentItems(court).filter((item) => {
    if (item.state !== MANUAL_ASSIGNMENT_PENDING) return false;
    if (includeCurrent) return true;
    return !currentMatchId || toIdString(item.matchId) !== currentMatchId;
  });
};

export const getNextManualAssignmentItem = (court, options = {}) =>
  getUpcomingManualAssignmentItems(court, options)[0] || null;

export const toMatchLite = (match) => {
  if (!match) return null;
  const pairAName = nameOfPair(match.pairA);
  const pairBName = nameOfPair(match.pairB);
  return {
    _id: match._id,
    tournament: match.tournament,
    bracket: match.bracket,
    status: match.status,
    queueOrder: match.queueOrder,
    court: match.court,
    courtLabel: match.courtLabel,
    pool: match.pool,
    rrRound: match.rrRound,
    round: match.round,
    order: match.order,
    code: match.code,
    labelKey: match.labelKey,
    type: match.type,
    format: match.format,
    scheduledAt: match.scheduledAt,
    assignedAt: match.assignedAt,
    startedAt: match.startedAt,
    finishedAt: match.finishedAt,
    createdAt: match.createdAt,
    pairA: match.pairA || null,
    pairB: match.pairB || null,
    pairAName,
    pairBName,
  };
};

export async function fetchMatchLiteMapByIds(matchIds = [], { session } = {}) {
  const ids = [...new Set(matchIds.map(toIdString).filter(Boolean))].filter(
    mongoose.Types.ObjectId.isValid
  );
  if (!ids.length) return new Map();

  const matches = await withSession(
    Match.find({ _id: { $in: ids } })
      .select(MATCH_LITE_SELECT)
      .populate({ path: "pairA", select: PAIR_SELECT })
      .populate({ path: "pairB", select: PAIR_SELECT }),
    session
  ).lean();

  return new Map(matches.map((match) => [toIdString(match._id), toMatchLite(match)]));
}

export async function getManualReservationMap({
  tournamentId,
  excludeCourtId = null,
  bracketId = null,
  session = null,
} = {}) {
  if (!tournamentId || !mongoose.Types.ObjectId.isValid(String(tournamentId))) {
    return new Map();
  }

  const filter = {
    tournament: new mongoose.Types.ObjectId(String(tournamentId)),
    "manualAssignment.enabled": true,
  };

  if (excludeCourtId && mongoose.Types.ObjectId.isValid(String(excludeCourtId))) {
    filter._id = { $ne: new mongoose.Types.ObjectId(String(excludeCourtId)) };
  }

  if (bracketId && mongoose.Types.ObjectId.isValid(String(bracketId))) {
    filter["manualAssignment.bracketId"] = new mongoose.Types.ObjectId(
      String(bracketId)
    );
  }

  const courts = await withSession(
    Court.find(filter).select("name currentMatch manualAssignment"),
    session
  ).lean();

  const reservations = new Map();

  for (const court of courts) {
    const courtId = toIdString(court?._id);
    const courtName = court?.name || "";
    for (const item of getUpcomingManualAssignmentItems(court)) {
      const matchId = toIdString(item?.matchId);
      if (!matchId) continue;
      reservations.set(matchId, {
        courtId,
        courtName,
        bracketId: toIdString(court?.manualAssignment?.bracketId),
      });
    }
  }

  return reservations;
}

export async function enrichCourtsWithManualAssignment(
  courts = [],
  { session = null, matchLiteMap = null } = {}
) {
  if (!Array.isArray(courts) || !courts.length) return [];

  const matchIds = new Set();
  for (const court of courts) {
    for (const item of getManualAssignmentItems(court)) {
      const matchId = toIdString(item?.matchId);
      if (matchId) matchIds.add(matchId);
    }
  }

  const localMatchMap =
    matchLiteMap || (await fetchMatchLiteMapByIds([...matchIds], { session }));

  return courts.map((court) => {
    const manual = normalizeManualAssignment(court);
    const items = manual.items.map((item) => ({
      ...item,
      matchId: item.matchId || null,
      match: localMatchMap.get(toIdString(item.matchId)) || null,
    }));
    const currentMatchId = toIdString(court?.currentMatch);
    const upcoming = items.filter(
      (item) =>
        item.state === MANUAL_ASSIGNMENT_PENDING &&
        (!currentMatchId || toIdString(item.matchId) !== currentMatchId)
    );

    return {
      ...court,
      listEnabled: manual.enabled,
      remainingCount: upcoming.length,
      nextMatch: upcoming[0]?.match || null,
      manualAssignment: {
        ...manual,
        items,
      },
    };
  });
}
