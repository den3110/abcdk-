function asTrimmed(value) {
  return String(value || "").trim();
}

function typeKey(value) {
  return asTrimmed(value).toLowerCase();
}

export function isMatchEndedForRecordingExport(match) {
  if (!match) return false;

  const matchStatus = typeKey(match?.status);
  if (["finished", "ended", "completed", "done"].includes(matchStatus)) {
    return true;
  }
  if (match?.finishedAt || match?.endedAt) return true;

  const live = match?.live && typeof match.live === "object" ? match.live : null;
  const liveStatus = typeKey(live?.status);
  const livePlatforms =
    live?.platforms && typeof live.platforms === "object"
      ? Object.values(live.platforms)
      : [];
  const hasActiveLivePlatform = livePlatforms.some((platform) => platform?.active === true);
  const hasLiveEndSignal =
    Boolean(live?.lastEndAt || live?.endedAt) ||
    livePlatforms.some((platform) => platform?.lastEndAt || platform?.endedAt) ||
    (Array.isArray(live?.sessions) &&
      live.sessions.some((session) => session?.endedAt || session?.endAt));

  if (
    ["idle", "ended", "stopped", "finished"].includes(liveStatus) &&
    hasLiveEndSignal &&
    !hasActiveLivePlatform
  ) {
    return true;
  }

  const facebookLive =
    match?.facebookLive && typeof match.facebookLive === "object"
      ? match.facebookLive
      : null;
  const facebookStatus = typeKey(facebookLive?.status);
  if (
    ["ended", "stopped", "finished"].includes(facebookStatus) ||
    facebookLive?.endedAt
  ) {
    return true;
  }

  return false;
}
