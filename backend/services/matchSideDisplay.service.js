import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import { buildMatchCodePayload } from "../utils/matchDisplayCode.js";

const SOURCE_REF_TYPES = new Set([
  "matchwinner",
  "matchloser",
  "stagematchwinner",
  "stagematchloser",
]);

const MATCH_SIDE_DISPLAY_SELECT = [
  "_id",
  "code",
  "displayCode",
  "codeResolved",
  "globalCode",
  "labelKey",
  "liveVersion",
  "status",
  "winner",
  "format",
  "branch",
  "phase",
  "pool",
  "group",
  "groupNo",
  "groupIndex",
  "rrRound",
  "globalRound",
  "round",
  "roundCode",
  "roundName",
  "order",
  "matchNo",
  "index",
  "stageIndex",
  "type",
  "tournament",
  "bracket",
  "pairA",
  "pairB",
  "pairAName",
  "pairBName",
  "teamAName",
  "teamBName",
  "sideAName",
  "sideBName",
  "resolvedSideNameA",
  "resolvedSideNameB",
  "teamFactionAName",
  "teamFactionBName",
  "seedA",
  "seedB",
  "previousA",
  "previousB",
].join(" ");

const PAIR_POPULATE = (path) => ({
  path,
  select:
    "player1 player2 players seed label teamName teamFactionName displayName displayNameMode name title",
  populate: [
    {
      path: "player1",
      select: "fullName name shortName nickname nickName nick user displayName displayNameMode",
      populate: {
        path: "user",
        select: "name fullName nickname nickName nick",
      },
    },
    {
      path: "player2",
      select: "fullName name shortName nickname nickName nick user displayName displayNameMode",
      populate: {
        path: "user",
        select: "name fullName nickname nickName nick",
      },
    },
    {
      path: "players",
      select: "fullName name shortName nickname nickName nick user displayName displayNameMode",
      populate: {
        path: "user",
        select: "name fullName nickname nickName nick",
      },
    },
  ],
});

const MATCH_SIDE_DISPLAY_POPULATE = [
  { path: "tournament", select: "name eventType type displayNameMode nameDisplayMode" },
  {
    path: "bracket",
    select: "name type stage order drawRounds meta config prefill",
  },
  PAIR_POPULATE("pairA"),
  PAIR_POPULATE("pairB"),
];

function pick(value) {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value).trim();
  }
  return "";
}

function firstText(...values) {
  for (const value of values) {
    const text = pick(value);
    if (text) return text;
  }
  return "";
}

function toIdString(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return String(value._id || value.id || "").trim();
  }
  return String(value).trim();
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function sideKey(side) {
  return String(side || "").toUpperCase() === "B" ? "B" : "A";
}

function typeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function displayModeOf(...sources) {
  for (const source of sources) {
    if (source === "fullName") return "fullName";
    if (source === "nickname") return "nickname";
    const raw = firstText(
      source?.displayNameMode,
      source?.nameDisplayMode,
      source?.tournament?.displayNameMode,
      source?.tournament?.nameDisplayMode
    );
    if (raw === "fullName") return "fullName";
    if (raw === "nickname") return "nickname";
  }
  return "nickname";
}

function storedDisplayNameForMode(entity, displayMode) {
  const storedName = pick(entity?.displayName);
  const storedMode = firstText(entity?.displayNameMode, entity?.nameDisplayMode);
  return storedName && storedMode === displayMode ? storedName : "";
}

function playerNickname(player) {
  return firstText(
    player?.nickname,
    player?.nickName,
    player?.nick,
    player?.nick_name,
    player?.shortName,
    player?.user?.nickname,
    player?.user?.nickName,
    player?.user?.nick
  );
}

function playerFullName(player) {
  return firstText(
    player?.fullName,
    player?.user?.fullName,
    player?.user?.name,
    player?.name
  );
}

function playerDisplayName(player, displayMode = "nickname") {
  if (!player || typeof player !== "object") return "";
  const nickname = playerNickname(player);
  const fullName = playerFullName(player);
  if (displayMode === "fullName") {
    return (
      storedDisplayNameForMode(player, displayMode) ||
      fullName ||
      nickname ||
      pick(player?.displayName)
    );
  }
  return (
    storedDisplayNameForMode(player, displayMode) ||
    nickname ||
    fullName ||
    pick(player?.displayName)
  );
}

function eventTypeOf(match) {
  return typeKey(
    firstText(
      match?.eventType,
      match?.tournament?.eventType,
      match?.tournament?.type
    )
  );
}

function pairPlayers(pair) {
  if (!pair || typeof pair !== "object") return [];
  if (Array.isArray(pair.players) && pair.players.length) {
    return pair.players.filter(Boolean);
  }
  return [pair.player1, pair.player2, pair.p1, pair.p2].filter(Boolean);
}

function hasResolvedPair(pair) {
  return Boolean(
    pair &&
      typeof pair === "object" &&
      (pair.player1 ||
        pair.player2 ||
        (Array.isArray(pair.players) && pair.players.length) ||
        pair.name ||
        pair.teamName ||
        pair.label ||
        pair.displayName)
  );
}

function pairDisplayName(pair, match) {
  if (!pair || typeof pair !== "object") return "";
  const displayMode = displayModeOf(match, pair);
  const isSingle = eventTypeOf(match) === "single";
  const names = pairPlayers(pair)
    .slice(0, isSingle ? 1 : 2)
    .map((player) => playerDisplayName(player, displayMode))
    .filter(Boolean);
  if (names.length) return isSingle ? names[0] : names.join(" / ");

  return (
    storedDisplayNameForMode(pair, displayMode) ||
    firstText(pair.teamName, pair.name, pair.label, pair.title, pair.displayName)
  );
}

export function isReferenceDisplayName(value) {
  const normalized = pick(value)
    .replace(/\s+/g, "")
    .replace(/\([AB]\)$/i, "");
  if (!normalized) return false;
  return (
    /^(?:[WL]-)?V\d+(?:-[A-Z0-9]+)?(?:-NT)?-T\d+$/i.test(normalized) ||
    /^(?:WB|LB)\d+-T\d+$/i.test(normalized) ||
    /^GF(?:\d+)?-T\d+$/i.test(normalized)
  );
}

export function isConcreteTeamLabel(value) {
  const text = pick(value);
  if (!text) return false;
  if (/^(BYE|TBD|Registration|Chưa có đội|Đội A|Đội B|Team A|Team B|—|-)$/i.test(text)) {
    return false;
  }
  if (/^[WL]\s*-/i.test(text)) return false;
  return !isReferenceDisplayName(text);
}

function getSidePair(match, side) {
  return sideKey(side) === "B" ? match?.pairB : match?.pairA;
}

function getSideSeed(match, side) {
  return sideKey(side) === "B" ? match?.seedB : match?.seedA;
}

function getPreviousSide(match, side) {
  return sideKey(side) === "B" ? match?.previousB : match?.previousA;
}

function rawResolvedSideName(match, side) {
  const normalizedSide = sideKey(side);
  const candidates =
    normalizedSide === "B"
      ? [
          match?.resolvedSideNameB,
          match?.__sideB,
          match?.teamBName,
          match?.pairBName,
          match?.sideBName,
          match?.teamFactionBName,
        ]
      : [
          match?.resolvedSideNameA,
          match?.__sideA,
          match?.teamAName,
          match?.pairAName,
          match?.sideAName,
          match?.teamFactionAName,
        ];
  return candidates.find(isConcreteTeamLabel) || "";
}

function seedDisplayName(seed) {
  if (!seed) return "";
  const direct = firstText(
    seed?.label,
    seed?.displayName,
    seed?.teamName,
    seed?.name,
    seed?.title,
    seed?.code
  );
  if (direct) return direct;
  if (typeKey(seed?.type) === "bye") return "BYE";
  return "";
}

function sourceReferencePrefix(seed) {
  const seedType = typeKey(seed?.type);
  if (seedType === "matchloser" || seedType === "stagematchloser") return "L";
  if (seedType === "matchwinner" || seedType === "stagematchwinner") return "W";
  return "";
}

function isSourceReferenceSeed(seed) {
  return SOURCE_REF_TYPES.has(typeKey(seed?.type));
}

function effectiveBracketRounds(bracket, matchesOfBracket = []) {
  const kind = typeKey(bracket?.type);
  if (kind === "group" || kind === "round_robin" || kind === "gsl") return 1;

  const configured = Number(bracket?.meta?.maxRounds);
  if (Number.isFinite(configured) && configured > 0) return Math.trunc(configured);

  const maxRound = matchesOfBracket.reduce((max, match) => {
    const round = matchRoundNumber(match);
    return Number.isFinite(round) && round > max ? round : max;
  }, 0);
  return Math.max(1, maxRound);
}

function buildBaseByBracketId(matches = []) {
  const bracketRows = new Map();
  for (const match of matches) {
    const bracketId = toIdString(match?.bracket);
    if (!bracketId) continue;
    if (!bracketRows.has(bracketId)) {
      const bracket = match?.bracket && typeof match.bracket === "object" ? match.bracket : {};
      bracketRows.set(bracketId, {
        bracketId,
        bracket,
        matches: [],
      });
    }
    bracketRows.get(bracketId).matches.push(match);
  }

  const rows = Array.from(bracketRows.values()).sort((a, b) => {
    const stageA = Number(a.bracket?.stage);
    const stageB = Number(b.bracket?.stage);
    if (Number.isFinite(stageA) && Number.isFinite(stageB) && stageA !== stageB) {
      return stageA - stageB;
    }
    const orderA = Number(a.bracket?.order);
    const orderB = Number(b.bracket?.order);
    if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) {
      return orderA - orderB;
    }
    return a.bracketId.localeCompare(b.bracketId);
  });

  const baseByBracketId = new Map();
  let offset = 0;
  for (const row of rows) {
    baseByBracketId.set(row.bracketId, offset);
    offset += effectiveBracketRounds(row.bracket, row.matches);
  }
  return baseByBracketId;
}

export function resolveMatchDisplayCode(match, options = {}) {
  if (!match) return "";
  const payload = buildMatchCodePayload(match, {
    baseByBracketId: options.baseByBracketId,
    preferComputed: true,
  });
  return firstText(
    payload?.displayCode,
    payload?.code,
    match?.displayCode,
    match?.codeResolved,
    match?.globalCode,
    match?.code,
    match?.labelKey
  );
}

function matchDisplayCode(match, options = {}) {
  return resolveMatchDisplayCode(match, options);
}

function parseMatchCodeParts(match) {
  const raw = firstText(
    match?.displayCode,
    match?.code,
    match?.globalCode,
    match?.matchCode,
    match?.labelKey
  );
  const hit = raw.match(/^V(\d+)(?:-[^-]+)?-T(\d+)$/i);
  if (!hit) return { round: NaN, order: NaN };
  return {
    round: Number(hit[1]),
    order: Number(hit[2]) - 1,
  };
}

function matchRoundNumber(match) {
  const direct = Number(match?.round ?? match?.rrRound);
  if (Number.isFinite(direct)) return direct;
  const global = Number(match?.globalRound);
  if (Number.isFinite(global)) return global;
  return parseMatchCodeParts(match).round;
}

function matchOrderNumber(match) {
  const direct = Number(match?.order ?? match?.meta?.order);
  if (Number.isFinite(direct)) return direct;
  const matchNo = Number(match?.matchNo);
  if (Number.isFinite(matchNo) && matchNo > 0) return matchNo - 1;
  const index = Number(match?.index);
  if (Number.isFinite(index)) return index;
  return parseMatchCodeParts(match).order;
}

function uniqueFiniteNumbers(...values) {
  return Array.from(
    new Set(values.map((value) => Number(value)).filter(Number.isFinite))
  );
}

function matchRoundCandidates(match) {
  return uniqueFiniteNumbers(
    match?.round ?? match?.rrRound,
    match?.globalRound,
    parseMatchCodeParts(match).round
  );
}

function matchOrderCandidates(match) {
  return uniqueFiniteNumbers(
    match?.order ?? match?.meta?.order,
    match?.matchNo != null ? Number(match.matchNo) - 1 : NaN,
    match?.index,
    parseMatchCodeParts(match).order
  );
}

function sameTournament(candidate, owner) {
  const ownerTournamentId = toIdString(owner?.tournament);
  const candidateTournamentId = toIdString(candidate?.tournament);
  return (
    !ownerTournamentId ||
    !candidateTournamentId ||
    ownerTournamentId === candidateTournamentId
  );
}

function pickIndexedSource(candidates, owner) {
  const ownerId = toIdString(owner);
  const list = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => toIdString(candidate) !== ownerId)
    .filter((candidate) => sameTournament(candidate, owner));
  if (list.length <= 1) return list[0] || null;

  const sameBranch = list.filter(
    (candidate) =>
      String(candidate?.branch || "main") === String(owner?.branch || "main") &&
      String(candidate?.phase || "") === String(owner?.phase || "")
  );
  const branchCandidates = sameBranch.length ? sameBranch : list;
  const ownerRound = matchRoundNumber(owner);
  const previousCandidates = Number.isFinite(ownerRound)
    ? branchCandidates.filter((candidate) => {
        const candidateRound = matchRoundNumber(candidate);
        return Number.isFinite(candidateRound) && candidateRound < ownerRound;
      })
    : [];
  return (previousCandidates.length ? previousCandidates : branchCandidates)
    .slice()
    .sort((a, b) => matchRoundNumber(b) - matchRoundNumber(a))[0];
}

function findSourceBySeed(match, seed, matchesById) {
  if (!seed || !matchesById) return null;

  const directId = toIdString(
    seed?.ref?.matchId ||
      seed?.ref?.match ||
      seed?.ref?.sourceMatchId ||
      seed?.ref?.sourceMatch ||
      seed?.matchId ||
      seed?.match
  );
  if (directId && matchesById.has(directId)) return matchesById.get(directId);

  const refRound = Number(seed?.ref?.round);
  const refOrder = Number(seed?.ref?.order);
  if (!Number.isFinite(refRound) || !Number.isFinite(refOrder)) return null;

  const stage = Number(seed?.ref?.stageIndex ?? seed?.ref?.stage);
  const bracketId = toIdString(match?.bracket);
  const allMatches = Array.from(matchesById.values());
  const byRound = allMatches.filter((candidate) =>
    matchRoundCandidates(candidate).includes(refRound)
  );

  const findByOrder = (orderValue) => {
    const byOrder = byRound.filter((candidate) =>
      matchOrderCandidates(candidate).includes(orderValue)
    );
    const stageMatches = Number.isFinite(stage)
      ? byOrder.filter((candidate) => {
          const candidateStage = Number(
            candidate?.bracket?.stage ?? candidate?.stageIndex
          );
          return Number.isFinite(candidateStage) && candidateStage === stage;
        })
      : [];
    const stageHit = pickIndexedSource(stageMatches, match);
    if (stageHit) return stageHit;

    if (!bracketId) return null;
    return pickIndexedSource(
      byOrder.filter((candidate) => toIdString(candidate?.bracket) === bracketId),
      match
    );
  };

  return findByOrder(refOrder) || (refOrder > 0 ? findByOrder(refOrder - 1) : null);
}

function isByeSide(match, side) {
  const seed = getSideSeed(match, side);
  const label = seedDisplayName(seed);
  return typeKey(seed?.type) === "bye" || /\bBYE\b/i.test(label);
}

function isKnockoutMatch(match) {
  const kind = typeKey(match?.bracket?.type || match?.type || match?.format);
  return kind === "knockout" || kind === "ko";
}

function getPlannedSeed(match, side, matchesById) {
  if (!match || !isKnockoutMatch(match)) return null;

  const localRound = matchRoundNumber(match) || 1;
  const localOrder = matchOrderNumber(match);
  const bracketId = toIdString(match?.bracket);
  if (!bracketId || !Number.isFinite(localOrder)) return null;

  const bracket = match?.bracket && typeof match.bracket === "object" ? match.bracket : null;
  if (localRound > 1) {
    const bracketMatches = Array.from(matchesById?.values?.() || [])
      .filter((candidate) => toIdString(candidate?.bracket) === bracketId)
      .filter(
        (candidate) =>
          String(candidate?.branch || "main") === String(match?.branch || "main") &&
          String(candidate?.phase || "") === String(match?.phase || "")
      );
    if (!bracketMatches.length) return null;

    const byOrder = (a, b) => matchOrderNumber(a) - matchOrderNumber(b);
    const currentRoundMatches = bracketMatches
      .filter((candidate) => matchRoundCandidates(candidate).includes(localRound))
      .sort(byOrder);
    const currentIndex = currentRoundMatches.findIndex(
      (candidate) => toIdString(candidate) === toIdString(match)
    );
    const sourceSlot =
      (currentIndex >= 0 ? currentIndex : localOrder) * 2 + (sideKey(side) === "B" ? 1 : 0);
    const previousRoundMatches = bracketMatches
      .filter((candidate) => matchRoundCandidates(candidate).includes(localRound - 1))
      .sort(byOrder);
    const sourceMatch = previousRoundMatches[sourceSlot] || null;
    const sourceOrder = Number.isFinite(matchOrderNumber(sourceMatch))
      ? matchOrderNumber(sourceMatch)
      : sourceSlot;
    const sourceRound = Number.isFinite(matchRoundNumber(sourceMatch))
      ? matchRoundNumber(sourceMatch)
      : localRound - 1;
    const stageIndex = Number(sourceMatch?.bracket?.stage ?? bracket?.stage ?? 0);
    const ref = {
      stageIndex,
      stage: stageIndex,
      round: sourceRound,
      order: sourceOrder,
    };
    if (sourceMatch?._id) ref.matchId = sourceMatch._id;
    return {
      type: "stageMatchWinner",
      ref,
      label: `W-V${localRound - 1}-T${sourceOrder + 1}`,
    };
  }

  const seedRows = Array.isArray(bracket?.prefill?.seeds)
    ? bracket.prefill.seeds
    : Array.isArray(bracket?.config?.blueprint?.seeds)
      ? bracket.config.blueprint.seeds
      : [];
  if (!seedRows.length) return null;

  const pairNo = localOrder + 1;
  const planned = seedRows.find((entry) => Number(entry?.pair) === pairNo) || seedRows[localOrder];
  return sideKey(side) === "B" ? planned?.B || null : planned?.A || null;
}

function seedForSide(match, side, matchesById) {
  const rawSeed = getSideSeed(match, side);
  const rawSeedType = typeKey(rawSeed?.type);
  const isEmptyRegistrationSeed =
    rawSeedType === "registration" &&
    !rawSeed?.label &&
    !rawSeed?.ref?.registration &&
    !rawSeed?.ref?.reg &&
    !rawSeed?.ref?.id &&
    !rawSeed?.ref?._id;
  if (rawSeed?.type && !isEmptyRegistrationSeed) return rawSeed;
  return getPlannedSeed(match, side, matchesById) || rawSeed;
}

function previousSource(match, side, matchesById) {
  const previous = getPreviousSide(match, side);
  const previousId = toIdString(previous);
  if (previousId && matchesById?.has(previousId)) return matchesById.get(previousId);
  return previous && typeof previous === "object" ? previous : null;
}

export function resolveMatchSideDisplayName(match, side, options = {}) {
  const normalizedSide = sideKey(side);
  const fallback =
    options.fallback || (normalizedSide === "B" ? "Đội B chưa rõ" : "Đội A chưa rõ");
  const depth = Number(options.depth || 0);
  if (!match || depth > 12) return fallback;

  const matchesById = options.matchesById instanceof Map ? options.matchesById : new Map();
  const pair = getSidePair(match, normalizedSide);
  if (hasResolvedPair(pair)) {
    const pairName = pairDisplayName(pair, match);
    if (pairName && !isReferenceDisplayName(pairName)) return pairName;
  }

  const rawName = rawResolvedSideName(match, normalizedSide);
  if (rawName) return rawName;

  const seed = seedForSide(match, normalizedSide, matchesById);
  const seedType = typeKey(seed?.type);
  const isLoserSeed = seedType === "matchloser" || seedType === "stagematchloser";
  const source =
    previousSource(match, normalizedSide, matchesById) ||
    (isSourceReferenceSeed(seed) ? findSourceBySeed(match, seed, matchesById) : null);

  if (source) {
    const sourceByeA = isByeSide(source, "A");
    const sourceByeB = isByeSide(source, "B");
    if (sourceByeA || sourceByeB) {
      if (isLoserSeed || (sourceByeA && sourceByeB)) return "BYE";
      const carried = resolveMatchSideDisplayName(source, sourceByeA ? "B" : "A", {
        ...options,
        depth: depth + 1,
        fallback: "",
      });
      if (isConcreteTeamLabel(carried)) return carried;
    } else if (typeKey(source.status) === "finished" && source.winner) {
      const winnerSide = sideKey(source.winner);
      const sourceSide = isLoserSeed ? (winnerSide === "A" ? "B" : "A") : winnerSide;
      const carried = resolveMatchSideDisplayName(source, sourceSide, {
        ...options,
        depth: depth + 1,
        fallback: "",
      });
      if (isConcreteTeamLabel(carried)) return carried;
    }

    if (isSourceReferenceSeed(seed) || getPreviousSide(match, normalizedSide)) {
      const code = matchDisplayCode(source, options);
      if (code && code !== "—") {
        const prefix = sourceReferencePrefix(seed) || (isLoserSeed ? "L" : "W");
        return `${prefix}-${code.replace(/^[WL]\s*-\s*/i, "")}`;
      }
    }
  }

  const seedName = seedDisplayName(seed);
  if (seedName && !isReferenceDisplayName(seedName)) return seedName;

  const pairName = pairDisplayName(pair, match);
  if (pairName) return pairName;
  if (seedName) return seedName;
  return fallback;
}

function addMatchToMap(matchesById, match) {
  const id = toIdString(match);
  if (id && match && typeof match === "object") matchesById.set(id, match);
}

function collectSourceIds(match, pendingIds, matchesById) {
  for (const source of [
    match?.previousA,
    match?.previousB,
    match?.seedA?.ref?.matchId,
    match?.seedA?.ref?.match,
    match?.seedA?.ref?.sourceMatchId,
    match?.seedA?.ref?.sourceMatch,
    match?.seedB?.ref?.matchId,
    match?.seedB?.ref?.match,
    match?.seedB?.ref?.sourceMatchId,
    match?.seedB?.ref?.sourceMatch,
  ]) {
    const id = toIdString(source);
    if (id && isValidObjectId(id) && !matchesById.has(id)) pendingIds.add(id);
    if (source && typeof source === "object") addMatchToMap(matchesById, source);
  }
}

function needsTournamentScope(match, matchesById) {
  if (!match) return false;
  for (const side of ["A", "B"]) {
    const pair = getSidePair(match, side);
    if (hasResolvedPair(pair)) continue;
    if (rawResolvedSideName(match, side)) continue;

    const seed = getSideSeed(match, side);
    if (isSourceReferenceSeed(seed) && !toIdString(seed?.ref?.matchId || seed?.ref?.match)) {
      return true;
    }
    if (!seed?.type && isKnockoutMatch(match) && (matchRoundNumber(match) || 1) > 1) {
      return true;
    }
    if (!seed?.type && !previousSource(match, side, matchesById)) {
      return true;
    }
  }
  return false;
}

async function queryMatchesByIds(ids) {
  const normalizedIds = Array.from(new Set(ids)).filter(isValidObjectId);
  if (!normalizedIds.length) return [];
  return Match.find({ _id: { $in: normalizedIds } })
    .select(MATCH_SIDE_DISPLAY_SELECT)
    .populate(MATCH_SIDE_DISPLAY_POPULATE)
    .lean();
}

async function queryMatchesByScope(matchesById) {
  const matches = Array.from(matchesById.values());
  const tournamentIds = Array.from(
    new Set(matches.map((match) => toIdString(match?.tournament)).filter(isValidObjectId))
  );
  const bracketIds = Array.from(
    new Set(matches.map((match) => toIdString(match?.bracket)).filter(isValidObjectId))
  );

  if (tournamentIds.length) {
    return Match.find({ tournament: { $in: tournamentIds } })
      .select(MATCH_SIDE_DISPLAY_SELECT)
      .populate(MATCH_SIDE_DISPLAY_POPULATE)
      .lean();
  }

  if (bracketIds.length) {
    return Match.find({ bracket: { $in: bracketIds } })
      .select(MATCH_SIDE_DISPLAY_SELECT)
      .populate(MATCH_SIDE_DISPLAY_POPULATE)
      .lean();
  }

  return [];
}

export async function buildMatchSideDisplayContextFromMatches(matches = []) {
  const matchesById = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    addMatchToMap(matchesById, match);
  }

  for (let depth = 0; depth < 12; depth += 1) {
    const pendingIds = new Set();
    for (const match of matchesById.values()) {
      collectSourceIds(match, pendingIds, matchesById);
    }
    if (!pendingIds.size) break;
    const rows = await queryMatchesByIds(pendingIds);
    if (!rows.length) break;
    rows.forEach((row) => addMatchToMap(matchesById, row));
  }

  const scopeNeeded = Array.from(matchesById.values()).some((match) =>
    needsTournamentScope(match, matchesById)
  );
  if (scopeNeeded) {
    const scopedRows = await queryMatchesByScope(matchesById);
    scopedRows.forEach((row) => addMatchToMap(matchesById, row));
  }

  return {
    matchesById,
    baseByBracketId: buildBaseByBracketId(Array.from(matchesById.values())),
  };
}
