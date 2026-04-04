const readText = (...candidates) => {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }
  return "";
};

export const getTournamentNameDisplayMode = (source) => {
  const mode = readText(
    source?.displayNameMode,
    source?.nameDisplayMode,
    source?.tournament?.displayNameMode,
    source?.tournament?.nameDisplayMode,
  );
  return mode === "fullName" ? "fullName" : "nickname";
};

const displayModeValue = (value) =>
  value === "fullName" || value === "nickname" ? value : "";

const storedDisplayNameForMode = (entity, displayMode) => {
  const storedName = readText(entity?.displayName);
  const storedMode = displayModeValue(
    readText(entity?.displayNameMode, entity?.nameDisplayMode),
  );
  if (storedName && storedMode === displayMode) return storedName;
  return "";
};

const nicknameOf = (player) =>
  readText(
    player?.nickname,
    player?.nickName,
    player?.nick,
    player?.nick_name,
    player?.shortName,
    player?.user?.nickname,
    player?.user?.nickName,
  );

const fullNameOf = (player) =>
  readText(
    player?.fullName,
    player?.user?.fullName,
    player?.user?.name,
    player?.name,
  );

export const getTournamentPlayerName = (
  player,
  displayMode = "nickname",
  fallback = "—",
) => {
  if (!player) return fallback;
  const nickname = nicknameOf(player);
  const fullName = fullNameOf(player);
  if (displayMode === "fullName") {
    return (
      storedDisplayNameForMode(player, displayMode) ||
      fullName ||
      nickname ||
      readText(player?.displayName) ||
      fallback
    );
  }
  return (
    storedDisplayNameForMode(player, displayMode) ||
    nickname ||
    fullName ||
    readText(player?.displayName) ||
    fallback
  );
};

const extractPlayers = (entity) => {
  if (!entity || typeof entity !== "object") return [];
  if (Array.isArray(entity.players) && entity.players.length) {
    return entity.players.filter(Boolean);
  }
  return [entity.player1, entity.player2, entity.p1, entity.p2].filter(Boolean);
};

export const getTournamentTeamName = (
  entity,
  eventType = "double",
  displayMode = "nickname",
  options = {},
) => {
  const { fallback = "—", separator = " & " } = options;
  if (!entity) return fallback;

  const isSingle = String(eventType || "").toLowerCase() === "single";
  const players = extractPlayers(entity);
  const names = players
    .slice(0, isSingle ? 1 : 2)
    .map((player) => getTournamentPlayerName(player, displayMode, ""))
    .filter(Boolean);

  if (names.length) {
    return isSingle ? names[0] : names.join(separator);
  }

  return (
    readText(entity?.teamName, entity?.name, entity?.label, entity?.title) ||
    fallback
  );
};

export const getTournamentPairName = (
  pair,
  eventType = "double",
  displayMode = "nickname",
  options = {},
) => getTournamentTeamName(pair, eventType, displayMode, options);
