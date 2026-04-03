const trim = (value) => (value && String(value).trim()) || "";
const textValue = (value) => {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value).trim();
  }
  if (typeof value === "object") {
    return (
      trim(value?.name) ||
      trim(value?.label) ||
      trim(value?.title) ||
      ""
    );
  }
  return "";
};

export const resolveDisplayMode = (...sources) => {
  for (const source of sources) {
    const raw =
      source?.displayNameMode ||
      source?.nameDisplayMode ||
      source?.tournament?.displayNameMode ||
      source?.tournament?.nameDisplayMode;
    if (raw === "fullName") return "fullName";
    if (raw === "nickname") return "nickname";
  }
  return "nickname";
};

export const getPlayerNickname = (player) =>
  trim(player?.nickname) ||
  trim(player?.nickName) ||
  trim(player?.nick) ||
  trim(player?.user?.nickname) ||
  trim(player?.user?.nickName) ||
  trim(player?.user?.nick) ||
  "";

export const getPlayerFullName = (player) =>
  trim(player?.fullName) ||
  trim(player?.name) ||
  trim(player?.user?.fullName) ||
  trim(player?.user?.name) ||
  trim(player?.shortName) ||
  getPlayerNickname(player);

export const getPlayerDisplayName = (player, source) => {
  if (!player) return "";
  const mode = resolveDisplayMode(player, source);
  return (
    trim(player?.displayName) ||
    (mode === "fullName"
      ? getPlayerFullName(player) || getPlayerNickname(player)
      : getPlayerNickname(player) ||
        trim(player?.shortName) ||
        getPlayerFullName(player)) ||
    ""
  );
};

export const normalizePlayerDisplay = (player, source) => {
  if (!player) return null;
  if (typeof player !== "object") {
    return {
      _id: player,
      nickname: "",
      nickName: "",
      fullName: "",
      name: "",
      displayName: "",
      displayNameMode: resolveDisplayMode(source),
    };
  }

  const mode = resolveDisplayMode(player, source);
  const nickname = getPlayerNickname(player);
  const fullName = getPlayerFullName(player);
  const displayName = getPlayerDisplayName(player, source);

  return {
    ...player,
    _id: player?._id ?? player?.id ?? player,
    nickname,
    nickName: nickname || player?.nickName || "",
    fullName,
    name: fullName,
    displayName,
    displayNameMode: mode,
  };
};

export const getPairDisplayName = (pair, source) => {
  if (!pair) return "";
  const mode = resolveDisplayMode(pair, source);
  const player1 = normalizePlayerDisplay(pair?.player1, mode);
  const player2 = normalizePlayerDisplay(pair?.player2, mode);
  const joined = [player1?.displayName, player2?.displayName]
    .filter(Boolean)
    .join(" / ");

  return (
    trim(pair?.displayName) ||
    joined ||
    trim(pair?.teamName) ||
    trim(pair?.label) ||
    trim(pair?.title) ||
    trim(pair?.name) ||
    ""
  );
};

const sideKeyOf = (side) => (String(side).toUpperCase() === "B" ? "B" : "A");
const getSideValue = (match, side, prefix) => match?.[`${prefix}${sideKeyOf(side)}`];
const positiveInt = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
};
const referencePrefixFromSeed = (seed) => {
  const type = trim(seed?.type).toLowerCase();
  if (type === "stagematchloser" || type === "matchloser") return "L";
  if (type === "stagematchwinner" || type === "matchwinner") return "W";
  return "";
};
const stripReferencePrefix = (value) => trim(value).replace(/^[WL]\s*-\s*/i, "");

export const getSeedDisplayName = (seed) => {
  if (!seed) return "";

  const direct =
    trim(seed?.label) ||
    trim(seed?.displayName) ||
    trim(seed?.teamName) ||
    trim(seed?.name) ||
    trim(seed?.title);
  if (direct) return direct;

  const type = trim(seed?.type).toLowerCase();
  const ref = seed?.ref || {};

  if (type === "bye") return "BYE";

  if (type === "grouprank") {
    const stage = positiveInt(ref?.stage ?? seed?.stage);
    const groupCode = trim(
      ref?.groupCode || ref?.group?.name || ref?.group?.code || seed?.groupCode
    );
    const rank = positiveInt(ref?.rank ?? seed?.rank);
    if (stage && groupCode && rank) return `V${stage}-B${groupCode}-T${rank}`;
  }

  const prefix = referencePrefixFromSeed(seed);
  const stageIndex = positiveInt(ref?.stageIndex ?? seed?.stageIndex ?? ref?.stage);
  const order = positiveInt(ref?.order ?? seed?.order);
  if (prefix && stageIndex && order) return `${prefix}-V${stageIndex}-T${order}`;

  return textValue(seed);
};

export const getPreviousMatchDisplayCode = (previous) => {
  if (!previous) return "";

  const directCandidates = [
    previous?.codeResolved,
    previous?.globalCode,
    previous?.codeDisplay,
    previous?.codeGroup,
    previous?.code,
    previous?.label,
    previous?.displayCode,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeMatchCodeCandidate(candidate);
    if (normalized) return normalized;
  }

  const vIndex = positiveInt(previous?.vIndex ?? previous?.globalRound);
  const tIndex = positiveInt(previous?.tIndex);
  if (vIndex && tIndex) return `V${vIndex}-T${tIndex}`;

  const round = positiveInt(previous?.round ?? previous?.rrRound);
  const order =
    previous?.order != null && Number.isFinite(Number(previous.order))
      ? Math.trunc(Number(previous.order)) + 1
      : null;
  if (round && order) return `V${round}-T${order}`;

  return "";
};

export const getMatchSideDisplayName = (match, side, fallback = "TBD") => {
  const normalizedSide = sideKeyOf(side);
  const pair =
    getSideValue(match, normalizedSide, "pair") ||
    match?.teams?.[normalizedSide] ||
    match?.[`team${normalizedSide}`] ||
    match?.[`side${normalizedSide}`] ||
    null;
  const seed = getSideValue(match, normalizedSide, "seed");
  const previous = getSideValue(match, normalizedSide, "previous");
  const pairName = getPairDisplayName(pair, match);
  if (pairName) return pairName;

  const seedName = getSeedDisplayName(seed);
  if (seedName) return seedName;

  const previousCode = getPreviousMatchDisplayCode(previous);
  if (previousCode) {
    const prefix = referencePrefixFromSeed(seed) || "W";
    return `${prefix}-${stripReferencePrefix(previousCode)}`;
  }

  return fallback;
};

export const getMatchDisplayStatus = (match = {}) => {
  const raw = trim(match?.status || match?.state || match?.match_status).toLowerCase();
  if (
    ["live", "ongoing", "playing", "inprogress", "on_court", "oncourt"].includes(raw)
  ) {
    return "live";
  }
  if (["assigned"].includes(raw)) return "assigned";
  if (["finished", "done", "completed", "final", "ended", "over", "closed"].includes(raw)) {
    return "finished";
  }
  if (["queued", "queue"].includes(raw)) return "queued";
  if (["scheduled", "pending", "created", "assigning", "upcoming"].includes(raw)) {
    return "scheduled";
  }
  return raw;
};

export const shouldShowMatchCourt = (match = {}) => {
  const status = getMatchDisplayStatus(match);
  return !["scheduled", "queued", ""].includes(status);
};

export const getMatchCourtParts = (match = {}) => {
  if (!shouldShowMatchCourt(match)) {
    return {
      cluster: "",
      station: "",
    };
  }

  const station = textValue(
    match?.courtStationName ||
      match?.courtStationLabel ||
      match?.courtStation ||
      match?.courtName ||
      match?.court?.name ||
      match?.court?.label ||
      match?.court?.title
  );
  const cluster = textValue(
    match?.courtClusterName ||
      match?.courtClusterLabel ||
      match?.courtCluster ||
      match?.court?.cluster
  );
  const legacy = textValue(match?.courtLabel);
  const stationName = station || legacy;
  const clusterName =
    cluster && cluster.toLowerCase() !== stationName.toLowerCase() ? cluster : "";

  return {
    cluster: clusterName,
    station: stationName,
  };
};

export const getMatchCourtStationName = (match = {}) =>
  getMatchCourtParts(match).station;

export const getMatchCourtDisplayText = (match = {}) => {
  const { cluster, station } = getMatchCourtParts(match);
  if (cluster && station) return `${cluster} · ${station}`;
  return cluster || station || "";
};

export const normalizePairDisplay = (pair, source) => {
  if (!pair || typeof pair !== "object") return pair;
  const mode = resolveDisplayMode(pair, source);
  const player1 = normalizePlayerDisplay(pair?.player1, mode);
  const player2 = normalizePlayerDisplay(pair?.player2, mode);
  return {
    ...pair,
    _id: pair?._id ?? pair?.id ?? pair,
    player1,
    player2,
    displayName: getPairDisplayName({ ...pair, player1, player2 }, mode),
    displayNameMode: mode,
  };
};

const normalizeTeamDisplay = (team, source) => {
  if (!team || typeof team !== "object") return team;
  const mode = resolveDisplayMode(team, source);
  const players = Array.isArray(team?.players)
    ? team.players.map((player) => normalizePlayerDisplay(player, mode))
    : [];
  const displayName =
    trim(team?.displayName) ||
    trim(team?.name) ||
    players.map((player) => player?.displayName).filter(Boolean).join(" / ") ||
    trim(team?.teamName) ||
    trim(team?.label) ||
    "";
  return {
    ...team,
    players,
    name: displayName || team?.name || "",
    displayName,
    displayNameMode: mode,
  };
};

const normalizeRefEntity = (entity) => {
  if (!entity || typeof entity !== "object") return entity;
  return {
    ...entity,
    _id: entity?._id ?? entity?.id ?? entity,
  };
};

const MATCH_CODE_GROUP_LIKE = new Set([
  "group",
  "round_robin",
  "roundrobin",
  "rr",
  "gsl",
]);
const MATCH_CODE_KO = new Set([
  "ko",
  "knockout",
  "elimination",
  "single_elimination",
  "double_elimination",
  "playoff",
  "play_off",
]);
const matchCodeNorm = (value) => trim(value).toLowerCase();
const toPositiveInt = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : null;
};
const letterToIndex = (value) => {
  const raw = trim(value).toUpperCase();
  if (/^[A-Z]$/.test(raw)) return raw.charCodeAt(0) - 64;
  return null;
};
const isGlobalDisplayCode = (value) =>
  /^V\d+(?:-B[A-Z0-9]+)?-T\d+$/i.test(trim(value));
const normalizeMatchCodeCandidate = (value) => {
  const raw = trim(value).toUpperCase();
  if (!raw) return "";
  if (isGlobalDisplayCode(raw)) return raw;

  const legacyGroup = raw.match(/^#?V(\d+)-B([A-Z0-9]+)#(\d+)$/i);
  if (legacyGroup) {
    return `V${legacyGroup[1]}-B${legacyGroup[2]}-T${legacyGroup[3]}`;
  }

  const knockout = raw.match(/^V(\d+)\s*-\s*T(\d+)$/i);
  if (knockout) return `V${knockout[1]}-T${knockout[2]}`;

  return "";
};
const codeFromLabelKeyish = (value) => {
  const raw = trim(value).toUpperCase();
  if (!raw) return "";
  const nums = raw.match(/\d+/g);
  if (!nums || nums.length < 2) return "";
  const v = Number(nums[0]);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (/#?B\d+/i.test(raw)) {
    const b = nums.length >= 3 ? Number(nums[1]) : 1;
    const t = Number(nums[nums.length - 1]);
    if (!Number.isFinite(b) || !Number.isFinite(t) || b <= 0 || t <= 0) return "";
    return `V${v}-B${b}-T${t}`;
  }
  const t = Number(nums[nums.length - 1]);
  if (!Number.isFinite(t) || t <= 0) return "";
  return `V${v}-T${t}`;
};
const isGroupLikeForDisplayCode = (match = {}) => {
  const bracketType = matchCodeNorm(match?.bracketType || match?.bracket?.type);
  const type = matchCodeNorm(match?.type);
  const format = matchCodeNorm(match?.format);
  const phase = matchCodeNorm(match?.phase || match?.branch);

  if (MATCH_CODE_GROUP_LIKE.has(bracketType)) return true;
  if (MATCH_CODE_KO.has(bracketType)) return false;
  if (MATCH_CODE_GROUP_LIKE.has(type) || MATCH_CODE_GROUP_LIKE.has(format)) return true;
  if (MATCH_CODE_KO.has(type) || MATCH_CODE_KO.has(format)) return false;
  if (MATCH_CODE_KO.has(phase)) return false;

  return Boolean(
    match?.pool ||
      match?.group ||
      match?.groupNo != null ||
      match?.groupIndex != null ||
      match?.rrRound != null
  );
};
const resolvePoolIndex = (match = {}) => {
  const pool =
    match?.pool && typeof match.pool === "object"
      ? match.pool
      : {
          name: match?.pool ?? match?.group ?? "",
          code: match?.poolCode ?? "",
          index: match?.groupIndex ?? match?.groupNo ?? null,
        };

  const byOrder = toPositiveInt(pool?.order);
  if (byOrder) return byOrder;

  const byIndex = toPositiveInt(pool?.index);
  if (byIndex) return byIndex;

  const byGroupNo = toPositiveInt(match?.groupNo);
  if (byGroupNo) return byGroupNo;

  const byLetter = letterToIndex(pool?.name || pool?.code);
  if (byLetter) return byLetter;

  const explicit = trim(pool?.name || pool?.code);
  const explicitMatch = explicit.match(/^B(\d+)$/i) || explicit.match(/^(\d+)$/);
  if (explicitMatch) return Number(explicitMatch[1]);

  return 1;
};
const buildFallbackMatchDisplayCode = (match = {}, fallbackIndex = undefined) => {
  const orderBase = Number.isFinite(Number(match?.order))
    ? Number(match.order)
    : Number.isFinite(Number(fallbackIndex))
      ? Number(fallbackIndex)
      : 0;
  const matchOrder = Math.max(1, Math.trunc(orderBase) + 1);

  if (isGroupLikeForDisplayCode(match)) {
    return `V1-B${resolvePoolIndex(match)}-T${matchOrder}`;
  }

  const round =
    toPositiveInt(match?.globalRound) ||
    toPositiveInt(match?.stageIndex) ||
    toPositiveInt(match?.round) ||
    1;
  return `V${round}-T${matchOrder}`;
};

export const getMatchDisplayCode = (match, fallbackIndex = undefined) => {
  if (!match || typeof match !== "object") return "";

  const directCandidates = [
    match?.displayCode,
    match?.codeDisplay,
    match?.codeResolved,
    match?.codeGroup,
    match?.globalCodeV,
    match?.globalCode,
    match?.matchCode,
    match?.code,
    match?.slotCode,
    match?.bracketCode,
  ];
  for (const candidate of directCandidates) {
    const normalized = normalizeMatchCodeCandidate(candidate);
    if (normalized) return normalized;
  }

  const fromLabel =
    codeFromLabelKeyish(match?.labelKeyDisplay) ||
    codeFromLabelKeyish(match?.labelKey);
  if (fromLabel) return fromLabel;

  return buildFallbackMatchDisplayCode(match, fallbackIndex);
};

export const normalizeMatchDisplay = (match, fallbackSource = null) => {
  if (!match || typeof match !== "object") return match;

  const mode = resolveDisplayMode(match, fallbackSource);
  const hasGameScores = Array.isArray(match?.gameScores);
  const hasScores = Array.isArray(match?.scores);
  const scoreList = hasGameScores ? match.gameScores : hasScores ? match.scores : undefined;
  const matchIdValue =
    match?._id ?? match?.id ?? match?.matchId ?? fallbackSource?._id;
  const liveVersion = match?.liveVersion ?? match?.version;

  const tournament =
    match?.tournament && typeof match.tournament === "object"
      ? {
          ...match.tournament,
          _id: match.tournament?._id ?? match.tournament?.id ?? match.tournament,
          nameDisplayMode: mode,
          displayNameMode: mode,
        }
      : match?.tournament;

  const pairA = normalizePairDisplay(match?.pairA, match);
  const pairB = normalizePairDisplay(match?.pairB, match);

  const next = {
    ...match,
    tournament,
    pairA,
    pairB,
    teams:
      match?.teams && typeof match.teams === "object"
        ? {
            ...match.teams,
            A: normalizeTeamDisplay(match.teams?.A, mode),
            B: normalizeTeamDisplay(match.teams?.B, mode),
          }
        : match?.teams,
    court: normalizeRefEntity(match?.court),
    bracket: normalizeRefEntity(match?.bracket),
    previousA: normalizeRefEntity(match?.previousA),
    previousB: normalizeRefEntity(match?.previousB),
    nextMatch: normalizeRefEntity(match?.nextMatch),
    displayNameMode: mode,
  };

  if (matchIdValue) {
    next._id = matchIdValue;
    next.matchId = String(matchIdValue);
  }
  if (Array.isArray(scoreList)) next.gameScores = scoreList;
  if (match?.scoreText != null || match?.score_text != null) {
    next.scoreText = match?.scoreText ?? match?.score_text;
  }
  if (match?.status != null || match?.state != null || match?.match_status != null) {
    next.status = match?.status ?? match?.state ?? match?.match_status;
  }
  if (match?.updatedAt != null || match?.updated_at != null) {
    next.updatedAt = match?.updatedAt ?? match?.updated_at;
  }
  if (liveVersion != null) {
    next.liveVersion = liveVersion;
    next.version = liveVersion;
  }

  return next;
};

export const extractMatchPayload = (raw) =>
  raw?.data ?? raw?.match ?? raw?.snapshot ?? raw;

export const extractMatchPatchPayload = (raw) => {
  const patch =
    (raw?.payload && typeof raw.payload === "object" ? raw.payload : null) ||
    (raw?.data?.payload && typeof raw.data.payload === "object"
      ? raw.data.payload
      : null) ||
    (raw?.patch && typeof raw.patch === "object" ? raw.patch : null);

  if (!patch) return null;

  const matchId =
    patch?._id ??
    patch?.id ??
    patch?.matchId ??
    raw?.matchId ??
    raw?.id ??
    raw?._id;

  return {
    ...(matchId
      ? {
          _id: String(matchId),
          matchId: String(matchId),
        }
      : {}),
    ...patch,
  };
};

export const getMatchPayloadId = (raw) => {
  const payload = extractMatchPayload(raw);
  return String(
    payload?._id ??
      payload?.id ??
      raw?.matchId ??
      raw?.id ??
      raw?._id ??
      payload?.matchId ??
      ""
  );
};

export const isLightweightMatchPayload = (raw) => {
  const payload = extractMatchPayload(raw);
  if (!payload || typeof payload !== "object") return true;

  const informativeKeys = Object.keys(payload).filter((key) => {
    if (payload[key] == null) return false;
    return ![
      "_id",
      "id",
      "matchId",
      "type",
      "kind",
      "source",
      "at",
      "ts",
      "timestamp",
    ].includes(key);
  });

  return informativeKeys.length === 0;
};

export const isNewerOrEqualMatchPayload = (current, incoming) => {
  const next = normalizeMatchDisplay(incoming, current);
  const currentVersion = Number(
    current?.liveVersion ?? current?.version ?? Number.NaN
  );
  const nextVersion = Number(next?.liveVersion ?? next?.version ?? Number.NaN);

  if (Number.isFinite(currentVersion) && Number.isFinite(nextVersion)) {
    return nextVersion >= currentVersion;
  }

  const currentTime = Date.parse(current?.updatedAt ?? current?.liveAt ?? 0);
  const nextTime = Date.parse(next?.updatedAt ?? next?.liveAt ?? 0);

  if (Number.isFinite(currentTime) && Number.isFinite(nextTime)) {
    return nextTime >= currentTime;
  }

  return true;
};

const mergePlayer = (current, incoming, source) => {
  if (incoming == null) return normalizePlayerDisplay(current, source);
  if (typeof incoming !== "object") return normalizePlayerDisplay(incoming, source);
  return normalizePlayerDisplay({ ...(current || {}), ...incoming }, source);
};

const mergePair = (current, incoming, source) => {
  if (incoming == null) return normalizePairDisplay(current, source);
  if (typeof incoming !== "object") return incoming;
  return normalizePairDisplay(
    {
      ...(current || {}),
      ...incoming,
      player1: mergePlayer(current?.player1, incoming?.player1, source),
      player2: mergePlayer(current?.player2, incoming?.player2, source),
    },
    source
  );
};

export const mergeMatchPayload = (current, raw, fallbackSource = null) => {
  const incomingRaw = extractMatchPayload(raw);
  if (!incomingRaw || typeof incomingRaw !== "object") return current || null;
  const incoming = normalizeMatchDisplay(incomingRaw, fallbackSource || current);
  if (!current) return incoming;

  const merged = {
    ...current,
    ...incoming,
    tournament:
      incoming?.tournament && typeof incoming.tournament === "object"
        ? { ...(current?.tournament || {}), ...incoming.tournament }
        : current?.tournament,
    bracket:
      incoming?.bracket && typeof incoming.bracket === "object"
        ? { ...(current?.bracket || {}), ...incoming.bracket }
        : current?.bracket,
    court:
      incoming?.court && typeof incoming.court === "object"
        ? { ...(current?.court || {}), ...incoming.court }
        : incoming?.court ?? current?.court,
    previousA:
      incoming?.previousA && typeof incoming.previousA === "object"
        ? { ...(current?.previousA || {}), ...incoming.previousA }
        : incoming?.previousA ?? current?.previousA,
    previousB:
      incoming?.previousB && typeof incoming.previousB === "object"
        ? { ...(current?.previousB || {}), ...incoming.previousB }
        : incoming?.previousB ?? current?.previousB,
    nextMatch:
      incoming?.nextMatch && typeof incoming.nextMatch === "object"
        ? { ...(current?.nextMatch || {}), ...incoming.nextMatch }
        : incoming?.nextMatch ?? current?.nextMatch,
    pairA: mergePair(current?.pairA, incoming?.pairA, incoming),
    pairB: mergePair(current?.pairB, incoming?.pairB, incoming),
    teams:
      incoming?.teams && typeof incoming.teams === "object"
        ? {
            ...(current?.teams || {}),
            ...incoming.teams,
            A: incoming.teams?.A
              ? normalizeTeamDisplay(
                  { ...(current?.teams?.A || {}), ...incoming.teams.A },
                  incoming
                )
              : current?.teams?.A,
            B: incoming.teams?.B
              ? normalizeTeamDisplay(
                  { ...(current?.teams?.B || {}), ...incoming.teams.B },
                  incoming
                )
              : current?.teams?.B,
          }
        : current?.teams,
  };

  return normalizeMatchDisplay(merged, fallbackSource || current);
};
