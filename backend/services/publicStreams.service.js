import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import {
  buildRecordingLiveManifestObjectKey,
  buildRecordingPublicObjectUrl,
} from "./liveRecordingV2Storage.service.js";
import {
  buildRecordingPlaybackUrl,
  buildRecordingRawStreamUrl,
} from "./liveRecordingV2Export.service.js";
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

function selectFacebookOpenUrl(match = {}) {
  const fb = match?.facebookLive || {};
  const finishedLike =
    isFinishedLikeStatus(match?.status) || isFinishedLikeStatus(fb?.status);

  const orderedUrls = finishedLike
    ? [
        fb.video_permalink_url,
        fb.watch_url,
        fb.permalink_url,
        fb.raw_permalink_url,
        fb.embed_url,
      ]
    : [
        fb.watch_url,
        fb.permalink_url,
        fb.video_permalink_url,
        fb.raw_permalink_url,
        fb.embed_url,
      ];

  return orderedUrls.map(asTrimmed).find(Boolean) || "";
}

function detectLegacyKind(url) {
  const normalized = asTrimmed(url).toLowerCase();
  if (!normalized) return "";
  if (isFacebookUrl(normalized)) return "facebook";
  if (normalized.includes(".m3u8")) return "hls";
  if (/\.(mp4|webm|ogv?)(\?|$)/i.test(normalized)) return "file";
  if (/\/api\/live\/recordings\/v2\/[^/]+\/(?:play|raw)(?:\?|$)/i.test(normalized)) {
    return "file";
  }
  return "iframe";
}

function selectLegacyPlaybackUrl(match = {}) {
  return [
    match?.video,
    match?.playbackUrl,
    match?.streamUrl,
    match?.liveUrl,
  ]
    .map(asTrimmed)
    .find(Boolean);
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

function pickFinalServer2Url(recording) {
  const hasRawStream = Boolean(recording?.driveFileId || recording?.driveRawUrl);
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

export function buildRecordingServer2State(recording) {
  if (!recording) return null;

  const matchId = asTrimmed(recording?.match);
  const recordingId = asTrimmed(recording?._id);
  if (!matchId || !recordingId) return null;

  const multiSourceEnabled = isLiveMultiSourceEnabled();
  const delaySeconds = getLiveServer2DelaySeconds();
  const manifestObjectKey =
    asTrimmed(recording?.meta?.livePlayback?.manifestObjectKey) ||
    buildRecordingLiveManifestObjectKey({
      recordingId,
      matchId,
    });
  let manifestUrl = "";
  let publicBaseUrl = "";
  if (multiSourceEnabled) {
    manifestUrl = asTrimmed(recording?.meta?.livePlayback?.manifestUrl);
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
      publicBaseUrl = publicBaseUrl || "";
    }
  }

  const finalPlaybackUrl =
    asTrimmed(recording?.meta?.livePlayback?.finalPlaybackUrl) ||
    pickFinalServer2Url(recording);
  const uploadedSegments = normalizeUploadedSegments(recording);
  const uploadedDurationSeconds = sumUploadedDurationSeconds(recording);
  const delayedReady =
    multiSourceEnabled &&
    Boolean(manifestUrl) &&
    uploadedSegments.length > 0 &&
    uploadedDurationSeconds >= delaySeconds;
  const finalReady =
    Boolean(finalPlaybackUrl) &&
    (recording?.status === "ready" ||
      Boolean(recording?.driveFileId) ||
      Boolean(recording?.driveRawUrl) ||
      Boolean(recording?.drivePreviewUrl));

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
    publicBaseUrl: publicBaseUrl || null,
    finalPlaybackUrl: finalPlaybackUrl || null,
    delaySeconds: effectiveDelaySeconds,
    uploadedDurationSeconds,
    uploadedSegmentCount: uploadedSegments.length,
    ready,
    status,
    disabledReason: !ready && multiSourceEnabled && !finalReady
      ? "Dang chuan bi luong tre tu PickleTour CDN."
      : null,
  };
}

export function buildRecordingLivePlayback(recording) {
  const state = buildRecordingServer2State(recording);
  if (!state) return null;
  if (!state.finalPlaybackUrl && (!state.manifestUrl || !state.publicBaseUrl)) {
    return null;
  }
  return {
    enabled: true,
    key: state.key,
    providerLabel: state.providerLabel,
    manifestObjectKey: state.manifestObjectKey,
    manifestUrl: state.manifestUrl,
    publicBaseUrl: state.publicBaseUrl,
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
  const facebookOpenUrl = selectFacebookOpenUrl(match);
  if (facebookOpenUrl && !(finishedLike && server2?.ready)) {
    streams.push({
      key: "server1",
      displayLabel: "Server 1",
      providerLabel: "Facebook",
      kind: "facebook",
      priority: 1,
      status: "ready",
      playUrl: facebookOpenUrl,
      openUrl: facebookOpenUrl,
      delaySeconds: 0,
      ready: true,
    });
  }

  if (server2 && (server2.manifestUrl || server2.finalPlaybackUrl)) {
    streams.push({
      key: server2.key,
      displayLabel: server2.displayLabel,
      providerLabel: server2.providerLabel,
      kind: server2.finalPlaybackUrl ? "file" : "delayed_manifest",
      priority: 2,
      status: server2.status,
      playUrl: server2.finalPlaybackUrl || server2.manifestUrl,
      openUrl: server2.finalPlaybackUrl || null,
      delaySeconds: server2.delaySeconds,
      ready: server2.ready,
      disabledReason: server2.disabledReason,
      meta: {
        manifestUrl: server2.manifestUrl,
        manifestObjectKey: server2.manifestObjectKey,
        finalPlaybackUrl: server2.finalPlaybackUrl,
        publicBaseUrl: server2.publicBaseUrl,
        uploadedDurationSeconds: server2.uploadedDurationSeconds,
        uploadedSegmentCount: server2.uploadedSegmentCount,
      },
    });
  }

  const legacyPlaybackUrl = selectLegacyPlaybackUrl(match);
  if (legacyPlaybackUrl) {
    const normalizedLegacyUrl = legacyPlaybackUrl.trim();
    const duplicate = streams.some(
      (stream) =>
        asTrimmed(stream?.playUrl) === normalizedLegacyUrl ||
        asTrimmed(stream?.openUrl) === normalizedLegacyUrl
    );

    if (!duplicate) {
      const kind = detectLegacyKind(normalizedLegacyUrl);
      if (kind === "facebook") {
        streams.push({
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
        const hasServer2 = streams.some((stream) => stream.key === "server2");
        streams.push({
          key: hasServer2 ? "legacy_video" : "server2",
          displayLabel: hasServer2 ? "Video" : "Server 2",
          providerLabel: hasServer2 ? "Video" : "PickleTour",
          kind: kind || "iframe",
          priority: hasServer2 ? 3 : 2,
          status: "ready",
          playUrl: normalizedLegacyUrl,
          openUrl: normalizedLegacyUrl,
          delaySeconds: 0,
          ready: true,
        });
      }
    }
  }

  const status = asTrimmed(match?.status).toLowerCase();
  const facebookStatus = asTrimmed(match?.facebookLive?.status).toLowerCase();
  const shouldPreferServer2 =
    isFinishedLikeStatus(status) || isFinishedLikeStatus(facebookStatus);
  let defaultStreamKey = streams[0]?.key || null;
  if (status === "live") {
    defaultStreamKey =
      streams.find((stream) => stream.key === "server1" && stream.ready)?.key ||
      streams.find((stream) => stream.key === "server2")?.key ||
      defaultStreamKey;
  }
  if (shouldPreferServer2) {
    defaultStreamKey =
      streams.find((stream) => stream.key === "server2" && stream.ready)?.key ||
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
  const existingStreams = Array.isArray(match?.streams) ? match.streams : [];
  const effectiveStreams = streams.length > 0 ? streams : existingStreams;

  return {
    ...match,
    streams: effectiveStreams,
    defaultStreamKey:
      streams.length > 0
        ? defaultStreamKey
        : match?.defaultStreamKey || effectiveStreams[0]?.key || null,
    hasMultipleStreams:
      streams.length > 0 ? hasMultipleStreams : effectiveStreams.length > 1,
  };
}

export async function getLatestRecordingsByMatchIds(matchIds = []) {
  const normalizedMatchIds = [...new Set(matchIds.map(asTrimmed).filter(Boolean))];
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
        "segments.index",
        "segments.uploadStatus",
        "segments.durationSeconds",
        "segments.objectKey",
        "meta.livePlayback",
        "createdAt",
      ].join(" ")
    )
    .lean();

  const recordingRank = (recording) => {
    const status = asTrimmed(recording?.status).toLowerCase();
    const hasRaw = Boolean(recording?.driveFileId || recording?.driveRawUrl);
    const hasPlayable = Boolean(
      hasRaw || recording?.drivePreviewUrl || recording?.playbackUrl || recording?._id
    );

    if (hasRaw) return 500;
    if (status === "ready" && hasPlayable) return 450;
    if (status === "ready") return 400;
    if (status === "exporting") return 300;
    if (status === "pending_export_window") return 250;
    if (status === "uploading") return 200;
    if (status === "recording") return 150;
    return 100;
  };

  recordings.sort((a, b) => {
    const matchCmp = asTrimmed(a?.match).localeCompare(asTrimmed(b?.match));
    if (matchCmp !== 0) return matchCmp;

    const rankCmp = recordingRank(b) - recordingRank(a);
    if (rankCmp !== 0) return rankCmp;

    return new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime();
  });

  const byMatchId = new Map();
  for (const recording of recordings) {
    const key = asTrimmed(recording?.match);
    if (!key || byMatchId.has(key)) continue;
    byMatchId.set(key, recording);
  }
  return byMatchId;
}
