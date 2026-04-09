import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import {
  buildRecordingLiveHlsObjectKey,
  buildRecordingLiveManifestObjectKey,
  buildRecordingPublicObjectUrl,
  buildRecordingSegmentObjectKey,
  getRecordingPublicBaseUrl,
} from "./liveRecordingV2Storage.service.js";
import {
  buildRecordingPlaybackUrl,
  buildRecordingRawStreamUrl,
} from "./liveRecordingV2Export.service.js";
import {
  buildRecordingAiCommentaryPlaybackUrl,
  buildRecordingAiCommentaryRawUrl,
} from "./liveRecordingAiCommentaryPlayback.service.js";
import {
  getLiveServer2DelaySecondsSync,
  isLiveMultiSourceEnabledSync,
} from "./liveMultiSourceConfig.service.js";

function asTrimmed(value) {
  return String(value || "").trim();
}

function isFacebookUrl(url) {
  const normalized = asTrimmed(url).toLowerCase();
  return normalized.includes("facebook.com") || normalized.includes("fb.watch");
}

export function isLiveMultiSourceEnabled() {
  return isLiveMultiSourceEnabledSync();
}

export function getLiveServer2DelaySeconds() {
  return getLiveServer2DelaySecondsSync();
}

function isFinishedLikeStatus(status) {
  const normalized = asTrimmed(status).toLowerCase();
  return ["finished", "ended", "stopped"].includes(normalized);
}

function buildFacebookPageVideoUrl({ pageId, videoId, liveId }) {
  const normalizedPageId = asTrimmed(pageId);
  const normalizedVideoId = asTrimmed(videoId) || asTrimmed(liveId);
  if (!normalizedPageId || !normalizedVideoId) return "";
  return `https://www.facebook.com/${encodeURIComponent(normalizedPageId)}/videos/${encodeURIComponent(normalizedVideoId)}/`;
}

function buildFacebookLegacyVideoUrl({ videoId, liveId }) {
  const normalizedVideoId = asTrimmed(videoId) || asTrimmed(liveId);
  if (!normalizedVideoId) return "";
  return `https://www.facebook.com/video.php?v=${encodeURIComponent(normalizedVideoId)}`;
}

function buildFacebookPluginEmbedUrl(url) {
  const normalized = asTrimmed(url);
  if (!normalized) return "";
  return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(normalized)}&show_text=false&width=1280`;
}

const PRIVATE_FACEBOOK_LIVE_KEYS = [
  "pageAccessToken",
  "pageToken",
  "accessToken",
  "access_token",
];

export function sanitizePublicFacebookLive(facebookLive) {
  if (
    !facebookLive ||
    typeof facebookLive !== "object" ||
    Array.isArray(facebookLive)
  ) {
    return facebookLive;
  }

  const sanitized = { ...facebookLive };
  for (const key of PRIVATE_FACEBOOK_LIVE_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

export function sanitizePublicMatchPayload(match = {}) {
  if (!match || typeof match !== "object" || Array.isArray(match)) {
    return match;
  }

  return {
    ...match,
    facebookLive: sanitizePublicFacebookLive(match?.facebookLive),
  };
}

function buildFacebookStreamSource(match = {}) {
  const fb = match?.facebookLive || {};
  const metaFb = match?.meta?.facebook || {};
  const finishedLike =
    isFinishedLikeStatus(match?.status) || isFinishedLikeStatus(fb?.status);

  const pageId = asTrimmed(fb?.pageId || metaFb?.pageId);
  const liveId = asTrimmed(fb?.id || metaFb?.liveId);
  const videoId = asTrimmed(fb?.videoId || metaFb?.videoId);
  const rawPermalinkUrl = asTrimmed(
    fb?.raw_permalink_url || fb?.rawPermalinkUrl || metaFb?.rawPermalink
  );
  const videoPermalinkUrl = asTrimmed(
    fb?.video_permalink_url ||
      fb?.videoPermalinkUrl ||
      metaFb?.videoPermalinkUrl ||
      metaFb?.videoPermalink
  );
  const permalinkUrl = asTrimmed(
    fb?.permalink_url || fb?.permalinkUrl || metaFb?.permalinkUrl
  );
  const watchUrl = asTrimmed(
    fb?.watch_url || fb?.watchUrl || metaFb?.watch_url || metaFb?.watchUrl
  );
  const fallbackMatchVideoUrl = isFacebookUrl(match?.video)
    ? asTrimmed(match?.video)
    : "";
  const pageVideoUrl = buildFacebookPageVideoUrl({ pageId, videoId, liveId });
  const legacyVideoUrl = buildFacebookLegacyVideoUrl({ videoId, liveId });
  const embedHtml = asTrimmed(fb?.embed_html || fb?.embedHtml);
  const explicitEmbedUrl = asTrimmed(fb?.embed_url || fb?.embedUrl);

  const openCandidates = finishedLike
    ? [
        videoPermalinkUrl,
        pageVideoUrl,
        rawPermalinkUrl,
        permalinkUrl,
        watchUrl,
        legacyVideoUrl,
        fallbackMatchVideoUrl,
      ]
    : [
        rawPermalinkUrl,
        permalinkUrl,
        pageVideoUrl,
        videoPermalinkUrl,
        watchUrl,
        legacyVideoUrl,
        fallbackMatchVideoUrl,
      ];

  const embedCandidates = finishedLike
    ? [
        videoPermalinkUrl,
        rawPermalinkUrl,
        pageVideoUrl,
        permalinkUrl,
        legacyVideoUrl,
        watchUrl,
        fallbackMatchVideoUrl,
      ]
    : [
        rawPermalinkUrl,
        pageVideoUrl,
        videoPermalinkUrl,
        permalinkUrl,
        legacyVideoUrl,
        watchUrl,
        fallbackMatchVideoUrl,
      ];

  const openUrl = openCandidates.map(asTrimmed).find(Boolean) || "";
  const embedSourceUrl = embedCandidates.map(asTrimmed).find(Boolean) || "";

  return {
    openUrl,
    embedSourceUrl,
    embedHtml,
    embedUrl: explicitEmbedUrl || buildFacebookPluginEmbedUrl(embedSourceUrl),
    watchUrl,
    permalinkUrl,
    rawPermalinkUrl,
    videoPermalinkUrl,
    pageVideoUrl,
    legacyVideoUrl,
  };
}

function selectFacebookOpenUrl(match = {}) {
  return buildFacebookStreamSource(match).openUrl;
}

function parseYouTubeVideoId(match = {}) {
  const direct = asTrimmed(
    match?.meta?.youtube?.videoId || match?.youtubeLive?.id || ""
  );
  if (direct) return direct;

  const watchUrl = asTrimmed(
    match?.meta?.youtube?.watchUrl || match?.youtubeLive?.watch_url || ""
  );
  if (!watchUrl) return "";

  try {
    const url = new URL(watchUrl);
    if (url.hostname.includes("youtu.be")) {
      return asTrimmed(url.pathname.split("/").filter(Boolean)[0]);
    }
    return asTrimmed(url.searchParams.get("v"));
  } catch {
    const matched =
      watchUrl.match(/[?&]v=([^&]+)/i) ||
      watchUrl.match(/youtu\.be\/([^?&/]+)/i);
    return asTrimmed(matched?.[1] || "");
  }
}

function selectYouTubeWatchUrl(match = {}) {
  const direct = asTrimmed(
    match?.meta?.youtube?.watchUrl || match?.youtubeLive?.watch_url || ""
  );
  if (direct) return direct;

  const videoId = parseYouTubeVideoId(match);
  return videoId
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    : "";
}

function buildYouTubeEmbedUrl(match = {}) {
  const videoId = parseYouTubeVideoId(match);
  return videoId
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`
    : "";
}

function selectTikTokWatchUrl(match = {}) {
  const tiktok = match?.meta?.tiktok || {};
  const tiktokLive = match?.tiktokLive || {};
  const direct = asTrimmed(
    tiktok?.watchUrl || tiktokLive?.room_url || tiktok?.url || ""
  );
  if (direct) return direct;

  const username = asTrimmed(tiktok?.username || tiktokLive?.username || "");
  return username ? `https://www.tiktok.com/@${username}/live` : "";
}

function selectRtmpPublicUrl(match = {}) {
  const rtmp = match?.meta?.rtmp || {};
  return asTrimmed(rtmp?.publicUrl || rtmp?.viewUrl || rtmp?.url || "");
}

function pushUniqueStream(streams, candidate) {
  if (!candidate) return;
  const candidatePlayUrl = asTrimmed(candidate?.playUrl);
  const candidateOpenUrl = asTrimmed(candidate?.openUrl);
  const duplicate = streams.some((stream) => {
    const playUrl = asTrimmed(stream?.playUrl);
    const openUrl = asTrimmed(stream?.openUrl);
    return (
      (candidatePlayUrl &&
        (candidatePlayUrl === playUrl || candidatePlayUrl === openUrl)) ||
      (candidateOpenUrl &&
        (candidateOpenUrl === playUrl || candidateOpenUrl === openUrl))
    );
  });
  if (!duplicate) {
    streams.push(candidate);
  }
}

function detectLegacyKind(url) {
  const normalized = asTrimmed(url).toLowerCase();
  if (!normalized) return "";
  if (isFacebookUrl(normalized)) return "facebook";
  if (normalized.includes(".m3u8")) return "hls";
  if (/\.(mp4|webm|ogv?)(\?|$)/i.test(normalized)) return "file";
  if (
    /\/api\/live\/recordings\/v2\/[^/]+\/(?:play|raw)(?:\?|$)/i.test(normalized)
  ) {
    return "file";
  }
  return "iframe";
}

function isTemporaryRecordingPlaybackUrl(url) {
  const normalized = asTrimmed(url);
  if (!normalized) return false;
  return /\/api\/live\/recordings\/v2\/[^/]+\/temp(?:\/playlist)?(?:\?|$)/i.test(
    normalized
  );
}

function extractInternalRecordingRoute(url) {
  const normalized = asTrimmed(url);
  if (!normalized) return null;
  const match = normalized.match(
    /\/api\/live\/recordings\/v2\/([^/?#]+)\/(play|raw|temp)(?:\/playlist)?(?:\?|$)/i
  );
  if (!match) return null;
  return {
    recordingId: asTrimmed(match[1]),
    variant: asTrimmed(match[2]).toLowerCase(),
  };
}

function selectLegacyPlaybackUrl(match = {}) {
  return [match?.video, match?.playbackUrl, match?.streamUrl, match?.liveUrl]
    .map(asTrimmed)
    .find((url) => url && !isTemporaryRecordingPlaybackUrl(url));
}

function normalizeUploadedSegments(recording) {
  return [...(recording?.segments || [])]
    .filter((segment) => segment?.uploadStatus === "uploaded")
    .sort((a, b) => Number(a?.index || 0) - Number(b?.index || 0));
}

function sumUploadedDurationSeconds(recording) {
  return normalizeUploadedSegments(recording).reduce(
    (sum, segment) => sum + Math.max(0, Number(segment?.durationSeconds || 0)),
    0
  );
}

function getServer2RefreshSeconds(recording, { isFinal = false } = {}) {
  if (isFinal) return 0;
  const recentDurations = normalizeUploadedSegments(recording)
    .slice(-6)
    .map((segment) => Number(segment?.durationSeconds || 0))
    .filter((duration) => Number.isFinite(duration) && duration > 0);
  if (!recentDurations.length) {
    return 4;
  }
  const averageDuration =
    recentDurations.reduce((sum, duration) => sum + duration, 0) /
    recentDurations.length;
  return Math.max(2, Math.min(6, Math.round(averageDuration)));
}

function buildRecordingTargetPublicBaseUrls(recording) {
  const targetIds = new Set();
  const recordTargetId = asTrimmed(recording?.r2TargetId);
  if (recordTargetId) {
    targetIds.add(recordTargetId);
  }

  for (const segment of recording?.segments || []) {
    const storageTargetId = asTrimmed(segment?.storageTargetId);
    if (storageTargetId) {
      targetIds.add(storageTargetId);
    }
  }

  const targetPublicBaseUrls = {};
  for (const targetId of targetIds) {
    try {
      const baseUrl = asTrimmed(getRecordingPublicBaseUrl(targetId));
      if (baseUrl) {
        targetPublicBaseUrls[targetId] = baseUrl;
      }
    } catch {
      // Ignore target ids that are no longer configured.
    }
  }

  return targetPublicBaseUrls;
}

function pickFinalServer2Url(recording) {
  const hasRawStream = Boolean(
    recording?.driveFileId || recording?.driveRawUrl
  );
  if (hasRawStream && recording?._id) {
    return buildRecordingRawStreamUrl(recording._id);
  }
  const driveRawUrl = asTrimmed(recording?.driveRawUrl);
  const drivePreviewUrl = asTrimmed(recording?.drivePreviewUrl);
  const playbackUrl = asTrimmed(recording?.playbackUrl);
  if (driveRawUrl) return driveRawUrl;
  if (drivePreviewUrl) return drivePreviewUrl;
  if (playbackUrl) return playbackUrl;
  if (recording?._id) return buildRecordingPlaybackUrl(recording._id);
  return "";
}

function buildCompletedReplayStream(match = {}, recording = null) {
  const recordingId = asTrimmed(recording?._id);
  const hasDriveReady = Boolean(recording?.driveFileId || recording?.driveRawUrl);
  if (recordingId && hasDriveReady) {
    const internalRawUrl = buildRecordingRawStreamUrl(recordingId);
    const internalPlaybackUrl = buildRecordingPlaybackUrl(recordingId);
    return {
      key: "full_video",
      displayLabel: "Video đầy đủ",
      providerLabel: "PickleTour Drive",
      kind: "file",
      priority: 0,
      status: "ready",
      playUrl: internalRawUrl,
      openUrl: internalPlaybackUrl,
      delaySeconds: 0,
      ready: true,
      meta: {
        recordingId,
        useNativeControls: true,
        isCompleteVideo: true,
        playbackUrl: internalPlaybackUrl,
        rawUrl: internalRawUrl,
      },
    };
  }

  const legacyPlaybackUrl = selectLegacyPlaybackUrl(match);
  if (!legacyPlaybackUrl) return null;

  const kind = detectLegacyKind(legacyPlaybackUrl);
  if (kind !== "file") return null;

  return {
    key: "full_video",
    displayLabel: "Video đầy đủ",
    providerLabel: "Replay",
    kind: "file",
    priority: 0,
    status: "ready",
    playUrl: legacyPlaybackUrl,
    openUrl: legacyPlaybackUrl,
    delaySeconds: 0,
    ready: true,
    meta: {
      useNativeControls: true,
      isCompleteVideo: true,
      playbackUrl: legacyPlaybackUrl,
      rawUrl: legacyPlaybackUrl,
    },
  };
}

function buildRecordingAiCommentaryState(recording) {
  const ai = recording?.aiCommentary || {};
  const hasDriveReady = Boolean(
    asTrimmed(ai?.dubbedDriveFileId) || asTrimmed(ai?.dubbedDriveRawUrl)
  );
  const finalPlaybackUrl =
    asTrimmed(ai?.dubbedPlaybackUrl) ||
    (recording?._id &&
    hasDriveReady
      ? buildRecordingAiCommentaryPlaybackUrl(recording._id)
      : "");
  const rawUrl =
    (recording?._id && hasDriveReady
      ? buildRecordingAiCommentaryRawUrl(recording._id)
      : "") || asTrimmed(ai?.dubbedDriveRawUrl);
  const previewUrl = asTrimmed(ai?.dubbedDrivePreviewUrl);
  const ready = Boolean(
    asTrimmed(ai?.dubbedDriveFileId) || rawUrl || finalPlaybackUrl || previewUrl
  );

  if (!ready) return null;

  return {
    key: "ai_commentary",
    displayLabel: "BLV AI",
    providerLabel: "AI Commentary",
    finalPlaybackUrl: finalPlaybackUrl || null,
    rawUrl: rawUrl || null,
    previewUrl: previewUrl || null,
    ready: true,
    status: "ready",
  };
}

export function buildRecordingServer2State(recording) {
  if (!recording) return null;

  const matchId = asTrimmed(recording?.match);
  const recordingId = asTrimmed(recording?._id);
  if (!matchId || !recordingId) return null;

  const multiSourceEnabled = isLiveMultiSourceEnabled();
  const delaySeconds = getLiveServer2DelaySeconds();
  const sourceCleanupCompleted =
    asTrimmed(recording?.meta?.sourceCleanup?.status).toLowerCase() ===
    "completed";
  const manifestObjectKey =
    asTrimmed(recording?.meta?.livePlayback?.manifestObjectKey) ||
    buildRecordingLiveManifestObjectKey({
      recordingId,
      matchId,
    });
  const hlsManifestObjectKey =
    asTrimmed(recording?.meta?.livePlayback?.hlsManifestObjectKey) ||
    buildRecordingLiveHlsObjectKey({
      recordingId,
      matchId,
    });
  let manifestUrl = "";
  let hlsManifestUrl = "";
  let publicBaseUrl = "";
  const targetPublicBaseUrls = multiSourceEnabled
    ? buildRecordingTargetPublicBaseUrls(recording)
    : {};
  if (multiSourceEnabled && !sourceCleanupCompleted) {
    manifestUrl = asTrimmed(recording?.meta?.livePlayback?.manifestUrl);
    hlsManifestUrl = asTrimmed(recording?.meta?.livePlayback?.hlsManifestUrl);
    publicBaseUrl = asTrimmed(recording?.meta?.livePlayback?.publicBaseUrl);
    try {
      if (!manifestUrl) {
        manifestUrl = asTrimmed(
          buildRecordingPublicObjectUrl({
            objectKey: manifestObjectKey,
            storageTargetId: recording?.r2TargetId,
          })
        );
      }
      if (!hlsManifestUrl) {
        hlsManifestUrl = asTrimmed(
          buildRecordingPublicObjectUrl({
            objectKey: hlsManifestObjectKey,
            storageTargetId: recording?.r2TargetId,
          })
        );
      }
      if (!publicBaseUrl) {
        publicBaseUrl = asTrimmed(
          buildRecordingPublicObjectUrl({
            objectKey: "_",
            storageTargetId: recording?.r2TargetId,
          })
        )
          .replace(/\/_$/, "")
          .replace(/\/+$/, "");
      }
    } catch {
      manifestUrl = manifestUrl || "";
      hlsManifestUrl = hlsManifestUrl || "";
      publicBaseUrl = publicBaseUrl || "";
    }
  }

  const candidateFinalPlaybackUrl =
    asTrimmed(recording?.meta?.livePlayback?.finalPlaybackUrl) ||
    pickFinalServer2Url(recording);
  const uploadedSegments = normalizeUploadedSegments(recording);
  const uploadedDurationSeconds = sumUploadedDurationSeconds(recording);
  const delayedReady =
    multiSourceEnabled &&
    !sourceCleanupCompleted &&
    Boolean(manifestUrl || hlsManifestUrl) &&
    uploadedSegments.length > 0 &&
    uploadedDurationSeconds >= delaySeconds;
  const finalReady =
    Boolean(candidateFinalPlaybackUrl) &&
    (recording?.status === "ready" ||
      Boolean(recording?.driveFileId) ||
      Boolean(recording?.driveRawUrl) ||
      Boolean(recording?.drivePreviewUrl));
  const finalPlaybackUrl = finalReady ? candidateFinalPlaybackUrl : "";

  if (!finalReady && !multiSourceEnabled) {
    return null;
  }

  const effectiveDelaySeconds = finalReady ? 0 : delaySeconds;
  let status = "pending";
  let ready = false;
  if (finalReady) {
    status = "final";
    ready = true;
  } else if (delayedReady) {
    status = "ready";
    ready = true;
  } else if (multiSourceEnabled && uploadedSegments.length > 0) {
    status = "preparing";
  }

  return {
    providerLabel: finalReady ? "PickleTour Video" : "PickleTour CDN",
    key: "server2",
    displayLabel: "Server 2",
    manifestObjectKey,
    manifestUrl: manifestUrl || null,
    hlsManifestObjectKey,
    hlsManifestUrl: hlsManifestUrl || null,
    publicBaseUrl: publicBaseUrl || null,
    targetPublicBaseUrls:
      Object.keys(targetPublicBaseUrls).length > 0 ? targetPublicBaseUrls : null,
    finalPlaybackUrl: finalPlaybackUrl || null,
    delaySeconds: effectiveDelaySeconds,
    uploadedDurationSeconds,
    uploadedSegmentCount: uploadedSegments.length,
    ready,
    status,
    sourceCleanupCompleted,
    disabledReason:
      !ready && multiSourceEnabled && !finalReady
        ? "Dang chuan bi luong tre tu PickleTour CDN."
        : null,
  };
}

export function buildRecordingLivePlayback(recording) {
  const state = buildRecordingServer2State(recording);
  if (!state) return null;
  if (
    !state.finalPlaybackUrl &&
    (!state.publicBaseUrl || (!state.manifestUrl && !state.hlsManifestUrl))
  ) {
    return null;
  }
  return {
    enabled: true,
    key: state.key,
    providerLabel: state.providerLabel,
    manifestObjectKey: state.manifestObjectKey,
    manifestUrl: state.manifestUrl,
    hlsManifestObjectKey: state.hlsManifestObjectKey,
    hlsManifestUrl: state.hlsManifestUrl,
    publicBaseUrl: state.publicBaseUrl,
    targetPublicBaseUrls: state.targetPublicBaseUrls,
    finalPlaybackUrl: state.finalPlaybackUrl,
    delaySeconds: state.delaySeconds,
    uploadedDurationSeconds: state.uploadedDurationSeconds,
    uploadedSegmentCount: state.uploadedSegmentCount,
    ready: state.ready,
    status: state.status,
    disabledReason: state.disabledReason,
  };
}

export function buildPublicStreamsForMatch(match = {}, recording = null) {
  const streams = [];
  const finishedLike =
    isFinishedLikeStatus(match?.status) ||
    isFinishedLikeStatus(match?.facebookLive?.status);
  const server2 = buildRecordingServer2State(recording);
  const completedReplayStream = finishedLike
    ? buildCompletedReplayStream(match, recording)
    : null;

  if (completedReplayStream) {
    pushUniqueStream(streams, completedReplayStream);
  }

  const facebookStream = buildFacebookStreamSource(match);
  const facebookOpenUrl = facebookStream.openUrl;
  const facebookPlayUrl =
    facebookStream.embedSourceUrl || facebookOpenUrl || "";
  const shouldUseFacebookFallback =
    Boolean(facebookOpenUrl || facebookPlayUrl) && (!finishedLike || !completedReplayStream);
  if (shouldUseFacebookFallback) {
    pushUniqueStream(streams, {
      key: "server1",
      displayLabel: "Server 1",
      providerLabel: "Facebook",
      kind: facebookStream.embedHtml ? "iframe_html" : "facebook",
      priority: 1,
      status: "ready",
      playUrl: facebookPlayUrl,
      openUrl: facebookOpenUrl || facebookPlayUrl,
      embedHtml: facebookStream.embedHtml || "",
      embedUrl: facebookStream.embedUrl || "",
      allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
      delaySeconds: 0,
      ready: true,
      meta: {
        watchUrl: facebookStream.watchUrl,
        permalinkUrl: facebookStream.permalinkUrl,
        rawPermalinkUrl: facebookStream.rawPermalinkUrl,
        videoPermalinkUrl: facebookStream.videoPermalinkUrl,
        pageVideoUrl: facebookStream.pageVideoUrl,
        legacyVideoUrl: facebookStream.legacyVideoUrl,
      },
    });
  }

  const shouldRenderServer2 = Boolean(
    server2 &&
      !finishedLike &&
      (server2.manifestUrl || server2.hlsManifestUrl || server2.finalPlaybackUrl)
  );

  if (shouldRenderServer2) {
    const hasSegmentManifest =
      Boolean(server2.manifestUrl || server2.hlsManifestUrl) &&
      server2.uploadedSegmentCount > 0;
    const hlsUrl =
      !server2.sourceCleanupCompleted && server2.hlsManifestUrl
        ? server2.hlsManifestUrl
        : "";
    const useFileMode =
      Boolean(server2.finalPlaybackUrl) &&
      (server2.status === "final" ||
        server2.sourceCleanupCompleted ||
        !hasSegmentManifest);
    const useHlsMode = !useFileMode && Boolean(hlsUrl);
    const playbackKind = useFileMode
      ? "file"
      : useHlsMode
        ? "hls"
        : "delayed_manifest";
    const playbackUrl = useFileMode
      ? server2.finalPlaybackUrl
      : useHlsMode
        ? hlsUrl
        : server2.manifestUrl;

    pushUniqueStream(streams, {
      key: server2.key,
      displayLabel: server2.displayLabel,
      providerLabel: server2.providerLabel,
      kind: playbackKind,
      priority: 2,
      status: server2.status,
      playUrl: playbackUrl,
      openUrl: server2.finalPlaybackUrl || hlsUrl || server2.manifestUrl || null,
      delaySeconds: server2.delaySeconds,
      ready: server2.ready,
      disabledReason: server2.disabledReason,
      meta: {
        recordingId: String(recording?._id || "") || null,
        manifestUrl: server2.manifestUrl,
        manifestObjectKey: server2.manifestObjectKey,
        finalPlaybackUrl: server2.finalPlaybackUrl,
        publicBaseUrl: server2.publicBaseUrl,
        targetPublicBaseUrls: server2.targetPublicBaseUrls,
        // Backward-compatible fallback CDN path down to /segments/ directory.
        segmentBaseUrl: recording?._id && recording?.match
          ? (() => {
              const segKey = buildRecordingSegmentObjectKey({
                recordingId: recording._id,
                matchId: recording.match,
                segmentIndex: 0,
              });
              // segKey = 'recordings/v2/matches/{mid}/{rid}/segments/segment_00000.mp4'
              // Strip the filename to get the directory
              const segDir = segKey.replace(/\/[^/]+$/, "");
              return buildRecordingPublicObjectUrl({
                objectKey: segDir,
                storageTargetId: recording.r2TargetId,
              }) || null;
            })()
          : null,
        uploadedDurationSeconds: server2.uploadedDurationSeconds,
        uploadedSegmentCount: server2.uploadedSegmentCount,
        showLiveBadge: !finishedLike,
        status: server2.status,
        refreshSeconds: getServer2RefreshSeconds(recording, {
          isFinal: server2.status === "final",
        }),
        hlsUrl: hlsUrl || null,
        delayedManifestUrl: server2.manifestUrl || null,
      },
    });
  }

  const aiCommentary = buildRecordingAiCommentaryState(recording);
  if (aiCommentary && (aiCommentary.finalPlaybackUrl || aiCommentary.rawUrl)) {
    pushUniqueStream(streams, {
      key: aiCommentary.key,
      displayLabel: aiCommentary.displayLabel,
      providerLabel: aiCommentary.providerLabel,
      kind: "file",
      priority: 3,
      status: aiCommentary.status,
      playUrl: aiCommentary.finalPlaybackUrl || aiCommentary.rawUrl,
      openUrl:
        aiCommentary.previewUrl ||
        aiCommentary.rawUrl ||
        aiCommentary.finalPlaybackUrl ||
        null,
      delaySeconds: 0,
      ready: aiCommentary.ready,
      meta: {
        previewUrl: aiCommentary.previewUrl,
        rawUrl: aiCommentary.rawUrl,
        finalPlaybackUrl: aiCommentary.finalPlaybackUrl,
      },
    });
  }

  const legacyPlaybackUrl = selectLegacyPlaybackUrl(match);
  if (legacyPlaybackUrl) {
    const normalizedLegacyUrl = legacyPlaybackUrl.trim();
    const legacyRecordingRoute =
      extractInternalRecordingRoute(normalizedLegacyUrl);
    const shouldIgnoreLegacyInternalPlayback =
      asTrimmed(match?.status).toLowerCase() === "live" &&
      Boolean(legacyRecordingRoute) &&
      ["raw", "play"].includes(legacyRecordingRoute.variant);
    const duplicate = streams.some((stream) => {
      const streamPlayUrl = asTrimmed(stream?.playUrl);
      const streamOpenUrl = asTrimmed(stream?.openUrl);
      if (
        streamPlayUrl === normalizedLegacyUrl ||
        streamOpenUrl === normalizedLegacyUrl
      ) {
        return true;
      }

      if (!legacyRecordingRoute) return false;

      const streamRoute =
        extractInternalRecordingRoute(streamPlayUrl) ||
        extractInternalRecordingRoute(streamOpenUrl);

      return (
        Boolean(streamRoute?.recordingId) &&
        streamRoute.recordingId === legacyRecordingRoute.recordingId
      );
    });

    if (!duplicate && !shouldIgnoreLegacyInternalPlayback) {
      const kind = detectLegacyKind(normalizedLegacyUrl);
      if (kind === "facebook") {
        pushUniqueStream(streams, {
          key: "server1",
          displayLabel: "Server 1",
          providerLabel: "Facebook",
          kind: "facebook",
          priority: 1,
          status: "ready",
          playUrl: normalizedLegacyUrl,
          openUrl: normalizedLegacyUrl,
          delaySeconds: 0,
          ready: true,
        });
      } else {
        const hasPrimaryReplay = streams.some(
          (stream) => stream.key === "server2" || stream.key === "full_video",
        );
        pushUniqueStream(streams, {
          key: hasPrimaryReplay ? "legacy_video" : "full_video",
          displayLabel: hasPrimaryReplay ? "Video" : "Video đầy đủ",
          providerLabel: hasPrimaryReplay ? "Video" : "Replay",
          kind: kind || "iframe",
          priority: hasPrimaryReplay ? 3 : 0,
          status: "ready",
          playUrl: normalizedLegacyUrl,
          openUrl: normalizedLegacyUrl,
          delaySeconds: 0,
          ready: true,
          meta: {
            useNativeControls: kind === "file",
            isCompleteVideo: kind === "file",
          },
        });
      }
    }
  }

  const youtubeWatchUrl = selectYouTubeWatchUrl(match);
  if (youtubeWatchUrl) {
    pushUniqueStream(streams, {
      key: "youtube",
      displayLabel: "YouTube",
      providerLabel: "YouTube",
      kind: "iframe",
      priority: 3,
      status: "ready",
      playUrl: buildYouTubeEmbedUrl(match) || youtubeWatchUrl,
      openUrl: youtubeWatchUrl,
      delaySeconds: 0,
      ready: true,
    });
  }

  const tiktokWatchUrl = selectTikTokWatchUrl(match);
  if (tiktokWatchUrl) {
    pushUniqueStream(streams, {
      key: "tiktok",
      displayLabel: "TikTok",
      providerLabel: "TikTok",
      kind: "iframe",
      priority: 4,
      status: "ready",
      playUrl: tiktokWatchUrl,
      openUrl: tiktokWatchUrl,
      delaySeconds: 0,
      ready: true,
    });
  }

  const rtmpPublicUrl = selectRtmpPublicUrl(match);
  if (rtmpPublicUrl) {
    pushUniqueStream(streams, {
      key: "rtmp",
      displayLabel: "RTMP",
      providerLabel: "RTMP",
      kind: detectLegacyKind(rtmpPublicUrl) || "iframe",
      priority: 5,
      status: "ready",
      playUrl: rtmpPublicUrl,
      openUrl: rtmpPublicUrl,
      delaySeconds: 0,
      ready: true,
    });
  }

  const status = asTrimmed(match?.status).toLowerCase();
  const facebookStatus = asTrimmed(match?.facebookLive?.status).toLowerCase();
  const shouldPreferReplayVideo =
    isFinishedLikeStatus(status) || isFinishedLikeStatus(facebookStatus);
  let defaultStreamKey = streams[0]?.key || null;
  if (status === "live") {
    defaultStreamKey =
      streams.find((stream) => stream.key === "server1" && stream.ready)?.key ||
      streams.find((stream) => stream.key === "server2")?.key ||
      defaultStreamKey;
  }
  if (shouldPreferReplayVideo) {
    defaultStreamKey =
      streams.find((stream) => stream.key === "full_video" && stream.ready)?.key ||
      streams.find((stream) => stream.key === "server1")?.key ||
      defaultStreamKey;
  }

  return {
    streams,
    defaultStreamKey,
    hasMultipleStreams: streams.length > 1,
  };
}

export function attachPublicStreamsToMatch(match = {}, recording = null) {
  const { streams, defaultStreamKey, hasMultipleStreams } =
    buildPublicStreamsForMatch(match, recording);
  const sanitizedMatch = sanitizePublicMatchPayload(match);
  const existingStreams = Array.isArray(sanitizedMatch?.streams)
    ? sanitizedMatch.streams
    : [];
  const effectiveStreams = streams.length > 0 ? streams : existingStreams;

  return {
    ...sanitizedMatch,
    streams: effectiveStreams,
    defaultStreamKey:
      streams.length > 0
        ? defaultStreamKey
        : sanitizedMatch?.defaultStreamKey || effectiveStreams[0]?.key || null,
    hasMultipleStreams:
      streams.length > 0 ? hasMultipleStreams : effectiveStreams.length > 1,
  };
}

function normalizeMatchRecordingRefs(matchRefs = []) {
  const matchMetaById = new Map();
  const matchIds = [];

  for (const ref of Array.isArray(matchRefs) ? matchRefs : []) {
    if (!ref) continue;

    const matchId =
      typeof ref === "string"
        ? asTrimmed(ref)
        : asTrimmed(ref?._id || ref?.id || "");
    if (!matchId) continue;

    matchIds.push(matchId);

    if (ref && typeof ref === "object" && !Array.isArray(ref)) {
      matchMetaById.set(matchId, {
        status: asTrimmed(ref?.status).toLowerCase(),
      });
    }
  }

  return {
    normalizedMatchIds: [...new Set(matchIds)],
    matchMetaById,
  };
}

function hasLiveManifestCandidate(recording) {
  const sourceCleanupCompleted =
    asTrimmed(recording?.meta?.sourceCleanup?.status).toLowerCase() ===
    "completed";
  if (sourceCleanupCompleted) return false;

  const uploadedSegmentCount = normalizeUploadedSegments(recording).length;
  const manifestUrl = asTrimmed(recording?.meta?.livePlayback?.manifestUrl);
  const manifestObjectKey = asTrimmed(
    recording?.meta?.livePlayback?.manifestObjectKey
  );
  const hlsManifestUrl = asTrimmed(recording?.meta?.livePlayback?.hlsManifestUrl);
  const hlsManifestObjectKey = asTrimmed(
    recording?.meta?.livePlayback?.hlsManifestObjectKey
  );

  return Boolean(
    uploadedSegmentCount > 0 &&
      (
        manifestUrl ||
        manifestObjectKey ||
        hlsManifestUrl ||
        hlsManifestObjectKey ||
        asTrimmed(recording?.r2TargetId)
      )
  );
}

function isActiveLiveRecordingCandidate(recording) {
  const status = asTrimmed(recording?.status).toLowerCase();
  if (
    ["recording", "uploading", "pending_export_window", "exporting"].includes(
      status
    )
  ) {
    return true;
  }

  const hasRawOrFinal = Boolean(
    recording?.driveFileId ||
      recording?.driveRawUrl ||
      recording?.drivePreviewUrl ||
      recording?.playbackUrl
  );

  return status === "ready" && hasLiveManifestCandidate(recording) && !hasRawOrFinal;
}

export async function getLatestRecordingsByMatchIds(matchRefs = []) {
  const { normalizedMatchIds, matchMetaById } =
    normalizeMatchRecordingRefs(matchRefs);
  if (!normalizedMatchIds.length) return new Map();

  const recordings = await LiveRecordingV2.find({
    match: { $in: normalizedMatchIds },
  })
    .select(
      [
        "_id",
        "match",
        "status",
        "r2TargetId",
        "driveFileId",
        "driveRawUrl",
        "drivePreviewUrl",
        "playbackUrl",
        "aiCommentary.status",
        "aiCommentary.latestJobId",
        "aiCommentary.sourceFingerprint",
        "aiCommentary.dubbedDriveFileId",
        "aiCommentary.dubbedDriveRawUrl",
        "aiCommentary.dubbedDrivePreviewUrl",
        "aiCommentary.dubbedPlaybackUrl",
        "segments.index",
        "segments.uploadStatus",
        "segments.durationSeconds",
        "segments.objectKey",
        "meta.livePlayback",
        "createdAt",
      ].join(" ")
    )
    .lean();

  const recordingRank = (recording, { preferActiveLive = false } = {}) => {
    const status = asTrimmed(recording?.status).toLowerCase();
    const hasRaw = Boolean(recording?.driveFileId || recording?.driveRawUrl);
    const hasPlayable = Boolean(
      hasRaw ||
        recording?.drivePreviewUrl ||
        recording?.playbackUrl ||
        recording?._id
    );
    const hasLiveManifest = hasLiveManifestCandidate(recording);

    if (preferActiveLive) {
      if (status === "recording") return 700;
      if (status === "uploading") return 650;
      if (status === "pending_export_window") return 600;
      if (status === "exporting") return 550;
      if (hasLiveManifest) return 500;
      if (status === "ready" && hasPlayable) return 300;
      if (status === "ready") return 250;
      if (hasRaw) return 200;
      return 100;
    }

    if (hasRaw) return 500;
    if (status === "ready" && hasPlayable) return 450;
    if (status === "ready") return 400;
    if (status === "exporting") return 300;
    if (status === "pending_export_window") return 250;
    if (status === "uploading") return 200;
    if (status === "recording") return 150;
    return 100;
  };

  const groupedByMatchId = new Map();
  for (const recording of recordings) {
    const matchId = asTrimmed(recording?.match);
    if (!matchId) continue;
    const list = groupedByMatchId.get(matchId) || [];
    list.push(recording);
    groupedByMatchId.set(matchId, list);
  }

  const byMatchId = new Map();
  for (const matchId of normalizedMatchIds) {
    const matchRecordings = groupedByMatchId.get(matchId) || [];
    if (!matchRecordings.length) continue;

    const matchStatus = matchMetaById.get(matchId)?.status || "";
    const preferActiveLive = matchStatus === "live";
    const activeCandidates = preferActiveLive
      ? matchRecordings.filter(isActiveLiveRecordingCandidate)
      : [];
    const candidatePool = activeCandidates.length
      ? activeCandidates
      : matchRecordings;

    candidatePool.sort((a, b) => {
      const rankCmp =
        recordingRank(b, { preferActiveLive }) -
        recordingRank(a, { preferActiveLive });
      if (rankCmp !== 0) return rankCmp;

      return (
        new Date(b?.createdAt || 0).getTime() -
        new Date(a?.createdAt || 0).getTime()
      );
    });

    byMatchId.set(matchId, candidatePool[0]);
  }
  return byMatchId;
}
