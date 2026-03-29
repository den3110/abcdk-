import mongoose from "mongoose";
import slugify from "slugify";
import CourtCluster from "../models/courtClusterModel.js";
import CourtStation from "../models/courtStationModel.js";
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";
import TournamentManager from "../models/tournamentManagerModel.js";
import User from "../models/userModel.js";
import {
  attachPublicStreamsToMatch,
  getLatestRecordingsByMatchIds,
} from "./publicStreams.service.js";
import {
  buildMatchCodePayload,
  buildMatchDisplayMeta,
  compareMatchDisplayOrder,
  isGroupishBracketType,
} from "../utils/matchDisplayCode.js";

const ACTIVE_MATCH_STATUSES = ["scheduled", "queued", "assigned", "live"];
const TERMINAL_MATCH_STATUSES = ["finished", "cancelled", "canceled"];
const ASSIGNMENT_MODES = ["manual", "queue"];
const MATCH_REF_POPULATE = [
  {
    path: "tournament",
    select: "name image status allowedCourtClusterIds eventType nameDisplayMode",
  },
  {
    path: "bracket",
    select: "_id name type stage order groups prefill ko meta config drawRounds",
  },
  {
    path: "pairA",
    populate: [
      { path: "player1.user", select: "name fullName nickname nickName" },
      { path: "player2.user", select: "name fullName nickname nickName" },
    ],
  },
  {
    path: "pairB",
    populate: [
      { path: "player1.user", select: "name fullName nickname nickName" },
      { path: "player2.user", select: "name fullName nickname nickName" },
    ],
  },
];
const MATCH_SUMMARY_SELECT = [
  "_id",
  "tournament",
  "status",
  "code",
  "displayCode",
  "globalCode",
  "labelKey",
  "format",
  "seedA",
  "seedB",
  "phase",
  "groupCode",
  "pool",
  "group",
  "groupNo",
  "groupIndex",
  "orderInGroup",
  "rrRound",
  "round",
  "order",
  "matchNo",
  "index",
  "stageIndex",
  "bracket",
  "courtStation",
  "courtStationLabel",
  "courtLabel",
  "courtClusterId",
  "courtClusterLabel",
  "pairA",
  "pairB",
  "gameScores",
  "live",
  "facebookLive",
  "video",
  "playbackUrl",
  "streamUrl",
  "liveUrl",
  "meta",
  "youtubeLive",
  "tiktokLive",
  "currentGame",
  "scheduledAt",
  "startedAt",
  "finishedAt",
  "updatedAt",
  "createdAt",
].join(" ");

function toIdString(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function safeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function safeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeObjectIdArray(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => toIdString(value))
        .filter((value) => mongoose.Types.ObjectId.isValid(value))
    )
  );
}

function normalizeStationStatus(value, fallback = "idle") {
  const normalized = safeText(value, fallback).toLowerCase();
  return ["idle", "assigned", "live", "maintenance"].includes(normalized)
    ? normalized
    : fallback;
}

function normalizeAssignmentMode(value, fallback = "manual") {
  const normalized = safeText(value, fallback).toLowerCase();
  return ASSIGNMENT_MODES.includes(normalized) ? normalized : fallback;
}

function buildRefereeSummary(referee) {
  const id = toIdString(referee?._id || referee);
  if (!id) return null;
  return {
    _id: id,
    name: safeText(referee?.name),
    fullName: safeText(referee?.fullName),
    nickname: safeText(referee?.nickname || referee?.nickName),
    nickName: safeText(referee?.nickName || referee?.nickname),
    email: safeText(referee?.email),
    phone: safeText(referee?.phone),
  };
}

function extractStationDefaultRefereeIds(station) {
  return normalizeObjectIdArray(station?.defaultReferees || []);
}

function collectStationAssignedMatchIds(station) {
  const ids = [];
  const currentMatchId = toIdString(station?.currentMatch?._id || station?.currentMatch);
  if (currentMatchId) ids.push(currentMatchId);

  (Array.isArray(station?.assignmentQueue?.items) ? station.assignmentQueue.items : [])
    .forEach((item) => {
      const matchId = toIdString(item?.matchId?._id || item?.matchId || item?.match?._id);
      if (matchId) ids.push(matchId);
    });

  return Array.from(new Set(ids));
}

async function validateTournamentRefereeIds(refereeIds = [], tournamentId = null) {
  const normalizedIds = normalizeObjectIdArray(refereeIds);
  if (!normalizedIds.length) return [];
  if (!tournamentId || !mongoose.Types.ObjectId.isValid(String(tournamentId))) {
    const error = new Error("Thiếu tournamentId hợp lệ để gán trọng tài cho sân.");
    error.status = 400;
    throw error;
  }

  const validRefs = await User.find({
    _id: { $in: normalizedIds },
    isDeleted: { $ne: true },
    role: "referee",
    "referee.tournaments": tournamentId,
  })
    .select("_id name fullName nickname nickName email phone")
    .lean();

  if (validRefs.length !== normalizedIds.length) {
    const error = new Error(
      "Có trọng tài không tồn tại, không phải referee, hoặc không thuộc giải hiện tại."
    );
    error.status = 400;
    throw error;
  }

  const refMap = new Map(validRefs.map((ref) => [toIdString(ref._id), ref]));
  return normalizedIds.map((id) => refMap.get(id)).filter(Boolean);
}

async function replaceMatchCourtStationReferees(matchId, refereeIds = []) {
  const normalizedMatchId = toIdString(matchId);
  if (!normalizedMatchId || !mongoose.Types.ObjectId.isValid(normalizedMatchId)) {
    return;
  }

  const match = await Match.findById(normalizedMatchId)
    .select("_id referee courtStationReferees")
    .lean();
  if (!match?._id) return;

  const nextStationRefIds = normalizeObjectIdArray(refereeIds);
  const previousStationRefIds = normalizeObjectIdArray(match.courtStationReferees);
  const currentRefIds = normalizeObjectIdArray(match.referee);
  const manualRefIds = currentRefIds.filter(
    (refId) => !previousStationRefIds.includes(refId)
  );
  const nextRefIds = Array.from(new Set([...manualRefIds, ...nextStationRefIds]));

  await Match.updateOne(
    { _id: match._id },
    {
      $set: {
        referee: nextRefIds,
        courtStationReferees: nextStationRefIds,
      },
    }
  );
}

async function syncStationRefereesForMatches(matchIds = [], refereeIds = []) {
  const uniqueMatchIds = normalizeObjectIdArray(matchIds);
  for (const matchId of uniqueMatchIds) {
    await replaceMatchCourtStationReferees(matchId, refereeIds);
  }
}

function isTerminalMatchStatus(status) {
  return TERMINAL_MATCH_STATUSES.includes(safeText(status).toLowerCase());
}

function isByeSeed(seed) {
  if (!seed || typeof seed !== "object") return false;
  const type = safeText(seed.type).toLowerCase();
  if (type === "bye") return true;
  const label = safeText(seed.label || seed.name).toUpperCase();
  return label === "BYE";
}

function isByeMatch(match) {
  return isByeSeed(match?.seedA) || isByeSeed(match?.seedB);
}

function isAdminLike(user) {
  if (!user) return false;
  if (user.isAdmin === true) return true;
  return safeText(user.role).toLowerCase() === "admin";
}

function readFirstText(...values) {
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return "";
}

function normalizeNameDisplayMode(value) {
  return safeText(value) === "fullName" ? "fullName" : "nickname";
}

function normalizeEventType(value) {
  return safeText(value).toLowerCase() === "single" ? "single" : "double";
}

function buildRegistrationPlayerSummary(player) {
  if (!player || typeof player !== "object") return null;
  const user = player.user && typeof player.user === "object" ? player.user : null;
  const name = readFirstText(player.name, user?.name);
  const fullName = readFirstText(player.fullName, user?.fullName, name);
  const nickname = readFirstText(
    player.nickname,
    player.nickName,
    user?.nickname,
    user?.nickName
  );

  return {
    _id: toIdString(player._id || user?._id) || null,
    name,
    fullName,
    nickname,
    nickName: nickname,
    user: user
      ? {
          _id: toIdString(user._id) || null,
          name: readFirstText(user.name),
          fullName: readFirstText(user.fullName, user.name),
          nickname: readFirstText(user.nickname, user.nickName),
          nickName: readFirstText(user.nickName, user.nickname),
        }
      : null,
  };
}

function playerNameForDisplay(player, displayMode = "nickname") {
  if (!player) return "";
  const nickname = readFirstText(player.nickname, player.nickName, player.user?.nickname, player.user?.nickName);
  const fullName = readFirstText(player.fullName, player.name, player.user?.fullName, player.user?.name);
  if (displayMode === "fullName") {
    return fullName || nickname;
  }
  return nickname || fullName;
}

function pairPlayersFromReg(reg) {
  if (!reg || typeof reg !== "object") return [];
  return [buildRegistrationPlayerSummary(reg.player1), buildRegistrationPlayerSummary(reg.player2)].filter(Boolean);
}

function teamNameFromReg(reg, options = {}) {
  if (!reg || typeof reg !== "object") return "";
  const explicit =
    safeText(reg.displayName) ||
    safeText(reg.teamName) ||
    safeText(reg.label) ||
    safeText(reg.title);
  if (explicit) return explicit;

  const displayMode = normalizeNameDisplayMode(options?.displayMode);
  const eventType = normalizeEventType(options?.eventType);
  const names = pairPlayersFromReg(reg)
    .slice(0, eventType === "single" ? 1 : 2)
    .map((player) => playerNameForDisplay(player, displayMode))
    .filter(Boolean);
  if (names.length) return names.join(" / ");

  return safeText(reg.name);
}

function extractTournamentIdFromMatch(match) {
  return toIdString(match?.tournament?._id || match?.tournament) || "";
}

function collectMatchesFromStations(stations = []) {
  return stations.flatMap((station) => [
    station?.currentMatch || null,
    ...(Array.isArray(station?.assignmentQueue?.items)
      ? station.assignmentQueue.items.map((item) => item?.matchId || item?.match)
      : []),
  ]);
}

function teamsFromRoundKey(key) {
  if (!key) return 0;
  const upper = String(key).toUpperCase();
  if (upper === "F") return 2;
  if (upper === "SF") return 4;
  if (upper === "QF") return 8;
  const matched = /^R(\d+)$/i.exec(upper);
  return matched ? parseInt(matched[1], 10) : 0;
}

function ceilPow2(value) {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(1, value || 1))));
}

function readBracketScale(bracket) {
  const fromKey =
    teamsFromRoundKey(bracket?.ko?.startKey) ||
    teamsFromRoundKey(bracket?.prefill?.roundKey);
  const fromPrefillPairs = Array.isArray(bracket?.prefill?.pairs)
    ? bracket.prefill.pairs.length * 2
    : 0;
  const fromPrefillSeeds = Array.isArray(bracket?.prefill?.seeds)
    ? bracket.prefill.seeds.length * 2
    : 0;
  const candidates = [
    bracket?.drawScale,
    bracket?.targetScale,
    bracket?.maxSlots,
    bracket?.capacity,
    bracket?.size,
    bracket?.scale,
    bracket?.meta?.drawSize,
    bracket?.meta?.scale,
    fromKey,
    fromPrefillPairs,
    fromPrefillSeeds,
  ]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 2);
  return candidates.length ? ceilPow2(Math.max(...candidates)) : 0;
}

function roundsCountForBracket(bracket, maxRoundByBracket = new Map()) {
  const type = String(bracket?.type || "")
    .trim()
    .toLowerCase();
  const bracketId = toIdString(bracket?._id);
  if (isGroupishBracketType(type)) return 1;

  if (["roundelim", "po", "playoff"].includes(type)) {
    let value =
      Number(bracket?.meta?.maxRounds) ||
      Number(bracket?.config?.roundElim?.maxRounds) ||
      0;
    if (!value) value = maxRoundByBracket.get(bracketId) || 1;
    return Math.max(1, value);
  }

  const fromMatches = maxRoundByBracket.get(bracketId) || 0;
  if (fromMatches) return Math.max(1, fromMatches);

  const firstPairs =
    (Array.isArray(bracket?.prefill?.seeds) && bracket.prefill.seeds.length) ||
    (Array.isArray(bracket?.prefill?.pairs) && bracket.prefill.pairs.length) ||
    0;
  if (firstPairs > 0) return Math.ceil(Math.log2(firstPairs * 2));

  const scale = readBracketScale(bracket);
  if (scale) return Math.ceil(Math.log2(scale));

  const drawRounds = Number(bracket?.drawRounds || 0);
  return drawRounds ? Math.max(1, drawRounds) : 1;
}

function buildBracketBaseByBracketId(brackets = [], maxRoundByBracket = new Map()) {
  const groupBrackets = brackets.filter((bracket) =>
    isGroupishBracketType(bracket?.type)
  );
  const nonGroupBrackets = brackets.filter(
    (bracket) => !isGroupishBracketType(bracket?.type)
  );
  const stageValue = (bracket) =>
    Number.isFinite(bracket?.stage) ? Number(bracket.stage) : 9999;

  const buckets = [];
  if (groupBrackets.length) {
    buckets.push({
      isGroup: true,
      brackets: groupBrackets,
      spanRounds: 1,
      stageHint: 1,
      orderHint: Math.min(
        ...groupBrackets.map((bracket) => Number(bracket?.order ?? 0))
      ),
    });
  }

  const byStage = new Map();
  for (const bracket of nonGroupBrackets) {
    const stage = stageValue(bracket);
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage).push(bracket);
  }

  const stageKeys = Array.from(byStage.keys()).sort((a, b) => a - b);
  for (const stage of stageKeys) {
    const stageBrackets = byStage.get(stage);
    const span =
      Math.max(
        ...stageBrackets.map((bracket) =>
          roundsCountForBracket(bracket, maxRoundByBracket)
        )
      ) || 1;
    buckets.push({
      isGroup: false,
      brackets: stageBrackets,
      spanRounds: span,
      stageHint: stage,
      orderHint: Math.min(
        ...stageBrackets.map((bracket) => Number(bracket?.order ?? 0))
      ),
    });
  }

  buckets.sort((a, b) => {
    if (a.isGroup && !b.isGroup) return -1;
    if (!a.isGroup && b.isGroup) return 1;
    if (a.stageHint !== b.stageHint) return a.stageHint - b.stageHint;
    return a.orderHint - b.orderHint;
  });

  const baseByBracketId = new Map();
  let accumulated = 0;
  for (const bucket of buckets) {
    for (const bracket of bucket.brackets) {
      baseByBracketId.set(toIdString(bracket?._id), accumulated);
    }
    accumulated += bucket.spanRounds;
  }

  return baseByBracketId;
}

async function buildMatchDisplayContextsByTournamentIds(tournamentIds = []) {
  const ids = Array.from(
    new Set(tournamentIds.map((value) => toIdString(value)).filter(Boolean))
  );
  if (!ids.length) return new Map();

  const objectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!objectIds.length) return new Map();

  const [brackets, roundsAgg] = await Promise.all([
    Bracket.find({ tournament: { $in: objectIds } })
      .select("_id tournament name type stage order groups prefill ko meta config drawRounds")
      .lean(),
    Match.aggregate([
      { $match: { tournament: { $in: objectIds } } },
      {
        $group: {
          _id: { tournament: "$tournament", bracket: "$bracket" },
          maxRound: { $max: "$round" },
        },
      },
    ]),
  ]);

  const bracketsByTournamentId = new Map();
  brackets.forEach((bracket) => {
    const tournamentId = toIdString(bracket?.tournament);
    if (!tournamentId) return;
    const bucket = bracketsByTournamentId.get(tournamentId) || [];
    bucket.push(bracket);
    bracketsByTournamentId.set(tournamentId, bucket);
  });

  const maxRoundByTournamentId = new Map();
  roundsAgg.forEach((row) => {
    const tournamentId = toIdString(row?._id?.tournament);
    const bracketId = toIdString(row?._id?.bracket);
    if (!tournamentId || !bracketId) return;
    const bucket = maxRoundByTournamentId.get(tournamentId) || new Map();
    bucket.set(bracketId, Number(row?.maxRound) || 0);
    maxRoundByTournamentId.set(tournamentId, bucket);
  });

  return new Map(
    ids.map((tournamentId) => [
      tournamentId,
      {
        baseByBracketId: buildBracketBaseByBracketId(
          bracketsByTournamentId.get(tournamentId) || [],
          maxRoundByTournamentId.get(tournamentId) || new Map()
        ),
      },
    ])
  );
}

export async function buildMatchDisplayContextsFromMatches(matches = []) {
  const tournamentIds = matches.map(extractTournamentIdFromMatch).filter(Boolean);
  return buildMatchDisplayContextsByTournamentIds(tournamentIds);
}

function getMatchDisplayOptions(match, options = {}) {
  const contexts = options?.matchDisplayContexts;
  if (!(contexts instanceof Map)) return {};
  const tournamentId = extractTournamentIdFromMatch(match);
  const context = tournamentId ? contexts.get(tournamentId) : null;
  return context?.baseByBracketId instanceof Map
    ? { baseByBracketId: context.baseByBracketId }
    : {};
}

function compareMatchesForDisplay(a, b, options = {}) {
  const aOptions = getMatchDisplayOptions(a, options);
  const bOptions = getMatchDisplayOptions(b, options);
  if (aOptions.baseByBracketId === bOptions.baseByBracketId) {
    return compareMatchDisplayOrder(a, b, aOptions);
  }

  const aMeta = buildMatchDisplayMeta(a, aOptions);
  const bMeta = buildMatchDisplayMeta(b, bOptions);
  if (aMeta.sortRound !== bMeta.sortRound) {
    return aMeta.sortRound - bMeta.sortRound;
  }
  if (aMeta.bracketStage !== bMeta.bracketStage) {
    return (aMeta.bracketStage || Number.MAX_SAFE_INTEGER) -
      (bMeta.bracketStage || Number.MAX_SAFE_INTEGER);
  }
  if (aMeta.bracketOrder !== bMeta.bracketOrder) {
    return aMeta.bracketOrder - bMeta.bracketOrder;
  }
  if (aMeta.sortPool !== bMeta.sortPool) {
    return aMeta.sortPool - bMeta.sortPool;
  }
  if (aMeta.sortOrder !== bMeta.sortOrder) {
    return aMeta.sortOrder - bMeta.sortOrder;
  }
  return String(a?._id || "").localeCompare(String(b?._id || ""));
}

function buildBracketSummary(bracket, displayMeta) {
  if (!bracket) return null;
  return {
    _id: toIdString(bracket._id),
    name: safeText(bracket.name),
    type: safeText(bracket.type),
    stage: safeInt(bracket.stage, 0),
    order: safeInt(bracket.order, 0),
    globalRound: displayMeta?.globalRound || null,
  };
}

function buildPoolSummary(match, displayMeta) {
  const poolName =
    safeText(match?.pool?.name) ||
    safeText(match?.pool?.key) ||
    safeText(match?.groupCode) ||
    safeText(displayMeta?.poolName);
  if (!poolName && !displayMeta?.poolIndex) return null;
  return {
    name: poolName || `B${displayMeta?.poolIndex || "?"}`,
    index: displayMeta?.poolIndex || null,
  };
}

function buildRuntimeTournamentSummary(tournament) {
  if (!tournament) return null;
  return {
    _id: toIdString(tournament._id || tournament),
    name: safeText(tournament?.name),
    image: safeText(tournament?.image),
    status: safeText(tournament?.status),
    eventType: safeText(tournament?.eventType),
    nameDisplayMode: normalizeNameDisplayMode(tournament?.nameDisplayMode),
  };
}

export function buildMatchSummary(match, options = {}) {
  if (!match) return null;
  const displayMeta = buildMatchDisplayMeta(
    match,
    getMatchDisplayOptions(match, options)
  );
  const tournamentSummary = buildRuntimeTournamentSummary(match.tournament);
  const displayMode = tournamentSummary?.nameDisplayMode || "nickname";
  const eventType = tournamentSummary?.eventType || "double";
  const { code, displayCode, globalCode } = buildMatchCodePayload(
    match,
    getMatchDisplayOptions(match, options)
  );
  return {
    _id: toIdString(match._id),
    status: safeText(match.status),
    code: safeText(code),
    displayCode: safeText(displayCode),
    globalCode: safeText(globalCode || match.globalCode),
    labelKey: safeText(match.labelKey),
    globalRound: displayMeta.globalRound,
    matchOrder: displayMeta.matchOrder,
    createdAt: match.createdAt || null,
    updatedAt: match.updatedAt || null,
    scheduledAt: match.scheduledAt || null,
    startedAt: match.startedAt || null,
    finishedAt: match.finishedAt || null,
    currentGame: Number.isFinite(Number(match.currentGame))
      ? Number(match.currentGame)
      : 0,
    tournament: tournamentSummary,
    bracket: buildBracketSummary(match.bracket, displayMeta),
    pool: buildPoolSummary(match, displayMeta),
    pairA: match.pairA
      ? {
          _id: toIdString(match.pairA._id || match.pairA),
          name: teamNameFromReg(match.pairA, { displayMode, eventType }),
          player1: buildRegistrationPlayerSummary(match.pairA.player1),
          player2: buildRegistrationPlayerSummary(match.pairA.player2),
        }
      : null,
    pairB: match.pairB
      ? {
          _id: toIdString(match.pairB._id || match.pairB),
          name: teamNameFromReg(match.pairB, { displayMode, eventType }),
          player1: buildRegistrationPlayerSummary(match.pairB.player1),
          player2: buildRegistrationPlayerSummary(match.pairB.player2),
        }
      : null,
    score: Array.isArray(match.gameScores) && match.gameScores.length
      ? match.gameScores[match.gameScores.length - 1]
      : null,
    live: match.live || null,
    facebookLive: match.facebookLive || null,
    courtLabel: safeText(match.courtStationLabel || match.courtLabel),
    courtStationId: toIdString(match.courtStation) || null,
    courtStationName: safeText(match.courtStationLabel || match.courtLabel),
    courtClusterId: toIdString(match.courtClusterId) || null,
    courtClusterName: safeText(match.courtClusterLabel || match.courtCluster),
    sort: {
      round: displayMeta.sortRound,
      bracketStage: displayMeta.bracketStage || null,
      bracketOrder: Number.isFinite(displayMeta.bracketOrder)
        ? displayMeta.bracketOrder
        : null,
      pool: displayMeta.poolIndex || null,
      order: displayMeta.matchOrder || null,
    },
  };
}

async function buildPublicCurrentMatchSummaryMap(matches = []) {
  const matchRows = matches.filter(Boolean);
  if (!matchRows.length) {
    return {
      matchDisplayContexts: new Map(),
      currentMatchById: new Map(),
    };
  }

  const [matchDisplayContexts, latestRecordingsByMatchId] = await Promise.all([
    buildMatchDisplayContextsFromMatches(matchRows),
    getLatestRecordingsByMatchIds(matchRows),
  ]);

  const currentMatchById = new Map();
  matchRows.forEach((match) => {
    const summary = buildMatchSummary(match, { matchDisplayContexts });
    const decorated = attachPublicStreamsToMatch(
      {
        ...summary,
        meta: match?.meta || {},
        video: safeText(match?.video),
        playbackUrl: safeText(match?.playbackUrl),
        streamUrl: safeText(match?.streamUrl),
        liveUrl: safeText(match?.liveUrl),
        facebookLive: match?.facebookLive || null,
        youtubeLive: match?.youtubeLive || null,
        tiktokLive: match?.tiktokLive || null,
        courtLabel: summary?.courtLabel || summary?.courtStationName || "",
      },
      latestRecordingsByMatchId.get(toIdString(match?._id)) || null
    );

    currentMatchById.set(toIdString(match?._id), decorated);
  });

  return {
    matchDisplayContexts,
    currentMatchById,
  };
}

function buildPublicStationPayload(
  station,
  { cluster = null, matchDisplayContexts = new Map(), currentMatchById = new Map() } = {}
) {
  const preferredCurrent = selectPreferredStationMatchDocs(station).currentMatch;
  const currentMatchId = toIdString(preferredCurrent?._id || preferredCurrent);
  return {
    ...buildStationSummary(station, { cluster, matchDisplayContexts }),
    currentMatch: currentMatchById.get(currentMatchId) || null,
    currentTournament: station?.currentTournament
      ? {
          _id: toIdString(station.currentTournament._id || station.currentTournament),
          name: safeText(station.currentTournament.name),
          image: safeText(station.currentTournament.image),
          status: safeText(station.currentTournament.status),
        }
      : null,
  };
}

function hasRenderablePublicStream(match = {}) {
  const streams = Array.isArray(match?.streams) ? match.streams : [];
  return streams.some(
    (stream) =>
      stream?.ready !== false &&
      Boolean(safeText(stream?.playUrl) || safeText(stream?.openUrl))
  );
}

function isRenderablePublicLiveStation(station = {}) {
  const stationStatus = safeText(station?.status).toLowerCase();
  const matchStatus = safeText(station?.currentMatch?.status).toLowerCase();
  return (
    stationStatus === "live" &&
    matchStatus === "live" &&
    Boolean(station?.currentMatch) &&
    hasRenderablePublicStream(station.currentMatch)
  );
}

function buildClusterSummary(cluster) {
  if (!cluster) return null;
  return {
    _id: toIdString(cluster._id),
    name: safeText(cluster.name),
    slug: safeText(cluster.slug),
    description: safeText(cluster.description),
    venueName: safeText(cluster.venueName),
    notes: safeText(cluster.notes),
    color: safeText(cluster.color),
    order: safeInt(cluster.order, 0),
    isActive: cluster.isActive !== false,
  };
}

function buildQueueItemSummary(item, options = {}) {
  if (!item) return null;
  const match = buildMatchSummary(item.matchId || item.match, options);
  return {
    matchId: toIdString(item.matchId?._id || item.matchId || item.match?._id) || null,
    order: safeInt(item.order, 0),
    queuedAt: item.queuedAt || null,
    queuedBy: toIdString(item.queuedBy) || null,
    match,
  };
}

function isActiveMatchStatus(status) {
  return ACTIVE_MATCH_STATUSES.includes(safeText(status).toLowerCase());
}

function normalizeStationNameKey(value) {
  return safeText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function isLiveMatchOnStation(match, stationId = null) {
  if (safeText(match?.status).toLowerCase() !== "live") return false;
  const matchStationId = toIdString(match?.courtStation?._id || match?.courtStation);
  if (!matchStationId || !stationId) return true;
  return matchStationId === stationId;
}

function collectStationQueueMatchDocs(station) {
  const items = Array.isArray(station?.assignmentQueue?.items)
    ? station.assignmentQueue.items
    : [];
  return items
    .map((item) => item?.matchId || item?.match || null)
    .filter(Boolean);
}

async function loadLiveMatchMapByStationIds(stationRefs = []) {
  const stationEntries = (Array.isArray(stationRefs) ? stationRefs : [stationRefs])
    .map((value) => {
      if (value && typeof value === "object") {
        return {
          id: toIdString(value?._id || value),
          name: safeText(value?.name),
          code: safeText(value?.code),
        };
      }
      return {
        id: toIdString(value),
        name: "",
        code: "",
      };
    })
    .filter((value) => value.id && mongoose.Types.ObjectId.isValid(value.id));

  const normalizedIds = Array.from(
    new Set(stationEntries.map((value) => value.id).filter(Boolean))
  );

  if (!normalizedIds.length) {
    return new Map();
  }

  const stationNameMap = new Map();
  const stationNames = Array.from(
    new Set(
      stationEntries
        .flatMap((station) => [station.name])
        .map((value) => safeText(value))
        .filter(Boolean)
    )
  );

  stationEntries.forEach((station) => {
    [station.name].forEach((label) => {
      const normalizedLabel = normalizeStationNameKey(label);
      if (!normalizedLabel || stationNameMap.has(normalizedLabel)) return;
      stationNameMap.set(normalizedLabel, station.id);
    });
  });

  const liveMatchQuery = {
    status: "live",
    $or: [{ courtStation: { $in: normalizedIds } }],
  };
  if (stationNames.length) {
    liveMatchQuery.$or.push(
      { courtLabel: { $in: stationNames } },
      { courtStationLabel: { $in: stationNames } }
    );
  }

  const matches = await Match.find(liveMatchQuery)
    .select(MATCH_SUMMARY_SELECT)
    .populate(MATCH_REF_POPULATE)
    .sort({ startedAt: -1, updatedAt: -1, createdAt: -1 })
    .lean();

  const byStationId = new Map();
  for (const match of matches) {
    const explicitStationId = toIdString(
      match?.courtStation?._id || match?.courtStation
    );
    const derivedStationId =
      stationNameMap.get(
        normalizeStationNameKey(
          match?.courtStationLabel || match?.courtLabel
        )
      ) || null;
    const stationId =
      (explicitStationId && normalizedIds.includes(explicitStationId)
        ? explicitStationId
        : null) || derivedStationId;
    if (!stationId || byStationId.has(stationId)) continue;
    byStationId.set(stationId, match);
  }

  return byStationId;
}

function selectPreferredStationMatchDocs(station, { liveCurrentMatch = null } = {}) {
  if (!station) {
    return {
      currentMatch: null,
      nextQueuedMatch: null,
    };
  }

  const orderedCandidates = [];
  const seenIds = new Set();
  const pushCandidate = (match) => {
    if (!match) return;
    const matchId = toIdString(match?._id || match);
    if (!matchId || seenIds.has(matchId)) return;
    seenIds.add(matchId);
    orderedCandidates.push(match);
  };

  pushCandidate(liveCurrentMatch);
  pushCandidate(station.currentMatch);
  collectStationQueueMatchDocs(station).forEach(pushCandidate);

  const stationId = toIdString(station?._id);
  const preferredCurrent =
    orderedCandidates.find((match) => isLiveMatchOnStation(match, stationId)) || null;
  const preferredCurrentId = toIdString(
    preferredCurrent?._id || preferredCurrent
  );
  const preferredNext = collectStationQueueMatchDocs(station).find((match) => {
    const matchId = toIdString(match?._id || match);
    if (!matchId || matchId === preferredCurrentId) return false;
    return isActiveMatchStatus(match?.status);
  }) || null;

  return {
    currentMatch: preferredCurrent,
    nextQueuedMatch: preferredNext,
  };
}

function buildStationSummary(station, options = {}) {
  if (!station) return null;
  const cluster = station.clusterId && typeof station.clusterId === "object"
    ? station.clusterId
    : options.cluster || null;
  const preferredMatches = selectPreferredStationMatchDocs(station, {
    liveCurrentMatch: options.liveCurrentMatch || null,
  });
  const queueItems = Array.isArray(station?.assignmentQueue?.items)
    ? station.assignmentQueue.items
        .map((item) => buildQueueItemSummary(item, options))
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
    : [];
  const rawStatus = safeText(station.status, "idle");
  const normalizedStatus = rawStatus.toLowerCase();
  const derivedStatus = preferredMatches.currentMatch
    ? "live"
    : queueItems.length && ["", "idle", "assigned", "live"].includes(normalizedStatus)
      ? "assigned"
      : rawStatus;
  return {
    _id: toIdString(station._id),
    name: safeText(station.name),
    code: safeText(station.code),
    order: safeInt(station.order, 0),
    isActive: station.isActive !== false,
    status: derivedStatus,
    assignmentMode: normalizeAssignmentMode(station.assignmentMode, "manual"),
    clusterId: toIdString(cluster?._id || station.clusterId) || null,
    clusterName: safeText(cluster?.name),
    defaultRefereeIds: extractStationDefaultRefereeIds(station),
    defaultReferees: (Array.isArray(station?.defaultReferees)
      ? station.defaultReferees
      : []
    )
      .map((referee) => buildRefereeSummary(referee))
      .filter(Boolean),
    currentMatchId:
      toIdString(preferredMatches.currentMatch?._id || preferredMatches.currentMatch) ||
      null,
    currentTournamentId: toIdString(station.currentTournament) || null,
    queueCount: queueItems.length,
    queueItems,
    nextQueuedMatch:
      buildMatchSummary(preferredMatches.nextQueuedMatch, options) ||
      queueItems[0]?.match ||
      null,
    liveConfig: station.liveConfig || null,
    presence: station.presence?.liveScreenPresence || null,
  };
}

function buildClusterSlug(name, id) {
  const base = slugify(safeText(name, "court-cluster"), {
    lower: true,
    strict: true,
  });
  const normalizedBase = base || "court-cluster";
  const normalizedId = safeText(id);
  return normalizedId ? `${normalizedBase}-${normalizedId}` : normalizedBase;
}

function buildStationCodeBase(name) {
  const base = slugify(safeText(name, "san"), {
    lower: false,
    strict: true,
    locale: "vi",
  });
  return safeText(base, "SAN").toUpperCase();
}

async function resolveUniqueStationCode(clusterId, name, excludeStationId = null) {
  const base = buildStationCodeBase(name);
  const query = { clusterId };
  if (excludeStationId) {
    query._id = { $ne: excludeStationId };
  }
  const rows = await CourtStation.find(query).select("code").lean();
  const used = new Set(
    rows
      .map((row) => safeText(row.code).toUpperCase())
      .filter(Boolean)
  );
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function resolveMatchCourtStationFields(matchDoc) {
  const match = matchDoc || {};
  const station =
    match.courtStation && typeof match.courtStation === "object"
      ? match.courtStation
      : null;
  const clusterFromStation =
    station?.clusterId && typeof station.clusterId === "object"
      ? station.clusterId
      : null;

  const courtStationId =
    toIdString(station?._id || match.courtStation || match.courtStationId) ||
    null;
  const courtStationName =
    safeText(
      station?.name ||
        station?.label ||
        match.courtStationLabel ||
        match.courtLabel
    ) || null;
  const courtClusterId =
    toIdString(
      clusterFromStation?._id ||
        station?.clusterId ||
        match.courtClusterId
    ) || null;
  const courtClusterName =
    safeText(
      clusterFromStation?.name ||
        match.courtClusterLabel ||
        match.courtCluster
    ) || null;

  return {
    courtStationId,
    courtStationName,
    courtClusterId,
    courtClusterName,
  };
}

function normalizeAssignmentQueueItems(items = []) {
  return items.map((item, index) => ({
    matchId: item.matchId,
    order: index + 1,
    queuedAt: item.queuedAt || new Date(),
    queuedBy: item.queuedBy || null,
  }));
}

function extractQueueMatchIds(station) {
  return Array.isArray(station?.assignmentQueue?.items)
    ? station.assignmentQueue.items
        .map((item) => toIdString(item?.matchId))
        .filter(Boolean)
    : [];
}

function ensureActiveQueueCandidate(match, tournamentId) {
  if (!match) {
    const error = new Error("Không tìm thấy trận đấu.");
    error.status = 404;
    throw error;
  }

  if (tournamentId && toIdString(match.tournament?._id || match.tournament) !== toIdString(tournamentId)) {
    const error = new Error("Chỉ được đưa vào danh sách các trận của đúng giải hiện tại.");
    error.status = 409;
    throw error;
  }

  if (!ACTIVE_MATCH_STATUSES.includes(safeText(match.status).toLowerCase())) {
    const error = new Error("Chỉ được đưa vào danh sách các trận chưa kết thúc.");
    error.status = 409;
    throw error;
  }

  if (isTerminalMatchStatus(match.status)) {
    const error = new Error("Trận đã kết thúc hoặc bị hủy, không thể đưa vào danh sách.");
    error.status = 409;
    throw error;
  }

  if (isByeMatch(match)) {
    const error = new Error("Trận BYE không thể đưa vào danh sách sân tự động.");
    error.status = 409;
    throw error;
  }
}

async function loadQueueMatches(matchIds = []) {
  const normalizedIds = matchIds
    .map((value) => toIdString(value))
    .filter(Boolean);
  if (!normalizedIds.length) return [];

  const docs = await Match.find({
    _id: { $in: normalizedIds },
  })
    .select(MATCH_SUMMARY_SELECT)
    .populate(MATCH_REF_POPULATE)
    .lean();

  const byId = new Map(docs.map((doc) => [toIdString(doc._id), doc]));
  return normalizedIds.map((matchId) => byId.get(matchId)).filter(Boolean);
}

async function ensureNoQueueConflicts(matchIds = [], stationId = null) {
  const normalizedIds = matchIds
    .map((value) => toIdString(value))
    .filter(Boolean);
  if (!normalizedIds.length) return;

  const query = {
    $or: [
      { currentMatch: { $in: normalizedIds } },
      { "assignmentQueue.items.matchId": { $in: normalizedIds } },
    ],
  };
  if (stationId) {
    query._id = { $ne: stationId };
  }

  const conflictingStations = await CourtStation.find(query)
    .select("_id name currentMatch assignmentQueue.items.matchId")
    .lean();

  const conflictMap = new Map();
  conflictingStations.forEach((station) => {
    const stationLabel = safeText(station.name, "San");
    const currentMatchId = toIdString(station.currentMatch);
    if (currentMatchId) {
      conflictMap.set(currentMatchId, stationLabel);
    }
    for (const queueId of extractQueueMatchIds(station)) {
      conflictMap.set(queueId, stationLabel);
    }
  });

  const conflictId = normalizedIds.find((matchId) => conflictMap.has(matchId));
  if (conflictId) {
    const error = new Error(
      `Trận này đã được gán hoặc chờ sân khác (${conflictMap.get(conflictId)}).`
    );
    error.status = 409;
    throw error;
  }
}

async function maybeAssignNextQueuedMatch(stationId) {
  let station = await CourtStation.findById(stationId)
    .select(
      "_id clusterId assignmentMode assignmentQueue currentMatch currentTournament status"
    )
    .lean();
  if (!station) return null;
  if (normalizeAssignmentMode(station.assignmentMode) !== "queue") return null;
  if (station.currentMatch) return null;

  while (true) {
    const queueItems = Array.isArray(station?.assignmentQueue?.items)
      ? [...station.assignmentQueue.items].sort(
          (left, right) => safeInt(left.order, 0) - safeInt(right.order, 0)
        )
      : [];

    if (!queueItems.length) {
      await CourtStation.updateOne(
        { _id: station._id },
        {
          $set: {
            status: "idle",
            currentTournament: null,
          },
        }
      ).catch(() => {});
      return null;
    }

    const [head, ...rest] = queueItems;
    const candidateId = toIdString(head?.matchId);
    if (!candidateId) {
      await CourtStation.updateOne(
        { _id: station._id },
        {
          $set: {
            assignmentQueue: { items: normalizeAssignmentQueueItems(rest) },
          },
        }
      );
      station = await CourtStation.findById(stationId)
        .select(
          "_id clusterId assignmentMode assignmentQueue currentMatch currentTournament status"
        )
        .lean();
      continue;
    }

    try {
      const [candidate] = await loadQueueMatches([candidateId]);
      ensureActiveQueueCandidate(candidate, candidate?.tournament?._id || candidate?.tournament);
      await ensureNoQueueConflicts([candidateId], station._id);

      await CourtStation.updateOne(
        { _id: station._id },
        {
          $set: {
            assignmentQueue: { items: normalizeAssignmentQueueItems(rest) },
          },
        }
      );

      return assignMatchToCourtStation(station._id, candidateId, {
        ignoreAssignmentMode: true,
      });
    } catch (error) {
      await CourtStation.updateOne(
        { _id: station._id },
        {
          $set: {
            assignmentQueue: { items: normalizeAssignmentQueueItems(rest) },
            status: "idle",
          },
        }
      );
      station = await CourtStation.findById(stationId)
        .select(
          "_id clusterId assignmentMode assignmentQueue currentMatch currentTournament status"
        )
        .lean();
    }
  }
}

export async function cleanupTournamentAssignmentsForRemovedClusters(
  tournamentId,
  clusterIds = []
) {
  const normalizedTournamentId = toIdString(tournamentId);
  const normalizedClusterIds = Array.from(
    new Set(clusterIds.map((value) => toIdString(value)).filter(Boolean))
  );

  if (!normalizedTournamentId || !normalizedClusterIds.length) {
    return {
      touchedClusterIds: [],
      touchedStationIds: [],
      clearedCurrentMatchIds: [],
      removedQueueMatchIds: [],
    };
  }

  const stations = await CourtStation.find({
    clusterId: { $in: normalizedClusterIds },
  })
    .select(
      "_id clusterId assignmentMode assignmentQueue currentMatch currentTournament status"
    )
    .lean();

  if (!stations.length) {
    return {
      touchedClusterIds: [],
      touchedStationIds: [],
      clearedCurrentMatchIds: [],
      removedQueueMatchIds: [],
    };
  }

  const relatedMatchIds = Array.from(
    new Set(
      stations
        .flatMap((station) => [
          toIdString(station?.currentMatch),
          ...extractQueueMatchIds(station),
        ])
        .filter(Boolean)
    )
  );

  const tournamentMatches = relatedMatchIds.length
    ? await Match.find({
        _id: { $in: relatedMatchIds },
        tournament: normalizedTournamentId,
      })
        .select("_id")
        .lean()
    : [];

  const tournamentMatchIdSet = new Set(
    tournamentMatches.map((match) => toIdString(match?._id)).filter(Boolean)
  );

  const touchedClusterIds = new Set();
  const touchedStationIds = new Set();
  const clearedCurrentMatchIds = new Set();
  const removedQueueMatchIds = new Set();

  for (const station of stations) {
    const stationId = toIdString(station?._id);
    const clusterId = toIdString(station?.clusterId);
    const currentMatchId = toIdString(station?.currentMatch);
    const currentBelongsToTournament =
      (currentMatchId && tournamentMatchIdSet.has(currentMatchId)) ||
      toIdString(station?.currentTournament) === normalizedTournamentId;

    const existingQueueItems = Array.isArray(station?.assignmentQueue?.items)
      ? station.assignmentQueue.items
      : [];
    const nextQueueItems = normalizeAssignmentQueueItems(
      existingQueueItems.filter((item) => {
        const matchId = toIdString(item?.matchId);
        const shouldKeep = !matchId || !tournamentMatchIdSet.has(matchId);
        if (!shouldKeep && matchId) {
          removedQueueMatchIds.add(matchId);
        }
        return shouldKeep;
      })
    );

    const queueChanged = nextQueueItems.length !== existingQueueItems.length;
    if (!currentBelongsToTournament && !queueChanged) {
      continue;
    }

    const nextSet = {
      assignmentQueue: { items: nextQueueItems },
    };

    if (currentBelongsToTournament) {
      nextSet.currentMatch = null;
      nextSet.currentTournament = null;
      nextSet.status = nextQueueItems.length ? "assigned" : "idle";
      if (currentMatchId) clearedCurrentMatchIds.add(currentMatchId);
    }

    await CourtStation.updateOne({ _id: stationId }, { $set: nextSet });

    if (currentBelongsToTournament && currentMatchId) {
      await clearMatchStationFields(currentMatchId, stationId);
    }

    touchedClusterIds.add(clusterId);
    touchedStationIds.add(stationId);
  }

  return {
    touchedClusterIds: Array.from(touchedClusterIds),
    touchedStationIds: Array.from(touchedStationIds),
    clearedCurrentMatchIds: Array.from(clearedCurrentMatchIds),
    removedQueueMatchIds: Array.from(removedQueueMatchIds),
  };
}

async function listManagedTournamentIds(userId) {
  const managerRows = await TournamentManager.find({ user: userId })
    .select("tournament")
    .lean();
  return Array.from(
    new Set(
      managerRows
        .map((row) => toIdString(row.tournament))
        .filter(Boolean)
    )
  );
}

export async function listManageableCourtClustersForUser(user) {
  if (!user?._id) return [];
  const query = {};
  if (!isAdminLike(user)) {
    const tournamentIds = await listManagedTournamentIds(user._id);
    if (!tournamentIds.length) return [];
    const tournaments = await Tournament.find({ _id: { $in: tournamentIds } })
      .select("allowedCourtClusterIds")
      .lean();
    const clusterIds = Array.from(
      new Set(
        tournaments
          .flatMap((tournament) =>
            Array.isArray(tournament.allowedCourtClusterIds)
              ? tournament.allowedCourtClusterIds
              : []
          )
          .map((value) => toIdString(value))
          .filter(Boolean)
      )
    );
    if (!clusterIds.length) return [];
    query._id = { $in: clusterIds };
  }

  const docs = await CourtCluster.find(query)
    .sort({ order: 1, name: 1, createdAt: 1 })
    .lean();
  return docs.map(buildClusterSummary);
}

export async function canManageCourtCluster(user, clusterId) {
  const normalizedClusterId = toIdString(clusterId);
  if (!user?._id || !normalizedClusterId) return false;
  if (isAdminLike(user)) return true;
  const tournamentIds = await listManagedTournamentIds(user._id);
  if (!tournamentIds.length) return false;
  const exists = await Tournament.exists({
    _id: { $in: tournamentIds },
    allowedCourtClusterIds: normalizedClusterId,
  });
  return !!exists;
}

export async function createCourtCluster(data = {}) {
  const payload = {
    name: safeText(data.name, "Cụm sân"),
    description: safeText(data.description),
    venueName: safeText(data.venueName),
    notes: safeText(data.notes),
    color: safeText(data.color),
    order: safeInt(data.order, 0),
    isActive: data.isActive !== false,
  };
  const doc = new CourtCluster(payload);
  doc.slug = buildClusterSlug(doc.name, doc._id);
  await doc.save();
  return buildClusterSummary(doc.toObject());
}

export async function listCourtClusters(filters = {}) {
  const query = {};
  if (filters.activeOnly) {
    query.isActive = true;
  }
  const docs = await CourtCluster.find(query)
    .sort({ order: 1, name: 1, createdAt: 1 })
    .lean();
  return docs.map(buildClusterSummary);
}

export async function updateCourtCluster(clusterId, data = {}) {
  const update = {};
  if (Object.prototype.hasOwnProperty.call(data, "name")) {
    update.name = safeText(data.name, "Cụm sân");
  }
  if (Object.prototype.hasOwnProperty.call(data, "name")) {
    update.slug = buildClusterSlug(update.name, clusterId);
  }
  if (Object.prototype.hasOwnProperty.call(data, "description")) {
    update.description = safeText(data.description);
  }
  if (Object.prototype.hasOwnProperty.call(data, "venueName")) {
    update.venueName = safeText(data.venueName);
  }
  if (Object.prototype.hasOwnProperty.call(data, "notes")) {
    update.notes = safeText(data.notes);
  }
  if (Object.prototype.hasOwnProperty.call(data, "color")) {
    update.color = safeText(data.color);
  }
  if (Object.prototype.hasOwnProperty.call(data, "order")) {
    update.order = safeInt(data.order, 0);
  }
  if (Object.prototype.hasOwnProperty.call(data, "isActive")) {
    update.isActive = data.isActive !== false;
  }
  const doc = await CourtCluster.findByIdAndUpdate(
    clusterId,
    { $set: update },
    { new: true, runValidators: true }
  ).lean();
  return doc ? buildClusterSummary(doc) : null;
}

export async function deleteCourtCluster(clusterId) {
  const stationCount = await CourtStation.countDocuments({ clusterId });
  if (stationCount > 0) {
    const error = new Error("Cluster vẫn còn sân vật lý, không thể xoá.");
    error.status = 409;
    throw error;
  }
  const inUseTournament = await Tournament.exists({
    allowedCourtClusterIds: clusterId,
  });
  if (inUseTournament) {
    const error = new Error("Cluster đang được gán cho tournament.");
    error.status = 409;
    throw error;
  }
  return CourtCluster.findByIdAndDelete(clusterId).lean();
}

export async function listCourtStations(clusterId, { includeMatches = false } = {}) {
  const query = CourtStation.find({ clusterId })
    .populate("clusterId", "name slug description venueName notes color order isActive")
    .populate("defaultReferees", "name fullName nickname nickName email phone")
    .sort({ order: 1, name: 1, createdAt: 1 });

  if (includeMatches) {
    query.populate([
      {
        path: "currentMatch",
        select: MATCH_SUMMARY_SELECT,
        populate: MATCH_REF_POPULATE,
      },
      {
        path: "assignmentQueue.items.matchId",
        select: MATCH_SUMMARY_SELECT,
        populate: MATCH_REF_POPULATE,
      },
      { path: "currentTournament", select: "name image status" },
    ]);
  } else {
    query.populate("currentTournament", "name image status");
  }

  const docs = await query.lean();
  const liveMatchByStationId = includeMatches
    ? await loadLiveMatchMapByStationIds(docs)
    : new Map();
  const matchDisplayContexts = includeMatches
    ? await buildMatchDisplayContextsFromMatches([
        ...collectMatchesFromStations(docs),
        ...Array.from(liveMatchByStationId.values()),
      ])
    : new Map();
  return docs.map((station) => ({
    ...buildStationSummary(station, {
      matchDisplayContexts,
      liveCurrentMatch:
        liveMatchByStationId.get(toIdString(station?._id)) || null,
    }),
    currentMatch: buildMatchSummary(
      selectPreferredStationMatchDocs(station, {
        liveCurrentMatch:
          liveMatchByStationId.get(toIdString(station?._id)) || null,
      }).currentMatch,
      { matchDisplayContexts }
    ),
    currentTournament: station.currentTournament
      ? {
          _id: toIdString(station.currentTournament._id || station.currentTournament),
          name: safeText(station.currentTournament.name),
          image: safeText(station.currentTournament.image),
          status: safeText(station.currentTournament.status),
        }
      : null,
  }));
}


export async function createCourtStation(clusterId, data = {}) {
  const name = safeText(data.name, "San");
  const payload = {
    clusterId,
    name,
    code: await resolveUniqueStationCode(clusterId, name),
    order: safeInt(data.order, 0),
    isActive: data.isActive !== false,
    status: normalizeStationStatus(data.status, "idle"),
    assignmentMode: normalizeAssignmentMode(data.assignmentMode, "manual"),
    assignmentQueue: {
      items: normalizeAssignmentQueueItems(
        Array.isArray(data?.assignmentQueue?.items) ? data.assignmentQueue.items : []
      ),
    },
    defaultReferees: normalizeObjectIdArray(data.defaultReferees || []),
    liveConfig:
      data.liveConfig && typeof data.liveConfig === "object"
        ? data.liveConfig
        : undefined,
  };
  const doc = await CourtStation.create(payload);
  return buildStationSummary(doc.toObject(), { cluster: { _id: clusterId } });
}

export async function updateCourtStation(stationId, data = {}) {
  const current = await CourtStation.findById(stationId)
    .select("_id clusterId name")
    .lean();
  if (!current) return null;

  const update = {};
  let nextName = safeText(current.name, "San");
  if (Object.prototype.hasOwnProperty.call(data, "name")) {
    nextName = safeText(data.name, "San");
    update.name = nextName;
  }
  if (
    Object.prototype.hasOwnProperty.call(data, "name") ||
    Object.prototype.hasOwnProperty.call(data, "code")
  ) {
    update.code = await resolveUniqueStationCode(current.clusterId, nextName, stationId);
  }
  if (Object.prototype.hasOwnProperty.call(data, "order")) {
    update.order = safeInt(data.order, 0);
  }
  if (Object.prototype.hasOwnProperty.call(data, "isActive")) {
    update.isActive = data.isActive !== false;
  }
  if (Object.prototype.hasOwnProperty.call(data, "status")) {
    update.status = normalizeStationStatus(data.status, "idle");
  }
  if (Object.prototype.hasOwnProperty.call(data, "assignmentMode")) {
    update.assignmentMode = normalizeAssignmentMode(data.assignmentMode, "manual");
  }
  if (Object.prototype.hasOwnProperty.call(data, "assignmentQueue")) {
    update.assignmentQueue = {
      items: normalizeAssignmentQueueItems(
        Array.isArray(data?.assignmentQueue?.items) ? data.assignmentQueue.items : []
      ),
    };
  }
  if (Object.prototype.hasOwnProperty.call(data, "defaultReferees")) {
    update.defaultReferees = normalizeObjectIdArray(data.defaultReferees || []);
  }
  if (Object.prototype.hasOwnProperty.call(data, "liveConfig")) {
    update.liveConfig =
      data.liveConfig && typeof data.liveConfig === "object"
        ? data.liveConfig
        : {};
  }
  if (Object.prototype.hasOwnProperty.call(data, "presence")) {
    update.presence =
      data.presence && typeof data.presence === "object" ? data.presence : {};
  }

  const doc = await CourtStation.findByIdAndUpdate(
    stationId,
    { $set: update },
    { new: true, runValidators: true }
  )
    .populate("clusterId", "name slug description venueName notes color order isActive")
    .lean();

  return doc ? buildStationSummary(doc, { cluster: doc.clusterId }) : null;
}

export async function deleteCourtStation(stationId) {
  const station = await CourtStation.findById(stationId).lean();
  if (!station) return null;
  if (station.currentMatch) {
    const error = new Error("Sân đang giữ trận hiện tại, hãy giải phóng trước khi xoá.");
    error.status = 409;
    throw error;
  }
  return CourtStation.findByIdAndDelete(stationId).lean();
}

async function ensureTournamentClusterAllowed(tournamentId, clusterId) {
  const tournament = await Tournament.findById(tournamentId)
    .select("_id name allowedCourtClusterIds")
    .lean();
  if (!tournament) return { ok: false, reason: "tournament_not_found" };
  const allowedIds = Array.isArray(tournament.allowedCourtClusterIds)
    ? tournament.allowedCourtClusterIds.map((value) => toIdString(value))
    : [];
  if (!allowedIds.includes(toIdString(clusterId))) {
    return { ok: false, reason: "cluster_not_allowed", tournament };
  }
  return { ok: true, tournament };
}

async function clearMatchStationFields(matchId, stationId = null) {
  if (!matchId) return;
  const query = { _id: matchId };
  if (stationId) {
    query.courtStation = stationId;
  }
  const current = await Match.findOne(query)
    .select("_id status referee courtStationReferees")
    .lean()
    .catch(() => null);
  if (!current?._id) return;
  const currentStatus = safeText(current.status).toLowerCase();
  const nextStatus = currentStatus === "assigned" ? "scheduled" : current.status;
  const existingRefIds = normalizeObjectIdArray(current.referee);
  const stationRefIds = normalizeObjectIdArray(current.courtStationReferees);
  const manualRefIds = existingRefIds.filter((refId) => !stationRefIds.includes(refId));
  await Match.updateOne(
    { _id: current._id },
    {
      $set: {
        court: null,
        courtLabel: "",
        courtCluster: "",
        courtStation: null,
        courtStationLabel: "",
        courtClusterId: null,
        courtClusterLabel: "",
        assignedAt: null,
        status: nextStatus,
        referee: manualRefIds,
        courtStationReferees: [],
      },
    }
  ).catch(() => {});
}

async function detachMatchFromOtherStations(matchId, keepStationId = null) {
  const normalizedMatchId = toIdString(matchId);
  if (!normalizedMatchId) return;

  const query = {
    $or: [
      { currentMatch: normalizedMatchId },
      { "assignmentQueue.items.matchId": normalizedMatchId },
    ],
  };
  if (keepStationId) {
    query._id = { $ne: keepStationId };
  }

  const stations = await CourtStation.find(query)
    .select("_id assignmentMode assignmentQueue currentMatch currentTournament status")
    .lean();

  for (const station of stations) {
    const stationId = toIdString(station?._id);
    const wasCurrent = toIdString(station?.currentMatch) === normalizedMatchId;
    const nextQueueItems = normalizeAssignmentQueueItems(
      (Array.isArray(station?.assignmentQueue?.items)
        ? station.assignmentQueue.items
        : []
      ).filter((item) => toIdString(item?.matchId) !== normalizedMatchId)
    );

    const nextSet = {
      assignmentQueue: { items: nextQueueItems },
    };

    if (wasCurrent) {
      nextSet.currentMatch = null;
      nextSet.currentTournament = null;
      nextSet.status = nextQueueItems.length ? "assigned" : "idle";
    }

    await CourtStation.updateOne({ _id: stationId }, { $set: nextSet });

    if (!wasCurrent) {
      await replaceMatchCourtStationReferees(normalizedMatchId, []);
    }

  }
}

async function applyMatchStationFields(matchId, station, cluster) {
  const current = await Match.findById(matchId).select("_id status").lean();
  const currentStatus = safeText(current?.status).toLowerCase();
  const nextStatus = [
    "",
    "scheduled",
    "queued",
    "pending",
    "created",
    "assigning",
  ].includes(currentStatus)
    ? "assigned"
    : current?.status || "assigned";

  await Match.updateOne(
    { _id: matchId },
    {
      $set: {
        court: null,
        courtStation: station._id,
        courtStationLabel: safeText(station.name),
        courtClusterId: cluster._id,
        courtClusterLabel: safeText(cluster.name),
        courtLabel: safeText(station.name),
        courtCluster: safeText(cluster.name, "Main"),
        assignedAt: new Date(),
        status: nextStatus,
      },
    }
  );

  await replaceMatchCourtStationReferees(
    matchId,
    extractStationDefaultRefereeIds(station)
  );
}

async function loadRuntimeStation(stationId) {
  return CourtStation.findById(stationId)
    .populate("clusterId", "name slug description venueName notes color order isActive")
    .populate("defaultReferees", "name fullName nickname nickName email phone")
    .populate({
      path: "currentMatch",
      select: MATCH_SUMMARY_SELECT,
      populate: MATCH_REF_POPULATE,
    })
    .populate({
      path: "assignmentQueue.items.matchId",
      select: MATCH_SUMMARY_SELECT,
      populate: MATCH_REF_POPULATE,
    })
    .populate("currentTournament", "name image status")
    .lean();
}

function buildRuntimeStationPayload(stationDoc, options = {}) {
  if (!stationDoc) return null;
  const matchDisplayContexts =
    options?.matchDisplayContexts instanceof Map
      ? options.matchDisplayContexts
      : new Map();
  const preferredMatches = selectPreferredStationMatchDocs(stationDoc, {
    liveCurrentMatch: options.liveCurrentMatch || null,
  });
  return {
    ...buildStationSummary(stationDoc, {
      cluster: stationDoc?.clusterId,
      matchDisplayContexts,
      liveCurrentMatch: options.liveCurrentMatch || null,
    }),
    currentMatch: buildMatchSummary(preferredMatches.currentMatch, {
      matchDisplayContexts,
    }),
    currentTournament: stationDoc?.currentTournament
      ? {
          _id: toIdString(stationDoc.currentTournament._id),
          name: safeText(stationDoc.currentTournament.name),
          image: safeText(stationDoc.currentTournament.image),
          status: safeText(stationDoc.currentTournament.status),
        }
      : null,
  };
}

async function buildRuntimeStationPayloadAsync(stationDoc) {
  if (!stationDoc) return null;
  const liveCurrentMatch =
    (
      await loadLiveMatchMapByStationIds([stationDoc])
    ).get(toIdString(stationDoc?._id)) || null;
  const matchDisplayContexts = await buildMatchDisplayContextsFromMatches(
    [
      ...collectMatchesFromStations([stationDoc]),
      ...(liveCurrentMatch ? [liveCurrentMatch] : []),
    ]
  );
  return buildRuntimeStationPayload(stationDoc, {
    matchDisplayContexts,
    liveCurrentMatch,
  });
}

async function buildCurrentMatchPayloadAsync(stationDoc) {
  const liveCurrentMatch =
    (
      await loadLiveMatchMapByStationIds([stationDoc])
    ).get(toIdString(stationDoc?._id)) || null;
  const preferredCurrent = selectPreferredStationMatchDocs(stationDoc, {
    liveCurrentMatch,
  }).currentMatch;
  if (!preferredCurrent) return null;
  const matchDisplayContexts = await buildMatchDisplayContextsFromMatches([
    preferredCurrent,
  ]);
  return buildMatchSummary(preferredCurrent, { matchDisplayContexts });
}

export async function assignMatchToCourtStation(
  stationId,
  matchId,
  options = {}
) {
  const station = await CourtStation.findById(stationId)
    .populate("clusterId", "name slug description venueName notes color order isActive")
    .lean();
  if (!station) {
    const error = new Error("Không tìm thấy sân vật lý.");
    error.status = 404;
    throw error;
  }

  if (
    normalizeAssignmentMode(station.assignmentMode, "manual") === "queue" &&
    options.ignoreAssignmentMode !== true
  ) {
    const error = new Error(
      "Sân đang ở chế độ danh sách. Hãy thêm trận vào danh sách thay vì gán tay."
    );
    error.status = 409;
    throw error;
  }

  const match = await Match.findById(matchId)
    .select(MATCH_SUMMARY_SELECT)
    .populate(MATCH_REF_POPULATE)
    .lean();

  if (!match) {
    const error = new Error("Không tìm thấy match.");
    error.status = 404;
    throw error;
  }

  if (!ACTIVE_MATCH_STATUSES.includes(safeText(match.status))) {
    const error = new Error("Chỉ gán được match chưa kết thúc.");
    error.status = 409;
    throw error;
  }

  if (isByeMatch(match)) {
    const error = new Error("Trận BYE không thể gán vào sân.");
    error.status = 409;
    throw error;
  }

  const allowed = await ensureTournamentClusterAllowed(
    toIdString(match.tournament?._id || match.tournament),
    toIdString(station.clusterId?._id || station.clusterId)
  );
  if (!allowed.ok) {
    const error = new Error("Giải đấu này chưa được phép dùng cụm sân đó.");
    error.status = 409;
    throw error;
  }

  const previousStation = await CourtStation.findOne({
    currentMatch: match._id,
    _id: { $ne: station._id },
  })
    .select("_id currentMatch")
    .lean();

  if (previousStation?._id && safeText(match.status).toLowerCase() === "live") {
    const error = new Error("Trận đang live ở sân khác, không thể gán sang sân này.");
    error.status = 409;
    throw error;
  }

  const replacingMatchId = toIdString(station.currentMatch);
  if (replacingMatchId && replacingMatchId !== toIdString(match._id)) {
    const replacingMatch = await Match.findById(replacingMatchId)
      .select("_id status")
      .lean();
    if (safeText(replacingMatch?.status).toLowerCase() === "live") {
      const error = new Error("Sân này đang có trận live, không thể gán đè.");
      error.status = 409;
      throw error;
    }
    await clearMatchStationFields(replacingMatchId, station._id);
  }

  const staleDirectMatches = await Match.find({
    _id: {
      $nin: [toIdString(match._id), replacingMatchId].filter(Boolean),
    },
    courtStation: station._id,
    status: { $in: ACTIVE_MATCH_STATUSES },
  })
    .select("_id status")
    .lean();

  for (const staleMatch of staleDirectMatches) {
    if (safeText(staleMatch?.status).toLowerCase() === "live") {
      const error = new Error("Sân này đang có trận live, không thể gán đè.");
      error.status = 409;
      throw error;
    }
    await clearMatchStationFields(staleMatch._id, station._id);
  }

  await detachMatchFromOtherStations(match._id, station._id);

  await CourtStation.updateOne(
    { _id: station._id },
    {
      $set: {
        currentMatch: match._id,
        currentTournament: toIdString(match.tournament?._id || match.tournament),
        status: safeText(match.status) === "live" ? "live" : "assigned",
      },
    }
  );

  if (previousStation?._id) {
    await clearMatchStationFields(match._id, previousStation._id);
  }

  await applyMatchStationFields(match._id, station, station.clusterId);

  const refreshedStation = await loadRuntimeStation(station._id);
  const runtimeStation = await buildRuntimeStationPayloadAsync(refreshedStation);
  const currentMatch = await buildCurrentMatchPayloadAsync(refreshedStation);

  return {
    station: runtimeStation,
    match: currentMatch,
    replacedMatchId: replacingMatchId || null,
    previousStationId: toIdString(previousStation?._id) || null,
  };
}

export async function updateCourtStationAssignmentConfig(
  stationId,
  {
    tournamentId,
    assignmentMode,
    queueMatchIds,
    refereeIds,
    user = null,
    isAdmin = false,
  } = {}
) {
  const station = await CourtStation.findById(stationId)
    .select(
      "_id clusterId assignmentMode assignmentQueue currentMatch currentTournament status defaultReferees"
    )
    .lean();
  if (!station) {
    const error = new Error("Court station not found");
    error.status = 404;
    throw error;
  }

  const nextMode = normalizeAssignmentMode(
    assignmentMode,
    station.assignmentMode || "manual"
  );
  let nextDefaultRefs = extractStationDefaultRefereeIds(station);
  let nextQueueItems = Array.isArray(station?.assignmentQueue?.items)
    ? station.assignmentQueue.items
    : [];

  if (Array.isArray(queueMatchIds)) {
    const normalizedIds = queueMatchIds
      .map((value) => toIdString(value))
      .filter(Boolean);
    const uniqueIds = Array.from(new Set(normalizedIds));
    if (uniqueIds.length !== normalizedIds.length) {
      const error = new Error("Danh sách trận đang bị trùng.");
      error.status = 409;
      throw error;
    }

    const orderedMatches = await loadQueueMatches(uniqueIds);
    if (orderedMatches.length !== uniqueIds.length) {
      const error = new Error("Danh sách trận không hợp lệ.");
      error.status = 400;
      throw error;
    }

    if (!isAdmin && tournamentId) {
      const prevMatchIds = nextQueueItems.map((item) => toIdString(item.matchId)).filter(Boolean);
      if (prevMatchIds.length > 0) {
        const prevMatches = await loadQueueMatches(prevMatchIds);
        const prevForeignMatchIds = prevMatches
          .filter((m) => toIdString(m.tournament?._id || m.tournament) !== String(tournamentId))
          .map((m) => toIdString(m._id));

        const nextForeignMatchIds = orderedMatches
          .filter((m) => toIdString(m.tournament?._id || m.tournament) !== String(tournamentId))
          .map((m) => toIdString(m._id));

        if (prevForeignMatchIds.join(",") !== nextForeignMatchIds.join(",")) {
          const error = new Error("Không được phép xoá hoặc đổi vị trí trận của giải khác.");
          error.status = 403;
          throw error;
        }
      }
    }

    const prevUniqueQueueMatchIds = new Set(nextQueueItems.map((item) => toIdString(item.matchId)).filter(Boolean));

    orderedMatches.forEach((match) => {
      const matchId = toIdString(match._id);
      if (!prevUniqueQueueMatchIds.has(matchId)) {
        ensureActiveQueueCandidate(match, tournamentId);
      } else {
        ensureActiveQueueCandidate(match, null); // bypass tournamentId check for existing items
      }
    });
    await ensureNoQueueConflicts(uniqueIds, station._id);

    nextQueueItems = normalizeAssignmentQueueItems(
      orderedMatches.map((match) => ({
        matchId: match._id,
        queuedAt: new Date(),
        queuedBy: user?._id || null,
      }))
    );
  }

  if (refereeIds !== undefined) {
    const validRefs = await validateTournamentRefereeIds(refereeIds, tournamentId);
    nextDefaultRefs = validRefs.map((ref) => ref._id);
  }

  const previousAssignedMatchIds = collectStationAssignedMatchIds(station);
  const nextAssignedMatchIds = collectStationAssignedMatchIds({
    currentMatch: station.currentMatch,
    assignmentQueue: { items: nextQueueItems },
  });
  const removedMatchIds = previousAssignedMatchIds.filter(
    (matchId) => !nextAssignedMatchIds.includes(matchId)
  );

  await CourtStation.updateOne(
    { _id: station._id },
    {
      $set: {
        assignmentMode: nextMode,
        assignmentQueue: { items: nextQueueItems },
        defaultReferees: nextDefaultRefs,
        status: station.currentMatch
          ? station.status || "assigned"
          : nextQueueItems.length
            ? "assigned"
            : "idle",
      },
    }
  );

  await syncStationRefereesForMatches(removedMatchIds, []);
  await syncStationRefereesForMatches(nextAssignedMatchIds, nextDefaultRefs);

  const refreshed = await loadRuntimeStation(station._id);
  return {
    station: await buildRuntimeStationPayloadAsync(refreshed),
  };
}

export async function appendMatchToCourtStationQueue(
  stationId,
  { tournamentId, matchId, user = null } = {}
) {
  const station = await CourtStation.findById(stationId)
    .select(
      "_id clusterId assignmentMode assignmentQueue currentMatch currentTournament status defaultReferees"
    )
    .lean();
  if (!station) {
    const error = new Error("Court station not found");
    error.status = 404;
    throw error;
  }

  if (normalizeAssignmentMode(station.assignmentMode, "manual") !== "queue") {
    const error = new Error("Sân này đang ở chế độ gán tay.");
    error.status = 409;
    throw error;
  }

  if (toIdString(station.currentMatch) === toIdString(matchId)) {
    const error = new Error("Trận này đang là trận hiện tại của sân.");
    error.status = 409;
    throw error;
  }

  const existingQueueIds = extractQueueMatchIds(station);
  if (existingQueueIds.includes(toIdString(matchId))) {
    const error = new Error("Trận này đã có trong danh sách của sân.");
    error.status = 409;
    throw error;
  }

  const [match] = await loadQueueMatches([matchId]);
  ensureActiveQueueCandidate(match, tournamentId);
  await ensureNoQueueConflicts([matchId], station._id);

  const nextQueueItems = normalizeAssignmentQueueItems([
    ...(Array.isArray(station?.assignmentQueue?.items)
      ? station.assignmentQueue.items
      : []),
    {
      matchId: match._id,
      queuedAt: new Date(),
      queuedBy: user?._id || null,
    },
  ]);

  await CourtStation.updateOne(
    { _id: station._id },
    {
      $set: {
        assignmentQueue: { items: nextQueueItems },
        status: station.currentMatch ? station.status || "assigned" : "assigned",
      },
    }
  );

  await replaceMatchCourtStationReferees(
    match._id,
    extractStationDefaultRefereeIds(station)
  );

  const refreshed = await loadRuntimeStation(station._id);
  return {
    station: await buildRuntimeStationPayloadAsync(refreshed),
  };
}

export async function removeMatchFromCourtStationQueue(stationId, matchId) {
  const station = await CourtStation.findById(stationId)
    .select("_id assignmentMode assignmentQueue currentMatch")
    .lean();
  if (!station) {
    const error = new Error("Court station not found");
    error.status = 404;
    throw error;
  }

  const nextQueueItems = normalizeAssignmentQueueItems(
    (Array.isArray(station?.assignmentQueue?.items)
      ? station.assignmentQueue.items
      : []
    ).filter((item) => toIdString(item?.matchId) !== toIdString(matchId))
  );
  const wasQueued =
    nextQueueItems.length !==
    (Array.isArray(station?.assignmentQueue?.items)
      ? station.assignmentQueue.items.length
      : 0);

  await CourtStation.updateOne(
    { _id: station._id },
    {
      $set: {
        assignmentQueue: { items: nextQueueItems },
        status:
          station.currentMatch || nextQueueItems.length
            ? station.status || "assigned"
            : "idle",
      },
    }
  );

  if (wasQueued) {
    await clearMatchStationFields(matchId, station._id);
    await replaceMatchCourtStationReferees(matchId, []);
  }

  const refreshed = await loadRuntimeStation(station._id);
  return {
    station: await buildRuntimeStationPayloadAsync(refreshed),
  };
}

export async function advanceCourtStationQueueOnMatchFinished(matchId) {
  const normalizedMatchId = toIdString(matchId);
  const station = await CourtStation.findOne({
    $or: [
      { currentMatch: normalizedMatchId },
      { "assignmentQueue.items.matchId": normalizedMatchId },
    ],
    assignmentMode: "queue",
  })
    .select(
      "_id clusterId assignmentMode assignmentQueue currentMatch currentTournament status"
    )
    .lean();
  if (!station) {
    return { station: null, assigned: false };
  }

  const nextQueueItems = normalizeAssignmentQueueItems(
    (Array.isArray(station?.assignmentQueue?.items)
      ? station.assignmentQueue.items
      : []
    ).filter((item) => toIdString(item?.matchId) !== normalizedMatchId)
  );
  const isCurrentMatch = toIdString(station.currentMatch) === normalizedMatchId;

  await CourtStation.updateOne(
    { _id: station._id },
    {
      $set: {
        assignmentQueue: { items: nextQueueItems },
        currentMatch: isCurrentMatch ? null : station.currentMatch,
        currentTournament: isCurrentMatch ? null : station.currentTournament,
        status: isCurrentMatch
          ? nextQueueItems.length
            ? "assigned"
            : "idle"
          : station.status || (nextQueueItems.length ? "assigned" : "idle"),
      },
    }
  );

  const refreshed = await loadRuntimeStation(station._id);
  const runtimeStation = await buildRuntimeStationPayloadAsync(refreshed);
  return {
    station: runtimeStation,
    assigned: false,
    nextMatch: null,
  };
}

export async function freeCourtStation(
  stationId,
  { advanceQueue = true } = {}
) {
  void advanceQueue;
  const station = await CourtStation.findById(stationId)
    .populate("clusterId", "name slug description venueName notes color order isActive")
    .populate({
      path: "currentMatch",
      select: MATCH_SUMMARY_SELECT,
      populate: MATCH_REF_POPULATE,
    })
    .populate({
      path: "assignmentQueue.items.matchId",
      select: MATCH_SUMMARY_SELECT,
      populate: MATCH_REF_POPULATE,
    })
    .lean();
  if (!station) return null;

  const preferredCurrent = selectPreferredStationMatchDocs(station).currentMatch;
  const rawCurrentMatchId = toIdString(
    station?.currentMatch?._id || station?.currentMatch
  );
  const previousMatchId =
    rawCurrentMatchId ||
    toIdString(preferredCurrent?._id || preferredCurrent);
  const nextQueueItems = previousMatchId
    ? normalizeAssignmentQueueItems(
        (Array.isArray(station?.assignmentQueue?.items)
          ? station.assignmentQueue.items
          : []
        ).filter((item) => toIdString(item?.matchId) !== previousMatchId)
      )
    : normalizeAssignmentQueueItems(
        Array.isArray(station?.assignmentQueue?.items)
          ? station.assignmentQueue.items
          : []
      );
  if (previousMatchId) {
    await clearMatchStationFields(previousMatchId, station._id);
  }

  await CourtStation.updateOne(
    { _id: station._id },
    {
      $set: {
        currentMatch: null,
        currentTournament: null,
        assignmentQueue: { items: nextQueueItems },
        status: nextQueueItems.length ? "assigned" : "idle",
      },
    }
  );

  const refreshed = await loadRuntimeStation(station._id);

  return {
    station: await buildRuntimeStationPayloadAsync(refreshed),
    previousMatchId: previousMatchId || null,
  };
}

export async function getCourtStationCurrentMatch(stationId) {
  const station = await loadRuntimeStation(stationId);

  if (!station) return null;

  return {
    cluster: buildClusterSummary(station.clusterId),
    station: await buildRuntimeStationPayloadAsync(station),
    currentMatch: await buildCurrentMatchPayloadAsync(station),
  };
}

async function buildAvailableMatchesForCluster(clusterId, tournamentId = null) {
  const tournaments = await Tournament.find(
    tournamentId
      ? { _id: tournamentId, allowedCourtClusterIds: clusterId }
      : { allowedCourtClusterIds: clusterId }
  )
    .select("_id name image status")
    .lean();

  const tournamentIds = tournaments.map((tournament) => tournament._id);
  if (!tournamentIds.length) return [];

  const matches = await Match.find({
    tournament: { $in: tournamentIds },
    status: { $in: ACTIVE_MATCH_STATUSES },
  })
    .select(MATCH_SUMMARY_SELECT)
    .populate(MATCH_REF_POPULATE)
    .sort({ status: 1, updatedAt: -1, scheduledAt: 1, createdAt: 1 })
    .lean();

  const filteredMatches = matches.filter((match) => !isByeMatch(match));
  const matchDisplayContexts =
    await buildMatchDisplayContextsFromMatches(filteredMatches);

  return filteredMatches
    .sort((a, b) => compareMatchesForDisplay(a, b, { matchDisplayContexts }))
    .map((match) => buildMatchSummary(match, { matchDisplayContexts }));
}

export async function buildCourtClusterRuntime(clusterId, options = {}) {
  const tournamentId = toIdString(options?.tournamentId) || null;
  const cluster = await CourtCluster.findById(clusterId).lean();
  if (!cluster) return null;

  const sharedTournamentQuery = { allowedCourtClusterIds: clusterId };
  const allowedTournamentQuery = tournamentId
    ? { _id: tournamentId, allowedCourtClusterIds: clusterId }
    : sharedTournamentQuery;

  const [stations, allowedTournaments, sharedTournaments, availableMatches] = await Promise.all([
    listCourtStations(clusterId, { includeMatches: true }),
    Tournament.find(allowedTournamentQuery)
      .select("_id name image status")
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean(),
    Tournament.find(sharedTournamentQuery)
      .select("_id name image status")
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean(),
    buildAvailableMatchesForCluster(clusterId, tournamentId),
  ]);

  return {
    cluster: buildClusterSummary(cluster),
    stations,
    allowedTournaments: allowedTournaments.map(buildRuntimeTournamentSummary),
    sharedTournamentCount: sharedTournaments.length,
    sharedTournaments: sharedTournaments.map(buildRuntimeTournamentSummary),
    availableMatches,
  };
}

export async function buildPublicLiveClusters() {
  const clusters = await CourtCluster.find({ isActive: true })
    .sort({ order: 1, name: 1, createdAt: 1 })
    .lean();
  if (!clusters.length) return [];

  const clusterIds = clusters.map((cluster) => cluster._id);
  const stations = await CourtStation.find({
    clusterId: { $in: clusterIds },
    isActive: true,
  })
    .populate({
      path: "assignmentQueue.items.matchId",
      select: MATCH_SUMMARY_SELECT,
      populate: MATCH_REF_POPULATE,
    })
    .populate({
      path: "currentMatch",
      select: MATCH_SUMMARY_SELECT,
      populate: [
        { path: "tournament", select: "name image status" },
        {
          path: "pairA",
          populate: [
            { path: "player1.user", select: "name" },
            { path: "player2.user", select: "name" },
          ],
        },
        {
          path: "pairB",
          populate: [
            { path: "player1.user", select: "name" },
            { path: "player2.user", select: "name" },
          ],
        },
      ],
    })
    .sort({ order: 1, name: 1, createdAt: 1 })
    .lean();

  const currentMatches = stations
    .map((station) => selectPreferredStationMatchDocs(station).currentMatch)
    .filter(Boolean);
  const { matchDisplayContexts, currentMatchById } =
    await buildPublicCurrentMatchSummaryMap(currentMatches);

  const stationsByClusterId = new Map();
  stations.forEach((station) => {
    const key = toIdString(station.clusterId);
    const stationPayload = buildPublicStationPayload(station, {
      matchDisplayContexts,
      currentMatchById,
    });
    if (!isRenderablePublicLiveStation(stationPayload)) return;

    const bucket = stationsByClusterId.get(key) || [];
    bucket.push(stationPayload);
    stationsByClusterId.set(key, bucket);
  });

  return clusters
    .map((cluster) => {
      const stationRows = stationsByClusterId.get(toIdString(cluster._id)) || [];
      const liveCount = stationRows.filter(
        (station) => safeText(station.status) === "live"
      ).length;
      return {
        ...buildClusterSummary(cluster),
        stationsCount: stationRows.length,
        liveCount,
        hasActiveMatch: stationRows.some((station) => station.currentMatch),
        stations: stationRows,
      };
    })
    .filter((cluster) => cluster.stationsCount > 0);
}

export async function buildPublicLiveClusterDetail(clusterId) {
  const cluster = await CourtCluster.findById(clusterId).lean();
  if (!cluster) return null;
  const stationDocs = await CourtStation.find({
    clusterId,
    isActive: true,
  })
    .populate("clusterId", "name slug description venueName notes color order isActive")
    .populate({
      path: "currentMatch",
      select: MATCH_SUMMARY_SELECT,
      populate: MATCH_REF_POPULATE,
    })
    .populate({
      path: "assignmentQueue.items.matchId",
      select: MATCH_SUMMARY_SELECT,
      populate: MATCH_REF_POPULATE,
    })
    .populate("currentTournament", "name image status")
    .sort({ order: 1, name: 1, createdAt: 1 })
    .lean();

  const currentMatches = stationDocs
    .map((station) => selectPreferredStationMatchDocs(station).currentMatch)
    .filter(Boolean);
  const { matchDisplayContexts, currentMatchById } =
    await buildPublicCurrentMatchSummaryMap(currentMatches);

  const stations = stationDocs
    .map((station) =>
      buildPublicStationPayload(station, {
        cluster,
        matchDisplayContexts,
        currentMatchById,
      })
    )
    .filter(isRenderablePublicLiveStation);

  return {
    cluster: buildClusterSummary(cluster),
    stations,
  };
}

export async function buildPublicLiveCourtDetail(stationId) {
  const current = await getCourtStationCurrentMatch(stationId);
  if (!current) return null;
  return current;
}
