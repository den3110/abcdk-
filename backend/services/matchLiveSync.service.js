import { randomUUID } from "node:crypto";
import IORedis from "ioredis";
import Bracket from "../models/bracketModel.js";
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
import { invalidateMatchSnapshotCache } from "./matchSnapshotCache.service.js";
import { buildMatchCodePayload } from "../utils/matchDisplayCode.js";
import {
  claimMatchLiveOwner,
  getMatchLiveOwner,
  liveOwnerMatchesIdentity,
} from "./matchLiveOwnership.service.js";
import { loadMatchLiveSnapshot } from "./matchLiveSnapshot.service.js";
import { getRefereeMatchControlLockRuntime } from "./systemSettingsRuntime.service.js";

const envValue = (key) =>
  typeof process !== "undefined" ? process.env?.[key] : undefined;

const readInt = (key, fallback, { min = 0, max = 60_000 } = {}) => {
  const value = Number(envValue(key));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

const readBool = (key, fallback = false) => {
  const raw = envValue(key);
  if (raw == null || raw === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LIVE_SYNC_REDIS_URL = String(envValue("REDIS_URL") || "").trim();
const LIVE_SYNC_REDIS_LOCK_ENABLED = readBool(
  "MATCH_LIVE_SYNC_REDIS_LOCK",
  Boolean(LIVE_SYNC_REDIS_URL)
);
const LIVE_SYNC_REDIS_PREFIX = String(
  envValue("MATCH_LIVE_SYNC_REDIS_PREFIX") || "pkt:matchLiveSync:v1"
).trim();
const LIVE_SYNC_REDIS_LOCK_TTL_MS = readInt(
  "MATCH_LIVE_SYNC_REDIS_LOCK_TTL_MS",
  15_000,
  { min: 1000, max: 60_000 }
);
const LIVE_SYNC_REDIS_LOCK_WAIT_MS = readInt(
  "MATCH_LIVE_SYNC_REDIS_LOCK_WAIT_MS",
  10_000,
  { min: 0, max: 60_000 }
);
const LIVE_SYNC_REDIS_LOCK_POLL_MS = readInt(
  "MATCH_LIVE_SYNC_REDIS_LOCK_POLL_MS",
  35,
  { min: 10, max: 500 }
);
const LIVE_SYNC_REDIS_COMMAND_TIMEOUT_MS = readInt(
  "MATCH_LIVE_SYNC_REDIS_COMMAND_TIMEOUT_MS",
  500,
  { min: 50, max: 5000 }
);
const LIVE_SYNC_REDIS_CONNECT_TIMEOUT_MS = readInt(
  "MATCH_LIVE_SYNC_REDIS_CONNECT_TIMEOUT_MS",
  500,
  { min: 50, max: 5000 }
);
const LIVE_SYNC_REDIS_FAILURE_BACKOFF_MS = readInt(
  "MATCH_LIVE_SYNC_REDIS_FAILURE_BACKOFF_MS",
  5000,
  { min: 500, max: 60_000 }
);

const RELEASE_REDIS_LOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const liveSyncQueues = new Map();
let liveSyncRedis = null;
let liveSyncRedisDisabledUntil = 0;
let lastLiveSyncRedisErrorAt = 0;

function normalizeMatchLockId(matchId) {
  return String(matchId || "").trim();
}

function logLiveSyncRedisError(context, error) {
  const now = Date.now();
  liveSyncRedisDisabledUntil = now + LIVE_SYNC_REDIS_FAILURE_BACKOFF_MS;
  if (liveSyncRedis) {
    liveSyncRedis.disconnect();
    liveSyncRedis = null;
  }
  if (now - lastLiveSyncRedisErrorAt < 30_000) return;
  lastLiveSyncRedisErrorAt = now;
  console.error(
    `[match-live-sync] redis ${context}:`,
    error?.message || error
  );
}

const withTimeout = (promise, ms, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label || "operation"} timed out after ${ms}ms`));
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

function redisLockConfigured() {
  return Boolean(LIVE_SYNC_REDIS_LOCK_ENABLED && LIVE_SYNC_REDIS_URL);
}

function redisLockUsableNow() {
  return redisLockConfigured() && Date.now() >= liveSyncRedisDisabledUntil;
}

function createLiveSyncRedisClient() {
  const client = new IORedis(LIVE_SYNC_REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: LIVE_SYNC_REDIS_CONNECT_TIMEOUT_MS,
    retryStrategy: (attempt) => Math.min(1000, 100 + attempt * 100),
  });
  client.on("error", (error) => logLiveSyncRedisError("client error", error));
  return client;
}

function getLiveSyncRedisClient() {
  if (!redisLockUsableNow()) return null;
  if (liveSyncRedis?.status === "end") {
    liveSyncRedis.disconnect();
    liveSyncRedis = null;
  }
  if (!liveSyncRedis) liveSyncRedis = createLiveSyncRedisClient();
  return liveSyncRedis;
}

async function ensureLiveSyncRedisReady(client) {
  if (!client) return null;
  if (client.status === "ready") return client;
  if (client.status === "wait") {
    await withTimeout(
      client.connect(),
      LIVE_SYNC_REDIS_CONNECT_TIMEOUT_MS,
      "redis connect"
    );
  }
  return client.status === "ready" ? client : null;
}

async function liveSyncRedisCommand(label, fn) {
  const client = await ensureLiveSyncRedisReady(
    getLiveSyncRedisClient()
  ).catch((error) => {
    logLiveSyncRedisError(label, error);
    return null;
  });
  if (!client) return { ok: false, value: null };

  try {
    const value = await withTimeout(
      fn(client),
      LIVE_SYNC_REDIS_COMMAND_TIMEOUT_MS,
      label
    );
    return { ok: true, value };
  } catch (error) {
    logLiveSyncRedisError(label, error);
    return { ok: false, value: null };
  }
}

function redisMatchLockKey(matchId) {
  return `${LIVE_SYNC_REDIS_PREFIX}:lock:${normalizeMatchLockId(matchId)}`;
}

async function acquireRedisMatchSyncLock(matchId) {
  if (!redisLockConfigured()) return { release: null, unavailable: true };

  const key = redisMatchLockKey(matchId);
  const token = randomUUID();
  const deadline = Date.now() + LIVE_SYNC_REDIS_LOCK_WAIT_MS;

  for (;;) {
    const result = await liveSyncRedisCommand("lock acquire", (client) =>
      client.set(key, token, "PX", LIVE_SYNC_REDIS_LOCK_TTL_MS, "NX")
    );
    if (!result.ok) return { release: null, unavailable: true };

    if (result.value === "OK") {
      return {
        release: async () => {
          await liveSyncRedisCommand("lock release", (client) =>
            client.eval(RELEASE_REDIS_LOCK_LUA, 1, key, token)
          );
        },
        unavailable: false,
        busy: false,
      };
    }

    if (
      LIVE_SYNC_REDIS_LOCK_WAIT_MS <= 0 ||
      Date.now() >= deadline
    ) {
      return { release: null, unavailable: false, busy: true };
    }

    await sleep(
      Math.min(
        LIVE_SYNC_REDIS_LOCK_POLL_MS,
        Math.max(1, deadline - Date.now())
      )
    );
  }
}

async function runMatchLiveSyncSerialized(matchId, task) {
  const key = normalizeMatchLockId(matchId);
  if (!key) return task();

  const previous = liveSyncQueues.get(key) || Promise.resolve();
  let releaseCurrent = () => {};
  const current = new Promise((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => {}).then(() => current);
  liveSyncQueues.set(key, tail);

  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    releaseCurrent();
    if (liveSyncQueues.get(key) === tail) {
      liveSyncQueues.delete(key);
    }
  }
}

function isFinitePos(value) {
  return Number.isFinite(value) && value > 0;
}

const OPENING_DOUBLES_SERVER = 2;

function isDoublesMatch(match) {
  return (
    String(match?.tournament?.eventType || match?.eventType || "").toLowerCase() !==
    "single"
  );
}

function buildNormalizedRules(match) {
  return {
    bestOf: toNum(match?.rules?.bestOf, 3),
    pointsToWin: toNum(match?.rules?.pointsToWin, 11),
    winByTwo:
      match?.rules?.winByTwo === undefined
        ? true
        : Boolean(match?.rules?.winByTwo),
    cap: {
      mode: String(match?.rules?.cap?.mode ?? "none"),
      points:
        match?.rules?.cap?.points === undefined
          ? null
          : Number(match.rules.cap.points),
    },
  };
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
      if (a === b) return { finished: false, winner: null };
      return { finished: true, winner: a > b ? "A" : "B" };
    }
  }

  if (mode === "soft" && isFinitePos(capPoints)) {
    if (a >= capPoints || b >= capPoints) {
      if (a === b) return { finished: false, winner: null };
      return { finished: true, winner: a > b ? "A" : "B" };
    }
  }

  if (byTwo) {
    if ((a >= base || b >= base) && Math.abs(a - b) >= 2) {
      return { finished: true, winner: a > b ? "A" : "B" };
    }
  } else if ((a >= base || b >= base) && a !== b) {
    return { finished: true, winner: a > b ? "A" : "B" };
  }

  return { finished: false, winner: null };
}

function resolveFinishedWinnerByScore(match) {
  const rules = buildNormalizedRules(match);
  let aWins = 0;
  let bWins = 0;

  for (const game of Array.isArray(match?.gameScores) ? match.gameScores : []) {
    const result = evaluateGameFinish(toNum(game?.a, 0), toNum(game?.b, 0), rules);
    if (!result.finished) continue;
    if (result.winner === "A") aWins += 1;
    if (result.winner === "B") bWins += 1;
  }

  const needWins = Math.floor(Number(rules.bestOf) / 2) + 1;
  if (aWins >= needWins) return "A";
  if (bWins >= needWins) return "B";
  return "";
}

function onLostRallyNextServe(prev) {
  if (prev?.opening) {
    return { side: prev.side === "A" ? "B" : "A", server: 1, opening: false };
  }
  if (prev.server === 1) return { side: prev.side, server: 2, opening: false };
  return { side: prev.side === "A" ? "B" : "A", server: 1, opening: false };
}

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function validSide(side) {
  return side === "A" || side === "B" ? side : "A";
}

function oppositeSide(side) {
  return side === "A" ? "B" : "A";
}

function buildForfeitGameScores(match, winnerSide) {
  const rules = buildNormalizedRules(match);
  const pointsToWin = Math.max(1, toNum(rules.pointsToWin, 11));
  const gamesToWin = Math.max(1, Math.floor(toNum(rules.bestOf, 1) / 2) + 1);
  return Array.from({ length: gamesToWin }, () =>
    winnerSide === "A"
      ? { a: pointsToWin, b: 0 }
      : { a: 0, b: pointsToWin },
  );
}

function resolveForfeitedSide(winnerSide, payload = {}) {
  const raw = String(payload?.forfeitedSide || "").toUpperCase();
  if (raw === "A" || raw === "B") return raw;
  return oppositeSide(winnerSide);
}

function isForfeitResult(match) {
  return (
    match?.meta?.resultType === "forfeit" ||
    (Array.isArray(match?.liveLog) &&
      match.liveLog.some((entry) => entry?.type === "forfeit")) ||
    /^\[forfeit/.test(String(match?.note || "").trim().toLowerCase())
  );
}

function validServer(server) {
  return server === 1 || server === 2 ? server : 1;
}

function duplicateError(error) {
  return (
    error?.code === 11000 ||
    String(error?.message || "").toLowerCase().includes("duplicate key")
  );
}

function cloneValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function docId(value) {
  return String(value?._id || value?.id || value || "").trim();
}

function hasRegistrationRef(value) {
  return mongoose.Types.ObjectId.isValid(docId(value));
}

function seedTypeKey(seed) {
  return String(seed?.type || "")
    .trim()
    .toLowerCase();
}

function isByeLiveSeed(seed) {
  return (
    seedTypeKey(seed) === "bye" ||
    /\bBYE\b/i.test(String(seed?.label || seed?.displayName || ""))
  );
}

function isWinnerSeedType(type) {
  return type === "stagematchwinner" || type === "matchwinner";
}

function isLoserSeedType(type) {
  return type === "stagematchloser" || type === "matchloser";
}

function parseLiveMatchCode(value) {
  const match = String(value || "")
    .trim()
    .match(/\b(?:[WL]\s*-\s*)?(V\d+(?:-(?:B[A-Z0-9]+|NT))?-T\d+)\b/i);
  return match?.[1] ? match[1].toUpperCase().replace(/\s+/g, "") : "";
}

function isGroupishLiveBracketType(value) {
  return ["group", "round_robin", "gsl", "swiss"].includes(
    String(value || "")
      .trim()
      .toLowerCase()
  );
}

function ceilPow2Live(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 1) return 1;
  return 1 << Math.ceil(Math.log2(number));
}

function countLiveBracketRounds(bracket, maxRoundByBracket) {
  if (!bracket) return 1;
  if (isGroupishLiveBracketType(bracket?.type)) return 1;

  const bid = docId(bracket);
  const fromMatches = Number(maxRoundByBracket.get(bid) || 0);
  if (fromMatches > 0) return Math.max(1, fromMatches);

  const explicit =
    Number(bracket?.meta?.maxRounds) || Number(bracket?.drawRounds) || 0;
  if (explicit > 0) return Math.max(1, explicit);

  const drawSize = Number(bracket?.meta?.drawSize) || 0;
  if (drawSize >= 2) return Math.ceil(Math.log2(ceilPow2Live(drawSize)));

  return 1;
}

async function getLiveMatchCodeOptionsForTournament(tournamentId) {
  const tournamentKey = docId(tournamentId);
  if (!mongoose.Types.ObjectId.isValid(tournamentKey)) return {};

  const objectId = new mongoose.Types.ObjectId(tournamentKey);
  const [brackets, roundsAgg] = await Promise.all([
    Bracket.find({ tournament: objectId })
      .select("_id type stage order createdAt meta.maxRounds meta.drawSize drawRounds")
      .sort({ stage: 1, order: 1, createdAt: 1, _id: 1 })
      .lean(),
    Match.aggregate([
      { $match: { tournament: objectId } },
      { $group: { _id: "$bracket", maxRound: { $max: "$round" } } },
    ]),
  ]);

  const maxRoundByBracket = new Map(
    roundsAgg.map((item) => [docId(item?._id), Number(item?.maxRound) || 0])
  );
  const sorted = [...brackets].sort((left, right) => {
    const leftStage = Number(left?.stage ?? 9999);
    const rightStage = Number(right?.stage ?? 9999);
    if (leftStage !== rightStage) return leftStage - rightStage;
    const leftOrder = Number(left?.order ?? 9999);
    const rightOrder = Number(right?.order ?? 9999);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftCreated = left?.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightCreated = right?.createdAt ? new Date(right.createdAt).getTime() : 0;
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    return docId(left).localeCompare(docId(right));
  });

  const baseByBracketId = new Map();
  let accumulated = 0;
  for (const bracket of sorted) {
    const bracketId = docId(bracket);
    if (bracketId) baseByBracketId.set(bracketId, accumulated);
    accumulated += countLiveBracketRounds(bracket, maxRoundByBracket);
  }

  return { baseByBracketId };
}

const LIVE_RESOLUTION_MATCH_SELECT = [
  "_id",
  "tournament",
  "bracket",
  "round",
  "order",
  "labelKey",
  "displayCode",
  "codeResolved",
  "code",
  "matchCode",
  "meta",
  "format",
  "branch",
  "phase",
  "status",
  "winner",
  "pairA",
  "pairB",
  "seedA",
  "seedB",
  "previousA",
  "previousB",
].join(" ");

async function buildLiveMatchResolutionContext(tournamentId) {
  const tournamentKey = docId(tournamentId);
  if (!mongoose.Types.ObjectId.isValid(tournamentKey)) return null;

  const [matches, codeOptions] = await Promise.all([
    Match.find({ tournament: tournamentKey })
      .select(LIVE_RESOLUTION_MATCH_SELECT)
      .populate({
        path: "bracket",
        select: "_id type stage order createdAt meta.maxRounds meta.drawSize drawRounds",
      })
      .lean(),
    getLiveMatchCodeOptionsForTournament(tournamentKey),
  ]);

  const byId = new Map();
  const byCode = new Map();
  const matchesByBracketId = new Map();

  for (const match of matches) {
    const id = docId(match);
    if (id) byId.set(id, match);

    const bracketId = docId(match?.bracket);
    if (bracketId) {
      const bucket = matchesByBracketId.get(bracketId) || [];
      bucket.push(match);
      matchesByBracketId.set(bracketId, bucket);
    }
  }

  for (const match of matches) {
    const payload = buildMatchCodePayload(match, {
      ...codeOptions,
      matchesByBracketId,
    });
    const codes = [
      payload?.displayCode,
      payload?.code,
      payload?.globalCode,
      match?.displayCode,
      match?.codeResolved,
      match?.code,
      match?.matchCode,
    ]
      .map(parseLiveMatchCode)
      .filter(Boolean);

    for (const code of codes) {
      if (!byCode.has(code)) byCode.set(code, match);
    }
  }

  return { byId, byCode };
}

function sourceMatchIdsForSeed(seed) {
  return [
    seed?.ref?.matchId,
    seed?.ref?.match,
    seed?.matchId,
    seed?.match,
    seed?.ref?._id,
    seed?.ref?.id,
  ]
    .map(docId)
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
}

function findLiveSourceMatch(ownerMatch, seed, side, context) {
  const ownerId = docId(ownerMatch);
  const previous = side === "A" ? ownerMatch?.previousA : ownerMatch?.previousB;
  const previousId = docId(previous);
  if (previousId && context.byId.has(previousId) && previousId !== ownerId) {
    return context.byId.get(previousId);
  }

  for (const sourceId of sourceMatchIdsForSeed(seed)) {
    if (sourceId && sourceId !== ownerId && context.byId.has(sourceId)) {
      return context.byId.get(sourceId);
    }
  }

  const labelCode = parseLiveMatchCode(
    seed?.label || seed?.displayName || seed?.name || seed?.title
  );
  if (labelCode && context.byCode.has(labelCode)) return context.byCode.get(labelCode);

  return null;
}

function resolveLivePairFromSeedSide(ownerMatch, side, context, depth = 0) {
  if (!ownerMatch || !context || depth > 10) return null;
  const sideKey = side === "B" ? "B" : "A";
  const pair = sideKey === "A" ? ownerMatch.pairA : ownerMatch.pairB;
  if (hasRegistrationRef(pair)) return pair;

  const seed = sideKey === "A" ? ownerMatch.seedA : ownerMatch.seedB;
  const seedType = seedTypeKey(seed);
  if (seedType === "registration") {
    return (
      seed?.ref?.registration ||
      seed?.ref?.reg ||
      seed?.ref?.id ||
      seed?.ref?._id ||
      null
    );
  }
  if (isByeLiveSeed(seed)) return null;

  const isWinnerSeed = isWinnerSeedType(seedType);
  const isLoserSeed = isLoserSeedType(seedType);
  if (!isWinnerSeed && !isLoserSeed) return null;

  const sourceMatch = findLiveSourceMatch(ownerMatch, seed, sideKey, context);
  if (!sourceMatch) return null;

  const sourceByeA = isByeLiveSeed(sourceMatch.seedA);
  const sourceByeB = isByeLiveSeed(sourceMatch.seedB);
  if (sourceByeA || sourceByeB) {
    if (isLoserSeed || (sourceByeA && sourceByeB)) return null;
    const carriedSide = sourceByeA ? "B" : "A";
    const carriedPair = carriedSide === "A" ? sourceMatch.pairA : sourceMatch.pairB;
    if (hasRegistrationRef(carriedPair)) return carriedPair;
    return resolveLivePairFromSeedSide(sourceMatch, carriedSide, context, depth + 1);
  }

  const winnerSide =
    sourceMatch.winner === "A" || sourceMatch.winner === "B"
      ? sourceMatch.winner
      : "";
  if (!winnerSide) return null;

  const sourceSide = isLoserSeed
    ? winnerSide === "A"
      ? "B"
      : "A"
    : winnerSide;
  const sourcePair = sourceSide === "A" ? sourceMatch.pairA : sourceMatch.pairB;
  if (hasRegistrationRef(sourcePair)) return sourcePair;
  return resolveLivePairFromSeedSide(sourceMatch, sourceSide, context, depth + 1);
}

async function hydrateResolvedMatchPairsForLive(match) {
  if (!match?._id || !match?.tournament) return false;
  if (hasRegistrationRef(match.pairA) && hasRegistrationRef(match.pairB)) {
    return false;
  }

  const context = await buildLiveMatchResolutionContext(match.tournament);
  if (!context) return false;

  let changed = false;
  for (const side of ["A", "B"]) {
    const field = side === "A" ? "pairA" : "pairB";
    const resolved = resolveLivePairFromSeedSide(match, side, context);
    const resolvedId = docId(resolved);
    if (!mongoose.Types.ObjectId.isValid(resolvedId)) continue;
    if (docId(match[field]) === resolvedId) continue;

    match.set(field, new mongoose.Types.ObjectId(resolvedId));
    changed = true;
  }

  if (changed) {
    match.liveVersion = toNum(match.liveVersion, 0) + 1;
    match.version = toNum(match.version, 0) + 1;
  }
  return changed;
}

function liveEventRequiresResolvedTeams(type) {
  return ["start", "point", "serve", "slots", "finish", "forfeit"].includes(
    String(type || "").trim().toLowerCase()
  );
}

function hasResolvedLiveTeams(match) {
  return hasRegistrationRef(match?.pairA) && hasRegistrationRef(match?.pairB);
}

function normalizeRefereeLayout(layout) {
  if (layout?.left === "B" || layout?.right === "A") {
    return { left: "B", right: "A" };
  }
  return { left: "A", right: "B" };
}

function userIdOfPlayer(player) {
  return String(player?.user?._id || player?.user || player?._id || player?.id || "").trim();
}

function getTeamPlayerIds(match, team) {
  const pair = team === "B" ? match?.pairB : match?.pairA;
  return [pair?.player1, pair?.player2].map(userIdOfPlayer).filter(Boolean);
}

function currentGameScoreOf(match) {
  const scores = Array.isArray(match?.gameScores) ? match.gameScores : [];
  const index = Number.isInteger(match?.currentGame)
    ? Math.max(0, match.currentGame)
    : Math.max(0, scores.length - 1);
  const score = scores[index] || {};
  return {
    a: toNum(score.a, 0),
    b: toNum(score.b, 0),
  };
}

function currentSlotFromBaseSlot(baseSlot, teamScore) {
  const base = Number(baseSlot) === 2 ? 2 : 1;
  return Number(teamScore || 0) % 2 === 0 ? base : base === 1 ? 2 : 1;
}

function oppositeSlot(slot) {
  return Number(slot) === 1 ? 2 : 1;
}

function preStartRightSlotForSide(side, layout) {
  return normalizeRefereeLayout(layout).left === side ? 2 : 1;
}

function normalizedSlotsBaseForMatch(match, inputBase = null) {
  const rawBase =
    inputBase && typeof inputBase === "object"
      ? inputBase
      : match?.slots?.base || match?.meta?.slots?.base || {};
  const base = {
    A: { ...(rawBase?.A || {}) },
    B: { ...(rawBase?.B || {}) },
  };

  for (const team of ["A", "B"]) {
    const ids = getTeamPlayerIds(match, team);
    if (ids[0] && ![1, 2].includes(Number(base[team][ids[0]]))) {
      base[team][ids[0]] = 1;
    }
    if (ids[1] && ![1, 2].includes(Number(base[team][ids[1]]))) {
      base[team][ids[1]] = 2;
    }
  }

  return base;
}

function findPlayerIdByBaseSlot(match, side, slot, base = null) {
  const normalizedBase = base || normalizedSlotsBaseForMatch(match);
  return (
    Object.entries(normalizedBase?.[side] || {}).find(
      ([, value]) => Number(value) === Number(slot)
    )?.[0] || ""
  );
}

function findPlayerIdByCurrentSlot(match, side, slot, base = null, score = null) {
  const normalizedBase = base || normalizedSlotsBaseForMatch(match);
  const currentScore = score || currentGameScoreOf(match);
  const teamScore = side === "A" ? currentScore.a : currentScore.b;
  return (
    Object.entries(normalizedBase?.[side] || {}).find(
      ([, value]) => currentSlotFromBaseSlot(value, teamScore) === Number(slot)
    )?.[0] || ""
  );
}

function isServeServerIdValid(match, side, serverId) {
  const normalizedId = String(serverId || "").trim();
  if (!normalizedId) return false;
  return new Set(getTeamPlayerIds(match, side)).has(normalizedId);
}

function resolveReceiverIdForServe(match, serve, base, score) {
  const serverId = String(serve?.serverId || "").trim();
  if (!serverId) return null;
  const side = validSide(serve?.side);
  const otherSide = side === "A" ? "B" : "A";
  const currentScore = score || currentGameScoreOf(match);
  const serverBaseSlot = Number(base?.[side]?.[serverId] || serve?.server || 1);
  const serverTeamScore = side === "A" ? currentScore.a : currentScore.b;
  const serverCurrentSlot = currentSlotFromBaseSlot(serverBaseSlot, serverTeamScore);
  return findPlayerIdByCurrentSlot(match, otherSide, serverCurrentSlot, base, currentScore) || null;
}

function normalizeServeForMatch(match, serve = {}, options = {}) {
  const side = validSide(serve?.side);
  let server = validServer(Number(serve?.server));
  const opening = Boolean(serve?.opening);
  const base = normalizedSlotsBaseForMatch(match, options.base);
  const score = currentGameScoreOf(match);
  const teamIds = getTeamPlayerIds(match, side);
  let serverId = String(serve?.serverId || "").trim();
  const isOpeningDoubles = isDoublesMatch(match) && opening;
  if (isOpeningDoubles) {
    server = OPENING_DOUBLES_SERVER;
  }

  if (serverId && !isServeServerIdValid(match, side, serverId)) {
    serverId = "";
  }
  const existingServerId = String(match?.serve?.serverId || "").trim();
  const canKeepExistingServer =
    !serverId &&
    existingServerId &&
    match?.serve?.side === side &&
    validServer(match?.serve?.server) === server &&
    Boolean(match?.serve?.opening) === opening &&
    isServeServerIdValid(match, side, existingServerId);

  if (
    isOpeningDoubles &&
    opening &&
    toNum(score.a, 0) === 0 &&
    toNum(score.b, 0) === 0
  ) {
    server = OPENING_DOUBLES_SERVER;
    const rightSlot = preStartRightSlotForSide(side, match?.meta?.refereeLayout);
    serverId =
      findPlayerIdByCurrentSlot(match, side, rightSlot, base, score) ||
      findPlayerIdByCurrentSlot(match, side, oppositeSlot(rightSlot), base, score) ||
      serverId ||
      teamIds[0] ||
      "";
  } else if (canKeepExistingServer) {
    serverId = existingServerId;
  } else if (!serverId) {
    serverId =
      (options.preferCurrentSlot
        ? findPlayerIdByCurrentSlot(match, side, server, base, score)
        : "") ||
      findPlayerIdByBaseSlot(match, side, server, base) ||
      findPlayerIdByCurrentSlot(match, side, server, base, score) ||
      teamIds[0] ||
      "";
  }

  const normalized = {
    side,
    server,
    serverId: serverId || null,
    receiverId: null,
    opening,
  };
  normalized.receiverId = resolveReceiverIdForServe(match, normalized, base, score);
  return normalized;
}

function validateSlotsBaseForMatch(match, inputBase = {}) {
  const normalizeTeam = (team) => {
    const validIds = new Set(getTeamPlayerIds(match, team));
    const raw = inputBase?.[team] && typeof inputBase[team] === "object" ? inputBase[team] : {};
    const filtered = {};

    for (const [rawId, rawSlot] of Object.entries(raw)) {
      const playerId = String(rawId).trim();
      const slot = Number(rawSlot);
      if (!playerId || !validIds.has(playerId)) continue;
      if (slot !== 1 && slot !== 2) continue;
      filtered[playerId] = slot;
    }

    if (validIds.size >= 2) {
      const slots = Object.values(filtered);
      const count1 = slots.filter((slot) => slot === 1).length;
      const count2 = slots.filter((slot) => slot === 2).length;
      if (count1 !== 1 || count2 !== 1) {
        return {
          ok: false,
          code: "invalid_transition",
          message: `Team ${team} must have one #1 and one #2`,
        };
      }
    }

    return { ok: true, value: filtered };
  };

  const teamA = normalizeTeam("A");
  if (!teamA.ok) return teamA;
  const teamB = normalizeTeam("B");
  if (!teamB.ok) return teamB;

  return {
    ok: true,
    value: {
      A: teamA.value,
      B: teamB.value,
    },
  };
}

function validateServeForMatch(match, inputServe = {}, options = {}) {
  const sideInput = String(inputServe?.side || "").trim().toUpperCase();
  const side = sideInput === "B" ? "B" : "A";
  const server = Number(inputServe?.server) === 1 ? 1 : 2;
  const rawServerId = String(inputServe?.serverId || "").trim();
  const opening = Boolean(inputServe?.opening);

  return {
    ok: true,
    value: normalizeServeForMatch(match, {
      side,
      server,
      serverId: rawServerId || null,
      opening,
    }, options),
  };
}

function applyServeState(match, serve, options = {}) {
  const bumpSlotsVersion = options.bumpSlotsVersion !== false;
  const normalizedServe = normalizeServeForMatch(match, serve, options);
  match.serve = normalizedServe;

  if (match.serve.serverId) {
    match.set("slots.serverId", match.serve.serverId, { strict: false });
  } else {
    match.set("slots.serverId", null, { strict: false });
  }
  match.set("slots.receiverId", match.serve.receiverId || null, { strict: false });
  match.set("slots.updatedAt", new Date(), { strict: false });
  if (bumpSlotsVersion) {
    const version = Number(match?.slots?.version || 0);
    match.set("slots.version", version + 1, { strict: false });
  }
  match.markModified("slots");
}

function normalizeEventInput(input) {
  const type = String(input?.type || "").trim().toLowerCase();
  if (!["start", "point", "undo", "finish", "forfeit", "serve", "slots"].includes(type)) {
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

function isBreakActive(match) {
  const rawBreak = match?.isBreak;
  return Boolean(
    rawBreak &&
      typeof rawBreak === "object" &&
      !Array.isArray(rawBreak) &&
      rawBreak.active === true
  );
}

function isBlockedByActiveBreak(eventType) {
  return ["point", "undo", "serve", "slots"].includes(eventType);
}

function applyStartEvent(match, event, actorId) {
  if (match.status === "finished") {
    return { ok: false, code: "match_closed", message: "Match already finished" };
  }

  const opening = isDoublesMatch(match);
  match.status = "live";
  if (!match.startedAt) match.startedAt = new Date();
  if (!match.gameScores?.length) {
    match.gameScores = [{ a: 0, b: 0 }];
    match.currentGame = 0;
  }
  applyServeState(match, {
    side: validSide(match.serve?.side),
    server: opening ? OPENING_DOUBLES_SERVER : 1,
    serverId: match.serve?.serverId || null,
    opening,
  }, { bumpSlotsVersion: false });

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
  if (evaluateGameFinish(score.a, score.b, buildNormalizedRules(match)).finished) {
    return {
      ok: false,
      code: "game_already_finished",
      message: "Current game is already finished",
    };
  }

  const prevServe = {
    side: validSide(match.serve?.side),
    server: validServer(match.serve?.server),
    serverId: match.serve?.serverId || null,
    opening: Boolean(match.serve?.opening),
  };

  const servingTeam = prevServe.side;
  if (team !== servingTeam) {
    return {
      ok: false,
      code: "invalid_transition",
      message: "Only the serving side can score in pickleball",
    };
  }

  if (team === "A") score.a += step;
  else score.b += step;
  match.gameScores[gameIndex] = score;

  applyServeState(match, prevServe, { bumpSlotsVersion: false });

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

function applyServeEvent(match, event, actorId) {
  if (match.status === "finished") {
    return { ok: false, code: "match_closed", message: "Match already finished" };
  }

  const prevServe = {
    side: validSide(match.serve?.side),
    server: validServer(match.serve?.server),
    serverId: match.serve?.serverId || null,
    opening: Boolean(match.serve?.opening),
  };

  const nextServe = validateServeForMatch(match, event.payload, {
    preferCurrentSlot:
      !event.payload?.serverId &&
      validSide(event.payload?.side) !== prevServe.side,
  });
  if (!nextServe.ok) return nextServe;

  applyServeState(match, nextServe.value);
  match.liveBy = actorId || match.liveBy || null;
  ensureLiveLog(match);
  match.liveLog.push({
    type: "serve",
    by: actorId || null,
    payload: {
      prevServe,
      nextServe: cloneValue(match.serve),
    },
    at: new Date(),
  });
  match.liveVersion = toNum(match.liveVersion, 0) + 1;
  return { ok: true, emittedType: "serve" };
}

function applySlotsEvent(match, event, actorId) {
  if (match.status === "finished") {
    return { ok: false, code: "match_closed", message: "Match already finished" };
  }

  const nextBase = validateSlotsBaseForMatch(match, event.payload?.base);
  if (!nextBase.ok) return nextBase;

  const nextLayout = normalizeRefereeLayout(event.payload?.layout);
  const hasLayout = Boolean(event.payload?.layout);
  const nextServe = event.payload?.serve
    ? validateServeForMatch(match, event.payload.serve, {
        base: nextBase.value,
      })
    : null;
  if (nextServe && !nextServe.ok) return nextServe;

  const prevBase = cloneValue(match?.slots?.base || { A: {}, B: {} });
  const prevLayout = normalizeRefereeLayout(match?.meta?.refereeLayout);
  const prevServe = {
    side: validSide(match.serve?.side),
    server: validServer(match.serve?.server),
    serverId: match.serve?.serverId || null,
    opening: Boolean(match.serve?.opening),
  };

  match.set("slots.base", cloneValue(nextBase.value), { strict: false });
  match.set("slots.updatedAt", new Date(), { strict: false });
  const prevVersion = Number(match?.slots?.version || 0);
  match.set("slots.version", prevVersion + 1, { strict: false });
  match.markModified("slots");

  if (hasLayout) {
    match.set("meta.refereeLayout", nextLayout, { strict: false });
  }
  if (nextServe?.value) {
    applyServeState(match, nextServe.value, { bumpSlotsVersion: false });
  }

  match.liveBy = actorId || match.liveBy || null;
  ensureLiveLog(match);
  match.liveLog.push({
    type: "slots",
    by: actorId || null,
    payload: {
      prevBase,
      nextBase: cloneValue(nextBase.value),
      prevLayout,
      nextLayout: hasLayout ? nextLayout : null,
      prevServe: nextServe?.value ? prevServe : null,
      nextServe: nextServe?.value ? cloneValue(match.serve) : null,
    },
    at: new Date(),
  });
  match.liveVersion = toNum(match.liveVersion, 0) + 1;
  return { ok: true, emittedType: "slots" };
}

function findUndoableLiveLogEntry(match) {
  const entries = Array.isArray(match?.liveLog) ? match.liveLog : [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const event = entries[index];
    const type = String(event?.type || "").trim().toLowerCase();
    if (["finish", "forfeit", "start"].includes(type)) {
      return null;
    }
    if (["point", "serve", "slots"].includes(type)) {
      return { index, event, type };
    }
  }
  return null;
}

function applyUndoEvent(match) {
  const found = findUndoableLiveLogEntry(match);
  if (!found) {
    return { ok: false, code: "invalid_transition", message: "No action to undo" };
  }

  const { index, event, type } = found;

  if (type === "point") {
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
      applyServeState(match, event.payload.prevServe);
    }
  } else if (type === "serve") {
    if (!event.payload?.prevServe) {
      return { ok: false, code: "invalid_transition", message: "No serve state to undo" };
    }
    applyServeState(match, event.payload.prevServe);
  } else if (type === "slots") {
    match.set("slots.base", cloneValue(event.payload?.prevBase || { A: {}, B: {} }), {
      strict: false,
    });
    match.set("slots.updatedAt", new Date(), { strict: false });
    const prevVersion = Number(match?.slots?.version || 0);
    match.set("slots.version", prevVersion + 1, { strict: false });
    match.markModified("slots");

    if (event.payload?.prevLayout) {
      match.set("meta.refereeLayout", normalizeRefereeLayout(event.payload.prevLayout), {
        strict: false,
      });
    }
    if (event.payload?.prevServe) {
      applyServeState(match, event.payload.prevServe);
    }
  }

  match.liveLog.splice(index, 1);
  match.liveVersion = toNum(match.liveVersion, 0) + 1;
  return { ok: true, emittedType: "undo" };
}

function applyFinishEvent(match, event, actorId, { isForfeit = false } = {}) {
  if (!event.payload?.winner) {
    return { ok: false, code: "invalid_transition", message: "Winner is required" };
  }
  if (!["A", "B"].includes(event.payload.winner)) {
    return { ok: false, code: "invalid_transition", message: "Invalid winner" };
  }
  if (match.status === "finished") {
    if (String(match.winner || "") === String(event.payload.winner || "")) {
      return { ok: true, emittedType: isForfeit ? "forfeit" : "finish" };
    }
    return { ok: false, code: "invalid_transition", message: "Match already finished" };
  }
  if (!isForfeit) {
    const winnerByScore = resolveFinishedWinnerByScore(match);
    if (!winnerByScore) {
      return {
        ok: false,
        code: "invalid_transition",
        message: "Match score is not finished yet",
      };
    }
    if (winnerByScore !== event.payload.winner) {
      return {
        ok: false,
        code: "invalid_transition",
        message: "Winner does not match current score",
      };
    }
  }

  match.status = "finished";
  match.winner = event.payload.winner;
  match.finishedAt = new Date();
  if (isForfeit) {
    const winnerSide = event.payload.winner;
    const forfeitedSide = resolveForfeitedSide(winnerSide, event.payload);
    match.gameScores = buildForfeitGameScores(match, winnerSide);
    match.currentGame = Math.max(0, match.gameScores.length - 1);
    match.ratingDelta = 0;
    match.ratingApplied = true;
    match.ratingAppliedAt = new Date();
    match.set("meta.resultType", "forfeit", { strict: false });
    match.set("meta.forfeitedSide", forfeitedSide, { strict: false });
    match.markModified("gameScores");
    match.markModified("meta");
  }
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
      forfeitedSide: isForfeit
        ? resolveForfeitedSide(event.payload.winner, event.payload)
        : undefined,
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
  if (isBreakActive(match) && isBlockedByActiveBreak(event.type)) {
    return {
      ok: false,
      code: "break_active",
      message: "Break is active. Resume the match before changing score or serve.",
    };
  }
  if (event.type === "start") return applyStartEvent(match, event, actorId);
  if (event.type === "point") return applyPointEvent(match, event, actorId);
  if (event.type === "serve") return applyServeEvent(match, event, actorId);
  if (event.type === "slots") return applySlotsEvent(match, event, actorId);
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
  await invalidateMatchSnapshotCache(matchId);
  emitTournamentMatchUpdate(io, doc, dto, {
    type,
    matchId: String(matchId),
    emitScoreUpdated: true,
    emitLiveActivity: type !== "point",
  });
}

async function applyLegacyRatingDeltaForMatch(matchDoc, scorerId) {
  const delta = Number(matchDoc.ratingDelta) || 0;
  if (matchDoc.ratingApplied || delta <= 0) return;
  if (isForfeitResult(matchDoc)) {
    matchDoc.ratingApplied = true;
    matchDoc.ratingAppliedAt = new Date();
    matchDoc.ratingDelta = 0;
    await matchDoc.save();
    return;
  }

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
  let stationAdvance = null;

  try {
    if (!matchDoc.ratingApplied) {
      await applyRatingForFinishedMatch(matchDoc._id).catch(async () => {
        await applyLegacyRatingDeltaForMatch(matchDoc, actorId);
      });
    }
  } catch (error) {
    console.error("[match-live-sync] finish rating side effect error:", error);
  }

  try {
    await onMatchFinished({ matchId: matchDoc._id });
    stationAdvance = await advanceCourtStationQueueOnMatchFinished(matchDoc._id);
  } catch (error) {
    console.error("[match-live-sync] finish court side effect error:", error);
  }

  try {
    const stationId =
      stationAdvance?.station?._id || matchDoc.courtStation?._id || matchDoc.courtStation;
    const clusterId =
      stationAdvance?.station?.clusterId ||
      matchDoc.courtClusterId?._id ||
      matchDoc.courtClusterId;

    if (stationId || clusterId) {
      const tasks = [];
      if (clusterId) {
        tasks.push(
          publishCourtClusterRuntimeUpdate({
            clusterId,
            stationIds: stationId ? [stationId] : [],
            reason: "match_finished_auto_advance",
          })
        );
      }
      if (stationId) {
        tasks.push(
          publishCourtStationRuntimeUpdate({
            stationId,
            clusterId,
            reason: "match_finished_auto_advance",
          })
        );
      }
      await Promise.allSettled(tasks);
    }
  } catch (error) {
    console.error("[match-live-sync] finish court publish error:", error);
  }
}

function buildRejected(events, code, message) {
  return (Array.isArray(events) ? events : []).map((event) => ({
    clientEventId: String(event?.clientEventId || "").trim(),
    code,
    message,
  }));
}

function buildLiveSyncModePayload(lockRuntime) {
  const featureEnabled = lockRuntime?.enabled !== false;
  return {
    featureEnabled,
    mode: featureEnabled ? "offline_sync_v1" : "legacy_realtime_v1",
    settingsUpdatedAt: lockRuntime?.updatedAt || null,
  };
}

async function syncMatchLiveEventsLocked({
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
  const lockRuntime = await getRefereeMatchControlLockRuntime();
  const modePayload = buildLiveSyncModePayload(lockRuntime);
  const ownershipEnabled = modePayload.featureEnabled && enforceOwnership !== false;

  if (!deviceId) {
    return {
      ...modePayload,
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

  let owner = ownershipEnabled ? await getMatchLiveOwner(matchId) : null;
  const currentUserId = user?._id || null;
  if (
    ownershipEnabled &&
    (!owner || liveOwnerMatchesIdentity(owner, { deviceId, userId: currentUserId }))
  ) {
    const claimResult = await claimMatchLiveOwner({
      matchId,
      deviceId,
      userId: currentUserId,
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
    ownershipEnabled &&
    owner &&
    !liveOwnerMatchesIdentity(owner, { deviceId, userId: currentUserId })
  ) {
    return {
      ...modePayload,
      ackedClientEventIds: [],
      rejectedEvents: buildRejected(
        normalizedEvents,
        "ownership_conflict",
        "Another referee owns this match"
      ),
      snapshot: await loadMatchLiveSnapshot(matchId),
      serverVersion: toNum(lastKnownServerVersion, 0),
      owner,
    };
  }

  const match = await Match.findById(matchId);
  if (!match) {
    return {
      ...modePayload,
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

  await hydrateResolvedMatchPairsForLive(match);

  const needsRosterContext = normalizedEvents.some((rawEvent) => {
    const type = String(rawEvent?.type || "").trim().toLowerCase();
    return type === "serve" || type === "slots";
  });
  if (needsRosterContext) {
    await match.populate([
      {
        path: "pairA",
        select: "player1 player2",
        populate: [
          { path: "player1", select: "user" },
          { path: "player2", select: "user" },
        ],
      },
      {
        path: "pairB",
        select: "player1 player2",
        populate: [
          { path: "player1", select: "user" },
          { path: "player2", select: "user" },
        ],
      },
    ]);
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

    if (
      liveEventRequiresResolvedTeams(normalized.event.type) &&
      !hasResolvedLiveTeams(match)
    ) {
      const remaining = normalizedEvents.slice(index);
      rejectedEvents.push(
        ...buildRejected(
          remaining,
          "teams_not_resolved",
          "Match teams are not resolved yet"
        )
      );
      break;
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
    ...modePayload,
    ackedClientEventIds,
    rejectedEvents,
    snapshot,
    serverVersion: toNum(snapshot?.liveVersion, toNum(match.liveVersion, 0)),
    owner: ownershipEnabled ? await getMatchLiveOwner(matchId) : null,
  };
}

export async function syncMatchLiveEvents(args = {}) {
  const matchId = args?.matchId;
  if (!matchId) return syncMatchLiveEventsLocked(args);

  return runMatchLiveSyncSerialized(matchId, async () => {
    const redisLock = await acquireRedisMatchSyncLock(matchId);
    if (redisLock?.busy) {
      const normalizedEvents = Array.isArray(args?.events) ? args.events : [];
      const lockRuntime = await getRefereeMatchControlLockRuntime();
      const modePayload = buildLiveSyncModePayload(lockRuntime);
      const snapshot = await loadMatchLiveSnapshot(matchId);
      const owner = modePayload.featureEnabled
        ? await getMatchLiveOwner(matchId).catch(() => null)
        : null;

      return {
        ...modePayload,
        ackedClientEventIds: [],
        rejectedEvents: buildRejected(
          normalizedEvents,
          "server_busy",
          "Match is busy, retry shortly"
        ),
        snapshot,
        serverVersion: toNum(
          snapshot?.liveVersion,
          toNum(args?.lastKnownServerVersion, 0)
        ),
        owner,
      };
    }

    try {
      return await syncMatchLiveEventsLocked(args);
    } finally {
      if (typeof redisLock?.release === "function") {
        await redisLock.release();
      }
    }
  });
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
