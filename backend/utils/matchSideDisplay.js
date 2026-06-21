const trim = (value) => (value == null ? "" : String(value).trim());

const docId = (value) => {
  const raw = value?._id || value?.id || value || "";
  return raw ? String(raw) : "";
};

const normalizeText = (value) =>
  trim(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .replace(/\s+/g, " ")
    .toLowerCase();

const labelText = (value) => {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return trim(value);
  }
  if (typeof value === "object") {
    return trim(
      value.displayName ||
        value.teamName ||
        value.name ||
        value.label ||
        value.title ||
        ""
    );
  }
  return "";
};

const sideKeyOf = (side) => (String(side).toUpperCase() === "B" ? "B" : "A");
const sideField = (side, prefix) => `${prefix}${sideKeyOf(side)}`;

const seedType = (seed) => trim(seed?.type).toLowerCase();
const isWinnerSeedType = (type) =>
  type === "stagematchwinner" || type === "matchwinner";
const isLoserSeedType = (type) =>
  type === "stagematchloser" || type === "matchloser";

export const isByeSideLabel = (value) => normalizeText(value) === "bye";

export const isPendingSideLabel = (value) => {
  const text = normalizeText(value);
  return (
    !text ||
    [
      "tbd",
      "registration",
      "chua co doi",
      "doi",
      "doi a",
      "doi b",
      "-",
      "--",
      "—",
    ].includes(text)
  );
};

export const isReferenceSideLabel = (value) =>
  /^[WL]\s*-\s*(?:V\d+(?:-(?:B[A-Z0-9]+|NT))?-T\d+|NT-T\d+)$/i.test(
    labelText(value)
  );

const isDisplayableTeamLabel = (value) => {
  const text = labelText(value);
  return Boolean(text) && !isPendingSideLabel(text) && !isByeSideLabel(text);
};

const isByeSeed = (seed) =>
  seedType(seed) === "bye" || isByeSideLabel(seed?.label);

const personName = (player, source) => {
  const mode = trim(
    source?.displayNameMode ||
      source?.nameDisplayMode ||
      source?.tournament?.displayNameMode ||
      source?.tournament?.nameDisplayMode
  );
  const nickname =
    trim(player?.displayName) ||
    trim(player?.nickname) ||
    trim(player?.nickName) ||
    trim(player?.nick) ||
    trim(player?.user?.nickname) ||
    trim(player?.user?.nickName) ||
    trim(player?.user?.nick);
  const fullName =
    trim(player?.fullName) ||
    trim(player?.user?.fullName) ||
    trim(player?.user?.name) ||
    trim(player?.name) ||
    trim(player?.shortName);
  return mode === "fullName" ? fullName || nickname : nickname || fullName;
};

export const getPairDisplayNameForMatch = (pair, source) => {
  if (!pair || typeof pair !== "object") return "";
  const playerNames = [personName(pair.player1, source), personName(pair.player2, source)]
    .filter(Boolean)
    .join(" / ");
  return (
    playerNames ||
    trim(pair.displayName) ||
    trim(pair.teamName) ||
    trim(pair.label) ||
    trim(pair.title) ||
    trim(pair.name) ||
    ""
  );
};

const positiveInt = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
};

const matchCodeRegex = /^V\d+(?:-(?:B[A-Z0-9]+|NT))?-T\d+$/i;

const normalizeMatchCodeCandidate = (value) => {
  const raw = trim(value).toUpperCase();
  if (!raw) return "";
  if (matchCodeRegex.test(raw)) return raw;

  const legacyGroup = raw.match(/^#?V(\d+)-B([A-Z0-9]+)#(\d+)$/i);
  if (legacyGroup) {
    return `V${legacyGroup[1]}-B${legacyGroup[2]}-T${legacyGroup[3]}`;
  }

  const knockout = raw.match(/^V(\d+)\s*-\s*T(\d+)$/i);
  if (knockout) return `V${knockout[1]}-T${knockout[2]}`;

  const nt = raw.match(/^V(\d+)\s*-\s*NT\s*-\s*T(\d+)$/i);
  if (nt) return `V${nt[1]}-NT-T${nt[2]}`;

  return "";
};

const codeFromLabelKeyish = (value) => {
  const raw = trim(value).toUpperCase();
  if (!raw) return "";
  const nt = raw.match(/V(\d+).*NT.*?(\d+)\s*$/i);
  if (nt) return `V${nt[1]}-NT-T${nt[2]}`;

  const nums = raw.match(/\d+/g);
  if (!nums || nums.length < 2) return "";
  const v = Number(nums[0]);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (/#?B\d+/i.test(raw)) {
    const b = nums.length >= 3 ? Number(nums[1]) : 1;
    const t = Number(nums[nums.length - 1]);
    if (!Number.isFinite(b) || !Number.isFinite(t) || b <= 0 || t <= 0) {
      return "";
    }
    return `V${v}-B${b}-T${t}`;
  }
  const t = Number(nums[nums.length - 1]);
  if (!Number.isFinite(t) || t <= 0) return "";
  return `V${v}-T${t}`;
};

export const getMatchDisplayCodeForSide = (match, context = {}) => {
  if (!match || typeof match !== "object") return "";
  const custom = context.codeOf?.(match);
  if (custom) return normalizeMatchCodeCandidate(custom) || trim(custom);

  const candidates = [
    match.displayCode,
    match.codeResolved,
    match.roundCode,
    match.codeDisplay,
    match.globalCodeV,
    match.globalCode,
    match.matchCode,
    match.code,
    match.labelKeyDisplay,
    match.labelKey,
  ];
  for (const candidate of candidates) {
    const normalized =
      normalizeMatchCodeCandidate(candidate) || codeFromLabelKeyish(candidate);
    if (normalized) return normalized;
  }

  const round =
    positiveInt(match.globalRound) ||
    positiveInt(match.stageIndex) ||
    positiveInt(match.round) ||
    1;
  const order = positiveInt(match.tIndex) || positiveInt(match.order) || 0;
  return `V${round}-T${order + 1}`;
};

const extractReferenceParts = (value) => {
  const raw = trim(value).toUpperCase();
  if (!raw) return null;
  const prefixed = raw.match(/^([WL])\s*-\s*(.+)$/i);
  const prefix = prefixed?.[1]?.toUpperCase() || "";
  const base = prefixed?.[2] || raw;
  const normalized = normalizeMatchCodeCandidate(base) || codeFromLabelKeyish(base);
  if (!normalized) return null;
  const parsed = normalized.match(/^V(\d+)(?:-(?:B[A-Z0-9]+|NT))?-T(\d+)$/i);
  if (!parsed) return null;
  return {
    prefix,
    code: normalized.toUpperCase(),
    round: Number(parsed[1]),
    order: Number(parsed[2]),
  };
};

const currentDisplayRound = (match) => {
  const candidates = [
    match?.displayCode,
    match?.codeResolved,
    match?.roundCode,
    match?.codeDisplay,
    match?.globalCode,
    match?.matchCode,
    match?.code,
    match?.labelKeyDisplay,
    match?.labelKey,
  ];
  for (const value of candidates) {
    const parts = extractReferenceParts(value);
    if (parts?.round) return parts.round;
  }
  return (
    positiveInt(match?.globalRound) ||
    positiveInt(match?.stageIndex) ||
    positiveInt(match?.round)
  );
};

const dependentDisplayRound = (match, fallbackRound) => {
  const current = currentDisplayRound(match);
  if (current) return Math.max(1, current - 1);
  return positiveInt(fallbackRound);
};

const displayOrderFromSeed = (seed) => {
  const ref = seed?.ref || {};
  const direct = positiveInt(ref.tIndex ?? seed?.tIndex);
  if (direct) return direct;
  const order = Number(ref.order ?? seed?.order);
  if (Number.isFinite(order) && order >= 0) return Math.trunc(order) + 1;
  return null;
};

const referencePrefixFromSeed = (seed) => {
  const type = seedType(seed);
  if (isWinnerSeedType(type)) return "W";
  if (isLoserSeedType(type)) return "L";
  return "";
};

export const getSeedReferenceLabel = (seed, ownerMatch = null, context = {}) => {
  if (!seed) return "";

  const direct = labelText(
    seed.label || seed.displayName || seed.teamName || seed.name || seed.title
  );
  if (isReferenceSideLabel(direct) || isByeSideLabel(direct)) return direct;
  if (isDisplayableTeamLabel(direct) && !isPendingSideLabel(direct)) return direct;

  const type = seedType(seed);
  const ref = seed.ref || {};

  if (type === "bye") return "BYE";

  if (type === "grouprank") {
    const stage = positiveInt(ref.stage ?? seed.stage);
    const groupCode = trim(
      ref.groupCode || ref.group?.name || ref.group?.code || seed.groupCode
    );
    const rank = positiveInt(ref.rank ?? seed.rank);
    if (stage && groupCode && rank) return `V${stage}-B${groupCode}-T${rank}`;
  }

  const prefix = referencePrefixFromSeed(seed);
  if (!prefix) return "";

  const sourceMatch = findSourceMatchFromSeed(ownerMatch, seed, context);
  if (sourceMatch) {
    const sourceCode = getMatchDisplayCodeForSide(sourceMatch, context);
    if (sourceCode) return `${prefix}-${sourceCode}`;
  }

  const directParts = extractReferenceParts(direct);
  const fallbackRound =
    directParts?.round ||
    positiveInt(ref.stageIndex ?? seed.stageIndex ?? ref.stage ?? seed.stage ?? ref.round);
  const round = ownerMatch
    ? dependentDisplayRound(ownerMatch, fallbackRound)
    : fallbackRound;
  const order = directParts?.order || displayOrderFromSeed(seed);
  return round && order ? `${prefix}-V${round}-T${order}` : "";
};

const sideSeed = (match, side) => match?.[sideField(side, "seed")];
const sidePair = (match, side) => match?.[sideField(side, "pair")];
const sidePrevious = (match, side) => match?.[sideField(side, "previous")];

export const findSourceMatchFromSeed = (ownerMatch, seed, context = {}) => {
  if (!ownerMatch || !seed) return null;
  const ownerId = docId(ownerMatch);
  const byId = context.byId || new Map();
  const byCode = context.byCode || new Map();

  const ids = [
    seed?.ref?.matchId,
    seed?.ref?.match,
    seed?.matchId,
    seed?.match,
    seed?.ref?._id,
    seed?.ref?.id,
  ].map(docId);
  for (const id of ids) {
    if (id && id !== ownerId && byId.has(id)) return byId.get(id);
  }

  const labelCode = extractReferenceParts(
    seed.label || seed.displayName || seed.name || seed.title
  );
  if (labelCode) {
    const source =
      byCode.get(labelCode.code) ||
      byCode.get(`V${labelCode.round}-T${labelCode.order}`);
    if (source && docId(source) !== ownerId) return source;
  }

  const ref = seed.ref || {};
  const round = positiveInt(ref.round ?? seed.round);
  const order = displayOrderFromSeed(seed);
  if (!round || !order) return null;

  for (const candidate of byId.values()) {
    if (docId(candidate) === ownerId) continue;
    const candidateRound = positiveInt(candidate.round);
    const candidateOrderBase = positiveInt(candidate.order);
    const candidateOrder =
      positiveInt(candidate.tIndex) ||
      (candidateOrderBase ? candidateOrderBase + 1 : null);
    if (candidateRound === round && candidateOrder === order) return candidate;
  }
  return null;
};

const sourceFromPrevious = (ownerMatch, side, context) => {
  const previous = sidePrevious(ownerMatch, side);
  const id = docId(previous);
  if (id && context.byId?.has(id)) return context.byId.get(id);
  return previous && typeof previous === "object" ? previous : null;
};

export const resolveMatchSideDisplay = (
  match,
  side,
  context = {},
  depth = 0
) => {
  if (!match || depth > 12) {
    return { name: "Chưa có đội", kind: "pending", source: "" };
  }

  const normalizedSide = sideKeyOf(side);
  const pair = sidePair(match, normalizedSide);
  const pairName = getPairDisplayNameForMatch(pair, match);
  if (isDisplayableTeamLabel(pairName) && !isReferenceSideLabel(pairName)) {
    return { name: pairName, kind: "team", source: docId(pair) };
  }

  const seed = sideSeed(match, normalizedSide);
  const type = seedType(seed);
  if (isByeSeed(seed)) return { name: "BYE", kind: "bye", source: "bye" };

  const direct = labelText(
    normalizedSide === "A"
      ? match.resolvedSideNameA || match.teamAName || match.pairAName || match.sideAName
      : match.resolvedSideNameB || match.teamBName || match.pairBName || match.sideBName
  );
  const directIsReference = isReferenceSideLabel(direct);
  if ((isDisplayableTeamLabel(direct) && !directIsReference) || isByeSideLabel(direct)) {
    return {
      name: isByeSideLabel(direct) ? "BYE" : direct,
      kind: "team",
      source: "",
    };
  }

  if (type === "registration") {
    const seedLabel = getSeedReferenceLabel(seed, match, context);
    if (isDisplayableTeamLabel(seedLabel) || isByeSideLabel(seedLabel)) {
      return {
        name: isByeSideLabel(seedLabel) ? "BYE" : seedLabel,
        kind: "seed",
        source: "",
      };
    }
    return { name: "Chưa có đội", kind: "pending", source: "" };
  }

  const isWinnerSeed = isWinnerSeedType(type);
  const isLoserSeed = isLoserSeedType(type);
  if (isWinnerSeed || isLoserSeed) {
    const sourceMatch =
      sourceFromPrevious(match, normalizedSide, context) ||
      findSourceMatchFromSeed(match, seed, context);
    if (sourceMatch) {
      const sourceByeA = isByeSeed(sourceMatch.seedA);
      const sourceByeB = isByeSeed(sourceMatch.seedB);
      if (sourceByeA || sourceByeB) {
        if (isLoserSeed || (sourceByeA && sourceByeB)) {
          return { name: "BYE", kind: "bye", source: docId(sourceMatch) };
        }
        const carriedSide = sourceByeA ? "B" : "A";
        return resolveMatchSideDisplay(sourceMatch, carriedSide, context, depth + 1);
      }

      const winnerSide =
        sourceMatch.winner === "A" || sourceMatch.winner === "B"
          ? sourceMatch.winner
          : "";
      if (winnerSide) {
        const sourceSide = isLoserSeed
          ? winnerSide === "A"
            ? "B"
            : "A"
          : winnerSide;
        const resolved = resolveMatchSideDisplay(
          sourceMatch,
          sourceSide,
          context,
          depth + 1
        );
        if (resolved.name && !isPendingSideLabel(resolved.name)) {
          return { ...resolved, source: docId(sourceMatch) || resolved.source };
        }
      }

      const sourceCode = getMatchDisplayCodeForSide(sourceMatch, context);
      if (sourceCode) {
        return {
          name: `${isLoserSeed ? "L" : "W"}-${sourceCode}`,
          kind: "source",
          source: docId(sourceMatch),
        };
      }
    }

    const seedLabel = getSeedReferenceLabel(seed, match, context);
    if (seedLabel) {
      return {
        name: seedLabel,
        kind: isReferenceSideLabel(seedLabel) ? "source" : "seed",
        source: "",
      };
    }
  }

  const fallbackSeed = getSeedReferenceLabel(seed, match, context);
  if (isDisplayableTeamLabel(fallbackSeed) || isByeSideLabel(fallbackSeed)) {
    return {
      name: isByeSideLabel(fallbackSeed) ? "BYE" : fallbackSeed,
      kind: isReferenceSideLabel(fallbackSeed) ? "source" : "seed",
      source: "",
    };
  }

  if (directIsReference) {
    return { name: direct, kind: "source", source: "" };
  }

  return { name: "Chưa có đội", kind: "pending", source: "" };
};

export const buildMatchSideDisplayContext = (matches = [], options = {}) => {
  const byId = new Map();
  const byCode = new Map();
  const codeOf = options.codeOf;
  for (const match of Array.isArray(matches) ? matches : []) {
    const id = docId(match);
    if (id) byId.set(id, match);
  }
  for (const match of byId.values()) {
    const code = getMatchDisplayCodeForSide(match, { codeOf });
    if (code) byCode.set(code.toUpperCase(), match);
  }
  return { ...options, byId, byCode };
};

export const attachResolvedSideNamesToMatch = (match, context = {}) => {
  if (!match || typeof match !== "object") return match;
  const sideA = resolveMatchSideDisplay(match, "A", context);
  const sideB = resolveMatchSideDisplay(match, "B", context);

  match.resolvedSideNameA = sideA.name;
  match.resolvedSideNameB = sideB.name;
  match.sideAName = sideA.name;
  match.sideBName = sideB.name;
  match.teamAName = sideA.kind === "team" ? sideA.name : "";
  match.teamBName = sideB.kind === "team" ? sideB.name : "";
  match.pairAName = sideA.kind === "team" ? sideA.name : "";
  match.pairBName = sideB.kind === "team" ? sideB.name : "";
  match.resolvedSideKindA = sideA.kind;
  match.resolvedSideKindB = sideB.kind;
  match.resolvedSideSourceA = sideA.source || "";
  match.resolvedSideSourceB = sideB.source || "";
  return match;
};

export const attachResolvedSideNamesToMatches = (matches = [], options = {}) => {
  const context = buildMatchSideDisplayContext(matches, options);
  for (const match of Array.isArray(matches) ? matches : []) {
    attachResolvedSideNamesToMatch(match, context);
  }
  return matches;
};
