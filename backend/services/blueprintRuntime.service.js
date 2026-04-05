import mongoose from "mongoose";
import DrawSession from "../models/drawSessionModel.js";
import Match from "../models/matchModel.js";

export const BLUEPRINT_STAGE_ORDER = ["groups", "po", "ko"];

const GROUP_STAGE_TYPES = new Set(["group", "round_robin", "gsl"]);

const isPlainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

const toIdString = (value) => {
  if (value === null || value === undefined) return "";
  try {
    if (typeof value === "string") return value;
    if (typeof value.toString === "function") return String(value.toString());
    return String(value);
  } catch {
    return "";
  }
};

const toObjectIdString = (value) => {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") {
    const trimmed = value.trim();
    return mongoose.isValidObjectId(trimmed) ? trimmed : "";
  }

  if (mongoose.isValidObjectId(value)) {
    return String(value);
  }

  if (isPlainObject(value)) {
    const nested =
      value._id ?? value.id ?? value.registration ?? value.reg ?? value.value ?? null;
    if (nested && nested !== value) {
      return toObjectIdString(nested);
    }
  }

  return "";
};

const ceilPow2 = (n) => {
  const value = Math.max(2, Number(n) || 2);
  return 1 << Math.ceil(Math.log2(value));
};

const KO_ROUND_KEYS = ["F", "SF", "QF", "R16", "R32", "R64", "R128", "R256", "R512", "R1024"];

const normalizeKoRoundKey = (value) => {
  if (!value) return null;
  const upper = String(value).trim().toUpperCase();
  return KO_ROUND_KEYS.includes(upper) ? upper : null;
};

const drawSizeFromKoRoundKey = (roundKey) => {
  const normalized = normalizeKoRoundKey(roundKey);
  if (!normalized) return 0;
  if (normalized === "F") return 2;
  if (normalized === "SF") return 4;
  if (normalized === "QF") return 8;
  if (normalized.startsWith("R")) return Math.max(2, ceilPow2(Number(normalized.slice(1)) || 0));
  return 0;
};

const koRoundKeyFromDrawSize = (drawSize) => {
  const size = Math.max(2, ceilPow2(drawSize || 2));
  if (size === 2) return "F";
  if (size === 4) return "SF";
  if (size === 8) return "QF";
  return `R${size}`;
};
const getKoMinDrawSize = (format) => (format === "double_elim" ? 4 : 2);
const getKoConfiguredDrawSize = (drawSize, format) =>
  Math.max(getKoMinDrawSize(format), ceilPow2(drawSize || getKoMinDrawSize(format)));
const clampDoubleElimStartRoundKey = (roundKey, configuredDrawSize) => {
  const maxSize = Math.max(4, ceilPow2(configuredDrawSize || 4));
  const normalized = normalizeKoRoundKey(roundKey);
  if (normalized) {
    const roundSize = drawSizeFromKoRoundKey(normalized);
    if (roundSize >= 4 && roundSize <= maxSize) return normalized;
  }
  return koRoundKeyFromDrawSize(maxSize);
};
const getDoubleElimStartDrawSize = ({ drawSize, format, doubleElim } = {}) => {
  const normalizedFormat = format === "double_elim" ? "double_elim" : "single_elim";
  const configuredDrawSize = getKoConfiguredDrawSize(drawSize, normalizedFormat);
  if (normalizedFormat !== "double_elim") return configuredDrawSize;
  const startRoundKey = clampDoubleElimStartRoundKey(
    doubleElim?.startRoundKey,
    configuredDrawSize
  );
  return Math.max(
    getKoMinDrawSize(normalizedFormat),
    Math.min(configuredDrawSize, drawSizeFromKoRoundKey(startRoundKey) || configuredDrawSize)
  );
};

const maxPoRoundsFor = (n) => {
  const size = Math.max(0, Number(n) || 0);
  const losers1 = Math.floor(size / 2);
  return Math.max(1, 1 + (losers1 > 0 ? Math.floor(Math.log2(losers1)) : 0));
};

const countFilledSeedSlots = (seeds = []) =>
  (Array.isArray(seeds) ? seeds : []).reduce((acc, seed) => {
    const aType = String(seed?.A?.type || "").toLowerCase();
    const bType = String(seed?.B?.type || "").toLowerCase();
    if (aType && aType !== "bye") acc += 1;
    if (bType && bType !== "bye") acc += 1;
    return acc;
  }, 0);

const toComparableObject = (value) => {
  if (Array.isArray(value)) return value.map((item) => toComparableObject(item));
  if (!isPlainObject(value)) {
    if (value instanceof Date) return value.toISOString();
    return value;
  }

  const out = {};
  Object.keys(value)
    .sort()
    .forEach((key) => {
      const nextValue = value[key];
      if (nextValue === undefined) return;
      out[key] = toComparableObject(nextValue);
    });
  return out;
};

const stableStringify = (value) => JSON.stringify(toComparableObject(value));

export function semanticStageKeyFromBracketType(type) {
  const key = String(type || "").trim().toLowerCase();
  if (!key) return null;
  if (GROUP_STAGE_TYPES.has(key)) return "groups";
  if (["roundelim", "po", "playoff", "round_elim", "round-elim"].includes(key)) {
    return "po";
  }
  if (["knockout", "ko", "double_elim", "double-elim", "doubleelim"].includes(key)) {
    return "ko";
  }
  return null;
}

export function blueprintUiTypeFromStageKey(stageKey) {
  if (stageKey === "groups") return "group";
  if (stageKey === "po") return "po";
  if (stageKey === "ko") return "ko";
  return "";
}

export function normalizePlanRule(rules) {
  if (!rules) return undefined;

  const bestOf = Number(rules.bestOf ?? 1);
  const pointsToWin = Number(rules.pointsToWin ?? 11);
  const winByTwo = rules.winByTwo !== false;
  const rawMode = String(rules?.cap?.mode ?? "none").toLowerCase();
  const mode = ["none", "soft", "hard"].includes(rawMode) ? rawMode : "none";

  let points = rules?.cap?.points;
  if (mode === "none") {
    points = null;
  } else {
    const n = Number(points);
    points = Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }

  return {
    bestOf,
    pointsToWin,
    winByTwo,
    cap: { mode, points },
  };
}

export function normalizePlanRoundRules(arr, fallback, maxRounds) {
  const fb = normalizePlanRule(fallback);
  const rounds = Math.max(1, Number(maxRounds) || 1);

  if (!Array.isArray(arr) || !arr.length) {
    return Array.from({ length: rounds }, () => fb);
  }

  const out = arr.map((rule) => normalizePlanRule(rule || fallback) || fb);
  while (out.length < rounds) out.push(fb);
  return out.slice(0, rounds);
}

function normalizeGroupCode(value) {
  if (!value) return "";
  return String(value).trim().toUpperCase();
}

function normalizeSeedSource(seed) {
  if (!seed?.type) return null;

  const type = String(seed.type);
  const label = String(seed.label || "");
  const ref = isPlainObject(seed.ref) ? seed.ref : {};

  if (type === "bye") {
    return { type, label, ref: null };
  }

  if (type === "registration") {
    const registrationId = toObjectIdString(
      isPlainObject(seed.ref)
        ? ref.registration ?? ref.reg ?? seed.registration ?? seed.reg
        : seed.ref ?? seed.registration ?? seed.reg
    );
    return {
      type,
      label,
      ref: registrationId ? { registration: registrationId } : {},
    };
  }

  if (type === "groupRank") {
    return {
      type,
      label,
      ref: {
        stage: Number(ref.stage ?? ref.stageIndex ?? 1) || 1,
        groupCode: normalizeGroupCode(
          ref.groupCode || ref.group?.name || ref.group || ref.pool || ""
        ),
        rank: Number(ref.rank || ref.place || 0) || 0,
        wildcardOrder: Number(ref.wildcardOrder || ref.pick || ref.index || 0) || 0,
      },
    };
  }

  if (type === "stageMatchWinner" || type === "stageMatchLoser") {
    return {
      type,
      label,
      ref: {
        stageIndex: Number(ref.stageIndex ?? ref.stage ?? 0) || 0,
        round: Number(ref.round || 0) || 0,
        order: Number(ref.order || 0) || 0,
      },
    };
  }

  return {
    type,
    label,
    ref: toComparableObject(ref),
  };
}

function sanitizeSeeds(seeds = [], { firstPairs = null } = {}) {
  const list = Array.isArray(seeds) ? seeds : [];
  return list
    .map((seed) => ({
      pair: Number(seed?.pair) || 0,
      A: normalizeSeedSource(seed?.A),
      B: normalizeSeedSource(seed?.B),
    }))
    .filter((seed) => {
      if (seed.pair < 1) return false;
      if (firstPairs && seed.pair > firstPairs) return false;
      return true;
    })
    .sort((a, b) => a.pair - b.pair);
}

function normalizeGroupsPlan(groups) {
  if (!groups || Number(groups.count) <= 0) return null;

  const count = Math.max(1, Number(groups.count) || 0);
  const totalTeams = Math.max(0, Number(groups.totalTeams) || 0);
  const groupSizes = Array.isArray(groups.groupSizes)
    ? groups.groupSizes.map((size) => Math.max(0, Number(size) || 0)).slice(0, count)
    : undefined;

  return {
    count,
    ...(totalTeams > 0
      ? { totalTeams, ...(groupSizes?.length ? { groupSizes } : {}) }
      : { size: Math.max(0, Number(groups.size) || 0) }),
    qualifiersPerGroup: Math.max(1, Number(groups.qualifiersPerGroup) || 1),
    rules: normalizePlanRule(groups.rules),
  };
}

function normalizePoPlan(po) {
  if (!po || Number(po.drawSize) <= 0) return null;

  const drawSize = Math.max(0, Number(po.drawSize) || 0);
  const maxRounds = Math.max(
    1,
    Math.min(
      Number(po.maxRounds || (Array.isArray(po.roundRules) ? po.roundRules.length : 1)) || 1,
      maxPoRoundsFor(drawSize)
    )
  );

  return {
    drawSize,
    maxRounds,
    seeds: sanitizeSeeds(po.seeds),
    rules: normalizePlanRule(po.rules),
    roundRules: normalizePlanRoundRules(po.roundRules, po.rules, maxRounds),
  };
}

function normalizeKoPlan(ko) {
  if (!ko || Number(ko.drawSize) <= 0) return null;

  const rawFormat = String(
    ko.format ?? ko.mode ?? ko.variant ?? ko.structure ?? "single_elim"
  )
    .trim()
    .toLowerCase();
  const format =
    rawFormat === "double_elim" || rawFormat === "double-elim" || rawFormat === "doubleelim"
      ? "double_elim"
      : "single_elim";
  const requestedStartRoundKey =
    format === "double_elim"
      ? normalizeKoRoundKey(ko?.doubleElim?.startRoundKey ?? ko?.startRoundKey)
      : null;
  const drawSize = getKoConfiguredDrawSize(ko.drawSize, format);
  const startRoundKey =
    format === "double_elim"
      ? clampDoubleElimStartRoundKey(requestedStartRoundKey, drawSize)
      : null;
  const firstPairs = drawSize / 2;
  const hasGrandFinalReset =
    ko?.doubleElim?.hasGrandFinalReset !== undefined
      ? !!ko.doubleElim.hasGrandFinalReset
      : ko?.hasGrandFinalReset !== undefined
      ? !!ko.hasGrandFinalReset
      : false;

  return {
    drawSize,
    seeds: sanitizeSeeds(ko.seeds, { firstPairs }),
    format,
    doubleElim:
      format === "double_elim"
        ? {
            hasGrandFinalReset,
            startRoundKey,
          }
        : undefined,
    rules: normalizePlanRule(ko.rules),
    semiRules: normalizePlanRule(ko.semiRules),
    finalRules: normalizePlanRule(ko.finalRules),
    thirdPlaceEnabled:
      format === "double_elim"
        ? false
        : ko.thirdPlaceEnabled !== undefined
        ? !!ko.thirdPlaceEnabled
        : !!ko.thirdPlace,
    thirdPlaceRules:
      format === "double_elim" ? undefined : normalizePlanRule(ko.thirdPlaceRules),
  };
}

export function normalizeBlueprintPlan(plan = {}) {
  return {
    groups: normalizeGroupsPlan(plan?.groups),
    po: normalizePoPlan(plan?.po),
    ko: normalizeKoPlan(plan?.ko),
  };
}

function deriveGroupPlanFromBracket(bracket) {
  const blueprint = bracket?.config?.blueprint || {};
  const groups = Array.isArray(bracket?.groups) ? bracket.groups : [];
  const sizes = groups.map((group) => {
    const expectedSize = Number(group?.expectedSize || 0);
    if (expectedSize > 0) return expectedSize;
    return Array.isArray(group?.regIds) ? group.regIds.length : 0;
  });
  const totalTeams = sizes.reduce((sum, size) => sum + size, 0);
  const rules =
    normalizePlanRule(blueprint?.rules) || normalizePlanRule(bracket?.config?.rules);

  return normalizeGroupsPlan({
    count: Number(blueprint?.groupCount || groups.length || 0),
    totalTeams: Number(blueprint?.totalTeams || totalTeams || 0),
    groupSizes: Array.isArray(blueprint?.groupSizes) && blueprint.groupSizes.length
      ? blueprint.groupSizes
      : sizes,
    size: Number(blueprint?.groupSize || 0),
    qualifiersPerGroup: Number(blueprint?.qualifiersPerGroup || 1),
    rules,
  });
}

function derivePoPlanFromBracket(bracket) {
  const blueprint = bracket?.config?.blueprint || {};
  const seeds = Array.isArray(blueprint?.seeds)
    ? blueprint.seeds
    : Array.isArray(bracket?.prefill?.seeds)
    ? bracket.prefill.seeds
    : [];
  const entrants =
    Number(blueprint?.drawSize || 0) ||
    countFilledSeedSlots(seeds) ||
    Math.max(0, (Array.isArray(seeds) ? seeds.length : 0) * 2);
  const maxRounds =
    Number(blueprint?.maxRounds || 0) ||
    Number(bracket?.meta?.maxRounds || 0) ||
    1;

  return normalizePoPlan({
    drawSize: entrants,
    maxRounds,
    seeds,
    rules:
      normalizePlanRule(blueprint?.rules) || normalizePlanRule(bracket?.config?.rules),
    roundRules:
      Array.isArray(blueprint?.roundRules) && blueprint.roundRules.length
        ? blueprint.roundRules
        : undefined,
  });
}

function deriveKoPlanFromBracket(bracket) {
  const blueprint = bracket?.config?.blueprint || {};
  const seeds = Array.isArray(blueprint?.seeds)
    ? blueprint.seeds
    : Array.isArray(bracket?.prefill?.seeds)
    ? bracket.prefill.seeds
    : [];
  const drawSize =
    Number(blueprint?.drawSize || 0) ||
    Number(bracket?.meta?.drawSize || 0) ||
    Math.max(2, (Array.isArray(seeds) ? seeds.length : 1) * 2);
  const bracketType = String(bracket?.type || "").trim().toLowerCase();
  const format =
    bracketType === "double_elim" ? "double_elim" : blueprint?.format || "single_elim";
  const doubleElim =
    format === "double_elim"
      ? {
          hasGrandFinalReset:
            blueprint?.doubleElim?.hasGrandFinalReset ??
            bracket?.config?.doubleElim?.hasGrandFinalReset ??
            false,
          startRoundKey:
            blueprint?.doubleElim?.startRoundKey ??
            bracket?.config?.doubleElim?.startRoundKey ??
            bracket?.prefill?.roundKey ??
            koRoundKeyFromDrawSize(drawSize),
        }
      : undefined;

  return normalizeKoPlan({
    drawSize,
    seeds,
    format,
    doubleElim,
    rules:
      normalizePlanRule(blueprint?.rules) || normalizePlanRule(bracket?.config?.rules),
    semiRules: normalizePlanRule(blueprint?.semiRules),
    finalRules: normalizePlanRule(blueprint?.finalRules),
    thirdPlaceEnabled:
      blueprint?.thirdPlaceEnabled !== undefined
        ? blueprint.thirdPlaceEnabled
        : blueprint?.thirdPlace,
    thirdPlaceRules: normalizePlanRule(blueprint?.thirdPlaceRules),
  });
}

export function deriveBlueprintPlanFromBrackets(brackets = []) {
  const out = { groups: null, po: null, ko: null };
  const ordered = Array.isArray(brackets) ? brackets : [];

  for (const bracket of ordered) {
    const stageKey = semanticStageKeyFromBracketType(bracket?.type);
    if (!stageKey || out[stageKey]) continue;

    if (stageKey === "groups") out.groups = deriveGroupPlanFromBracket(bracket);
    if (stageKey === "po") out.po = derivePoPlanFromBracket(bracket);
    if (stageKey === "ko") out.ko = deriveKoPlanFromBracket(bracket);
  }

  return out;
}

export function buildPublishedBlueprintPlan({ tournamentPlan, brackets = [] }) {
  const savedPlan = normalizeBlueprintPlan(tournamentPlan || {});
  const derivedPlan = deriveBlueprintPlanFromBrackets(brackets);
  const stageBuckets = groupBracketsBySemanticStage(brackets);

  const out = { groups: null, po: null, ko: null };
  for (const stageKey of BLUEPRINT_STAGE_ORDER) {
    const publishedBucket = stageBuckets[stageKey] || [];
    if (!publishedBucket.length) continue;
    out[stageKey] = savedPlan[stageKey] || derivedPlan[stageKey] || null;
  }
  return out;
}

export function groupBracketsBySemanticStage(brackets = []) {
  const buckets = {
    groups: [],
    po: [],
    ko: [],
  };

  for (const bracket of Array.isArray(brackets) ? brackets : []) {
    const stageKey = semanticStageKeyFromBracketType(bracket?.type);
    if (!stageKey) continue;
    buckets[stageKey].push(bracket);
  }

  return buckets;
}

function summarizeDrawSessions(drawSessions = []) {
  const committed = drawSessions.filter((session) => session.status === "committed");
  const active = drawSessions.filter((session) => session.status === "active");
  return {
    total: drawSessions.length,
    committed: committed.length,
    active: active.length,
    latestCommittedAt: committed[0]?.committedAt || null,
    latestActiveAt: active[0]?.updatedAt || active[0]?.createdAt || null,
  };
}

function buildMatchSummary(matches = []) {
  const byStatus = {};
  let operational = 0;
  let scheduledSignals = 0;
  let assignedSignals = 0;
  let startedSignals = 0;
  let finishedSignals = 0;
  let courtSignals = 0;
  let queueSignals = 0;

  for (const match of matches) {
    const status = String(match?.status || "scheduled");
    byStatus[status] = (byStatus[status] || 0) + 1;

    const hasOperationalSignal =
      status !== "scheduled" ||
      !!match?.assignedAt ||
      !!match?.startedAt ||
      !!match?.finishedAt ||
      !!match?.court ||
      (match?.queueOrder !== null && match?.queueOrder !== undefined);

    if (hasOperationalSignal) operational += 1;
    if (match?.scheduledAt) scheduledSignals += 1;
    if (match?.assignedAt) assignedSignals += 1;
    if (match?.startedAt) startedSignals += 1;
    if (match?.finishedAt) finishedSignals += 1;
    if (match?.court) courtSignals += 1;
    if (match?.queueOrder !== null && match?.queueOrder !== undefined) queueSignals += 1;
  }

  return {
    total: matches.length,
    byStatus,
    operational,
    scheduledSignals,
    assignedSignals,
    startedSignals,
    finishedSignals,
    courtSignals,
    queueSignals,
  };
}

export async function analyzeBlueprintRuntime({ tournamentId, brackets = [] }) {
  const buckets = groupBracketsBySemanticStage(brackets);
  const bracketIds = (Array.isArray(brackets) ? brackets : [])
    .map((bracket) => bracket?._id)
    .filter(Boolean);

  const [drawSessions, matches] = await Promise.all([
    bracketIds.length
      ? DrawSession.find({
          tournament: tournamentId,
          bracket: { $in: bracketIds },
        })
          .sort({ committedAt: -1, updatedAt: -1, createdAt: -1 })
          .select("_id bracket status committedAt createdAt updatedAt")
          .lean()
      : [],
    bracketIds.length
      ? Match.find({
          tournament: tournamentId,
          bracket: { $in: bracketIds },
        })
          .select(
            "_id bracket status scheduledAt assignedAt startedAt finishedAt court queueOrder"
          )
          .lean()
      : [],
  ]);

  const drawByBracketId = new Map();
  for (const session of drawSessions) {
    const key = toIdString(session?.bracket);
    if (!key) continue;
    if (!drawByBracketId.has(key)) drawByBracketId.set(key, []);
    drawByBracketId.get(key).push(session);
  }

  const matchesByBracketId = new Map();
  for (const match of matches) {
    const key = toIdString(match?.bracket);
    if (!key) continue;
    if (!matchesByBracketId.has(key)) matchesByBracketId.set(key, []);
    matchesByBracketId.get(key).push(match);
  }

  const runtimeByKey = {};

  for (const stageKey of BLUEPRINT_STAGE_ORDER) {
    const bucket = buckets[stageKey] || [];
    const primaryBracket = bucket[0] || null;
    const bucketIds = bucket.map((bracket) => toIdString(bracket?._id)).filter(Boolean);

    const bucketDrawSessions = bucketIds.flatMap((id) => drawByBracketId.get(id) || []);
    const bucketMatches = bucketIds.flatMap((id) => matchesByBracketId.get(id) || []);

    const drawSummary = summarizeDrawSessions(bucketDrawSessions);
    const matchSummary = buildMatchSummary(bucketMatches);
    const groupAssignments = bucket.reduce((sum, bracket) => {
      if (stageKey !== "groups") return sum;
      const groups = Array.isArray(bracket?.groups) ? bracket.groups : [];
      return (
        sum +
        groups.reduce(
          (groupSum, group) => groupSum + (Array.isArray(group?.regIds) ? group.regIds.length : 0),
          0
        )
      );
    }, 0);

    const lockReasons = [];
    if (stageKey === "groups") {
      if (drawSummary.committed > 0) {
        lockReasons.push(`Đã commit bốc thăm vòng bảng (${drawSummary.committed} phiên).`);
      }
      if (groupAssignments > 0) {
        lockReasons.push(`Đã có ${groupAssignments} đội gắn vào bảng.`);
      }
      if (matchSummary.total > 0) {
        lockReasons.push(`Đã phát sinh ${matchSummary.total} trận vòng bảng.`);
      }
    } else {
      if (drawSummary.committed > 0) {
        lockReasons.push(`Đã commit bốc thăm ${stageKey === "po" ? "PO" : "KO"} (${drawSummary.committed} phiên).`);
      }
      if (matchSummary.operational > 0) {
        lockReasons.push(
          `Đã có ${matchSummary.operational}/${matchSummary.total} trận mang dấu hiệu vận hành thật.`
        );
      }
    }

    const locked = lockReasons.length > 0;
    runtimeByKey[stageKey] = {
      key: stageKey,
      status: locked ? "locked" : "draftable",
      locked,
      lockReasons,
      publishedBracketId: primaryBracket ? toIdString(primaryBracket._id) : null,
      publishedBracketIds: bucketIds,
      matchSummary,
      drawSummary,
      groupAssignments,
    };
  }

  return runtimeByKey;
}

function splitStagePlanForImpact(stageKey, stagePlan) {
  if (!stagePlan) {
    return { structure: null, rules: null };
  }

  if (stageKey === "groups") {
    return {
      structure: {
        count: Number(stagePlan.count || 0),
        size: Number(stagePlan.size || 0),
        totalTeams: Number(stagePlan.totalTeams || 0),
        groupSizes: Array.isArray(stagePlan.groupSizes) ? stagePlan.groupSizes : [],
        qualifiersPerGroup: Number(stagePlan.qualifiersPerGroup || 1),
      },
      rules: stagePlan.rules || null,
    };
  }

  if (stageKey === "po") {
    return {
      structure: {
        drawSize: Number(stagePlan.drawSize || 0),
        maxRounds: Number(stagePlan.maxRounds || 1),
        seeds: Array.isArray(stagePlan.seeds) ? stagePlan.seeds : [],
      },
      rules: {
        rules: stagePlan.rules || null,
        roundRules: Array.isArray(stagePlan.roundRules) ? stagePlan.roundRules : [],
      },
    };
  }

  if (stageKey === "ko") {
    return {
      structure: {
        drawSize: Number(stagePlan.drawSize || 0),
        seeds: Array.isArray(stagePlan.seeds) ? stagePlan.seeds : [],
        thirdPlaceEnabled: !!stagePlan.thirdPlaceEnabled,
      },
      rules: {
        rules: stagePlan.rules || null,
        semiRules: stagePlan.semiRules || null,
        finalRules: stagePlan.finalRules || null,
        thirdPlaceRules: stagePlan.thirdPlaceRules || null,
      },
    };
  }

  return {
    structure: stagePlan,
    rules: null,
  };
}

function baseImpactType({ stageKey, draftStage, publishedStage }) {
  if (!draftStage && !publishedStage) return "unchanged";
  if (draftStage && !publishedStage) return "create";
  if (!draftStage && publishedStage) return "delete";

  const draftParts = splitStagePlanForImpact(stageKey, draftStage);
  const publishedParts = splitStagePlanForImpact(stageKey, publishedStage);
  const structureChanged =
    stableStringify(draftParts.structure) !== stableStringify(publishedParts.structure);
  const rulesChanged =
    stableStringify(draftParts.rules) !== stableStringify(publishedParts.rules);

  if (!structureChanged && !rulesChanged) return "unchanged";
  if (!structureChanged && rulesChanged) return "update_rules";
  return "rebuild";
}

function isStructuralImpactType(type) {
  return ["create", "rebuild", "delete"].includes(type);
}

export function buildBlueprintImpact({
  draftPlan,
  publishedPlan,
  runtimeByKey = {},
}) {
  const normalizedDraft = normalizeBlueprintPlan(draftPlan || {});
  const normalizedPublished = normalizeBlueprintPlan(publishedPlan || {});

  const stages = BLUEPRINT_STAGE_ORDER.map((stageKey) => {
    const draftStage = normalizedDraft[stageKey];
    const publishedStage = normalizedPublished[stageKey];
    const runtime = runtimeByKey[stageKey] || {
      key: stageKey,
      status: "draftable",
      locked: false,
      lockReasons: [],
      publishedBracketId: null,
      matchSummary: { total: 0, operational: 0, byStatus: {} },
      drawSummary: { total: 0, committed: 0, active: 0 },
    };

    return {
      key: stageKey,
      label: blueprintUiTypeFromStageKey(stageKey),
      type: baseImpactType({ stageKey, draftStage, publishedStage }),
      draftExists: !!draftStage,
      publishedExists: !!publishedStage,
      draft: draftStage || null,
      published: publishedStage || null,
      runtime,
      locked: !!runtime.locked,
    };
  });

  let firstStructuralChangeIndex = -1;
  stages.forEach((stage, index) => {
    if (isStructuralImpactType(stage.type) && firstStructuralChangeIndex === -1) {
      firstStructuralChangeIndex = index;
    }
  });

  if (firstStructuralChangeIndex >= 0) {
    for (let index = firstStructuralChangeIndex + 1; index < stages.length; index += 1) {
      const stage = stages[index];
      if (stage.type === "unchanged" && (stage.draftExists || stage.publishedExists)) {
        stage.type = "rebuild";
        stage.reason = `Phụ thuộc stage ${stages[firstStructuralChangeIndex].key}`;
      }
    }
  }

  const conflictStages = [];
  const impactedStages = [];
  for (const stage of stages) {
    if (stage.type !== "unchanged") impactedStages.push(stage.key);
    if (["rebuild", "delete"].includes(stage.type) && stage.locked) {
      stage.type = "locked_conflict";
      conflictStages.push(stage.key);
    }
  }

  const canReplaceAll = BLUEPRINT_STAGE_ORDER.every(
    (stageKey) => !(runtimeByKey[stageKey]?.locked)
  );

  return {
    stages,
    impactedStages,
    conflictStages,
    changed: impactedStages.length > 0,
    hasConflicts: conflictStages.length > 0,
    canReplaceAll,
    runtimeByKey,
    draftPlan: normalizedDraft,
    publishedPlan: normalizedPublished,
  };
}
