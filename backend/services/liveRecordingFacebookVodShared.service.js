const FACEBOOK_ENDED_STATUSES = new Set(["ENDED", "STOPPED", "FINISHED"]);
const FACEBOOK_VOD_RETRY_WINDOW_MS = 2 * 60 * 60 * 1000;
const FACEBOOK_VOD_RETRY_DELAYS_MS = [
  2 * 60 * 1000,
  5 * 60 * 1000,
  10 * 60 * 1000,
  15 * 60 * 1000,
  20 * 60 * 1000,
  30 * 60 * 1000,
];

export const RECORDING_SOURCE_SEGMENTS = "segments";
export const RECORDING_SOURCE_FACEBOOK_VOD = "facebook_vod";

function asTrimmed(value) {
  return String(value || "").trim();
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
}

export function isFacebookEndedStatus(status) {
  return FACEBOOK_ENDED_STATUSES.has(asTrimmed(status).toUpperCase());
}

export function getFacebookVodRetryWindowMs() {
  return FACEBOOK_VOD_RETRY_WINDOW_MS;
}

export function getFacebookVodRetryDelayMs(attemptNumber = 1) {
  const normalizedAttempt = Math.max(1, Math.floor(Number(attemptNumber) || 1));
  return (
    FACEBOOK_VOD_RETRY_DELAYS_MS[normalizedAttempt - 1] ||
    FACEBOOK_VOD_RETRY_DELAYS_MS[FACEBOOK_VOD_RETRY_DELAYS_MS.length - 1]
  );
}

export function getUploadedRecordingSegments(recording) {
  return [...(recording?.segments || [])]
    .filter((segment) => segment?.uploadStatus === "uploaded")
    .sort((a, b) => a.index - b.index);
}

export function getPendingRecordingSegments(recording) {
  return [...(recording?.segments || [])].filter(
    (segment) => segment?.uploadStatus !== "uploaded"
  );
}

export function hasDriveRecordingOutput(recording) {
  return Boolean(
    recording?.driveFileId || recording?.driveRawUrl || recording?.status === "ready"
  );
}

export function getRecordingSourceMeta(recording) {
  const source = asObject(recording?.meta?.source);
  const type = asTrimmed(source.type).toLowerCase();
  return {
    type:
      type === RECORDING_SOURCE_FACEBOOK_VOD ||
      type === RECORDING_SOURCE_SEGMENTS
        ? type
        : "",
    platform: asTrimmed(source.platform).toLowerCase() || null,
    pageId: asTrimmed(source.pageId) || null,
    videoId: asTrimmed(source.videoId) || null,
  };
}

export function getFacebookLiveIdentifiers(match) {
  const facebookLive =
    match?.facebookLive && typeof match.facebookLive === "object"
      ? match.facebookLive
      : {};

  return {
    videoId:
      asTrimmed(
        facebookLive.videoId || facebookLive.id || facebookLive.liveVideoId
      ) || null,
    pageId: asTrimmed(facebookLive.pageId || facebookLive.page_id) || null,
    pageAccessToken:
      asTrimmed(
        facebookLive.pageAccessToken ||
          facebookLive.pageToken ||
          facebookLive.accessToken ||
          facebookLive.access_token
      ) || null,
    status: asTrimmed(facebookLive.status) || null,
    endedAt: toDateOrNull(facebookLive.endedAt) || null,
    watchUrl:
      asTrimmed(
        facebookLive.watch_url ||
          facebookLive.video_permalink_url ||
          facebookLive.permalink_url
      ) || null,
  };
}

export function buildFacebookVodSourceMeta(match, currentSource = null) {
  const normalizedCurrent = asObject(currentSource);
  const facebook = getFacebookLiveIdentifiers(match);
  return {
    type: RECORDING_SOURCE_FACEBOOK_VOD,
    platform: "facebook",
    pageId:
      asTrimmed(normalizedCurrent.pageId) || asTrimmed(facebook.pageId) || null,
    videoId:
      asTrimmed(normalizedCurrent.videoId) ||
      asTrimmed(facebook.videoId) ||
      null,
  };
}

export function getFacebookVodRetryMeta(recording) {
  const retry = asObject(recording?.meta?.facebookVod);
  return {
    startedAt: toDateOrNull(retry.startedAt),
    deadlineAt: toDateOrNull(retry.deadlineAt),
    attemptCount: Math.max(0, Math.floor(Number(retry.attemptCount) || 0)),
    lastAttemptAt: toDateOrNull(retry.lastAttemptAt),
    nextAttemptAt: toDateOrNull(retry.nextAttemptAt),
    lastError: asTrimmed(retry.lastError) || null,
  };
}

export function buildFacebookVodRetryPlan({
  recording,
  match = null,
  now = new Date(),
} = {}) {
  const safeNow = toDateOrNull(now) || new Date();
  const facebook = getFacebookLiveIdentifiers(match);
  const retryMeta = getFacebookVodRetryMeta(recording);
  const startedAt =
    retryMeta.startedAt ||
    facebook.endedAt ||
    toDateOrNull(recording?.finalizedAt) ||
    toDateOrNull(recording?.createdAt) ||
    safeNow;
  const deadlineAt =
    retryMeta.deadlineAt ||
    new Date(startedAt.getTime() + getFacebookVodRetryWindowMs());
  const nextAttemptNumber = retryMeta.attemptCount + 1;
  const nextDelayMs = getFacebookVodRetryDelayMs(nextAttemptNumber);
  const nextAttemptAt = new Date(
    Math.min(deadlineAt.getTime(), safeNow.getTime() + nextDelayMs)
  );
  const expired = safeNow.getTime() >= deadlineAt.getTime();

  return {
    startedAt,
    deadlineAt,
    attemptCount: retryMeta.attemptCount,
    nextAttemptNumber,
    nextDelayMs,
    nextAttemptAt,
    expired,
  };
}

export function resolveLiveRecordingExportSource(recording, match = null) {
  const uploadedSegments = getUploadedRecordingSegments(recording);
  if (uploadedSegments.length) {
    return {
      type: RECORDING_SOURCE_SEGMENTS,
      uploadedSegments,
      sourceMeta: {
        type: RECORDING_SOURCE_SEGMENTS,
        platform: null,
        pageId: null,
        videoId: null,
      },
      facebook: getFacebookLiveIdentifiers(match),
    };
  }

  const sourceMeta = getRecordingSourceMeta(recording);
  const facebook = getFacebookLiveIdentifiers(match);
  if (
    sourceMeta.type === RECORDING_SOURCE_FACEBOOK_VOD &&
    sourceMeta.videoId
  ) {
    return {
      type: RECORDING_SOURCE_FACEBOOK_VOD,
      uploadedSegments,
      sourceMeta,
      facebook,
    };
  }

  if (!sourceMeta.type && facebook.videoId) {
    return {
      type: RECORDING_SOURCE_FACEBOOK_VOD,
      uploadedSegments,
      sourceMeta: buildFacebookVodSourceMeta(match, sourceMeta),
      facebook,
    };
  }

  return {
    type: null,
    uploadedSegments,
    sourceMeta,
    facebook,
  };
}

export function buildRecordingSourceSummary(recording, match = null) {
  const resolved = resolveLiveRecordingExportSource(recording, match);
  if (resolved.type === RECORDING_SOURCE_FACEBOOK_VOD) {
    const retry = getFacebookVodRetryMeta(recording);
    return {
      type: RECORDING_SOURCE_FACEBOOK_VOD,
      label: "Facebook VOD",
      platform: "facebook",
      pageId: resolved.sourceMeta.pageId || resolved.facebook.pageId || null,
      videoId: resolved.sourceMeta.videoId || resolved.facebook.videoId || null,
      nextAttemptAt: retry.nextAttemptAt,
      deadlineAt: retry.deadlineAt,
      lastError: retry.lastError,
    };
  }

  return {
    type: RECORDING_SOURCE_SEGMENTS,
    label: "Recording segments",
    platform: null,
    pageId: null,
    videoId: null,
    nextAttemptAt: null,
    deadlineAt: null,
    lastError: null,
  };
}
