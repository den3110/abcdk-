const NORMALIZED_MATCH_CODE_RE = /^V\d+(?:-B\d+)?-T\d+$/i;
const GROUPISH_TYPES = new Set(["group", "round_robin", "gsl"]);

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
  if (groupLike && poolIndex) {
    computedDisplayCode = `V1-B${poolIndex}-T${matchOrder}`;
  } else if (!groupLike && globalRound) {
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

  const displayCode = computedDisplayCode || explicit || fallback;
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
