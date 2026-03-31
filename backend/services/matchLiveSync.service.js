import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";
import Registration from "../models/registrationModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import MatchLiveEvent from "../models/matchLiveEventModel.js";
import usersOfReg from "../utils/usersOfReg.js";
import latestSnapshot from "../utils/getLastestSnapshot.js";
import { applyRatingForFinishedMatch } from "../utils/applyRatingForFinishedMatch.js";
import { onMatchFinished } from "./courtQueueService.js";
import { advanceCourtStationQueueOnMatchFinished } from "./courtCluster.service.js";
import {
  publishCourtClusterRuntimeUpdate,
  publishCourtStationRuntimeUpdate,
} from "./courtStationRuntimeEvents.service.js";
import { emitTournamentMatchUpdate } from "../socket/tournamentRealtime.js";
import {
  claimMatchLiveOwner,
  getMatchLiveOwner,
} from "./matchLiveOwnership.service.js";
import { loadMatchLiveSnapshot } from "./matchLiveSnapshot.service.js";

function isFinitePos(n) {
  return Number.isFinite(n) && n > 0;
}

function evaluateGameFinish(aRaw, bRaw, rules) {
  const a = Number(aRaw) || 0;
  const b = Number(bRaw) || 0;

  const base = Number(rules?.pointsToWin ?? 11);
  const byTwo = rules?.winByTwo !== false;
  const mode = String(rules?.cap?.mode ?? "none");
  const capPoints =
    rules?.cap?.points != null ? Number(rules.cap.points) : null;

  if (mode === "hard" && isFinitePos(capPoints)) {
    if (a >= capPoints || b >= capPoints) {
      if (a === b) return { finished: false, winner: null, capped: false };
      return { finished: true, winner: a > b ? "A" : "B", capped: true };
    }
  }

  if (mode === "soft" && isFinitePos(capPoints)) {
    if (a >= capPoints || b >= capPoints) {
      if (a === b) return { finished: false, winner: null, capped: false };
      return { finished: true, winner: a > b ? "A" : "B", capped: true };
    }
  }

  if (byTwo) {
    if ((a >= base || b >= base) && Math.abs(a - b) >= 2) {
      return { finished: true, winner: a > b ? "A" : "B", capped: false };
    }
  } else if ((a >= base || b >= base) && a !== b) {
    return { finished: true, winner: a > b ? "A" : "B", capped: false };
  }

  return { finished: false, winner: null, capped: false };
}

function onLostRallyNextServe(prev) {
  if (prev.server === 1) return { side: prev.side, server: 2 };
  return { side: prev.side === "A" ? "B" : "A", server: 1 };
}

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function validSide(side) {
  return side === "A" || side === "B" ? side : "A";
}

function validServer(server) {
  return server === 1 || server === 2 ? server : 2;
}

function duplicateError(error) {
  return (
    error?.code === 11000 ||
    String(error?.message || "").toLowerCase().includes("duplicate key")
  );
}

function buildNormalizedRules(match) {
  return {
    bestOf: toNum(match.rules?.bestOf, 3),
    pointsToWin: toNum(match.rules?.pointsToWin, 11),
    winByTwo:
      match.rules?.winByTwo === undefined
        ? true
        : Boolean(match.rules?.winByTwo),
    cap: {
      mode: String(match.rules?.cap?.mode ?? "none"),
      points:
        match.rules?.cap?.points === undefined
          ? null
          : Number(match.rules.cap.points),
    },
  };
}

function normalizeEventInput(input) {
  const type = String(input?.type || "").trim().toLowerCase();
  if (!["start", "point", "undo", "finish", "forfeit"].includes(type)) {
    return { ok: false, code: "invalid_transition", message: "Unsupported event type" };
  }

  const payload =
    input?.payload && typeof input.payload === "object" ? input.payload : {};

  return {
    ok: true,
    event: {
      clientEventId: String(input?.clientEventId || "").trim(),
      type,
      payload,
      clientCreatedAt: input?.clientCreatedAt
        ? new Date(input.clientCreatedAt)
        : new Date(),
      clientBaseVersion: toNum(input?.clientBaseVersion, 0),
    },
  };
}

function ensureLiveLog(match) {
  if (!Array.isArray(match.liveLog)) match.liveLog = [];
}

function applyStartEvent(match, event, actorId) {
  if (match.status === "finished") {
    return { ok: false, code: "match_closed", message: "Match already finished" };
  }

  match.status = "live";
  if (!match.startedAt) match.startedAt = new Date();
  if (!match.gameScores?.length) {
    match.gameScores = [{ a: 0, b: 0 }];
    match.currentGame = 0;
  }
  if (!match.serve) {
    match.serve = { side: "A", server: 2 };
  }

  match.liveBy = actorId || match.liveBy || null;
  ensureLiveLog(match);
  match.liveLog.push({ type: "start", by: actorId || null, at: new Date() });
  match.liveVersion = toNum(match.liveVersion, 0) + 1;
  return { ok: true, emittedType: "start" };
}

function applyPointEvent(match, event, actorId) {
  if (match.status !== "live") {
    return { ok: false, code: "invalid_transition", message: "Match is not live" };
  }

  const team = String(event.payload?.team || "").toUpperCase();
  const step = Math.max(1, toNum(event.payload?.step, 1));
  if (!["A", "B"].includes(team)) {
    return { ok: false, code: "invalid_transition", message: "Invalid scoring side" };
  }

  if (!Array.isArray(match.gameScores)) match.gameScores = [];
  let gameIndex = Number.isInteger(match.currentGame) ? match.currentGame : 0;
  if (gameIndex < 0) gameIndex = 0;
  while (match.gameScores.length <= gameIndex) {
    match.gameScores.push({ a: 0, b: 0 });
  }

  const current = match.gameScores[gameIndex] || {};
  const score = {
    a: toNum(current.a, 0),
    b: toNum(current.b, 0),
  };

  if (team === "A") score.a += step;
  else score.b += step;
  match.gameScores[gameIndex] = score;

  const prevServe = {
    side: validSide(match.serve?.side),
    server: validServer(match.serve?.server),
  };

  const servingTeam = prevServe.side;
  if (team !== servingTeam) {
    match.serve = onLostRallyNextServe(prevServe);

    const base = match?.meta?.slots?.base;
    if (base && base[match.serve.side]) {
      const wanted = Number(match.serve.server);
      const entry = Object.entries(base[match.serve.side]).find(
        ([, slot]) => Number(slot) === wanted
      );
      match.serve.serverId = entry ? entry[0] : null;
    } else if (match.serve?.serverId) {
      match.serve.serverId = undefined;
    }
  }

  const rules = buildNormalizedRules(match);
  const evaluation = evaluateGameFinish(score.a, score.b, rules);
  if (evaluation.finished) {
    let aWins = 0;
    let bWins = 0;
    for (const game of match.gameScores) {
      const result = evaluateGameFinish(toNum(game?.a, 0), toNum(game?.b, 0), rules);
      if (!result.finished) continue;
      if (result.winner === "A") aWins += 1;
      if (result.winner === "B") bWins += 1;
    }
    const need = Math.floor(Number(rules.bestOf) / 2) + 1;
    if (aWins >= need || bWins >= need) {
      match.status = "finished";
      match.winner = aWins > bWins ? "A" : "B";
      if (!match.finishedAt) match.finishedAt = new Date();
    }
  }

  match.liveBy = actorId || match.liveBy || null;
  ensureLiveLog(match);
  match.liveLog.push({
    type: "point",
    by: actorId || null,
    payload: { team, step, prevServe },
    at: new Date(),
  });
  match.liveVersion = toNum(match.liveVersion, 0) + 1;
  return { ok: true, emittedType: "point" };
}

function applyUndoEvent(match) {
  if (!match?.liveLog?.length) {
    return { ok: false, code: "invalid_transition", message: "No point to undo" };
  }

  for (let index = match.liveLog.length - 1; index >= 0; index -= 1) {
    const event = match.liveLog[index];
    if (event?.type !== "point") continue;

    if (match.status === "finished") {
      match.status = "live";
      match.winner = "";
      match.finishedAt = null;
    }

    if (match.currentGame > 0) {
      const currentGame = match.gameScores?.[match.currentGame];
      if (currentGame?.a === 0 && currentGame?.b === 0) {
        match.gameScores.pop();
        match.currentGame -= 1;
      }
    }

    const current = match.gameScores?.[match.currentGame || 0];
    if (!current) {
      return { ok: false, code: "invalid_transition", message: "No active game to undo" };
    }

    const step = toNum(event.payload?.step, 1);
    if (event.payload?.team === "A") current.a = Math.max(0, toNum(current.a, 0) - step);
    if (event.payload?.team === "B") current.b = Math.max(0, toNum(current.b, 0) - step);

    if (event.payload?.prevServe) {
      match.serve = event.payload.prevServe;
    }

    match.liveLog.splice(index, 1);
    match.liveVersion = toNum(match.liveVersion, 0) + 1;
    return { ok: true, emittedType: "undo" };
  }

  return { ok: false, code: "invalid_transition", message: "No point to undo" };
}

function applyFinishEvent(match, event, actorId, { isForfeit = false } = {}) {
  if (!event.payload?.winner) {
    return { ok: false, code: "invalid_transition", message: "Winner is required" };
  }

  match.status = "finished";
  match.winner = event.payload.winner;
  match.finishedAt = new Date();
  if (event.payload?.reason) {
    match.note = `[${event.payload.reason}] ${match.note || ""}`.trim();
  }
  match.liveBy = actorId || match.liveBy || null;

  ensureLiveLog(match);
  match.liveLog.push({
    type: isForfeit ? "forfeit" : "finish",
    by: actorId || null,
    payload: {
      winner: event.payload.winner,
      reason: event.payload.reason || (isForfeit ? "forfeit" : ""),
    },
    at: new Date(),
  });
  match.liveVersion = toNum(match.liveVersion, 0) + 1;
  return { ok: true, emittedType: isForfeit ? "forfeit" : "finish" };
}

export function applyLiveSyncEvent(match, input, actorId = null) {
  const normalized = normalizeEventInput(input);
  if (!normalized.ok) return normalized;

  const { event } = normalized;
  if (event.type === "start") return applyStartEvent(match, event, actorId);
  if (event.type === "point") return applyPointEvent(match, event, actorId);
  if (event.type === "undo") return applyUndoEvent(match);
  if (event.type === "finish") return applyFinishEvent(match, event, actorId);
  if (event.type === "forfeit") {
    return applyFinishEvent(match, event, actorId, { isForfeit: true });
  }

  return { ok: false, code: "invalid_transition", message: "Unsupported event type" };
}

async function latestSnapshotDto(doc) {
  const { toRealtimePublicMatchDTO } = await import("../socket/liveHandlers.js");
  return toRealtimePublicMatchDTO(doc);
}

async function emitMatchRealtimeUpdate(io, matchId, type, doc) {
  if (!io || !matchId || !doc) return;
  const dto = await latestSnapshotDto(doc);
  if (!dto) return;
  emitTournamentMatchUpdate(io, doc, dto, {
    type,
    matchId: String(matchId),
    emitScoreUpdated: true,
  });
}

async function applyLegacyRatingDeltaForMatch(matchDoc, scorerId) {
  const delta = Number(matchDoc.ratingDelta) || 0;
  if (matchDoc.ratingApplied || delta <= 0) return;

  const tournament = await Tournament.findById(matchDoc.tournament).select(
    "eventType"
  );
  const eventType = tournament?.eventType === "single" ? "single" : "double";

  const registrations = await Registration.find({
    _id: { $in: [matchDoc.pairA, matchDoc.pairB].filter(Boolean) },
  })
    .select("player1 player2")
    .lean();
  const regA = registrations.find(
    (registration) => String(registration._id) === String(matchDoc.pairA)
  );
  const regB = registrations.find(
    (registration) => String(registration._id) === String(matchDoc.pairB)
  );

  const usersA = usersOfReg(regA);
  const usersB = usersOfReg(regB);
  if (!usersA.length || !usersB.length) return;

  const winners = matchDoc.winner === "A" ? usersA : usersB;
  const losers = matchDoc.winner === "A" ? usersB : usersA;
  const autoToken = `[AUTO mt:${String(matchDoc._id)}]`;
  const tokenNote = `${autoToken} winner:${matchDoc.winner} Δ${delta} (${eventType})`;

  const inserts = [];
  for (const uid of winners) {
    const previous = await latestSnapshot(uid);
    inserts.push({
      user: uid,
      scorer: scorerId || null,
      single:
        eventType === "single" ? previous.single + delta : previous.single,
      double:
        eventType === "double" ? previous.double + delta : previous.double,
      note: tokenNote,
      scoredAt: new Date(),
    });
  }
  for (const uid of losers) {
    const previous = await latestSnapshot(uid);
    inserts.push({
      user: uid,
      scorer: scorerId || null,
      single:
        eventType === "single"
          ? Math.max(0, previous.single - delta)
          : previous.single,
      double:
        eventType === "double"
          ? Math.max(0, previous.double - delta)
          : previous.double,
      note: tokenNote,
      scoredAt: new Date(),
    });
  }

  if (inserts.length) {
    await ScoreHistory.insertMany(inserts);
    matchDoc.ratingApplied = true;
    matchDoc.ratingAppliedAt = new Date();
    await matchDoc.save();
  }
}

async function runFinishedSideEffects(matchDoc, actorId = null) {
  try {
    if (!matchDoc.ratingApplied) {
      await applyRatingForFinishedMatch(matchDoc._id).catch(async () => {
        await applyLegacyRatingDeltaForMatch(matchDoc, actorId);
      });
      await onMatchFinished({ matchId: matchDoc._id });
      const stationAdvance = await advanceCourtStationQueueOnMatchFinished(
        matchDoc._id
      );
      if (stationAdvance?.station?._id && stationAdvance?.station?.clusterId) {
        await Promise.allSettled([
          publishCourtClusterRuntimeUpdate({
            clusterId: stationAdvance.station.clusterId,
            stationIds: [stationAdvance.station._id],
            reason: "match_finished_auto_advance",
          }),
          publishCourtStationRuntimeUpdate({
            stationId: stationAdvance.station._id,
            clusterId: stationAdvance.station.clusterId,
            reason: "match_finished_auto_advance",
          }),
        ]);
      }
    }
  } catch (error) {
    console.error("[match-live-sync] finish side effects error:", error);
  }
}

function buildRejected(events, code, message) {
  return (Array.isArray(events) ? events : []).map((event) => ({
    clientEventId: String(event?.clientEventId || "").trim(),
    code,
    message,
  }));
}

export async function syncMatchLiveEvents({
  matchId,
  user,
  deviceId,
  deviceName = "",
  source = "mobile_sync",
  lastKnownServerVersion = 0,
  events = [],
  io = null,
  enforceOwnership = true,
}) {
  const normalizedEvents = Array.isArray(events) ? events : [];
  if (!matchId) {
    throw new Error("matchId is required");
  }
  if (!deviceId) {
    return {
      ackedClientEventIds: [],
      rejectedEvents: buildRejected(
        normalizedEvents,
        "invalid_transition",
        "deviceId is required"
      ),
      snapshot: await loadMatchLiveSnapshot(matchId),
      serverVersion: toNum(lastKnownServerVersion, 0),
      owner: null,
    };
  }

  let owner = await getMatchLiveOwner(matchId);
  if (enforceOwnership && (!owner || String(owner.deviceId) === String(deviceId))) {
    const claimResult = await claimMatchLiveOwner({
      matchId,
      deviceId,
      userId: user?._id || null,
      displayName:
        user?.nickname ||
        user?.name ||
        user?.fullName ||
        deviceName ||
        "Referee device",
    });
    if (claimResult.ok) owner = claimResult.owner;
  }

  if (
    enforceOwnership &&
    owner &&
    String(owner.deviceId) !== String(deviceId || "")
  ) {
    return {
      ackedClientEventIds: [],
      rejectedEvents: buildRejected(
        normalizedEvents,
        "ownership_conflict",
        "Another scorer device owns this match"
      ),
      snapshot: await loadMatchLiveSnapshot(matchId),
      serverVersion: toNum(lastKnownServerVersion, 0),
      owner,
    };
  }

  const match = await Match.findById(matchId);
  if (!match) {
    return {
      ackedClientEventIds: [],
      rejectedEvents: buildRejected(
        normalizedEvents,
        "invalid_transition",
        "Match not found"
      ),
      snapshot: null,
      serverVersion: 0,
      owner,
    };
  }

  const actorId = user?._id || null;
  const ackedClientEventIds = [];
  const rejectedEvents = [];
  let lastEmittedType = null;

  for (let index = 0; index < normalizedEvents.length; index += 1) {
    const rawEvent = normalizedEvents[index];
    const normalized = normalizeEventInput(rawEvent);
    const clientEventId = String(rawEvent?.clientEventId || "").trim();

    if (!normalized.ok || !clientEventId) {
      const remaining = normalizedEvents.slice(index);
      rejectedEvents.push(
        ...buildRejected(
          remaining,
          normalized.code || "invalid_transition",
          normalized.message || "Invalid event payload"
        )
      );
      break;
    }

    const existing = await MatchLiveEvent.findOne({
      matchId,
      clientEventId,
    })
      .select("clientEventId serverVersion")
      .lean();

    if (existing) {
      ackedClientEventIds.push(clientEventId);
      continue;
    }

    const applyResult = applyLiveSyncEvent(match, normalized.event, actorId);
    if (!applyResult.ok) {
      const remaining = normalizedEvents.slice(index);
      rejectedEvents.push(
        ...buildRejected(remaining, applyResult.code, applyResult.message)
      );
      break;
    }

    try {
      await match.save();
      await MatchLiveEvent.create({
        matchId: match._id,
        tournamentId: match.tournament || null,
        clientEventId,
        deviceId: String(deviceId),
        actorId,
        type: normalized.event.type,
        payload: normalized.event.payload,
        clientCreatedAt: normalized.event.clientCreatedAt,
        clientBaseVersion: normalized.event.clientBaseVersion,
        serverVersion: toNum(match.liveVersion, 0),
        source,
        acceptedAt: new Date(),
      });
      ackedClientEventIds.push(clientEventId);
      lastEmittedType = applyResult.emittedType || normalized.event.type;
    } catch (error) {
      if (duplicateError(error)) {
        ackedClientEventIds.push(clientEventId);
        continue;
      }

      console.error("[match-live-sync] event persist failed:", error);
      const remaining = normalizedEvents.slice(index);
      rejectedEvents.push(
        ...buildRejected(
          remaining,
          "invalid_transition",
          "Unable to persist live event"
        )
      );
      break;
    }
  }

  if (match.status === "finished") {
    await runFinishedSideEffects(match, actorId);
  }

  const snapshot = await loadMatchLiveSnapshot(matchId);
  if (snapshot && ackedClientEventIds.length > 0) {
    await emitMatchRealtimeUpdate(io, matchId, lastEmittedType || "sync", snapshot);
  }

  return {
    ackedClientEventIds,
    rejectedEvents,
    snapshot,
    serverVersion: toNum(snapshot?.liveVersion, toNum(match.liveVersion, 0)),
    owner: await getMatchLiveOwner(matchId),
  };
}

export async function applyLegacyLiveAction({
  matchId,
  type,
  payload = {},
  user = null,
  io = null,
  deviceId = "",
  deviceName = "",
}) {
  const clientEventId = `${type}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  return syncMatchLiveEvents({
    matchId,
    user,
    deviceId: deviceId || `socket:${Math.random().toString(36).slice(2, 10)}`,
    deviceName,
    source: "legacy_socket",
    events: [
      {
        clientEventId,
        type,
        payload,
        clientCreatedAt: new Date().toISOString(),
        clientBaseVersion: 0,
      },
    ],
    io,
    enforceOwnership: true,
  });
}
