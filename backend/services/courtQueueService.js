import mongoose from "mongoose";
import Court from "../models/courtModel.js";
import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";
import {
  MANUAL_ASSIGNMENT_DONE,
  MANUAL_ASSIGNMENT_PENDING,
  MANUAL_ASSIGNMENT_SKIPPED,
  getCurrentManualAssignmentItem,
  getManualReservationMap,
  getUpcomingManualAssignmentItems,
  isManualAssignmentEnabled,
} from "./courtManualAssignment.service.js";

const FINISHED_LIKE = new Set(["finished", "cancelled", "canceled"]);
const ACTIVE_MATCH_STATUSES = ["assigned", "live"];
const ASSIGNABLE_MATCH_STATUSES = ["scheduled", "queued", "assigned"];

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));
const withSession = (query, session) => (session ? query.session(session) : query);

const courtLabelOf = (court) =>
  court?.name ||
  court?.label ||
  court?.title ||
  court?.code ||
  (court?._id ? `Court-${String(court._id).slice(-4)}` : "");

const baseUnassignUpdate = (nextStatus) => ({
  $set: {
    status: nextStatus,
    court: null,
    courtLabel: "",
    assignedAt: null,
  },
});

const getUnassignedStatus = (match, { preferQueued = true } = {}) => {
  if (!match || FINISHED_LIKE.has(String(match.status || "").toLowerCase())) {
    return String(match?.status || "finished");
  }
  if (preferQueued && (match.queueOrder != null || match.courtCluster)) {
    return "queued";
  }
  return "scheduled";
};

async function buildRegUsersMap(regIds) {
  if (!regIds.size) return new Map();
  const regs = await Registration.find({ _id: { $in: [...regIds] } })
    .select("player1.user player2.user")
    .lean();
  return new Map(
    regs.map((r) => [
      String(r._id),
      [r.player1?.user, r.player2?.user].filter(Boolean).map(String),
    ])
  );
}

async function markManualItemStateOnCourtDoc(courtDoc, matchId, nextState, session) {
  if (!courtDoc || !matchId || !courtDoc.manualAssignment?.items?.length) {
    return false;
  }

  let changed = false;
  const now = new Date();

  for (const item of courtDoc.manualAssignment.items) {
    if (toIdString(item.matchId) !== toIdString(matchId)) continue;
    if (item.state === nextState) continue;
    item.state = nextState;
    item.actedAt = now;
    changed = true;
  }

  if (!changed) return false;

  courtDoc.manualAssignment.updatedAt = now;
  await courtDoc.save({ session });
  return true;
}

async function updateManualAssignmentStateByIds(
  courtId,
  matchIds,
  nextState,
  session
) {
  const ids = [...new Set((matchIds || []).map(toIdString).filter(Boolean))];
  if (!ids.length) return false;

  const courtDoc = await withSession(Court.findById(courtId), session);
  if (!courtDoc) return false;

  let changed = false;
  const now = new Date();
  for (const item of courtDoc.manualAssignment?.items || []) {
    if (!ids.includes(toIdString(item.matchId))) continue;
    if (item.state === nextState) continue;
    item.state = nextState;
    item.actedAt = now;
    changed = true;
  }

  if (!changed) return false;

  courtDoc.manualAssignment.updatedAt = now;
  await courtDoc.save({ session });
  return true;
}

async function findAssignableManualItem(court, session) {
  const upcoming = getUpcomingManualAssignmentItems(court);
  if (!upcoming.length) {
    return { item: null, staleMatchIds: [] };
  }

  const ids = upcoming.map((item) => item.matchId).filter(Boolean);
  const matches = await withSession(
    Match.find({ _id: { $in: ids } }).select("_id status court"),
    session
  ).lean();

  const matchMap = new Map(matches.map((match) => [toIdString(match._id), match]));
  const staleMatchIds = [];

  for (const item of upcoming) {
    const match = matchMap.get(toIdString(item.matchId));
    if (!match || FINISHED_LIKE.has(String(match.status || "").toLowerCase())) {
      staleMatchIds.push(toIdString(item.matchId));
      continue;
    }
    if (match.court && toIdString(match.court) !== toIdString(court._id)) {
      continue;
    }
    return { item, staleMatchIds };
  }

  return { item: null, staleMatchIds };
}

async function assignManualNextToCourt({ tournamentId, court, clusterKey, session }) {
  if (!isManualAssignmentEnabled(court)) return null;

  const { item, staleMatchIds } = await findAssignableManualItem(court, session);
  if (staleMatchIds.length) {
    await updateManualAssignmentStateByIds(
      court._id,
      staleMatchIds,
      MANUAL_ASSIGNMENT_SKIPPED,
      session
    );
  }

  if (!item) return null;

  const cid = toObjectId(court._id);
  const next = await withSession(
    Match.findOneAndUpdate(
      {
        _id: item.matchId,
        tournament: toObjectId(tournamentId),
        status: { $in: ASSIGNABLE_MATCH_STATUSES },
        $or: [{ court: null }, { court: cid }],
      },
      {
        $set: {
          status: "assigned",
          court: cid,
          courtLabel: courtLabelOf(court),
          assignedAt: new Date(),
          courtCluster: clusterKey,
        },
      },
      { new: true }
    ),
    session
  );

  if (!next) return null;

  await withSession(
    Court.updateOne(
      { _id: cid },
      { $set: { status: "assigned", currentMatch: next._id } }
    ),
    session
  );

  return next.toObject();
}

async function getEngagedParticipants({ tournamentId, clusterKey, session }) {
  const matches = await withSession(
    Match.find({
      tournament: toObjectId(tournamentId),
      courtCluster: clusterKey,
      status: { $in: ACTIVE_MATCH_STATUSES },
    }).select("participants"),
    session
  ).lean();

  return new Set(
    matches
      .flatMap((match) => match.participants || [])
      .filter(Boolean)
      .map(String)
  );
}

function buildParticipantsFreeFilter(engagedParticipants) {
  if (!engagedParticipants.size) return {};
  return {
    participants: {
      $not: { $elemMatch: { $in: [...engagedParticipants] } },
    },
  };
}

function buildReservedMatchFilter(reservedMatchIds) {
  if (!reservedMatchIds.length) return {};
  return { _id: { $nin: reservedMatchIds.map((id) => toObjectId(id)) } };
}

async function getClusterKeyForCourt(court, fallbackCluster = "Main") {
  return String(court?.cluster || fallbackCluster || "Main");
}

async function releaseCurrentMatchFromCourt(
  courtDoc,
  currentMatch,
  { session, manualSkip = false }
) {
  if (!courtDoc || !currentMatch) return;

  const currentItem = getCurrentManualAssignmentItem(courtDoc);
  if (manualSkip && currentItem) {
    await markManualItemStateOnCourtDoc(
      courtDoc,
      currentMatch._id,
      MANUAL_ASSIGNMENT_SKIPPED,
      session
    );
  }

  const nextStatus = getUnassignedStatus(currentMatch, {
    preferQueued: !manualSkip,
  });
  await withSession(
    Match.updateOne(
      { _id: currentMatch._id },
      baseUnassignUpdate(nextStatus)
    ),
    session
  );
}

async function runAssignSpecific({
  tournamentId,
  courtId,
  matchId,
  bracket = null,
  replace = true,
  cluster = null,
  session,
}) {
  const [court, match] = await Promise.all([
    withSession(
      Court.findOne({
        _id: courtId,
        tournament: tournamentId,
        isActive: true,
      }),
      session
    ),
    withSession(
      Match.findOne({ _id: matchId, tournament: tournamentId }),
      session
    ),
  ]);

  if (!court) {
    throw new Error("Kh?ng t?m th?y s?n h?p l?.");
  }
  if (!match) {
    throw new Error("Kh?ng t?m th?y tr?n c?n g?n.");
  }
  if (bracket && toIdString(match.bracket) !== toIdString(bracket)) {
    throw new Error("Tr?n v? bracket kh?ng kh?p.");
  }
  if (FINISHED_LIKE.has(String(match.status || "").toLowerCase())) {
    throw new Error("Tr?n ?? k?t th?c; kh?ng th? g?n.");
  }

  const reservationMap = await getManualReservationMap({
    tournamentId,
    excludeCourtId: courtId,
    bracketId: bracket || match.bracket || null,
    session,
  });
  const reserved = reservationMap.get(toIdString(matchId));
  if (reserved) {
    throw new Error(
      `Tr?n ?ang n?m trong list c?a s?n ${reserved.courtName || reserved.courtId}.`
    );
  }

  if (toIdString(match.court) === toIdString(court._id)) {
    return {
      court,
      match,
      replacedMatchId: null,
      previousCourtId: null,
      clusterKey: String(court.cluster || cluster || bracket || "Main"),
    };
  }

  if (
    court.currentMatch &&
    toIdString(court.currentMatch) !== toIdString(match._id) &&
    !replace
  ) {
    throw new Error("S?n ?ang c? tr?n. Thi?u quy?n thay th?.");
  }

  let replacedMatchId = null;

  if (
    court.currentMatch &&
    toIdString(court.currentMatch) !== toIdString(match._id)
  ) {
    const currentOnCourt = await withSession(
      Match.findById(court.currentMatch),
      session
    );
    if (currentOnCourt && !FINISHED_LIKE.has(String(currentOnCourt.status || "").toLowerCase())) {
      await withSession(
        Match.updateOne(
          { _id: currentOnCourt._id },
          baseUnassignUpdate(getUnassignedStatus(currentOnCourt, { preferQueued: true }))
        ),
        session
      );
      replacedMatchId = toIdString(currentOnCourt._id);
    }
  }

  let previousCourtId = null;
  if (match.court && toIdString(match.court) !== toIdString(court._id)) {
    previousCourtId = toIdString(match.court);
    const previousCourt = await withSession(
      Court.findById(match.court).select("_id currentMatch status"),
      session
    );
    if (
      previousCourt &&
      toIdString(previousCourt.currentMatch) === toIdString(match._id)
    ) {
      previousCourt.status = "idle";
      previousCourt.currentMatch = null;
      await previousCourt.save({ session });
    }
  }

  const clusterKey = String(cluster || court.cluster || bracket || "Main");

  match.status = "assigned";
  match.court = court._id;
  match.courtLabel = courtLabelOf(court);
  match.courtCluster = clusterKey;
  match.assignedAt = new Date();
  await match.save({ session });

  court.status = "assigned";
  court.currentMatch = match._id;
  await court.save({ session });

  return {
    court,
    match,
    replacedMatchId,
    previousCourtId,
    clusterKey,
  };
}

export async function assignSpecificMatchToCourt(params) {
  if (params?.session) {
    return runAssignSpecific(params);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await runAssignSpecific({ ...params, session });
    await session.commitTransaction();
    session.endSession();
    return result;
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    session.endSession();
    throw error;
  }
}

async function loadCourtForManualList({ tournamentId, courtId, session }) {
  const court = await withSession(
    Court.findOne({
      _id: courtId,
      tournament: tournamentId,
    }),
    session
  );

  if (!court) {
    throw new Error("Kh?ng t?m th?y s?n.");
  }

  return court;
}

async function validateManualListMatches({
  tournamentId,
  courtId,
  bracketId,
  matchIds,
  session,
}) {
  const uniqueIds = [...new Set((matchIds || []).map(toIdString).filter(Boolean))];
  if (!uniqueIds.every((id) => mongoose.Types.ObjectId.isValid(id))) {
    throw new Error("Danh s?ch tr?n kh?ng h?p l?.");
  }

  const matches = await withSession(
    Match.find({
      _id: { $in: uniqueIds.map((id) => toObjectId(id)) },
      tournament: toObjectId(tournamentId),
    }).select("_id bracket status court queueOrder courtCluster"),
    session
  ).lean();

  if (matches.length !== uniqueIds.length) {
    throw new Error("C? tr?n kh?ng t?n t?i trong gi?i ??u n?y.");
  }

  const reservationMap = await getManualReservationMap({
    tournamentId,
    excludeCourtId: courtId,
    bracketId,
    session,
  });

  for (const match of matches) {
    if (bracketId && toIdString(match.bracket) !== toIdString(bracketId)) {
      throw new Error("Ch? ???c ch?n tr?n trong bracket hi?n t?i.");
    }
    if (FINISHED_LIKE.has(String(match.status || "").toLowerCase())) {
      throw new Error("Kh?ng th? ??a tr?n ?? k?t th?c v?o list.");
    }
    if (
      match.court &&
      toIdString(match.court) !== toIdString(courtId) &&
      ACTIVE_MATCH_STATUSES.includes(String(match.status || "").toLowerCase())
    ) {
      throw new Error("C? tr?n ?ang n?m ? s?n kh?c.");
    }
    const reserved = reservationMap.get(toIdString(match._id));
    if (reserved) {
      throw new Error(
        `Tr?n ?ang n?m trong list c?a s?n ${reserved.courtName || reserved.courtId}.`
      );
    }
  }

  return uniqueIds;
}

export async function setCourtMatchList({
  tournamentId,
  courtId,
  bracketId,
  matchIds,
  userId = null,
}) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const court = await loadCourtForManualList({ tournamentId, courtId, session });
    const uniqueIds = await validateManualListMatches({
      tournamentId,
      courtId,
      bracketId,
      matchIds,
      session,
    });

    const pendingIds = uniqueIds.filter(
      (id) => id !== toIdString(court.currentMatch)
    );

    const nextManualAssignment =
      pendingIds.length > 0
        ? {
            enabled: true,
            bracketId: toObjectId(bracketId),
            fallbackToAuto: true,
            items: pendingIds.map((id, index) => ({
              matchId: toObjectId(id),
              order: index,
              state: MANUAL_ASSIGNMENT_PENDING,
              actedAt: null,
            })),
            updatedBy:
              userId && mongoose.Types.ObjectId.isValid(String(userId))
                ? toObjectId(userId)
                : null,
            updatedAt: new Date(),
          }
        : {
            enabled: false,
            bracketId: null,
            fallbackToAuto: true,
            items: [],
            updatedBy:
              userId && mongoose.Types.ObjectId.isValid(String(userId))
                ? toObjectId(userId)
                : null,
            updatedAt: new Date(),
          };

    court.manualAssignment = nextManualAssignment;
    await court.save({ session });

    await session.commitTransaction();
    session.endSession();

    let assignedMatch = null;
    if (!court.currentMatch && court.status === "idle" && pendingIds.length > 0) {
      assignedMatch = await assignNextToCourt({
        tournamentId,
        courtId,
        cluster: String(court.cluster || bracketId || "Main"),
      });
    }

    return {
      courtId: toIdString(court._id),
      assignedMatch,
    };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    session.endSession();
    throw error;
  }
}

export async function clearCourtMatchList({
  tournamentId,
  courtId,
  userId = null,
}) {
  const court = await loadCourtForManualList({ tournamentId, courtId });
  court.manualAssignment = {
    enabled: false,
    bracketId: null,
    fallbackToAuto: true,
    items: [],
    updatedBy:
      userId && mongoose.Types.ObjectId.isValid(String(userId))
        ? toObjectId(userId)
        : null,
    updatedAt: new Date(),
  };
  await court.save();
  return { courtId: toIdString(court._id) };
}

export async function advanceCourtMatchList({
  tournamentId,
  courtId,
  action = "skip_current",
}) {
  if (action !== "skip_current") {
    throw new Error("Unsupported action.");
  }

  const court = await Court.findOne({
    _id: courtId,
    tournament: tournamentId,
  })
    .select("_id tournament cluster status currentMatch manualAssignment")
    .lean();

  if (!court) {
    throw new Error("Kh?ng t?m th?y s?n.");
  }

  const match = await freeCourtAndAssignNext({ courtId });
  return {
    courtId: toIdString(court._id),
    match,
  };
}

export async function buildGroupsRotationQueue({
  tournamentId,
  bracket,
  cluster = "Main",
}) {
  const tid = new mongoose.Types.ObjectId(tournamentId);
  const clusterKey = bracket ? String(bracket) : cluster;

  const matchFilter = {
    tournament: tid,
    format: "group",
    status: { $in: ["scheduled", "queued", "assigned"] },
  };

  if (bracket) {
    matchFilter.bracket = new mongoose.Types.ObjectId(bracket);
  } else {
    matchFilter.courtCluster = clusterKey;
  }

  const matches = await Match.find(matchFilter)
    .select("_id pool rrRound round order status pairA pairB")
    .lean();

  const byPool = matches.reduce((acc, match) => {
    const key = (match.pool && match.pool.name) || "?";
    (acc[key] ||= []).push(match);
    return acc;
  }, {});

  const rk = (match) =>
    (Number.isInteger(match.rrRound) ? match.rrRound : match.round) || 0;

  Object.values(byPool).forEach((arr) =>
    arr.sort((a, b) => rk(a) - rk(b) || (a.order || 0) - (b.order || 0))
  );

  const pools = Object.keys(byPool).sort();
  const maxLen = Math.max(0, ...Object.values(byPool).map((arr) => arr.length));
  const linear = [];
  for (let index = 0; index < maxLen; index += 1) {
    for (const pool of pools) {
      const match = byPool[pool][index];
      if (match) linear.push(match);
    }
  }

  const regIds = new Set();
  for (const match of linear) {
    if (match.pairA) regIds.add(String(match.pairA));
    if (match.pairB) regIds.add(String(match.pairB));
  }
  const regUsers = await buildRegUsersMap(regIds);

  let order = 1;
  const bulk = [];
  for (const match of linear) {
    if (match.status === "assigned") continue;
    const participants = [
      ...(regUsers.get(String(match.pairA)) || []),
      ...(regUsers.get(String(match.pairB)) || []),
    ];
    bulk.push({
      updateOne: {
        filter: { _id: match._id },
        update: {
          $set: {
            status: "queued",
            queueOrder: order++,
            courtCluster: clusterKey,
            ...(participants.length ? { participants } : {}),
          },
        },
      },
    });
  }

  if (bulk.length) {
    await Match.bulkWrite(bulk);
  }

  return { totalQueued: bulk.length, pools: pools.length };
}

export async function assignNextToCourt({
  tournamentId,
  courtId,
  cluster = "Main",
  session = null,
}) {
  const tid = toObjectId(tournamentId);
  const cid = toObjectId(courtId);

  const court = await withSession(
    Court.findById(cid).select(
      "tournament isActive status name bracket cluster currentMatch manualAssignment"
    ),
    session
  ).lean();

  if (!court) return null;
  if (toIdString(court.tournament) !== toIdString(tid)) return null;
  if (!court.isActive) return null;
  if (court.status !== "idle") return null;

  const clusterKey = await getClusterKeyForCourt(court, cluster);

  const manualAssigned = await assignManualNextToCourt({
    tournamentId,
    court,
    clusterKey,
    session,
  });
  if (manualAssigned) {
    return manualAssigned;
  }

  if (
    isManualAssignmentEnabled(court) &&
    court.manualAssignment?.fallbackToAuto === false
  ) {
    return null;
  }

  const engagedParticipants = await getEngagedParticipants({
    tournamentId,
    clusterKey,
    session,
  });

  const reservationMap = await getManualReservationMap({
    tournamentId,
    excludeCourtId: courtId,
    session,
  });
  const reservedMatchIds = [...reservationMap.keys()];

  let next = await withSession(
    Match.findOneAndUpdate(
      {
        tournament: tid,
        court: null,
        courtCluster: clusterKey,
        status: "queued",
        ...buildParticipantsFreeFilter(engagedParticipants),
        ...buildReservedMatchFilter(reservedMatchIds),
      },
      {
        $set: {
          status: "assigned",
          court: cid,
          courtLabel: courtLabelOf(court),
          assignedAt: new Date(),
          courtCluster: clusterKey,
        },
      },
      { sort: { queueOrder: 1 }, new: true }
    ),
    session
  );

  const bracketId =
    court.bracket && mongoose.Types.ObjectId.isValid(String(court.bracket))
      ? toObjectId(court.bracket)
      : null;

  if (!next && bracketId) {
    next = await withSession(
      Match.findOneAndUpdate(
        {
          tournament: tid,
          court: null,
          bracket: bracketId,
          status: "queued",
          $or: [
            { courtCluster: { $exists: false } },
            { courtCluster: null },
            { courtCluster: "" },
          ],
          ...buildParticipantsFreeFilter(engagedParticipants),
          ...buildReservedMatchFilter(reservedMatchIds),
        },
        {
          $set: {
            status: "assigned",
            court: cid,
            courtLabel: courtLabelOf(court),
            assignedAt: new Date(),
            courtCluster: clusterKey,
          },
        },
        { sort: { queueOrder: 1 }, new: true }
      ),
      session
    );
  }

  if (!next && bracketId) {
    const candidates = await withSession(
      Match.find({
        tournament: tid,
        court: null,
        bracket: bracketId,
        status: "scheduled",
        ...buildReservedMatchFilter(reservedMatchIds),
      })
        .sort({ rrRound: 1, round: 1, order: 1, createdAt: 1 })
        .limit(12)
        .select("_id pairA pairB participants"),
      session
    ).lean();

    const regIds = new Set();
    for (const match of candidates) {
      if (!match.participants?.length) {
        if (match.pairA) regIds.add(String(match.pairA));
        if (match.pairB) regIds.add(String(match.pairB));
      }
    }
    const regUsers = await buildRegUsersMap(regIds);

    let chosen = null;
    for (const match of candidates) {
      const participants = match.participants?.length
        ? match.participants.map(String)
        : [
            ...(regUsers.get(String(match.pairA)) || []),
            ...(regUsers.get(String(match.pairB)) || []),
          ];
      const hasConflict = participants.some((participant) =>
        engagedParticipants.has(String(participant))
      );
      if (!hasConflict) {
        chosen = { _id: match._id, participants };
        break;
      }
    }

    if (chosen) {
      const maxQueued = await withSession(
        Match.find({ tournament: tid, courtCluster: clusterKey })
          .sort({ queueOrder: -1 })
          .limit(1)
          .select("queueOrder"),
        session
      ).lean();
      const nextQueueOrder = (maxQueued?.[0]?.queueOrder || 0) + 1;

      next = await withSession(
        Match.findOneAndUpdate(
          { _id: chosen._id, court: null, status: "scheduled" },
          {
            $set: {
              status: "assigned",
              court: cid,
              courtLabel: courtLabelOf(court),
              assignedAt: new Date(),
              courtCluster: clusterKey,
              queueOrder: nextQueueOrder,
              ...(chosen.participants.length
                ? { participants: chosen.participants }
                : {}),
            },
          },
          { new: true }
        ),
        session
      );
    }
  }

  if (!next) return null;

  await withSession(
    Court.updateOne(
      { _id: cid },
      { $set: { status: "assigned", currentMatch: next._id } }
    ),
    session
  );

  return next.toObject();
}

export async function fillIdleCourtsForCluster({
  tournamentId,
  cluster = "Main",
  maxAssign = Infinity,
}) {
  const tid = toObjectId(tournamentId);

  const idleCourts = await Court.find({
    tournament: tid,
    cluster,
    isActive: true,
    status: "idle",
  })
    .select("_id")
    .sort({ order: 1 })
    .lean();

  let assignedNow = 0;
  for (const court of idleCourts) {
    if (assignedNow >= maxAssign) break;
    const assigned = await assignNextToCourt({
      tournamentId,
      courtId: court._id,
      cluster,
    });
    if (assigned) assignedNow += 1;
  }

  const remainingQueued = await Match.countDocuments({
    tournament: tid,
    courtCluster: cluster,
    status: "queued",
    court: null,
  });

  return {
    assignedNow,
    idleCourtsChecked: idleCourts.length,
    remainingQueued,
  };
}

export async function freeCourtAndAssignNext({ courtId }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  let tournamentId = null;
  let clusterKey = "Main";

  try {
    const courtDoc = await withSession(
      Court.findById(courtId).select(
        "_id tournament cluster status currentMatch manualAssignment"
      ),
      session
    );
    if (!courtDoc) {
      await session.abortTransaction().catch(() => {});
      session.endSession();
      return null;
    }

    tournamentId = toIdString(courtDoc.tournament);
    clusterKey = String(courtDoc.cluster || "Main");

    let currentMatch = null;
    if (courtDoc.currentMatch) {
      currentMatch = await withSession(
        Match.findById(courtDoc.currentMatch).select(
          "_id status queueOrder courtCluster"
        ),
        session
      );
    }

    const manualSkip = isManualAssignmentEnabled(courtDoc);
    if (currentMatch) {
      await releaseCurrentMatchFromCourt(courtDoc, currentMatch, {
        session,
        manualSkip,
      });
    }

    courtDoc.status = "idle";
    courtDoc.currentMatch = null;
    await courtDoc.save({ session });

    await session.commitTransaction();
    session.endSession();
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    session.endSession();
    throw error;
  }

  return assignNextToCourt({
    tournamentId,
    courtId,
    cluster: clusterKey,
  });
}

export async function onMatchFinished({ matchId }) {
  const match = await Match.findById(matchId)
    .select("_id court tournament courtCluster")
    .lean();

  if (!match) {
    return { tournamentId: null, clusterKey: null, assigned: false };
  }

  if (!match.court) {
    return {
      tournamentId: match.tournament,
      clusterKey: match.courtCluster || null,
      assigned: false,
    };
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  let clusterKey = String(match.courtCluster || "Main");
  let shouldAssignNext = false;

  try {
    const courtDoc = await withSession(
      Court.findById(match.court).select(
        "_id tournament cluster currentMatch status manualAssignment"
      ),
      session
    );

    if (!courtDoc) {
      await withSession(
        Match.updateOne(
          { _id: match._id },
          { $set: { court: null, courtLabel: "", assignedAt: null } }
        ),
        session
      );
      await session.commitTransaction();
      session.endSession();
      return {
        tournamentId: match.tournament,
        clusterKey,
        assigned: false,
      };
    }

    clusterKey = String(courtDoc.cluster || clusterKey || "Main");

    if (toIdString(courtDoc.currentMatch) !== toIdString(match._id)) {
      await session.commitTransaction();
      session.endSession();
      return {
        tournamentId: match.tournament,
        clusterKey,
        assigned: false,
      };
    }

    await markManualItemStateOnCourtDoc(
      courtDoc,
      match._id,
      MANUAL_ASSIGNMENT_DONE,
      session
    );

    courtDoc.status = "idle";
    courtDoc.currentMatch = null;
    await courtDoc.save({ session });

    await withSession(
      Match.updateOne(
        { _id: match._id },
        { $set: { court: null, courtLabel: "", assignedAt: null } }
      ),
      session
    );

    shouldAssignNext = true;

    await session.commitTransaction();
    session.endSession();
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    session.endSession();
    throw error;
  }

  const assigned = shouldAssignNext
    ? await assignNextToCourt({
        tournamentId: match.tournament,
        courtId: match.court,
        cluster: clusterKey,
      })
    : null;

  return {
    tournamentId: match.tournament,
    clusterKey,
    assigned: !!assigned,
  };
}
