import asyncHandler from "express-async-handler";
import Tournament from "../models/tournamentModel.js";
import mongoose from "mongoose";
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import TournamentManager from "../models/tournamentManagerModel.js";
import Registration from "../models/registrationModel.js";
import Court from "../models/courtModel.js";
import { sleep } from "../utils/sleep.js";
import { toPublicUrl } from "../utils/publicUrl.js";
import { ensureTournamentCardImageUrl } from "../utils/tournamentImageVariant.js";
import { normalizeMatchDisplayShape } from "../socket/liveHandlers.js";
import {
  attachPublicStreamsToMatch,
  getLatestRecordingsByMatchIds,
} from "../services/publicStreams.service.js";
import {
  buildTeamRoster,
  buildTeamStandings,
} from "../services/teamTournament.service.js";
import { buildMatchCodePayload } from "../utils/matchDisplayCode.js";

const isId = (id) => mongoose.Types.ObjectId.isValid(id);
const normalizeTournamentPublicUrls = async (req, tournament) => {
  if (!tournament || typeof tournament !== "object") return tournament;

  const overlay =
    tournament.overlay && typeof tournament.overlay === "object"
      ? {
          ...tournament.overlay,
          logoUrl: toPublicUrl(req, tournament.overlay.logoUrl, {
            absolute: false,
          }),
        }
      : tournament.overlay;

  return {
    ...tournament,
    image: await ensureTournamentCardImageUrl(req, tournament.image),
    overlay,
  };
};
const setNoStoreHeaders = (res) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-PKT-Cache", "BYPASS");
};
const ROUND_ELIM_TYPES = new Set(["roundelim", "po", "playoff"]);
const DEFAULT_MATCH_RULES = {
  bestOf: 1,
  pointsToWin: 11,
  winByTwo: true,
};
const ROUND_ELIM_BYE_SEED = { type: "bye", ref: null, label: "BYE" };

const clampMatchRules = (rule, fallback = DEFAULT_MATCH_RULES) => {
  const source =
    rule && typeof rule === "object" ? rule : fallback && typeof fallback === "object" ? fallback : {};
  const bestOf = [1, 3, 5].includes(Number(source.bestOf))
    ? Number(source.bestOf)
    : Number(fallback?.bestOf || DEFAULT_MATCH_RULES.bestOf);
  const pointsToWin = [11, 15, 21].includes(Number(source.pointsToWin))
    ? Number(source.pointsToWin)
    : Number(fallback?.pointsToWin || DEFAULT_MATCH_RULES.pointsToWin);
  const winByTwo =
    typeof source.winByTwo === "boolean"
      ? source.winByTwo
      : typeof fallback?.winByTwo === "boolean"
        ? fallback.winByTwo
        : DEFAULT_MATCH_RULES.winByTwo;
  const capMode = String(source?.cap?.mode || fallback?.cap?.mode || "none");
  const capPoints = Number.isFinite(Number(source?.cap?.points))
    ? Number(source.cap.points)
    : Number.isFinite(Number(fallback?.cap?.points))
      ? Number(fallback.cap.points)
      : null;

  return {
    bestOf,
    pointsToWin,
    winByTwo,
    cap: { mode: capMode, points: capPoints },
  };
};

const cloneRoundElimSeed = (seed, fallbackSeed = null) => {
  if (!seed || typeof seed !== "object" || !seed.type) {
    if (!fallbackSeed) return null;
    return {
      ...fallbackSeed,
      ref:
        fallbackSeed.ref && typeof fallbackSeed.ref === "object"
          ? { ...fallbackSeed.ref }
          : fallbackSeed.ref ?? null,
    };
  }

  return {
    type: String(seed.type),
    ref:
      seed.ref && typeof seed.ref === "object"
        ? { ...seed.ref }
        : seed.ref ?? null,
    label: String(seed.label || fallbackSeed?.label || ""),
  };
};

const defaultRoundElimRegistrationSeed = (index) => ({
  type: "registration",
  ref: {},
  label: `Đội ${index}`,
});

const roundElimMatchesForRound = (drawSize, roundNum) => {
  const totalTeams = Math.max(0, Number(drawSize || 0));
  const round = Math.max(1, Number(roundNum || 1));
  if (round === 1) return Math.max(1, Math.ceil(totalTeams / 2));
  const prevMatches = roundElimMatchesForRound(totalTeams, round - 1);
  return Math.floor(prevMatches / 2);
};

const getRoundElimRuleForRound = (bracket, roundNum) => {
  const blueprint = bracket?.config?.blueprint || {};
  const roundRules = Array.isArray(blueprint.roundRules) ? blueprint.roundRules : [];
  const baseRule = clampMatchRules(
    bracket?.config?.rules || blueprint.rules || null,
    DEFAULT_MATCH_RULES
  );
  const roundRule = roundRules[Math.max(0, Number(roundNum || 1) - 1)];
  return clampMatchRules(roundRule, baseRule);
};

const buildRoundElimSeedsForSlot = (bracket, drawSize, r1Pairs, roundNum, orderNum) => {
  if (Number(roundNum) === 1) {
    const prefillSeeds = Array.isArray(bracket?.prefill?.seeds)
      ? bracket.prefill.seeds
      : [];
    const prefillEntry = prefillSeeds[orderNum] || {};
    const idxA = orderNum * 2 + 1;
    const idxB = orderNum * 2 + 2;

    const fallbackA = defaultRoundElimRegistrationSeed(idxA);
    const fallbackB =
      idxB <= drawSize ? defaultRoundElimRegistrationSeed(idxB) : ROUND_ELIM_BYE_SEED;

    return {
      seedA: cloneRoundElimSeed(prefillEntry?.A, fallbackA) || fallbackA,
      seedB: cloneRoundElimSeed(prefillEntry?.B, fallbackB) || fallbackB,
    };
  }

  const prevPairs =
    Number(roundNum) === 2
      ? r1Pairs
      : Math.max(0, roundElimMatchesForRound(drawSize, Number(roundNum) - 1));
  const leftOrder = orderNum * 2;
  const rightOrder = orderNum * 2 + 1;

  return {
    seedA: {
      type: "stageMatchLoser",
      ref: {
        stageIndex: Number(bracket?.stage || 0),
        round: Number(roundNum) - 1,
        order: leftOrder,
      },
      label: `L-V${Number(roundNum) - 1}-T${leftOrder + 1}`,
    },
    seedB:
      rightOrder < prevPairs
        ? {
            type: "stageMatchLoser",
            ref: {
              stageIndex: Number(bracket?.stage || 0),
              round: Number(roundNum) - 1,
              order: rightOrder,
            },
            label: `L-V${Number(roundNum) - 1}-T${rightOrder + 1}`,
          }
        : cloneRoundElimSeed(ROUND_ELIM_BYE_SEED, ROUND_ELIM_BYE_SEED),
  };
};

const ensureRoundElimBracketMatches = async (tournamentId) => {
  const brackets = await Bracket.find({
    tournament: tournamentId,
    type: { $in: Array.from(ROUND_ELIM_TYPES) },
  })
    .select("_id tournament type stage order prefill meta config")
    .lean();

  if (!brackets.length) return;

  const existingMatches = await Match.find({
    tournament: tournamentId,
    bracket: { $in: brackets.map((bracket) => bracket._id) },
  })
    .select(
      "_id bracket round order seedA seedB rules bestOf pointsToWin winByTwo capMode capPoints"
    )
    .lean();

  const existingByKey = new Map(
    existingMatches.map((match) => [
      `${String(match.bracket)}:${Number(match.round || 1)}:${Number(match.order || 0)}`,
      match,
    ])
  );

  const ops = [];
  const touchedBracketIds = new Set();

  for (const bracket of brackets) {
    const bracketId = String(bracket?._id || "");
    if (!bracketId) continue;

    const drawSize = Math.max(
      0,
      Number(
        bracket?.config?.roundElim?.drawSize ||
          bracket?.config?.blueprint?.drawSize ||
          (Array.isArray(bracket?.prefill?.seeds) ? bracket.prefill.seeds.length * 2 : 0) ||
          Number(bracket?.meta?.expectedFirstRoundMatches || 0) * 2 ||
          bracket?.meta?.drawSize ||
          0
      )
    );
    const r1Pairs = Math.max(
      1,
      Number(
        bracket?.meta?.expectedFirstRoundMatches ||
          (Array.isArray(bracket?.prefill?.seeds) ? bracket.prefill.seeds.length : 0) ||
          Math.ceil(drawSize / 2) ||
          1
      )
    );
    const maxRounds = Math.max(
      1,
      Number(
        bracket?.meta?.maxRounds ||
          bracket?.config?.roundElim?.maxRounds ||
          bracket?.config?.roundElim?.cutRounds ||
          bracket?.config?.blueprint?.maxRounds ||
          1
      )
    );

    for (let roundNum = 1; roundNum <= maxRounds; roundNum += 1) {
      const expectedMatches =
        roundNum === 1
          ? r1Pairs
          : Math.max(0, roundElimMatchesForRound(drawSize, roundNum));

      if (roundNum > 1 && expectedMatches <= 0) break;

      for (let orderNum = 0; orderNum < Math.max(1, expectedMatches); orderNum += 1) {
        const key = `${bracketId}:${roundNum}:${orderNum}`;
        const existingMatch = existingByKey.get(key) || null;
        const seeds = buildRoundElimSeedsForSlot(
          bracket,
          drawSize,
          r1Pairs,
          roundNum,
          orderNum
        );
        const roundRule = getRoundElimRuleForRound(bracket, roundNum);

        if (!existingMatch) {
          const doc = {
            tournament: bracket.tournament,
            bracket: bracket._id,
            format: "roundElim",
            round: roundNum,
            order: orderNum,
            seedA: seeds.seedA,
            seedB: seeds.seedB,
            rules: roundRule,
            bestOf: roundRule.bestOf,
            pointsToWin: roundRule.pointsToWin,
            winByTwo: roundRule.winByTwo,
            capMode: roundRule.cap?.mode ?? "none",
            capPoints: roundRule.cap?.points ?? null,
          };

          ops.push({
            updateOne: {
              filter: {
                tournament: bracket.tournament,
                bracket: bracket._id,
                round: roundNum,
                order: orderNum,
              },
              update: { $setOnInsert: doc },
              upsert: true,
            },
          });
          touchedBracketIds.add(bracketId);
          continue;
        }

        const patch = {};
        if (!existingMatch?.seedA?.type && seeds.seedA) patch.seedA = seeds.seedA;
        if (!existingMatch?.seedB?.type && seeds.seedB) patch.seedB = seeds.seedB;
        if (!existingMatch?.rules && roundRule) patch.rules = roundRule;
        if (!Number.isFinite(Number(existingMatch?.bestOf)))
          patch.bestOf = roundRule.bestOf;
        if (!Number.isFinite(Number(existingMatch?.pointsToWin)))
          patch.pointsToWin = roundRule.pointsToWin;
        if (typeof existingMatch?.winByTwo !== "boolean")
          patch.winByTwo = roundRule.winByTwo;
        if (!existingMatch?.capMode) patch.capMode = roundRule.cap?.mode ?? "none";
        if (
          existingMatch?.capPoints === undefined &&
          roundRule.cap?.points !== undefined
        ) {
          patch.capPoints = roundRule.cap.points;
        }

        if (Object.keys(patch).length) {
          ops.push({
            updateOne: {
              filter: { _id: existingMatch._id },
              update: { $set: patch },
            },
          });
          touchedBracketIds.add(bracketId);
        }
      }
    }
  }

  if (!ops.length) return;

  await Match.bulkWrite(ops, { ordered: false });

  if (typeof Match.compileSeedsForBracket === "function") {
    for (const bracketId of touchedBracketIds) {
      await Match.compileSeedsForBracket(bracketId);
    }
  }
};

const getTournamentBracketBaseByBracketId = async (tournamentId) => {
  const objectId = new mongoose.Types.ObjectId(tournamentId);
  const allBrackets = await Bracket.find({ tournament: tournamentId })
    .select("_id type stage order prefill ko meta config drawRounds")
    .lean();

  const roundsAgg = await Match.aggregate([
    { $match: { tournament: objectId } },
    { $group: { _id: "$bracket", maxRound: { $max: "$round" } } },
  ]);

  const maxRoundByBracket = new Map(
    roundsAgg.map((row) => [String(row._id), Number(row.maxRound) || 0])
  );

  const typeKey = (type) => String(type || "").toLowerCase();
  const isGroupish = (type) => {
    const key = typeKey(type);
    return key === "group" || key === "round_robin" || key === "gsl";
  };
  const teamsFromRoundKey = (key) => {
    if (!key) return 0;
    const upper = String(key).toUpperCase();
    if (upper === "F") return 2;
    if (upper === "SF") return 4;
    if (upper === "QF") return 8;
    const matched = /^R(\d+)$/i.exec(upper);
    return matched ? parseInt(matched[1], 10) : 0;
  };
  const ceilPow2 = (value) =>
    Math.pow(2, Math.ceil(Math.log2(Math.max(1, value || 1))));
  const readBracketScale = (bracket) => {
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
  };
  const roundsCountForBracket = (bracket) => {
    const type = typeKey(bracket?.type);
    const bracketId = String(bracket?._id || "");
    if (isGroupish(type)) return 1;

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
  };

  const groupBrackets = allBrackets.filter((bracket) => isGroupish(bracket.type));
  const nonGroupBrackets = allBrackets.filter(
    (bracket) => !isGroupish(bracket.type)
  );
  const stageValue = (bracket) =>
    Number.isFinite(bracket?.stage) ? Number(bracket.stage) : 9999;

  const buckets = [];
  if (groupBrackets.length) {
    buckets.push({
      key: "group",
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
    const brackets = byStage.get(stage);
    const span =
      Math.max(...brackets.map((bracket) => roundsCountForBracket(bracket))) || 1;
    buckets.push({
      key: `stage-${stage}`,
      isGroup: false,
      brackets,
      spanRounds: span,
      stageHint: stage,
      orderHint: Math.min(
        ...brackets.map((bracket) => Number(bracket?.order ?? 0))
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
      baseByBracketId.set(String(bracket._id), accumulated);
    }
    accumulated += bucket.spanRounds;
  }

  return { baseByBracketId };
};

const enrichBracketMatchList = async (tournamentId, listRaw) => {
  const { baseByBracketId } = await getTournamentBracketBaseByBracketId(
    tournamentId
  );
  const latestRecordingsByMatchId = await getLatestRecordingsByMatchIds(listRaw);
  const resolvePublicCourtMeta = (match) => {
    const stationId =
      match?.courtStationId || match?.courtStation?._id || match?.courtStation;
    const stationName =
      match?.courtStationName || match?.courtStationLabel || "";
    const stationStatus = match?.courtStation?.status || "";
    const stationOrder = Number.isFinite(match?.courtStation?.order)
      ? match.courtStation.order
      : null;
    const stationCluster =
      match?.courtClusterName || match?.courtClusterLabel || "";

    return {
      courtId: stationId || match?.court?._id || match?.court || null,
      courtName: stationName || match?.court?.name || match?.courtLabel || "",
      courtStatus: stationStatus || match?.court?.status || "",
      courtOrder:
        stationOrder ??
        (Number.isFinite(match?.court?.order) ? match.court.order : null),
      courtBracket: match?.court?.bracket || null,
      courtCluster:
        stationCluster || match?.court?.cluster || match?.courtCluster || "",
    };
  };

  const safeInt = (value) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : undefined;
  };
  const alphaToNum = (value) => {
    const matched = String(value || "")
      .trim()
      .match(/^[A-Za-z]/);
    if (!matched) return undefined;
    return matched[0].toUpperCase().charCodeAt(0) - 64;
  };
  const typeKey = (type) => String(type || "").toLowerCase();
  const isGroupish = (type) => {
    const key = typeKey(type);
    return key === "group" || key === "round_robin" || key === "gsl";
  };
  const getGroupNo = (match, bracket) => {
    const poolName =
      match?.pool?.name || match?.pool?.key || match?.groupCode || "";
    if (poolName) {
      const numeric = String(poolName).match(/\d+/);
      if (numeric) return parseInt(numeric[0], 10);
      const alpha = alphaToNum(poolName);
      if (alpha) return alpha;
    }

    const groups = Array.isArray(bracket?.groups) ? bracket.groups : [];
    if (groups.length) {
      if (match?.pool?.id) {
        const groupIndex = groups.findIndex(
          (group) => String(group?._id) === String(match.pool.id)
        );
        if (groupIndex >= 0) return groupIndex + 1;
      }
      if (poolName) {
        const groupIndex = groups.findIndex(
          (group) =>
            String(group?.name || "")
              .trim()
              .toUpperCase() === String(poolName).trim().toUpperCase()
        );
        if (groupIndex >= 0) return groupIndex + 1;
      }
    }

    const directCandidates = [
      match?.groupNo,
      match?.groupIndex,
      match?.groupIdx,
      match?.group,
      match?.meta?.groupNo,
      match?.meta?.groupIndex,
      match?.meta?.pool,
      match?.group?.no,
      match?.group?.index,
      match?.group?.order,
      match?.pool?.index,
      match?.pool?.no,
      match?.pool?.order,
    ];
    for (const candidate of directCandidates) {
      const numeric = safeInt(candidate);
      if (typeof numeric === "number") return numeric <= 0 ? 1 : numeric;
    }
    return undefined;
  };
  const getGroupOrder = (match) => {
    const matched = String(match?.labelKey || "").match(/#(\d+)\s*$/);
    if (matched) return parseInt(matched[1], 10);
    const orderInGroup =
      safeInt(match?.orderInGroup) ?? safeInt(match?.meta?.orderInGroup);
    if (typeof orderInGroup === "number") return orderInGroup + 1;
    const order = safeInt(match?.order);
    if (typeof order === "number") return order + 1;
    return 1;
  };
  const getKnockoutOrder = (match) => {
    const matched = String(match?.labelKey || "").match(/#(\d+)\s*$/);
    if (matched) return parseInt(matched[1], 10);
    const order =
      safeInt(match?.order) ??
      safeInt(match?.meta?.order) ??
      safeInt(match?.matchNo) ??
      safeInt(match?.index) ??
      0;
    return order + 1;
  };

  return listRaw.map((rawMatch) => {
    const match = normalizeMatchDisplayShape(rawMatch);
    const bracket = match.bracket || {};
    const bracketId = String(bracket?._id || "");
    const groupStage = isGroupish(bracket?.type);

    const baseRound = baseByBracketId.get(bracketId) ?? 0;
    const localRound = groupStage
      ? 1
      : Number.isFinite(match.round)
      ? match.round
      : 1;
    const globalRound = baseRound + localRound;

    let code;
    if (groupStage) {
      const groupNo = getGroupNo(match, bracket);
      const groupOrder = getGroupOrder(match);
      code = `V1-${groupNo ? `B${groupNo}` : "B?"}-T${groupOrder}`;
    } else {
      code = `V${globalRound}-T${getKnockoutOrder(match)}`;
    }

    const fallbackVideo =
      match?.facebookLive?.video_permalink_url ||
      match?.facebookLive?.permalink_url ||
      "";
    const publicCourtMeta = resolvePublicCourtMeta(match);

    const enrichedMatch = {
      ...match,
      video:
        typeof match?.video === "string" && match.video.trim()
          ? match.video.trim()
          : fallbackVideo,
      ...publicCourtMeta,
      globalRound,
      globalCode: `V${globalRound}`,
      code,
    };
    return attachPublicStreamsToMatch(
      enrichedMatch,
      latestRecordingsByMatchId.get(String(match?._id || ""))
    );
  });
};

const listTournamentMatchesBracketView = async (req, res) => {
  const { id } = req.params;
  setNoStoreHeaders(res);
  await ensureRoundElimBracketMatches(id);

  const listRaw = await Match.find({ tournament: id })
    .select(
      [
        "tournament",
        "bracket",
        "format",
        "branch",
        "phase",
        "pool",
        "round",
        "order",
        "stageIndex",
        "labelKey",
        "meta.groupNo",
        "meta.groupIndex",
        "meta.pool",
        "meta.orderInGroup",
        "meta.order",
        "seedA",
        "seedB",
        "pairA",
        "pairB",
        "previousA",
        "previousB",
        "isThirdPlace",
        "meta.thirdPlace",
        "meta.stageLabel",
        "rules",
        "currentGame",
        "gameScores",
        "status",
        "winner",
        "referee",
        "scheduledAt",
        "startedAt",
        "finishedAt",
        "assignedAt",
        "court",
        "courtStation",
        "courtLabel",
        "courtCluster",
        "courtClusterId",
        "courtClusterLabel",
        "courtStationLabel",
        "queueOrder",
        "serve",
        "liveVersion",
        "video",
        "facebookLive.permalink_url",
        "facebookLive.video_permalink_url",
        "createdAt",
      ].join(" ")
    )
    .populate({
      path: "tournament",
      select: "name image eventType nameDisplayMode",
    })
    .populate({
      path: "bracket",
      select: [
        "name",
        "type",
        "stage",
        "order",
        "drawRounds",
        "drawStatus",
        "scheduler",
        "drawSettings",
        "noRankDelta",
        "meta.drawSize",
        "meta.maxRounds",
        "meta.expectedFirstRoundMatches",
        "groups._id",
        "groups.name",
        "groups.expectedSize",
        "config.rules",
        "config.doubleElim",
        "config.roundRobin",
        "config.swiss",
        "config.gsl",
        "config.roundElim",
        "overlay",
      ].join(" "),
    })
    .populate({
      path: "pairA",
      select: "player1 player2 label teamName",
    })
    .populate({
      path: "pairB",
      select: "player1 player2 label teamName",
    })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({
      path: "court",
      select:
        "name number code label zone area venue building floor cluster status bracket order",
    })
    .populate({
      path: "courtStation",
      select: "name code status order clusterId",
    })
    .sort({ round: 1, order: 1, createdAt: 1 })
    .lean();

  const payload = await enrichBracketMatchList(id, listRaw);
  setNoStoreHeaders(res);
  return res.json(payload);
};

const listTournamentMatchesScheduleView = async (req, res) => {
  const { id } = req.params;
  setNoStoreHeaders(res);
  const listRaw = await Match.find({ tournament: id })
    .select(
      [
        "tournament",
        "bracket",
        "format",
        "branch",
        "phase",
        "pool",
        "round",
        "order",
        "stageIndex",
        "labelKey",
        "meta.groupNo",
        "meta.groupIndex",
        "meta.pool",
        "meta.orderInGroup",
        "meta.order",
        "seedA",
        "seedB",
        "pairA",
        "pairB",
        "currentGame",
        "gameScores",
        "status",
        "winner",
        "referee",
        "scheduledAt",
        "startedAt",
        "finishedAt",
        "assignedAt",
        "court",
        "courtStation",
        "courtLabel",
        "courtCluster",
        "courtClusterId",
        "courtClusterLabel",
        "courtStationLabel",
        "queueOrder",
        "serve",
        "liveVersion",
        "video",
        "facebookLive.permalink_url",
        "facebookLive.video_permalink_url",
        "createdAt",
        "updatedAt",
      ].join(" ")
    )
    .populate({
      path: "tournament",
      select: "name image eventType nameDisplayMode",
    })
    .populate({
      path: "bracket",
      select: "name type stage order groups._id groups.name",
    })
    .populate({
      path: "pairA",
      select: "player1 player2 label teamName",
    })
    .populate({
      path: "pairB",
      select: "player1 player2 label teamName",
    })
    .populate({
      path: "court",
      select: "name cluster status order",
    })
    .populate({
      path: "courtStation",
      select: "name code status order clusterId",
    })
    .sort({ round: 1, order: 1, createdAt: 1 })
    .lean();

  const list = await enrichBracketMatchList(id, listRaw);
  const payload = {
    total: list.length,
    page: 1,
    limit: list.length,
    list,
  };

  setNoStoreHeaders(res);
  return res.json(payload);
};
// @desc    Lấy danh sách giải đấu (lọc theo sportType & groupId)
// @route   GET /api/tournaments?sportType=&groupId=
// @access  Public

/**
 * GET /api/tournaments/public
 * Query:
 *  - sportType: Number (1/2)
 *  - groupId:   Number
 *  - sort:      string, ví dụ "-startDate,name" (mặc định: "-startDate")
 *  - limit:     number (optional)
 */
// GET /tournaments
const getTournaments = asyncHandler(async (req, res) => {
  const hasSortQP = Object.prototype.hasOwnProperty.call(req.query, "sort");
  const sortQP = (req.query.sort || "").toString().trim();
  const limit = req.query.limit
    ? Math.max(parseInt(req.query.limit, 10) || 0, 0)
    : null;
  const status = (req.query.status || "").toString().toLowerCase(); // upcoming|ongoing|finished (chỉ dùng lọc nếu có)
  const rawKeyword = (req.query.keyword ?? req.query.q ?? "").toString().trim();

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parseSort = (s) =>
    s.split(",").reduce((acc, token) => {
      const key = token.trim();
      if (!key) return acc;
      if (key.startsWith("-")) acc[key.slice(1)] = -1;
      else acc[key] = 1;
      return acc;
    }, {});
  const sortSpecFromQP = hasSortQP ? parseSort(sortQP) : {};

  const pipeline = [];

  // ----- Search (keyword / q) -----
  if (rawKeyword) {
    const tokens = rawKeyword.split(/\s+/).filter(Boolean).map(escapeRegex);
    const tokenConds = tokens.map((tk) => ({
      $or: [
        { name: { $regex: tk, $options: "i" } },
        { slug: { $regex: tk, $options: "i" } },
        { code: { $regex: tk, $options: "i" } },
        { "location.city": { $regex: tk, $options: "i" } },
        { "location.province": { $regex: tk, $options: "i" } },
        { location: { $regex: tk, $options: "i" } },
        { venueName: { $regex: tk, $options: "i" } },
      ],
    }));

    const orExpr = [];
    if (tokenConds.length) orExpr.push({ $and: tokenConds });

    if (mongoose.Types.ObjectId.isValid(rawKeyword)) {
      orExpr.push({ _id: new mongoose.Types.ObjectId(rawKeyword) });
    }

    pipeline.push({
      $match: orExpr.length === 1 ? orExpr[0] : { $or: orExpr },
    });
  }

  // ----- Chuẩn hoá mốc thời gian -----
  pipeline.push({
    $addFields: {
      _startInstant: { $ifNull: ["$startAt", "$startDate"] },
      _endInstant: {
        $ifNull: [
          { $ifNull: ["$endAt", "$endDate"] },
          { $ifNull: ["$startAt", "$startDate"] }, // fallback
        ],
      },
    },
  });

  // ----- Tính “độ gần để sort” KHÔNG dựa trên status -----
  // nearDeltaMs: 0 cho giải đang diễn ra (now ∈ [start,end])
  //              (start - now) cho giải sắp diễn ra
  //              (now - end) cho giải đã kết thúc
  // tieMs:      ưu tiên kết thúc sớm hơn trong ongoing; bắt đầu sớm hơn trong upcoming; kết thúc gần hơn trong finished
  pipeline.push(
    {
      $addFields: {
        _isOngoing: {
          $and: [
            { $lte: ["$_startInstant", "$$NOW"] },
            { $gte: ["$_endInstant", "$$NOW"] },
          ],
        },
        _isUpcoming: { $gt: ["$_startInstant", "$$NOW"] },
      },
    },
    {
      $addFields: {
        nearDeltaMs: {
          $cond: [
            "$_isOngoing",
            0,
            {
              $cond: [
                "$_isUpcoming",
                { $subtract: ["$_startInstant", "$$NOW"] },
                { $subtract: ["$$NOW", "$_endInstant"] },
              ],
            },
          ],
        },
        tieMs: {
          $cond: [
            "$_isOngoing",
            { $max: [0, { $subtract: ["$_endInstant", "$$NOW"] }] }, // sắp kết thúc trước → lên trước
            {
              $cond: [
                "$_isUpcoming",
                { $max: [0, { $subtract: ["$_startInstant", "$$NOW"] }] }, // bắt đầu sớm hơn → lên trước
                { $max: [0, { $subtract: ["$$NOW", "$_endInstant"] }] }, // vừa kết thúc → lên trước
              ],
            },
          ],
        },
      },
    }
  );

  // ----- (Tuỳ chọn) Lọc theo status nếu client truyền, nhưng KHÔNG dùng status để sort -----
  if (["upcoming", "ongoing", "finished"].includes(status)) {
    // dùng status lưu trong DB (nếu muốn vẫn có thể tính runtime như trước)
    pipeline.push({ $match: { status } });
  }

  // ----- Sort / Limit -----
  // Ưu tiên tuyệt đối theo nearDeltaMs -> tieMs; sau đó cho phép ép thêm trường phụ từ QP (nếu có) -> _id ổn định
  pipeline.push({
    $sort: {
      nearDeltaMs: 1,
      tieMs: 1,
      ...sortSpecFromQP,
      _id: -1,
    },
  });
  if (limit) pipeline.push({ $limit: limit });

  // ----- registered / isFull / remaining -----
  pipeline.push(
    {
      $lookup: {
        from: "registrations",
        let: { tid: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$tournament", "$$tid"] } } },
          { $group: { _id: null, c: { $sum: 1 } } },
        ],
        as: "_rc",
      },
    },
    {
      $addFields: {
        registered: { $ifNull: [{ $arrayElemAt: ["$_rc.c", 0] }, 0] },
        isFull: {
          $cond: [
            {
              $and: [
                { $gt: ["$maxPairs", 0] },
                {
                  $gte: [
                    { $ifNull: [{ $arrayElemAt: ["$_rc.c", 0] }, 0] },
                    "$maxPairs",
                  ],
                },
              ],
            },
            true,
            false,
          ],
        },
        remaining: {
          $cond: [
            { $gt: ["$maxPairs", 0] },
            {
              $max: [
                0,
                {
                  $subtract: [
                    "$maxPairs",
                    { $ifNull: [{ $arrayElemAt: ["$_rc.c", 0] }, 0] },
                  ],
                },
              ],
            },
            null,
          ],
        },
      },
    }
  );

  // ----- Bracket stats / effectiveNoRankDelta -----
  pipeline.push(
    {
      $lookup: {
        from: "brackets",
        let: { tid: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$tournament", "$$tid"] } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              noRankOn: {
                $sum: { $cond: [{ $eq: ["$noRankDelta", true] }, 1, 0] },
              },
            },
          },
        ],
        as: "_bc",
      },
    },
    {
      $addFields: {
        bracketsTotal: { $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] },
        bracketsNoRankDeltaTrue: {
          $ifNull: [{ $arrayElemAt: ["$_bc.noRankOn", 0] }, 0],
        },
        allBracketsNoRankDelta: {
          $cond: [
            { $gt: [{ $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] }, 0] },
            {
              $eq: [
                { $ifNull: [{ $arrayElemAt: ["$_bc.noRankOn", 0] }, 0] },
                { $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] },
              ],
            },
            false,
          ],
        },
        effectiveNoRankDelta: {
          $or: [
            { $eq: ["$noRankDelta", true] },
            {
              $cond: [
                {
                  $gt: [
                    { $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] },
                    0,
                  ],
                },
                {
                  $eq: [
                    { $ifNull: [{ $arrayElemAt: ["$_bc.noRankOn", 0] }, 0] },
                    { $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] },
                  ],
                },
                false,
              ],
            },
          ],
        },
      },
    },
    {
      $project: {
        _rc: 0,
        _bc: 0,
        _startInstant: 0,
        _endInstant: 0,
        _isOngoing: 0,
        _isUpcoming: 0,
        nearDeltaMs: 0,
        tieMs: 0,
      },
    }
  );

  const tournaments = await Promise.all(
    (await Tournament.aggregate(pipeline)).map((t) =>
      normalizeTournamentPublicUrls(req, t)
    )
  );
  res.status(200).json(tournaments);
});

const getTournamentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid ID");
  }

  const tour = await Tournament.findById(id)
    .populate("allowedCourtClusterIds", "name slug venueName isActive order")
    .populate("teamConfig.factions.captainUser", "name nickname avatar phone")
    .lean();
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const [managerRows, registrationsCount, checkedInCount, paidCount] =
    await Promise.all([
      TournamentManager.find({ tournament: id }).select("user role").lean(),
      Registration.countDocuments({ tournament: id }),
      Registration.countDocuments({
        tournament: id,
        checkinAt: { $ne: null },
      }),
      Registration.countDocuments({
        tournament: id,
        "payment.status": "Paid",
      }),
    ]);

  const managers = managerRows.map((r) => ({ user: r.user, role: r.role }));
  const now = new Date();
  const startInstant = tour.startAt || tour.startDate;
  const endInstant = tour.endAt || tour.endDate;

  let status = "upcoming";
  if (tour.finishedAt) status = "finished";
  else if (startInstant && now < new Date(startInstant)) status = "upcoming";
  else if (endInstant && now > new Date(endInstant)) status = "finished";
  else status = "ongoing";

  const isFreeRegistration = tour.isFreeRegistration === true;
  const bankShortName = isFreeRegistration
    ? ""
    : tour.bankShortName || tour.qrBank || tour.bankCode || tour.bank || "";
  const bankAccountNumber = isFreeRegistration
    ? ""
    : tour.bankAccountNumber || tour.qrAccount || tour.bankAccount || "";
  const bankAccountName = isFreeRegistration
    ? ""
    : tour.bankAccountName ||
      tour.accountName ||
      tour.paymentAccountName ||
      tour.beneficiaryName ||
      "";
  const registrationFee = (() => {
    if (isFreeRegistration) return 0;
    const raw = tour.registrationFee ?? tour.fee ?? tour.entryFee ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  })();

  const normalizedTour = await normalizeTournamentPublicUrls(req, tour);
  const payload = {
    ...normalizedTour,
    allowedCourtClusters: Array.isArray(normalizedTour.allowedCourtClusterIds)
      ? normalizedTour.allowedCourtClusterIds.map((cluster) => ({
          _id: String(cluster?._id || cluster || ""),
          name: String(cluster?.name || "").trim(),
          slug: String(cluster?.slug || "").trim(),
          venueName: String(cluster?.venueName || "").trim(),
          isActive: cluster?.isActive !== false,
          order: Number(cluster?.order || 0),
        }))
      : [],
    tournamentMode: normalizedTour.tournamentMode || "standard",
    teamConfig: {
      factions: Array.isArray(normalizedTour?.teamConfig?.factions)
        ? normalizedTour.teamConfig.factions.map((faction, index) => ({
            _id: String(faction?._id || ""),
            name: String(faction?.name || "").trim(),
            order: Number(faction?.order ?? index),
            isActive: faction?.isActive !== false,
            captainUser: faction?.captainUser || null,
          }))
        : [],
    },
    status,
    managers,
    _managerUserIds: managerRows.map((r) => String(r.user)),
    stats: {
      registrationsCount,
      checkedInCount,
      paidCount,
    },
    bankShortName,
    bankAccountNumber,
    bankAccountName,
    registrationFee,
    isFreeRegistration,
    qrBank: bankShortName,
    qrAccount: bankAccountNumber,
    fee: registrationFee,
    entryFee: registrationFee,
  };

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-PKT-Cache", "BYPASS");

  const meId = req.user?._id ? String(req.user._id) : null;
  const amOwner = !!(meId && String(payload.createdBy) === meId);
  const amManager =
    amOwner ||
    (!!meId &&
      Array.isArray(payload._managerUserIds) &&
      payload._managerUserIds.includes(meId));

  const { _managerUserIds, ...publicPayload } = payload;
  res.json({
    ...publicPayload,
    amOwner,
    amManager,
  });
});

/**
 * GET /api/tournaments/:id/brackets
 * User route: trả về các bracket của giải, sort theo stage -> order -> createdAt
 * Thêm matchesCount (tính qua $lookup, không tốn populate).
 */
// helper

/* ========== Helpers ========== */
function buildKoLabels(B) {
  const labels = [];
  for (let s = B; s >= 2; s >>= 1) {
    if (s === 8) labels.push("QF");
    else if (s === 4) labels.push("SF");
    else if (s === 2) labels.push("F");
    else labels.push(`R${s}`);
  }
  return labels;
}

function sanitizeKoMeta(raw) {
  if (!raw || typeof raw !== "object") return null;
  const ko = { ...raw };
  if (!ko.entrants || ko.entrants <= 1) {
    if (ko.bracketSize && ko.bracketSize >= 2) {
      const labels = buildKoLabels(ko.bracketSize);
      ko.labels = labels;
      ko.rounds = Math.log2(ko.bracketSize) | 0;
      ko.startKey = labels[0];
    } else return null;
  } else {
    const B =
      ko.bracketSize && ko.bracketSize >= 2
        ? ko.bracketSize
        : 1 << Math.ceil(Math.log2(ko.entrants));
    ko.bracketSize = B;
    ko.rounds = Math.log2(B) | 0;
    ko.byes = typeof ko.byes === "number" ? ko.byes : B - ko.entrants;
    ko.labels =
      Array.isArray(ko.labels) && ko.labels.length
        ? ko.labels
        : buildKoLabels(B);
    ko.startKey = ko.startKey || ko.labels[0];
  }
  return ko;
}

/* ========== Controller ========== */
export const listTournamentBrackets = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isId(id)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-PKT-Cache", "BYPASS");

    const rows = await Bracket.aggregate([
      { $match: { tournament: new mongoose.Types.ObjectId(id) } },
      { $sort: { stage: 1, order: 1, createdAt: 1 } },

      // fallback theo matches (nếu cần)
      {
        $lookup: {
          from: "matches",
          let: { bid: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$bracket", "$$bid"] } } },
            { $group: { _id: "$roundKey", matches: { $sum: 1 } } },
            { $project: { _id: 0, roundKey: "$_id", matches: 1 } },
          ],
          as: "_rounds",
        },
      },

      // DrawSession KO mới nhất: LẤY CẢ source & board để FE vẽ sơ đồ prefill
      {
        $lookup: {
          from: "drawsessions",
          let: { bid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$bracket", "$$bid"] },
                    { $eq: ["$mode", "knockout"] },
                  ],
                },
              },
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            { $project: { _id: 1, board: 1, computedMeta: 1, source: 1 } }, // 👈 lấy thêm source
          ],
          as: "_draw",
        },
      },

      // Giữ matchesCount như cũ
      {
        $addFields: {
          matchesCount: { $sum: "$_rounds.matches" },
        },
      },
    ]);

    // === Thu thập mọi regId trong board prefill để map tên ===
    const allIds = new Set();
    for (const b of rows) {
      const ds = Array.isArray(b._draw) ? b._draw[0] : null;
      const pairs = ds?.board?.pairs || [];
      for (const p of pairs) {
        if (p?.a) allIds.add(String(p.a));
        if (p?.b) allIds.add(String(p.b));
      }
    }
    const regIds = [...allIds].map((s) => new mongoose.Types.ObjectId(s));
    let regMap = new Map();
    if (regIds.length) {
      const regs = await Registration.find({ _id: { $in: regIds } })
        .select("_id name displayName team shortName")
        .lean();
      regMap = new Map(
        regs.map((r) => [
          String(r._id),
          {
            name:
              r.displayName ||
              r.shortName ||
              r.name ||
              (r.team ? r.team.name : "Unnamed"),
          },
        ])
      );
    }

    // === Hậu xử lý: build ko + prefill (để FE render sơ đồ ngay cả khi chưa có match) ===
    const list = rows.map((b) => {
      let ko = null;
      let prefill = null;

      if (b.type === "knockout") {
        const ds = Array.isArray(b._draw) ? b._draw[0] : null;

        // 1) ƯU TIÊN: ko meta từ DrawSession
        if (ds?.computedMeta?.ko) {
          const sanitized = sanitizeKoMeta(ds.computedMeta.ko);
          if (sanitized) {
            ko = sanitized;
            if (ds.computedMeta.flags) {
              ko.flags = ds.computedMeta.flags;
            }
          }
        }

        // 2) prefill board để vẽ sơ đồ (kể cả khi entrants null/ BYE)
        if (ds?.board?.pairs?.length) {
          const pairs = ds.board.pairs.map((p) => ({
            index: p.index,
            a: p.a
              ? {
                  id: String(p.a),
                  name: regMap.get(String(p.a))?.name || null,
                }
              : null, // null = BYE
            b: p.b
              ? {
                  id: String(p.b),
                  name: regMap.get(String(p.b))?.name || null,
                }
              : null,
          }));
          prefill = {
            drawId: String(ds._id),
            roundKey: ds.board.roundKey || (ko ? ko.startKey : null),
            isVirtual: !!ds?.computedMeta?.flags?.virtual,
            source: ds?.source
              ? {
                  fromBracket: ds.source.fromBracket
                    ? String(ds.source.fromBracket)
                    : null,
                  fromName: ds.source.fromName || null,
                  fromType: ds.source.fromType || null,
                  mode: ds.source.mode || null,
                  params: ds.source.params || null,
                }
              : null,
            pairs,
          };

          // nếu chưa có ko, suy B từ board
          if (!ko) {
            const B = pairs.length * 2;
            if (B >= 2) {
              const labels = buildKoLabels(B);
              ko = {
                bracketSize: B,
                rounds: Math.log2(B) | 0,
                startKey: labels[0],
                labels,
              };
            }
          }
        }

        // 3) Cuối: nếu vẫn chưa có ko thì fallback từ matches
        if (!ko && Array.isArray(b._rounds) && b._rounds.length) {
          const maxMatches = b._rounds.reduce(
            (m, r) => Math.max(m, r?.matches || 0),
            0
          );
          const B = maxMatches * 2;
          if (B >= 2) {
            const labels = buildKoLabels(B);
            ko = {
              bracketSize: B,
              rounds: Math.log2(B) | 0,
              startKey: labels[0],
              labels,
            };
          }
        }
      }

      // loại bỏ field tạm
      const { _rounds, _draw, ...rest } = b;
      const out = { ...rest };
      if (ko) out.ko = ko;
      if (prefill) out.prefill = prefill;
      return out;
    });

    res.json(list);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tournaments/:id/matches
 * User route: trả về match của giải (có thể lọc theo bracket/type/stage/status).
 * HỖ TRỢ phân trang: ?page=1&limit=50, sort: ?sort=round,order (mặc định round asc, order asc).
 * Populate chuẩn theo schema (KHÔNG dùng 'reg1', 'reg2' — đó là lý do lỗi strictPopulate trước đây).
 */
const toObjectId = (id) => {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
};

export const getTeamRoster = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("Invalid tournament id");
  }
  const payload = await buildTeamRoster(id);
  res.json(payload);
});

export const getTeamStandings = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("Invalid tournament id");
  }
  const payload = await buildTeamStandings(id);
  res.json(payload);
});

export { getTournaments, getTournamentById };

export const listTournamentMatches = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isId(id))
      return res.status(400).json({ message: "Invalid tournament id" });

    const view = String(req.query.view || "").trim().toLowerCase();
    if (view === "bracket") {
      return await listTournamentMatchesBracketView(req, res);
    }
    if (view === "schedule") {
      return await listTournamentMatchesScheduleView(req, res);
    }

    const {
      bracket,
      stage,
      type,
      status,
      court,
      hasCourt,
      courtStatus,
      page = 1,
      limit = 200000,
      sort = "round,order,createdAt",
    } = req.query;

    // ---- parse sort ----
    const parseSort = (s) =>
      String(s || "")
        .split(",")
        .reduce((acc, tok) => {
          const key = tok.trim();
          if (!key) return acc;
          acc[key.startsWith("-") ? key.slice(1) : key] = key.startsWith("-")
            ? -1
            : 1;
          return acc;
        }, {});
    const sortSpec = Object.keys(parseSort(sort)).length
      ? parseSort(sort)
      : { round: 1, order: 1, createdAt: 1 };

    // ---- base filter ----
    const filter = { tournament: id };
    if (status) filter.status = status;
    if (bracket && isId(bracket)) filter.bracket = bracket;

    if (
      (stage && Number.isFinite(Number(stage))) ||
      (type && typeof type === "string")
    ) {
      const bFilter = { tournament: id };
      if (stage) bFilter.stage = Number(stage);
      if (type) bFilter.type = type;
      const brs = await Bracket.find(bFilter).select("_id").lean();
      const ids = brs.map((b) => b._id);
      filter.bracket = filter.bracket
        ? { $in: ids.filter((x) => String(x) === String(filter.bracket)) }
        : { $in: ids };
    }

    // ---- court filters ----
    if (court && isId(court)) filter.court = court;
    if (hasCourt === "1" || hasCourt === "true") {
      filter.court = { $ne: null, ...(filter.court || {}) };
    }
    if (courtStatus) {
      const courtCond = { tournament: id };
      if (bracket && isId(bracket)) courtCond.bracket = bracket;
      const courts = await Court.find({ ...courtCond, status: courtStatus })
        .select("_id")
        .lean();
      const ids = courts.map((c) => c._id);
      if (filter.court && filter.court.$ne === null) {
        filter.court = { $in: ids };
      } else if (filter.court) {
        if (!ids.some((x) => String(x) === String(filter.court)))
          return res.json({ total: 0, page: 1, limit: 0, list: [] });
      } else {
        filter.court = { $in: ids };
      }
    }

    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 0, 0), 1000);
    const skip = (pg - 1) * lim;

    // ---- fetch ----
    const [listRaw, total] = await Promise.all([
      Match.find(filter)
        .populate({
          path: "tournament",
          select: "name image eventType nameDisplayMode",
        })
        .populate({
          path: "bracket",
          // cần groups để map B từ pool/name/_id
          select:
            "name type stage order prefill ko meta config drawRounds groups._id groups.name",
        })
        .populate({ path: "pairA", select: "player1 player2 name teamName" })
        .populate({ path: "pairB", select: "player1 player2 name teamName" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "referee", select: "name nickname" })
        .populate({
          path: "court",
          select: "name cluster status bracket order",
        })
        .populate({
          path: "courtStation",
          select: "name code status order clusterId",
        })
        .sort(sortSpec)
        .skip(lim ? skip : 0)
        .limit(lim || 0)
        .lean(),
      Match.countDocuments(filter),
    ]);

    // ---- stage buckets: Group = V1 cho toàn giải ----
    const allBrackets = await Bracket.find({ tournament: id })
      .select("_id type stage order prefill ko meta config drawRounds")
      .lean();

    // max round theo bracket (fallback khi thiếu config)
    const roundsAgg = await Match.aggregate([
      { $match: { tournament: toObjectId(id) } }, // dùng helper toObjectId của bạn
      { $group: { _id: "$bracket", maxRound: { $max: "$round" } } },
    ]);
    const maxRoundByBracket = new Map(
      roundsAgg.map((r) => [String(r._id), Number(r.maxRound) || 0])
    );

    const tkey = (t) => String(t || "").toLowerCase();
    const isGroupish = (t) => {
      const k = tkey(t);
      return k === "group" || k === "round_robin" || k === "gsl";
    };

    const teamsFromRoundKey = (k) => {
      if (!k) return 0;
      const up = String(k).toUpperCase();
      if (up === "F") return 2;
      if (up === "SF") return 4;
      if (up === "QF") return 8;
      const m = /^R(\d+)$/i.exec(up);
      return m ? parseInt(m[1], 10) : 0;
    };
    const ceilPow2 = (n) =>
      Math.pow(2, Math.ceil(Math.log2(Math.max(1, n || 1))));
    const readBracketScale = (br) => {
      const fromKey =
        teamsFromRoundKey(br?.ko?.startKey) ||
        teamsFromRoundKey(br?.prefill?.roundKey);
      const fromPrefillPairs = Array.isArray(br?.prefill?.pairs)
        ? br.prefill.pairs.length * 2
        : 0;
      const fromPrefillSeeds = Array.isArray(br?.prefill?.seeds)
        ? br.prefill.seeds.length * 2
        : 0;
      const cands = [
        br?.drawScale,
        br?.targetScale,
        br?.maxSlots,
        br?.capacity,
        br?.size,
        br?.scale,
        br?.meta?.drawSize,
        br?.meta?.scale,
        fromKey,
        fromPrefillPairs,
        fromPrefillSeeds,
      ]
        .map(Number)
        .filter((x) => Number.isFinite(x) && x >= 2);
      return cands.length ? ceilPow2(Math.max(...cands)) : 0;
    };
    const roundsCountForBracket = (br) => {
      const type = tkey(br?.type);
      const bid = String(br?._id || "");
      if (isGroupish(type)) return 1;

      // roundElim / playoff
      if (["roundelim", "po", "playoff"].includes(type)) {
        let k =
          Number(br?.meta?.maxRounds) ||
          Number(br?.config?.roundElim?.maxRounds) ||
          0;
        if (!k) k = maxRoundByBracket.get(bid) || 1;
        return Math.max(1, k);
      }

      // knockout / double_elim...
      const rFromMatches = maxRoundByBracket.get(bid) || 0;
      if (rFromMatches) return Math.max(1, rFromMatches);

      const firstPairs =
        (Array.isArray(br?.prefill?.seeds) && br.prefill.seeds.length) ||
        (Array.isArray(br?.prefill?.pairs) && br.prefill.pairs.length) ||
        0;
      if (firstPairs > 0) return Math.ceil(Math.log2(firstPairs * 2));

      const scale = readBracketScale(br);
      if (scale) return Math.ceil(Math.log2(scale));

      const drawRounds = Number(br?.drawRounds || 0);
      return drawRounds ? Math.max(1, drawRounds) : 1;
    };

    const groupBrs = allBrackets.filter((b) => isGroupish(b.type));
    const nonGroupBrs = allBrackets.filter((b) => !isGroupish(b.type));
    const stageVal = (b) =>
      Number.isFinite(b?.stage) ? Number(b.stage) : 9999;

    const buckets = [];
    if (groupBrs.length) {
      buckets.push({
        key: "group",
        isGroup: true,
        brs: groupBrs,
        spanRounds: 1, // cả vòng bảng = V1
        stageHint: 1,
        orderHint: Math.min(...groupBrs.map((b) => Number(b?.order ?? 0))),
      });
    }
    const byStage = new Map();
    for (const b of nonGroupBrs) {
      const s = stageVal(b);
      if (!byStage.has(s)) byStage.set(s, []);
      byStage.get(s).push(b);
    }
    const stageKeys = Array.from(byStage.keys()).sort((a, b) => a - b);
    for (const s of stageKeys) {
      const brs = byStage.get(s);
      const span = Math.max(...brs.map((b) => roundsCountForBracket(b))) || 1;
      buckets.push({
        key: `stage-${s}`,
        isGroup: false,
        brs,
        spanRounds: span,
        stageHint: s,
        orderHint: Math.min(...brs.map((b) => Number(b?.order ?? 0))),
      });
    }
    buckets.sort((a, b) => {
      if (a.isGroup && !b.isGroup) return -1;
      if (!a.isGroup && b.isGroup) return 1;
      if (a.stageHint !== b.stageHint) return a.stageHint - b.stageHint;
      return a.orderHint - b.orderHint;
    });

    const baseByBracketId = new Map();
    let acc = 0;
    for (const bucket of buckets) {
      for (const br of bucket.brs) baseByBracketId.set(String(br._id), acc);
      acc += bucket.spanRounds;
    }

    // ---- helpers build code ----
    const safeInt = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const alphaToNum = (s) => {
      const m = String(s || "")
        .trim()
        .match(/^[A-Za-z]/);
      if (!m) return undefined;
      return m[0].toUpperCase().charCodeAt(0) - 64; // A=1, B=2, ...
    };
    const getGroupNo = (m, br) => {
      // 1) từ pool.name hoặc pool.key
      const poolName = m?.pool?.name || m?.pool?.key || m?.groupCode || "";
      if (poolName) {
        const num = String(poolName).match(/\d+/);
        if (num) return parseInt(num[0], 10);
        const a = alphaToNum(poolName);
        if (a) return a;
      }
      // 2) map theo _id / name trong bracket.groups
      const groups = Array.isArray(br?.groups) ? br.groups : [];
      if (groups.length) {
        if (m?.pool?.id) {
          const i = groups.findIndex(
            (g) => String(g?._id) === String(m.pool.id)
          );
          if (i >= 0) return i + 1;
        }
        if (poolName) {
          const i = groups.findIndex(
            (g) =>
              String(g?.name || "")
                .trim()
                .toUpperCase() === String(poolName).trim().toUpperCase()
          );
          if (i >= 0) return i + 1;
        }
      }
      // 3) các field số trực tiếp
      const direct = [
        m?.groupNo,
        m?.groupIndex,
        m?.groupIdx,
        m?.group,
        m?.meta?.groupNo,
        m?.meta?.groupIndex,
        m?.meta?.pool,
        m?.group?.no,
        m?.group?.index,
        m?.group?.order,
        m?.pool?.index,
        m?.pool?.no,
        m?.pool?.order,
      ];
      for (const c of direct) {
        const n = safeInt(c);
        if (typeof n === "number") return n <= 0 ? 1 : n;
      }
      return undefined;
    };
    const getGroupT = (m) => {
      // ưu tiên labelKey: "...#N" (N 1-based)
      const lk = String(m?.labelKey || "");
      const mk = lk.match(/#(\d+)\s*$/);
      if (mk) return parseInt(mk[1], 10);

      const oig = safeInt(m?.orderInGroup) ?? safeInt(m?.meta?.orderInGroup);
      if (typeof oig === "number") return oig + 1;

      const ord = safeInt(m?.order);
      if (typeof ord === "number") return ord + 1;

      return 1;
    };
    const getNonGroupT = (m) => {
      const lk = String(m?.labelKey || "");
      const mk = lk.match(/#(\d+)\s*$/);
      if (mk) return parseInt(mk[1], 10);

      const ord =
        safeInt(m?.order) ??
        safeInt(m?.meta?.order) ??
        safeInt(m?.matchNo) ??
        safeInt(m?.index) ??
        0;
      return ord + 1;
    };

    const normalizedList = listRaw.map((rawMatch) =>
      normalizeMatchDisplayShape(rawMatch),
    );
    const matchesByBracketId = new Map();
    for (const match of normalizedList) {
      const bracketId = String(match?.bracket?._id || match?.bracket || "");
      if (!bracketId) continue;
      if (!matchesByBracketId.has(bracketId)) matchesByBracketId.set(bracketId, []);
      matchesByBracketId.get(bracketId).push(match);
    }

    // ---- flatten + FINAL CODE ----
    const list = normalizedList.map((m) => {
      const br = m.bracket || {};
      const bid = String(br?._id || "");
      const groupStage = isGroupish(br?.type);

      const base = baseByBracketId.get(bid) ?? 0;
      const localRound = groupStage
        ? 1
        : Number.isFinite(m.round)
        ? m.round
        : 1;
      const globalRound = base + localRound; // KO ngay sau group => 2

      const codePayload = buildMatchCodePayload(m, {
        baseByBracketId,
        matchesByBracketId,
      });
      let displayCode = String(codePayload?.displayCode || "").trim();
      if (!displayCode) {
        if (groupStage) {
          const bNo = getGroupNo(m, br);
          const T = getGroupT(m);
          displayCode = `V1-${bNo ? `B${bNo}` : "B?"}-T${T}`;
        } else {
          const T = getNonGroupT(m);
          displayCode = `V${globalRound}-T${T}`;
        }
      }

      const globalCode = `V${globalRound}`;

      // phẳng court
      const courtId = m.courtStationId || m.courtStation?._id || m.courtStation || m.court?._id || m.court || null;
      const courtName =
        m.courtStationName || m.courtStationLabel || m.court?.name || m.courtLabel || "";
      const courtStatus = m.courtStation?.status || m.court?.status || "";
      const courtOrder = Number.isFinite(m.courtStation?.order)
        ? m.courtStation.order
        : Number.isFinite(m.court?.order)
        ? m.court.order
        : null;
      const courtBracket = m.court?.bracket || null;
      const courtCluster =
        m.courtClusterName ||
        m.courtClusterLabel ||
        m.court?.cluster ||
        m.courtCluster ||
        "";

      return {
        ...m,
        courtId,
        courtName,
        courtStatus,
        courtOrder,
        courtBracket,
        courtCluster,
        globalRound,
        globalCode, // "V1", "V2", ...
        code: displayCode,
        displayCode,
        codeResolved: displayCode,
        roundCode: displayCode,
      };
    });

    res.json({ total, page: pg, limit: lim, list });
  } catch (err) {
    next(err);
  }
});
export async function searchTournaments(req, res, next) {
  try {
    const q = (req.query.q || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase(); // optional: upcoming/ongoing/finished
    const sportType = req.query.sportType; // optional
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const escapeRegex = (value = "") =>
      String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tokens = q.split(/\s+/).filter(Boolean).map(escapeRegex);

    const mongoQuery = {};
    if (sportType !== undefined && sportType !== "") {
      const sportTypeNumber = Number(sportType);
      if (Number.isFinite(sportTypeNumber)) {
        mongoQuery.sportType = sportTypeNumber;
      }
    }
    if (status) {
      mongoQuery.status = status;
    }
    if (tokens.length) {
      mongoQuery.$and = tokens.map((token) => ({
        $or: [
          { name: { $regex: token, $options: "i" } },
          { code: { $regex: token, $options: "i" } },
          { location: { $regex: token, $options: "i" } },
        ],
      }));
    }

    const rawRows = await Tournament.find(mongoQuery)
      .select(
        [
          "name",
          "code",
          "location",
          "status",
          "sportType",
          "groupId",
          "image",
          "eventType",
          "timezone",
          "regOpenDate",
          "registrationDeadline",
          "startDate",
          "endDate",
          "startAt",
          "endAt",
          "scoringScope",
          "locationGeo",
          "createdAt",
          "updatedAt",
          "finishedAt",
        ].join(" ")
      )
      .sort({ startAt: 1, createdAt: -1 })
      .limit(tokens.length ? limit * 4 : limit)
      .lean();

    const now = new Date();
    const computeRuntimeStatus = (tournament) => {
      if (tournament?.finishedAt) return "finished";
      const startInstant = tournament?.startAt || tournament?.startDate;
      const endInstant = tournament?.endAt || tournament?.endDate;
      if (startInstant && now < new Date(startInstant)) return "upcoming";
      if (endInstant && now > new Date(endInstant)) return "finished";
      return "ongoing";
    };
    const normalizedQuery = q.toLowerCase();
    const scoreTournament = (tournament) => {
      if (!normalizedQuery) return 0;
      const code = String(tournament?.code || "").toLowerCase();
      const name = String(tournament?.name || "").toLowerCase();
      const location = String(tournament?.location || "").toLowerCase();
      let score = 0;
      if (code === normalizedQuery) score += 200;
      if (name === normalizedQuery) score += 160;
      if (code.startsWith(normalizedQuery)) score += 100;
      if (name.startsWith(normalizedQuery)) score += 80;
      if (location.startsWith(normalizedQuery)) score += 40;
      if (code.includes(normalizedQuery)) score += 25;
      if (name.includes(normalizedQuery)) score += 20;
      if (location.includes(normalizedQuery)) score += 10;
      return score;
    };

    const filteredRows = rawRows
      .map((row) => ({
        ...row,
        status: computeRuntimeStatus(row),
        _searchScore: scoreTournament(row),
      }))
      .filter((row) => !status || row.status === status)
      .sort((a, b) => {
        if (b._searchScore !== a._searchScore) {
          return b._searchScore - a._searchScore;
        }
        const aStart = a.startAt ? new Date(a.startAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bStart = b.startAt ? new Date(b.startAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (aStart !== bStart) return aStart - bStart;
        return String(a.name || "").localeCompare(String(b.name || ""));
      })
      .slice(0, limit);

    const items = await Promise.all(
      filteredRows.map(async ({ _searchScore, ...row }) =>
        normalizeTournamentPublicUrls(req, row)
      )
    );

    res.json({ items });
  } catch (err) {
    next(err);
  }
}
