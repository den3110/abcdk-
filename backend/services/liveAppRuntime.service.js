import mongoose from "mongoose";
import Court from "../models/courtModel.js";
import CourtStation from "../models/courtStationModel.js";
import Match from "../models/matchModel.js";
import { createShortTtlCache } from "../utils/shortTtlCache.js";
import { getManualAssignmentItems } from "./courtManualAssignment.service.js";
import { getCourtLivePresenceSummaryMap } from "./courtLivePresence.service.js";
import { getCourtStationPresenceSummaryMap } from "./courtStationPresence.service.js";
import { getLiveLeaseConfig } from "./liveSessionLease.service.js";
import { CACHE_GROUP_IDS } from "./cacheGroups.js";
import { resolveMatchCourtStationFields } from "./courtCluster.service.js";
import { buildMatchCodePayload } from "../utils/matchDisplayCode.js";

const COURT_RUNTIME_CACHE_TTL_MS = Math.max(
  1000,
  Number(process.env.LIVE_APP_COURT_RUNTIME_CACHE_TTL_MS || 1500)
);
const MATCH_RUNTIME_CACHE_TTL_MS = Math.max(
  1000,
  Number(process.env.LIVE_APP_MATCH_RUNTIME_CACHE_TTL_MS || 2000)
);
const COURT_RUNTIME_WAIT_POLL_MS = Math.max(
  3000,
  Number(process.env.LIVE_APP_COURT_RUNTIME_WAIT_POLL_MS || 5000)
);
const COURT_RUNTIME_STEADY_POLL_MS = Math.max(
  COURT_RUNTIME_WAIT_POLL_MS,
  Number(process.env.LIVE_APP_COURT_RUNTIME_STEADY_POLL_MS || 10000)
);

const FINISHED = "finished";
const WAITING_SCREEN_STATES = new Set([
  "preview",
  "waiting_for_court",
  "waiting_for_next_match",
  "idle",
  "preview_unknown",
]);
const STATUS_RANK = {
  assigned: 0,
  queued: 1,
  scheduled: 2,
  live: 3,
};

const courtRuntimeCache = createShortTtlCache(COURT_RUNTIME_CACHE_TTL_MS, {
  id: CACHE_GROUP_IDS.liveAppCourtRuntime,
  label: "Live app court runtime",
  category: "live-app",
  scope: "private",
});
const matchRuntimeCache = createShortTtlCache(MATCH_RUNTIME_CACHE_TTL_MS, {
  id: CACHE_GROUP_IDS.liveAppMatchRuntime,
  label: "Live app match runtime",
  category: "live-app",
  scope: "private",
});

function toIdString(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function pick(value) {
  return String(value || "").trim();
}

function preferNick(person) {
  return (
    pick(person?.nickname) ||
    pick(person?.nickName) ||
    pick(person?.user?.nickname) ||
    pick(person?.user?.nickName) ||
    pick(person?.shortName)
  );
}

function fullNameOf(person) {
  return (
    pick(person?.fullName) ||
    pick(person?.name) ||
    pick(person?.displayName) ||
    preferNick(person)
  );
}

function resolveDisplayMode(match) {
  return match?.tournament?.nameDisplayMode === "fullName"
    ? "fullName"
    : "nickname";
}

function playerDisplayName(person, displayMode = "nickname") {
  if (displayMode === "fullName") {
    return fullNameOf(person) || preferNick(person);
  }
  return preferNick(person) || fullNameOf(person);
}

function teamDisplayName(registration, displayMode = "nickname") {
  if (!registration) return "";
  const explicit =
    pick(registration?.teamName) ||
    pick(registration?.displayName) ||
    pick(registration?.name) ||
    pick(registration?.label);
  if (explicit) return explicit;

  const players = [registration?.player1, registration?.player2].filter(Boolean);
  if (!players.length) return "";
  return players
    .map((person) => playerDisplayName(person, displayMode))
    .filter(Boolean)
    .join(" / ");
}

function normalizeBreakPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      active: false,
      afterGame: null,
      note: "",
      startedAt: null,
      expectedResumeAt: null,
    };
  }
  return {
    active: !!value.active,
    afterGame:
      typeof value.afterGame === "number" ? value.afterGame : null,
    note: pick(value.note),
    startedAt: value.startedAt || null,
    expectedResumeAt: value.expectedResumeAt || null,
  };
}

function buildGameScores(match) {
  const scores = Array.isArray(match?.gameScores) ? match.gameScores : [];
  const currentGameIndex =
    Number.isInteger(Number(match?.currentGame)) && Number(match.currentGame) >= 0
      ? Number(match.currentGame)
      : scores.length > 0
      ? scores.length - 1
      : 0;

  return scores.map((setScore, index) => ({
    index: index + 1,
    a: Number(setScore?.a || 0),
    b: Number(setScore?.b || 0),
    winner: pick(setScore?.winner),
    current: index === currentGameIndex,
  }));
}

function buildCurrentScore(gameScores) {
  if (!Array.isArray(gameScores) || !gameScores.length) {
    return { scoreA: 0, scoreB: 0 };
  }
  const current =
    gameScores.find((setScore) => setScore.current) || gameScores[gameScores.length - 1];
  return {
    scoreA: Number(current?.a || 0),
    scoreB: Number(current?.b || 0),
  };
}

const STAGE_NAME_MAP = {
  // Group / Round Robin
  "group stage": "Vòng bảng",
  "group": "Vòng bảng",
  "round robin": "Vòng bảng",
  "round_robin": "Vòng bảng",
  "vong bang": "Vòng bảng",
  "pool play": "Vòng bảng",
  // Knockout / Single Elimination
  "knockout": "Loại trực tiếp",
  "single elimination": "Loại trực tiếp",
  "single_elimination": "Loại trực tiếp",
  "roundelim": "Loại trực tiếp",
  // Double Elimination
  "double elimination": "Nhánh đấu",
  "double_elimination": "Nhánh đấu",
  "double_elim": "Nhánh đấu",
  "nhanh dau": "Nhánh đấu",
  // Specific rounds
  "round of 32": "Vòng 32 đội",
  "round of 16": "Vòng 16 đội",
  "quarterfinal": "Tứ kết",
  "quarterfinals": "Tứ kết",
  "quarter-final": "Tứ kết",
  "quarter final": "Tứ kết",
  "tu ket": "Tứ kết",
  "semifinal": "Bán kết",
  "semifinals": "Bán kết",
  "semi-final": "Bán kết",
  "semi final": "Bán kết",
  "ban ket": "Bán kết",
  "final": "Chung kết",
  "finals": "Chung kết",
  "grand final": "Chung kết",
  "chung ket": "Chung kết",
  // Consolation
  "consolation": "Tranh hạng 3",
  "3rd place": "Tranh hạng 3",
  "bronze": "Tranh hạng 3",
};

function normalizeStageName(raw) {
  if (!raw) return "";
  const key = raw.trim().toLowerCase();
  if (STAGE_NAME_MAP[key]) return STAGE_NAME_MAP[key];
  // Partial match for "round of N"
  const roundOfMatch = key.match(/^round\s+of\s+(\d+)$/);
  if (roundOfMatch) return `Vòng ${roundOfMatch[1]} đội`;
  return raw.trim(); // keep original if no mapping found
}

function buildStageName(match) {
  const bracketName = pick(match?.bracket?.name);
  if (bracketName) {
    const normalized = normalizeStageName(bracketName);
    if (normalized) return normalized;
  }

  const format = pick(match?.format).toLowerCase();
  if (format) {
    const normalized = normalizeStageName(format);
    if (normalized) return normalized;
  }
  return "";
}

function buildRoundLabel(match) {
  return (
    pick(match?.code) ||
    pick(match?.labelKey) ||
    (Number.isFinite(Number(match?.round)) ? `R${Number(match.round)}` : "")
  );
}

function buildTournamentLogoUrl(match) {
  return (
    pick(match?.tournament?.image) ||
    pick(match?.tournament?.overlay?.logoUrl) ||
    ""
  );
}

function buildResolvedCourtName(match) {
  const resolved = resolveMatchCourtStationFields(match);
  return (
    resolved.courtStationName ||
    pick(match?.court?.name) ||
    pick(match?.court?.label)
  );
}

function sortKey(match) {
  return [
    STATUS_RANK[match?.status] ?? 99,
    Number.isFinite(Number(match?.queueOrder))
      ? Number(match.queueOrder)
      : Number.POSITIVE_INFINITY,
    match?.assignedAt ? new Date(match.assignedAt).getTime() : Number.POSITIVE_INFINITY,
    match?.scheduledAt
      ? new Date(match.scheduledAt).getTime()
      : Number.POSITIVE_INFINITY,
    match?.startedAt ? new Date(match.startedAt).getTime() : Number.POSITIVE_INFINITY,
    Number.isFinite(Number(match?.round)) ? Number(match.round) : Number.POSITIVE_INFINITY,
    Number.isFinite(Number(match?.order)) ? Number(match.order) : Number.POSITIVE_INFINITY,
    match?.createdAt ? new Date(match.createdAt).getTime() : Number.POSITIVE_INFINITY,
    toIdString(match?._id),
  ];
}

function lexCmp(a, b) {
  const left = sortKey(a);
  const right = sortKey(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function isActiveMatchStatus(status) {
  return Object.prototype.hasOwnProperty.call(
    STATUS_RANK,
    pick(status).toLowerCase()
  );
}

async function resolvePreferredStationMatchIds(station) {
  const stationId = toIdString(station?._id);
  const currentMatchId = toIdString(station?.currentMatch);
  const queueMatchIds = Array.isArray(station?.assignmentQueue?.items)
    ? station.assignmentQueue.items
        .map((item) => toIdString(item?.matchId || item?.match))
        .filter(Boolean)
    : [];
  const orderedCandidateIds = [currentMatchId, ...queueMatchIds].filter(Boolean);
  const uniqueCandidateIds = Array.from(new Set(orderedCandidateIds));

  if (!uniqueCandidateIds.length) {
    return {
      currentMatchId: null,
      nextMatchId: null,
    };
  }

  const matches = await Match.find({
    _id: {
      $in: uniqueCandidateIds.filter((matchId) =>
        mongoose.Types.ObjectId.isValid(matchId)
      ),
    },
    status: { $nin: [FINISHED, "cancelled", "canceled"] },
  })
    .select("_id status courtStation queueOrder assignedAt scheduledAt startedAt round order createdAt")
    .lean();

  const matchById = new Map(
    matches.map((match) => [toIdString(match?._id), match])
  );
  const orderedCandidates = uniqueCandidateIds
    .map((matchId) => matchById.get(matchId) || null)
    .filter(Boolean);

  const activeCandidates = orderedCandidates.filter((match) =>
    isActiveMatchStatus(match?.status)
  );

  // Only consider live matches that are actually assigned to THIS station.
  // A match might be in the queue but playing on a different station.
  const liveCandidate =
    activeCandidates.find(
      (match) =>
        pick(match?.status).toLowerCase() === "live" &&
        (!toIdString(match?.courtStation) || toIdString(match.courtStation) === stationId)
    ) || null;

  return {
    currentMatchId: toIdString(liveCandidate?._id) || null,
    nextMatchId: null,
  };
}

async function findNextManualAssignmentMatchId(court) {
  const currentMatchId = toIdString(court?.currentMatch);
  const pendingIds = getManualAssignmentItems(court)
    .filter((item) => item?.state === "pending")
    .map((item) => toIdString(item?.matchId))
    .filter(Boolean)
    .filter((matchId) => matchId !== currentMatchId);

  if (!pendingIds.length) return null;

  const manualCandidates = await Match.find({
    _id: {
      $in: pendingIds.filter((matchId) => mongoose.Types.ObjectId.isValid(matchId)),
    },
    status: { $nin: [FINISHED, "cancelled", "canceled"] },
  })
    .select("_id")
    .lean();

  const availableIds = new Set(manualCandidates.map((match) => toIdString(match?._id)));
  return pendingIds.find((matchId) => availableIds.has(matchId)) || null;
}

async function findNextAssignedCourtMatchId(court) {
  const courtId = toIdString(court?._id);
  if (!courtId || !mongoose.Types.ObjectId.isValid(courtId)) return null;

  const candidates = await Match.find({
    court: courtId,
    status: { $ne: FINISHED },
  })
    .select("_id status queueOrder assignedAt scheduledAt startedAt round order createdAt")
    .lean();

  if (!candidates.length) return null;
  candidates.sort(lexCmp);

  const currentMatchId = toIdString(court?.currentMatch);
  const next = candidates.find((candidate) => toIdString(candidate?._id) !== currentMatchId);
  return next ? toIdString(next._id) : null;
}

async function resolveNextCourtMatchId(court) {
  if (court?.manualAssignment?.enabled) {
    const nextManual = await findNextManualAssignmentMatchId(court);
    if (nextManual) return nextManual;
  }
  return findNextAssignedCourtMatchId(court);
}

function buildCourtRuntimePayload({ court, presence, nextMatchId, leaseConfig }) {
  const currentMatchId = toIdString(court?.currentMatch) || null;
  const screenState = pick(presence?.screenState).toLowerCase();
  const hasWaitingPresence = WAITING_SCREEN_STATES.has(screenState);
  const waitingForAssignment =
    !currentMatchId || court?.status === "idle" || hasWaitingPresence;
  const recommendedPollIntervalMs = waitingForAssignment
    ? COURT_RUNTIME_WAIT_POLL_MS
    : COURT_RUNTIME_STEADY_POLL_MS;

  return {
    ok: true,
    courtId: toIdString(court?._id),
    tournamentId: toIdString(court?.tournament) || null,
    bracketId: toIdString(court?.bracket) || null,
    name: pick(court?.name) || pick(court?.label) || null,
    status: pick(court?.status) || "idle",
    isActive: court?.isActive !== false,
    currentMatchId,
    nextMatchId: nextMatchId || null,
    listEnabled: !!court?.manualAssignment?.enabled,
    remainingManualCount: getManualAssignmentItems(court).filter(
      (item) =>
        item?.state === "pending" && toIdString(item?.matchId) !== currentMatchId
    ).length,
    recommendedPollIntervalMs,
    cacheTtlMs: COURT_RUNTIME_CACHE_TTL_MS,
    presence: presence || null,
    presenceHints: {
      occupied: Boolean(presence?.occupied),
      screenState: presence?.screenState || null,
      heartbeatIntervalMs: COURT_RUNTIME_WAIT_POLL_MS,
    },
    leaseHints: {
      heartbeatIntervalMs: leaseConfig?.heartbeatIntervalMs || null,
      leaseTimeoutMs: leaseConfig?.leaseTimeoutMs || null,
    },
  };
}

function buildCourtStationRuntimePayload({
  station,
  presence,
  leaseConfig,
  currentMatchIdOverride = null,
  nextMatchIdOverride = null,
}) {
  const currentMatchId =
    currentMatchIdOverride || toIdString(station?.currentMatch) || null;
  const queueItems = Array.isArray(station?.assignmentQueue?.items)
    ? station.assignmentQueue.items
    : [];
  const queueCount = queueItems.length;
  const assignmentMode =
    String(station?.assignmentMode || "").trim().toLowerCase() === "queue"
      ? "queue"
      : "manual";
  const nextQueuedMatchId =
    assignmentMode === "queue"
      ? nextMatchIdOverride ||
        toIdString(queueItems[0]?.matchId || queueItems[0]?.match?._id) ||
        null
      : null;
  const screenState = pick(presence?.screenState).toLowerCase();
  const hasWaitingPresence = WAITING_SCREEN_STATES.has(screenState);
  const waitingForAssignment =
    !currentMatchId || station?.status === "idle" || hasWaitingPresence;
  const recommendedPollIntervalMs = waitingForAssignment
    ? COURT_RUNTIME_WAIT_POLL_MS
    : COURT_RUNTIME_STEADY_POLL_MS;

  return {
    ok: true,
    courtId: toIdString(station?._id),
    courtStationId: toIdString(station?._id),
    courtClusterId: toIdString(station?.clusterId?._id || station?.clusterId) || null,
    courtClusterName: pick(station?.clusterId?.name),
    tournamentId: toIdString(station?.currentTournament) || null,
    bracketId: null,
    name: pick(station?.name) || null,
    status: pick(station?.status) || "idle",
    isActive: station?.isActive !== false,
    currentMatchId,
    nextMatchId: nextQueuedMatchId,
    assignmentMode,
    queueCount,
    listEnabled: assignmentMode === "queue",
    remainingManualCount: queueCount,
    recommendedPollIntervalMs,
    cacheTtlMs: COURT_RUNTIME_CACHE_TTL_MS,
    presence: presence || null,
    presenceHints: {
      occupied: Boolean(presence?.occupied),
      screenState: presence?.screenState || null,
      heartbeatIntervalMs: COURT_RUNTIME_WAIT_POLL_MS,
    },
    leaseHints: {
      heartbeatIntervalMs: leaseConfig?.heartbeatIntervalMs || null,
      leaseTimeoutMs: leaseConfig?.leaseTimeoutMs || null,
    },
  };
}

function buildMatchRuntimePayload(match) {
  const displayMode = resolveDisplayMode(match);
  const { code, displayCode } = buildMatchCodePayload(match);
  const teamAName = teamDisplayName(match?.pairA, displayMode);
  const teamBName = teamDisplayName(match?.pairB, displayMode);
  const gameScores = buildGameScores(match);
  const { scoreA, scoreB } = buildCurrentScore(gameScores);
  const serveSide = pick(match?.serve?.side).toUpperCase() === "B" ? "B" : "A";
  const serveCount = Number(match?.serve?.server || 1) || 1;
  const normalizedBreak = normalizeBreakPayload(match?.isBreak);
  const tournamentLogoUrl = buildTournamentLogoUrl(match);

  return {
    _id: toIdString(match?._id),
    code: pick(code) || null,
    displayCode: pick(displayCode) || null,
    displayNameMode: displayMode,
    liveVersion: Number(match?.liveVersion || 0),
    teamAName,
    teamBName,
    scoreA,
    scoreB,
    serveSide,
    serveCount,
    status: pick(match?.status) || "scheduled",
    tournamentName: pick(match?.tournament?.name),
    courtName: buildResolvedCourtName(match),
    tournamentLogoUrl: tournamentLogoUrl || null,
    stageName: buildStageName(match),
    phaseText: pick(match?.phase),
    roundLabel: buildRoundLabel(match),
    seedA:
      Number.isFinite(Number(match?.pairA?.seed)) ? Number(match.pairA.seed) : null,
    seedB:
      Number.isFinite(Number(match?.pairB?.seed)) ? Number(match.pairB.seed) : null,
    isBreak: normalizedBreak,
    breakNote: normalizedBreak.note,
    gameScores,
    tournament: match?.tournament
      ? {
          _id: toIdString(match.tournament._id),
          name: pick(match.tournament.name),
          displayNameMode: displayMode,
          logoUrl: pick(match.tournament.overlay?.logoUrl) || null,
          imageUrl: tournamentLogoUrl || null,
        }
      : null,
    court: match?.court
      ? {
          _id: toIdString(match.court._id),
          name: pick(match.court.name),
          label: pick(match.court.label) || null,
          number:
            Number.isFinite(Number(match.court.number)) && Number(match.court.number) > 0
              ? Number(match.court.number)
              : null,
        }
      : null,
    courtStationId: resolveMatchCourtStationFields(match).courtStationId,
    courtStationName: resolveMatchCourtStationFields(match).courtStationName,
    courtClusterId: resolveMatchCourtStationFields(match).courtClusterId,
    courtClusterName: resolveMatchCourtStationFields(match).courtClusterName,
  };
}

export async function buildLiveAppCourtRuntime(courtId) {
  const normalizedCourtId = toIdString(courtId);
  if (!normalizedCourtId || !mongoose.Types.ObjectId.isValid(normalizedCourtId)) {
    return null;
  }

  const cached = courtRuntimeCache.get(normalizedCourtId);
  if (cached) {
    return {
      ...cached,
      _cache: { hit: true, ttlMs: COURT_RUNTIME_CACHE_TTL_MS },
    };
  }

  const station = await CourtStation.findById(normalizedCourtId)
    .populate("clusterId", "name slug")
    .lean();
  if (station) {
    const [presenceMap, leaseConfig, preferredMatchIds] = await Promise.all([
      getCourtStationPresenceSummaryMap([normalizedCourtId]),
      getLiveLeaseConfig().catch(() => null),
      resolvePreferredStationMatchIds(station),
    ]);

    const payload = buildCourtStationRuntimePayload({
      station,
      presence: presenceMap.get(normalizedCourtId) || station?.presence?.liveScreenPresence || null,
      leaseConfig,
      currentMatchIdOverride: preferredMatchIds.currentMatchId,
      nextMatchIdOverride: preferredMatchIds.nextMatchId,
    });
    courtRuntimeCache.set(normalizedCourtId, payload);
    return {
      ...payload,
      _cache: { hit: false, ttlMs: COURT_RUNTIME_CACHE_TTL_MS },
    };
  }

  const court = await Court.findById(normalizedCourtId)
    .select(
      "_id tournament bracket name label number status isActive currentMatch manualAssignment"
    )
    .lean();
  if (!court) return null;

  const [presenceMap, leaseConfig, nextMatchId] = await Promise.all([
    getCourtLivePresenceSummaryMap([normalizedCourtId]),
    getLiveLeaseConfig().catch(() => null),
    resolveNextCourtMatchId(court),
  ]);

  const payload = buildCourtRuntimePayload({
    court,
    presence: presenceMap.get(normalizedCourtId) || null,
    nextMatchId,
    leaseConfig,
  });
  courtRuntimeCache.set(normalizedCourtId, payload);
  return {
    ...payload,
    _cache: { hit: false, ttlMs: COURT_RUNTIME_CACHE_TTL_MS },
  };
}

export async function buildLiveAppMatchRuntime(matchId) {
  const normalizedMatchId = toIdString(matchId);
  if (!normalizedMatchId || !mongoose.Types.ObjectId.isValid(normalizedMatchId)) {
    return null;
  }

  const cached = matchRuntimeCache.get(normalizedMatchId);
  if (cached) {
    return {
      ...cached,
      _cache: { hit: true, ttlMs: MATCH_RUNTIME_CACHE_TTL_MS },
    };
  }

  const match = await Match.findById(normalizedMatchId)
    .select(
      "_id code displayCode globalCode labelKey liveVersion status format phase pool group groupNo groupIndex rrRound round order matchNo index stageIndex rules gameScores currentGame serve isBreak tournament bracket pairA pairB court courtStation courtStationLabel courtClusterId courtClusterLabel"
    )
    .populate({
      path: "tournament",
      select: "name image overlay nameDisplayMode",
    })
    .populate({
      path: "bracket",
      select: "name type",
    })
    .populate({
      path: "court",
      select: "name label number",
    })
    .populate({
      path: "courtStation",
      select: "name code clusterId",
      populate: {
        path: "clusterId",
        select: "name slug",
      },
    })
    .populate({
      path: "pairA",
      select: "player1 player2 seed label teamName displayName name",
      populate: [
        {
          path: "player1",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
        {
          path: "player2",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
      ],
    })
    .populate({
      path: "pairB",
      select: "player1 player2 seed label teamName displayName name",
      populate: [
        {
          path: "player1",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
        {
          path: "player2",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
      ],
    })
    .lean();

  if (!match) return null;

  const payload = buildMatchRuntimePayload(match);
  matchRuntimeCache.set(normalizedMatchId, payload);
  return {
    ...payload,
    _cache: { hit: false, ttlMs: MATCH_RUNTIME_CACHE_TTL_MS },
  };
}
