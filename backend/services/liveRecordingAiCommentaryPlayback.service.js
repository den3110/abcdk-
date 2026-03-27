function getAppHost() {
  return String(
    process.env.HOST || process.env.FRONTEND_URL || "https://pickletour.vn"
  ).replace(/\/+$/, "");
}

function getPlaybackApiBase() {
  const explicitBase = String(
    process.env.LIVE_RECORDING_PLAYBACK_BASE_URL ||
      process.env.PUBLIC_API_BASE_URL ||
      process.env.API_URL ||
      ""
  ).trim();
  if (explicitBase) {
    return explicitBase.replace(/\/+$/, "");
  }

  return getAppHost();
}

export function buildRecordingAiCommentaryPlaybackUrl(recordingId) {
  return `${getPlaybackApiBase()}/api/live/recordings/v2/${String(
    recordingId
  )}/commentary/play`;
}

export function buildRecordingAiCommentaryRawUrl(recordingId) {
  return `${getPlaybackApiBase()}/api/live/recordings/v2/${String(
    recordingId
  )}/commentary/raw`;
}
