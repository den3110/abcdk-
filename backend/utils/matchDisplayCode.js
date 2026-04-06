const NORMALIZED_MATCH_CODE_RE = /^V\d+(?:-B\d+)?-T\d+$/i;
const GROUPISH_TYPES = new Set(["group", "round_robin", "gsl"]);
const DOUBLE_ELIM_TYPES = new Set([
  "double_elim",
  "double-elim",
  "doubleelim",
  "double_elimination",
]);

function toPositiveInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.trunc(number);
}

function normalizeCode(value) {
  const text = String(value || "").trim().toUpperCase();
  return NORMALIZED_MATCH_CODE_RE.test(text) ? text : "";
}

function typeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function isGroupishBracketType(value) {
  return GROUPISH_TYPES.has(typeKey(value));
}

function isDoubleElimBracketType(value) {
  return DOUBLE_ELIM_TYPES.has(typeKey(value));
}

function letterToIndex(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]$/.test(text)) return null;
  return text.charCodeAt(0) - 64;
}

function extractBracketId(match) {
  return String(match?.bracket?._id || match?.bracket || "").trim();
}

function extractRegistrationId(value) {
  return String(value?._id || value || "").trim();
}

function resolvePoolIndex(match) {
  const directCandidates = [
    match?.pool?.index,
    match?.pool?.idx,
    match?.pool?.no,
    match?.pool?.order,
    match?.pool?.code,
    match?.pool?.name,
    match?.poolName,
    match?.poolKey,
    match?.group,
    match?.groupCode,
    match?.groupNo,
  ];

  for (const candidate of directCandidates) {
    const positive = toPositiveInt(candidate);
    if (positive) return positive;

    const text = String(candidate || "").trim();
    if (!text) continue;

    const byBCode = /^B(\d+)$/i.exec(text);
    if (byBCode) return Number(byBCode[1]);

    const byLetter = letterToIndex(text);
    if (byLetter) return byLetter;
  }

  const groupIndex = toPositiveInt(Number(match?.groupIndex) + 1);
  if (groupIndex) return groupIndex;

  const pairAId = extractRegistrationId(match?.pairA);
  const pairBId = extractRegistrationId(match?.pairB);
  const bracketGroups = Array.isArray(match?.bracket?.groups)
    ? match.bracket.groups
    : [];
  if (pairAId && pairBId && bracketGroups.length) {
    const matchedIndex = bracketGroups.findIndex((group) => {
      const regIds = Array.isArray(group?.regIds) ? group.regIds : [];
      const normalized = regIds.map((regId) => String(regId || "").trim());
      return normalized.includes(pairAId) && normalized.includes(pairBId);
    });
    if (matchedIndex >= 0) return matchedIndex + 1;
  }

  return null;
}

function resolvePoolName(match) {
  return String(
    match?.pool?.name ||
      match?.pool?.key ||
      match?.groupCode ||
      match?.poolName ||
      ""
  ).trim();
}

function resolveGroupOrder(match) {
  const labelKey = String(match?.labelKey || "").trim();
  const tailMatch = labelKey.match(/#(\d+)\s*$/);
  if (tailMatch) {
    const tailNumber = Number(tailMatch[1]);
    if (Number.isFinite(tailNumber)) {
      return tailNumber <= 0 ? 1 : tailNumber;
    }
  }

  const orderInGroup = toPositiveInt(Number(match?.orderInGroup) + 1);
  if (orderInGroup) return orderInGroup;

  const order = Number(match?.order);
  if (Number.isFinite(order) && order >= 0) return Math.trunc(order) + 1;

  const matchNo = toPositiveInt(match?.matchNo);
  if (matchNo) return matchNo;

  const index = toPositiveInt(match?.index);
  if (index) return index;

  return 1;
}

function resolveKnockoutOrder(match) {
  const labelKey = String(match?.labelKey || "").trim();
  const tailMatch = labelKey.match(/#(\d+)\s*$/);
  if (tailMatch) {
    const tailNumber = Number(tailMatch[1]);
    if (Number.isFinite(tailNumber)) {
      return tailNumber <= 0 ? 1 : tailNumber;
    }
  }

  const order = Number(match?.order);
  if (Number.isFinite(order) && order >= 0) return Math.trunc(order) + 1;

  const matchNo = toPositiveInt(match?.matchNo);
  if (matchNo) return matchNo;

  const index = toPositiveInt(match?.index);
  if (index) return index;

  return 1;
}

function isGroupLike(match) {
  const kind = typeKey(match?.bracket?.type || match?.format || match?.phase);
  return Boolean(
    match?.pool?.id ||
      match?.pool?.name ||
      match?.poolName ||
      match?.poolKey ||
      match?.group ||
      match?.groupCode ||
      match?.groupNo ||
      Number.isFinite(Number(match?.groupIndex)) ||
      isGroupishBracketType(kind) ||
      kind.includes("group") ||
      kind.includes("roundrobin") ||
      kind.includes("round-robin") ||
      kind.includes("rr")
  );
}

function normalizeDoubleElimBranch(match) {
  const branch = String(match?.branch || "").trim().toLowerCase();
  const phase = String(match?.phase || "").trim().toLowerCase();
  if (branch === "gf" || phase === "grand_final") return "gf";
  if (branch === "lb" || phase === "losers") return "lb";
  return "wb";
}

function readDoubleElimConfiguredScale(bracket) {
  const directCandidates = [
    bracket?.meta?.drawSize,
    bracket?.config?.blueprint?.drawSize,
    bracket?.config?.doubleElim?.drawSize,
    bracket?.config?.roundElim?.drawSize,
    bracket?.drawSize,
  ];

  for (const candidate of directCandidates) {
    const positive = toPositiveInt(candidate);
    if (positive) return positive;
  }

  const prefillSeeds = Array.isArray(bracket?.prefill?.seeds)
    ? bracket.prefill.seeds.length * 2
    : 0;
  if (prefillSeeds > 0) return prefillSeeds;

  const expectedFirstRoundMatches = toPositiveInt(
    bracket?.meta?.expectedFirstRoundMatches,
  );
  if (expectedFirstRoundMatches) return expectedFirstRoundMatches * 2;

  return 0;
}

function resolveDoubleElimDisplayCode(match, options = {}) {
  const bracketId = extractBracketId(match);
  if (!bracketId) return "";

  const matchesByBracketId =
    options?.matchesByBracketId instanceof Map ? options.matchesByBracketId : null;
  const matchesOfBracket = Array.isArray(options?.matchesOfBracket)
    ? options.matchesOfBracket
    : matchesByBracketId?.get(bracketId) || [];
  if (!matchesOfBracket.length) return "";

  const activeMatches = matchesOfBracket
    .slice()
    .sort(
      (a, b) =>
        Number(a?.round || 1) - Number(b?.round || 1) ||
        Number(a?.order || 0) - Number(b?.order || 0),
    );

  const winnersMatches = activeMatches.filter(
    (item) => normalizeDoubleElimBranch(item) === "wb",
  );
  const losersMatches = activeMatches.filter(
    (item) => normalizeDoubleElimBranch(item) === "lb",
  );
  const grandFinalMatches = activeMatches.filter(
    (item) => normalizeDoubleElimBranch(item) === "gf",
  );

  const uniqueWinnerRounds = Array.from(
    new Set(
      winnersMatches
        .map((item) => Number(item?.round || 1))
        .filter(Number.isFinite),
    ),
  ).sort((a, b) => a - b);
  const uniqueLoserRounds = Array.from(
    new Set(
      losersMatches
        .map((item) => Number(item?.round || 1))
        .filter(Number.isFinite),
    ),
  ).sort((a, b) => a - b);
  const uniqueGrandFinalRounds = Array.from(
    new Set(
      grandFinalMatches
        .map((item) => Number(item?.round || 1))
        .filter(Number.isFinite),
    ),
  ).sort((a, b) => a - b);

  const winnerRoundMap = new Map(
    uniqueWinnerRounds.map((roundNo, index) => [roundNo, index + 1]),
  );
  const loserRoundMap = new Map(
    uniqueLoserRounds.map((roundNo, index) => [roundNo, index + 1]),
  );
  const grandFinalRoundMap = new Map(
    uniqueGrandFinalRounds.map((roundNo, index) => [roundNo, index + 1]),
  );

  const firstWinnerPairs = uniqueWinnerRounds.length
    ? winnersMatches.filter(
        (item) => Number(item?.round || 1) === uniqueWinnerRounds[0],
      ).length
    : 0;
  const firstLoserPairs = uniqueLoserRounds.length
    ? losersMatches.filter(
        (item) => Number(item?.round || 1) === uniqueLoserRounds[0],
      ).length
    : 0;

  const configuredScale = readDoubleElimConfiguredScale(
    match?.bracket || matchesOfBracket[0]?.bracket || {},
  );
  const scaleForDoubleElim =
    configuredScale ||
    firstWinnerPairs * 2 ||
    Math.max(4, firstLoserPairs * 4) ||
    4;
  const startDrawSize = Math.max(4, firstLoserPairs * 4 || 4);
  const startWinnersRoundIndex = Math.max(
    1,
    Math.round(Math.log2(Math.max(1, scaleForDoubleElim / startDrawSize))) + 1,
  );

  const baseByBracketId =
    options?.baseByBracketId instanceof Map ? options.baseByBracketId : null;
  const baseRoundStart = baseByBracketId
    ? (Number(baseByBracketId.get(bracketId)) || 0) + 1
    : 1;
  const losersBaseRound = baseRoundStart + startWinnersRoundIndex - 1;
  const grandFinalBaseRound =
    losersBaseRound + Math.max(1, uniqueLoserRounds.length);

  const branch = normalizeDoubleElimBranch(match);
  const order = Number(match?.order || 0) + 1;
  const roundNo = Number(match?.round || 1);

  if (branch === "lb") {
    const localRound = loserRoundMap.get(roundNo) || 1;
    return `V${losersBaseRound + localRound - 1}-NT-T${order}`;
  }

  if (branch === "gf") {
    const localRound = grandFinalRoundMap.get(roundNo) || 1;
    return `V${grandFinalBaseRound + localRound - 1}-T${order}`;
  }

  const localRound = winnerRoundMap.get(roundNo) || 1;
  return `V${baseRoundStart + localRound - 1}-T${order}`;
}

function resolveGlobalRound(match, groupLike, options = {}) {
  if (groupLike) return 1;

  const bracketId = extractBracketId(match);
  const baseByBracketId =
    options?.baseByBracketId instanceof Map ? options.baseByBracketId : null;
  const localRound =
    toPositiveInt(match?.round) ||
    toPositiveInt(match?.stageIndex) ||
    toPositiveInt(match?.globalRound) ||
    1;

  if (baseByBracketId && bracketId) {
    const baseRound = Number(baseByBracketId.get(bracketId));
    if (Number.isFinite(baseRound) && baseRound >= 0) {
      return baseRound + localRound;
    }
  }

  return (
    toPositiveInt(match?.globalRound) ||
    toPositiveInt(match?.stageIndex) ||
    localRound ||
    1
  );
}

export function buildMatchDisplayMeta(match, options = {}) {
  if (!match) {
    return {
      code: "",
      displayCode: "",
      globalCode: "",
      globalRound: null,
      isGroupLike: false,
      poolIndex: null,
      poolName: "",
      matchOrder: null,
      bracketId: "",
      bracketStage: null,
      bracketOrder: null,
      sortRound: Number.MAX_SAFE_INTEGER,
      sortPool: Number.MAX_SAFE_INTEGER,
      sortOrder: Number.MAX_SAFE_INTEGER,
    };
  }

  const bracketId = extractBracketId(match);
  const bracketStage = toPositiveInt(match?.bracket?.stage);
  const bracketOrder = Number.isFinite(Number(match?.bracket?.order))
    ? Number(match.bracket.order)
    : Number.MAX_SAFE_INTEGER;
  const groupLike = isGroupLike(match);
  const globalRound = resolveGlobalRound(match, groupLike, options);
  const poolIndex = groupLike ? resolvePoolIndex(match) : null;
  const poolName = groupLike ? resolvePoolName(match) : "";
  const matchOrder = groupLike
    ? resolveGroupOrder(match)
    : resolveKnockoutOrder(match);

  let computedDisplayCode = "";
  if (groupLike) {
    computedDisplayCode = poolIndex
      ? `V1-B${poolIndex}-T${matchOrder}`
      : `V1-T${matchOrder}`;
  } else if (isDoubleElimBracketType(match?.bracket?.type || match?.format)) {
    computedDisplayCode =
      resolveDoubleElimDisplayCode(match, options) ||
      (globalRound ? `V${globalRound}-T${matchOrder}` : "");
  } else if (globalRound) {
    computedDisplayCode = `V${globalRound}-T${matchOrder}`;
  }

  const explicit =
    normalizeCode(match?.displayCode) ||
    normalizeCode(match?.codeResolved) ||
    normalizeCode(match?.code);
  const fallback =
    String(
      match?.displayCode ||
        match?.codeResolved ||
        match?.code ||
        match?.globalCode ||
        match?.labelKey ||
        ""
    ).trim() || "";

  const displayCode = explicit || computedDisplayCode || fallback;
  const code = displayCode || fallback;
  const globalCode = globalRound ? `V${globalRound}` : "";

  return {
    code,
    displayCode,
    globalCode,
    globalRound: globalRound || null,
    isGroupLike: groupLike,
    poolIndex: poolIndex || null,
    poolName,
    matchOrder: matchOrder || null,
    bracketId,
    bracketStage: bracketStage || null,
    bracketOrder,
    sortRound: globalRound || Number.MAX_SAFE_INTEGER,
    sortPool: groupLike ? poolIndex || Number.MAX_SAFE_INTEGER : 0,
    sortOrder: matchOrder || Number.MAX_SAFE_INTEGER,
  };
}

export function compareMatchDisplayOrder(a, b, options = {}) {
  const aMeta = buildMatchDisplayMeta(a, options);
  const bMeta = buildMatchDisplayMeta(b, options);

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

  const aTime = Number(new Date(a?.scheduledAt || a?.updatedAt || a?.createdAt || 0));
  const bTime = Number(new Date(b?.scheduledAt || b?.updatedAt || b?.createdAt || 0));
  if (aTime !== bTime) return aTime - bTime;

  return String(a?._id || "").localeCompare(String(b?._id || ""));
}

export function buildMatchCodePayload(match, options = {}) {
  const meta = buildMatchDisplayMeta(match, options);
  return {
    code: meta.code,
    displayCode: meta.displayCode,
    globalCode: meta.globalCode,
  };
}
