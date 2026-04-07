import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import pLimit from "p-limit";
import Match from "../models/matchModel.js";
import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import {
  buildRecordingPlaybackUrl,
  buildRecordingRawStatusUrl,
  buildRecordingRawStreamUrl,
  buildRecordingTemporaryPlaybackUrl,
  buildRecordingTemporaryPlaylistUrl,
} from "../services/liveRecordingV2Export.service.js";
import {
  buildRecordingAiCommentaryPlaybackUrl,
  buildRecordingAiCommentaryRawUrl,
} from "../services/liveRecordingAiCommentaryPlayback.service.js";
import {
  getRecordingDriveFileMetadata,
  probeRecordingDriveFile,
  renameRecordingDriveFile,
  streamRecordingDriveFile,
  moveRecordingDriveFile,
  deleteRecordingDriveFile,
} from "../services/driveRecordings.service.js";
import {
  abortRecordingMultipartUpload,
  buildRecordingLiveManifestObjectKey,
  buildRecordingLiveHlsObjectKey,
  buildRecordingPrefix,
  buildRecordingSegmentObjectKey,
  completeRecordingMultipartUpload,
  createRecordingLiveManifestUploadUrl,
  createRecordingObjectDownloadUrl,
  createRecordingMultipartUpload,
  createRecordingMultipartUploadPartUrl,
  createRecordingSegmentUploadUrl,
  getRecordingPublicBaseUrl,
  getRecordingStorageHealthSummary,
  getRecordingStorageTarget,
  getRecordingStorageTargets,
  getRecordingMultipartPartSizeBytes,
  isRecordingR2Configured,
} from "../services/liveRecordingV2Storage.service.js";
import {
  buildLiveRecordingMonitorPage,
  getLiveRecordingMonitorRow,
  reconcileStaleLiveRecordingExports,
} from "../services/liveRecordingMonitor.service.js";
import { getLiveRecordingWorkerHealth } from "../services/liveRecordingWorkerHealth.service.js";
import {
  getPendingRecordingSegments,
  getRecordingMeta,
  getUploadedRecordingSegments,
  publishRecordingMonitor,
  queueLiveRecordingExport,
} from "../services/liveRecordingV2Transition.service.js";
import {
  buildRecordingSourceSummary,
  RECORDING_SOURCE_FACEBOOK_VOD,
  resolveLiveRecordingExportSource,
} from "../services/liveRecordingFacebookVodShared.service.js";
import { buildAiCommentarySummary } from "../services/liveRecordingAiCommentary.service.js";
import {
  buildRecordingLivePlayback,
  getLiveServer2DelaySeconds,
  isLiveMultiSourceEnabled,
} from "../services/publicStreams.service.js";
import {
  enqueueLiveRecordingAiCommentaryJob,
  getLiveRecordingAiCommentaryMonitor,
} from "../services/liveRecordingAiCommentaryQueue.service.js";

function isValidObjectId(value) {
  return mongoose.isValidObjectId(String(value || ""));
}

function asTrimmed(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function buildPublicObjectUrlFromBase(baseUrl, objectKey) {
  const normalizedBase = asTrimmed(baseUrl).replace(/\/+$/, "");
  const normalizedObjectKey = asTrimmed(objectKey).replace(/^\/+/, "");
  if (!normalizedBase || !normalizedObjectKey) return null;
  return `${normalizedBase}/${normalizedObjectKey}`;
}

function normalizeMode(mode) {
  const normalized = asTrimmed(mode).toUpperCase();
  return ["STREAM_AND_RECORD", "RECORD_ONLY", "STREAM_ONLY"].includes(
    normalized
  )
    ? normalized
    : "";
}

function getSegmentMeta(segment) {
  const meta =
    segment && segment.meta && typeof segment.meta === "object"
      ? { ...segment.meta }
      : {};
  return meta;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeIsoTimestamp(value) {
  const normalized = asTrimmed(value);
  if (!normalized) return "";
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function estimateRecordingR2SourceBytes(recording) {
  return (recording?.segments || []).reduce((sum, segment) => {
    const segmentMeta = getSegmentMeta(segment);
    const completedPartBytes = Array.isArray(segmentMeta.completedParts)
      ? segmentMeta.completedParts.reduce(
          (partSum, part) => partSum + toNumber(part?.sizeBytes),
          0
        )
      : 0;

    if (segment?.uploadStatus === "uploaded") {
      return sum + toNumber(segment?.sizeBytes);
    }

    return sum + completedPartBytes;
  }, 0);
}

function getHealthyRecordingTargetIds(healthSummary) {
  return new Set(
    (healthSummary?.targets || [])
      .filter((target) => target?.alive)
      .map((target) => asTrimmed(target?.id))
      .filter(Boolean)
  );
}

function getSegmentStorageTargetId(segment, recording) {
  return (
    asTrimmed(segment?.storageTargetId) ||
    asTrimmed(recording?.r2TargetId) ||
    ""
  );
}

function getSegmentStorageBucketName(segment, recording) {
  return (
    asTrimmed(segment?.bucketName) || asTrimmed(recording?.r2BucketName) || ""
  );
}

function buildRecordingTargetPublicBaseUrls(recording) {
  const targetIds = new Set();
  const recordingTargetId = asTrimmed(recording?.r2TargetId);
  if (recordingTargetId) {
    targetIds.add(recordingTargetId);
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
        targetPublicBaseUrls[targetId] = baseUrl.replace(/\/+$/, "");
      }
    } catch {
      // Ignore targets that are no longer configured.
    }
  }

  return targetPublicBaseUrls;
}

function buildSegmentPublicCdnUrl(
  segment,
  recording,
  { targetPublicBaseUrls = null, fallbackPublicBaseUrl = "" } = {}
) {
  const objectKey = asTrimmed(segment?.objectKey).replace(/^\/+/, "");
  if (!objectKey) return "";

  const targetMap =
    targetPublicBaseUrls && typeof targetPublicBaseUrls === "object"
      ? targetPublicBaseUrls
      : buildRecordingTargetPublicBaseUrls(recording);
  const segmentTargetId = getSegmentStorageTargetId(segment, recording);
  const recordingTargetId = asTrimmed(recording?.r2TargetId);
  const fallbackBase = asTrimmed(fallbackPublicBaseUrl).replace(/\/+$/, "");
  const baseUrl = asTrimmed(
    targetMap?.[segmentTargetId] ||
      targetMap?.[recordingTargetId] ||
      fallbackBase
  ).replace(/\/+$/, "");

  return baseUrl ? `${baseUrl}/${objectKey}` : "";
}

function isFinishedRecordingPlayback(recording) {
  const status = asTrimmed(recording?.status).toLowerCase();
  
  if (!status) return false;

  return (
    !["recording", "uploading"].includes(status) ||
    Boolean(recording?.driveFileId) ||
    Boolean(recording?.driveRawUrl)
  );
}

function sumSegmentDurationSeconds(segments = []) {
  return (Array.isArray(segments) ? segments : []).reduce(
    (sum, segment) => sum + Math.max(0, Number(segment?.durationSeconds || 0)),
    0
  );
}

function getPlaylistTargetDurationSeconds(segments = []) {
  const maxDuration = (Array.isArray(segments) ? segments : []).reduce(
    (max, segment) => Math.max(max, Number(segment?.durationSeconds || 0)),
    0
  );
  return Math.max(1, Math.ceil(maxDuration || 0));
}

function getPlaylistRefreshSeconds(segments = [], { isFinished = false } = {}) {
  if (isFinished) return 0;
  const recentDurations = (Array.isArray(segments) ? segments : [])
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

function getRecommendedStartSegmentIndex(
  segments = [],
  { isFinished = false, delaySeconds = 0 } = {}
) {
  const segmentList = Array.isArray(segments) ? segments : [];
  if (!segmentList.length) {
    return null;
  }

  if (isFinished) {
    return Number(segmentList[0]?.index ?? 0);
  }

  const desiredLagSeconds = Math.max(12, Number(delaySeconds || 0));
  const targetOffset = Math.max(
    0,
    sumSegmentDurationSeconds(segmentList) - desiredLagSeconds
  );

  let elapsed = 0;
  for (const segment of segmentList) {
    const duration = Math.max(0, Number(segment?.durationSeconds || 0));
    if (elapsed + duration > targetOffset) {
      return Number(segment?.index ?? 0);
    }
    elapsed += duration;
  }

  return Number(segmentList[0]?.index ?? 0);
}

function parseOptionalSegmentIndex(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const normalized = Math.floor(numeric);
  return normalized >= 0 ? normalized : null;
}

function parseOptionalPositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const normalized = Math.floor(numeric);
  return normalized > 0 ? normalized : null;
}

function getPlaylistWindowSegmentCount(
  targetDurationSeconds,
  requestedLimit = null,
) {
  if (Number.isFinite(requestedLimit) && requestedLimit > 0) {
    return Math.max(6, Math.min(36, Math.floor(requestedLimit)));
  }
  const targetDuration = Math.max(1, Number(targetDurationSeconds || 0));
  return Math.max(8, Math.min(24, Math.ceil(90 / targetDuration)));
}

function assignSegmentStorageTarget(segment, storageTarget) {
  if (!segment) return;
  segment.storageTargetId = storageTarget?.id || null;
  segment.bucketName = storageTarget?.bucketName || null;
}

function appendRecordingStorageFailoverHistory(recording, entry = {}) {
  const nextMeta = getRecordingMeta(recording);
  const currentHistory = Array.isArray(nextMeta?.storageFailoverHistory)
    ? nextMeta.storageFailoverHistory
    : [];
  nextMeta.storageFailoverHistory = [
    ...currentHistory.slice(-19),
    {
      fromTargetId: asTrimmed(entry.fromTargetId) || null,
      toTargetId: asTrimmed(entry.toTargetId) || null,
      reason: asTrimmed(entry.reason) || "recording_write_target_reselected",
      checkedAt: entry.checkedAt || new Date(),
      detail: asTrimmed(entry.detail) || null,
    },
  ];
  recording.meta = nextMeta;
}

async function selectRecordingStorageTarget(
  preferredTargetId = "",
  { excludeTargetIds = [], requireHealthy = false, healthSummary = null } = {}
) {
  const excluded = new Set(
    (excludeTargetIds || []).map((value) => asTrimmed(value)).filter(Boolean)
  );
  const healthyTargetIds = getHealthyRecordingTargetIds(healthSummary);
  let targets = getRecordingStorageTargets().filter(
    (target) => !excluded.has(asTrimmed(target?.id))
  );
  if (!targets.length) return null;

  if (requireHealthy) {
    if (!healthyTargetIds.size) {
      return null;
    }
    targets = targets.filter((target) =>
      healthyTargetIds.has(asTrimmed(target?.id))
    );
    if (!targets.length) return null;
  }

  const normalizedPreferred = asTrimmed(preferredTargetId);
  if (normalizedPreferred) {
    const preferred = targets.find(
      (target) => target.id === normalizedPreferred
    );
    if (preferred) return preferred;
  }

  if (targets.length === 1) return targets[0];

  const recordings = await LiveRecordingV2.find({})
    .select(
      "r2TargetId segments.storageTargetId segments.sizeBytes segments.meta segments.uploadStatus"
    )
    .lean();

  const usedBytesByTarget = new Map(targets.map((target) => [target.id, 0]));

  for (const recording of recordings) {
    const perTargetBytes = new Map();
    for (const segment of recording?.segments || []) {
      const targetId =
        asTrimmed(segment?.storageTargetId) ||
        asTrimmed(recording?.r2TargetId) ||
        asTrimmed(targets[0]?.id);
      if (!targetId || !usedBytesByTarget.has(targetId)) continue;
      const segmentMeta = getSegmentMeta(segment);
      const completedPartBytes = Array.isArray(segmentMeta.completedParts)
        ? segmentMeta.completedParts.reduce(
            (partSum, part) => partSum + toNumber(part?.sizeBytes),
            0
          )
        : 0;
      const segmentBytes =
        segment?.uploadStatus === "uploaded"
          ? toNumber(segment?.sizeBytes)
          : completedPartBytes;
      perTargetBytes.set(
        targetId,
        (perTargetBytes.get(targetId) || 0) + segmentBytes
      );
    }

    for (const [targetId, bytes] of perTargetBytes.entries()) {
      usedBytesByTarget.set(
        targetId,
        (usedBytesByTarget.get(targetId) || 0) + bytes
      );
    }
  }

  const rankedTargets = targets
    .map((target) => {
      const usedBytes = usedBytesByTarget.get(target.id) || 0;
      const capacityBytes = Number(target.capacityBytes) || null;
      const remainingBytes =
        capacityBytes && capacityBytes > 0
          ? Math.max(0, capacityBytes - usedBytes)
          : Number.POSITIVE_INFINITY;
      const utilization =
        capacityBytes && capacityBytes > 0
          ? usedBytes / capacityBytes
          : usedBytes;

      return {
        ...target,
        _usedBytes: usedBytes,
        _remainingBytes: remainingBytes,
        _utilization: utilization,
      };
    })
    .sort((a, b) => {
      const aHasRoom =
        !Number.isFinite(a._remainingBytes) || a._remainingBytes > 0;
      const bHasRoom =
        !Number.isFinite(b._remainingBytes) || b._remainingBytes > 0;
      if (aHasRoom !== bHasRoom) return aHasRoom ? -1 : 1;
      if (a._utilization !== b._utilization) {
        return a._utilization - b._utilization;
      }
      if (a._usedBytes !== b._usedBytes) {
        return a._usedBytes - b._usedBytes;
      }
      return String(a.id).localeCompare(String(b.id));
    });

  const picked = rankedTargets[0] || null;
  if (!picked) return null;

  return {
    id: picked.id,
    label: picked.label,
    endpoint: picked.endpoint,
    bucketName: picked.bucketName,
    capacityBytes: picked.capacityBytes,
  };
}

async function ensureRecordingStorageTargetForWrite(
  recording,
  { forceHealthRefresh = false, reason = "recording_write_target_check" } = {}
) {
  const currentTargetId = asTrimmed(recording?.r2TargetId);
  const configuredCurrentTarget = currentTargetId
    ? getRecordingStorageTarget(currentTargetId)
    : null;
  const healthSummary = await getRecordingStorageHealthSummary({
    forceRefresh: forceHealthRefresh,
  }).catch(() => null);
  const healthyTargetIds = getHealthyRecordingTargetIds(healthSummary);
  const hasHealthProbe =
    Array.isArray(healthSummary?.targets) && healthSummary.targets.length > 0;

  if (
    configuredCurrentTarget &&
    (!hasHealthProbe || healthyTargetIds.has(configuredCurrentTarget.id))
  ) {
    if (recording.r2BucketName !== configuredCurrentTarget.bucketName) {
      recording.r2BucketName = configuredCurrentTarget.bucketName || null;
    }
    return configuredCurrentTarget;
  }

  const replacementTarget = await selectRecordingStorageTarget("", {
    excludeTargetIds: configuredCurrentTarget
      ? [configuredCurrentTarget.id]
      : [],
    requireHealthy: hasHealthProbe,
    healthSummary,
  });

  if (replacementTarget) {
    const previousTargetId = currentTargetId || null;
    recording.r2TargetId = replacementTarget.id;
    recording.r2BucketName = replacementTarget.bucketName || null;
    appendRecordingStorageFailoverHistory(recording, {
      fromTargetId: previousTargetId,
      toTargetId: replacementTarget.id,
      reason,
      checkedAt: new Date(),
      detail: configuredCurrentTarget
        ? `Current target ${configuredCurrentTarget.id} is unavailable`
        : "Selected initial healthy target",
    });
    await recording.save();
    await publishRecordingMonitor(
      recording,
      previousTargetId
        ? "recording_storage_failover"
        : "recording_storage_selected"
    );
    return replacementTarget;
  }

  if (configuredCurrentTarget) {
    if (recording.r2BucketName !== configuredCurrentTarget.bucketName) {
      recording.r2BucketName = configuredCurrentTarget.bucketName || null;
    }
    return configuredCurrentTarget;
  }

  const fallbackTarget =
    (await selectRecordingStorageTarget("", {
      requireHealthy: hasHealthProbe,
      healthSummary,
    })) || (await selectRecordingStorageTarget(""));

  if (!fallbackTarget) return null;

  recording.r2TargetId = fallbackTarget.id;
  recording.r2BucketName = fallbackTarget.bucketName || null;
  appendRecordingStorageFailoverHistory(recording, {
    fromTargetId: null,
    toTargetId: fallbackTarget.id,
    reason,
    checkedAt: new Date(),
    detail: "Selected fallback target for write",
  });
  await recording.save();
  await publishRecordingMonitor(recording, "recording_storage_selected");
  return fallbackTarget;
}

function findRecordingSegment(recording, segmentIndex) {
  return (recording.segments || []).find(
    (segment) => segment.index === segmentIndex
  );
}

async function presignRecordingSegmentEntries({
  recording,
  segmentIndexes = [],
  contentType = "video/mp4",
}) {
  const normalizedIndexes = [...new Set(segmentIndexes)]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0)
    .sort((a, b) => a - b);

  if (!normalizedIndexes.length) {
    return [];
  }

  const entries = [];
  let mutated = false;
  const activeStorageTarget =
    (await ensureRecordingStorageTargetForWrite(recording, {
      reason: "segment_single_put_presign",
    })) || getRecordingStorageTarget(recording.r2TargetId);

  if (!activeStorageTarget?.id) {
    throw new Error("Recording R2 storage is not configured");
  }

  for (const segmentIndex of normalizedIndexes) {
    const objectKey = buildRecordingSegmentObjectKey({
      recordingId: recording._id,
      matchId: recording.match,
      segmentIndex,
    });

    const upload = await createRecordingSegmentUploadUrl({
      objectKey,
      contentType,
      storageTargetId: activeStorageTarget.id,
    });

    const existing = recording.segments.find(
      (segment) => segment.index === segmentIndex
    );
    if (existing) {
      if (existing.uploadStatus !== "uploaded") {
        existing.objectKey = objectKey;
        existing.uploadStatus = "presigned";
        assignSegmentStorageTarget(existing, activeStorageTarget);
        mutated = true;
      }
    } else {
      recording.segments.push({
        index: segmentIndex,
        objectKey,
        storageTargetId: activeStorageTarget.id,
        bucketName: activeStorageTarget.bucketName || null,
        uploadStatus: "presigned",
        isFinal: false,
      });
      mutated = true;
    }

    entries.push({
      segmentIndex,
      objectKey,
      upload,
    });
  }

  if (mutated) {
    await recording.save();
  }

  return entries;
}

function shouldPreserveExportState(recording) {
  return ["pending_export_window", "exporting", "ready", "failed"].includes(
    String(recording?.status || "")
  );
}

function buildRecordingLinks(recordingId) {
  const id = String(recordingId || "").trim();
  if (!id) {
    return {
      playbackUrl: null,
      rawStreamUrl: null,
      rawStatusUrl: null,
      temporaryPlaybackUrl: null,
      temporaryPlaylistUrl: null,
    };
  }

  const safeBuild = (builder, label) => {
    try {
      return builder(id);
    } catch (error) {
      console.error(`Failed to build ${label} for recording ${id}:`, error);
      return null;
    }
  };

  return {
    playbackUrl: safeBuild(buildRecordingPlaybackUrl, "playbackUrl"),
    rawStreamUrl: safeBuild(buildRecordingRawStreamUrl, "rawStreamUrl"),
    rawStatusUrl: safeBuild(buildRecordingRawStatusUrl, "rawStatusUrl"),
    temporaryPlaybackUrl: safeBuild(
      buildRecordingTemporaryPlaybackUrl,
      "temporaryPlaybackUrl"
    ),
    temporaryPlaylistUrl: safeBuild(
      buildRecordingTemporaryPlaylistUrl,
      "temporaryPlaylistUrl"
    ),
  };
}

function ensureRecordingPlaybackUrl(recording) {
  if (!recording) return null;
  const links = buildRecordingLinks(recording._id);
  const playbackUrl = links.playbackUrl || recording.playbackUrl || null;
  recording.playbackUrl = playbackUrl;
  return {
    ...links,
    playbackUrl,
  };
}

function buildSerializedLivePlayback(recording) {
  if (!recording || !isLiveMultiSourceEnabled()) return null;
  const livePlayback = buildRecordingLivePlayback(recording);
  if (!livePlayback) return null;
  const sourceCleanupCompleted =
    asTrimmed(recording?.meta?.sourceCleanup?.status).toLowerCase() ===
    "completed";
  const manifestObjectKey =
    livePlayback.manifestObjectKey ||
    buildRecordingLiveManifestObjectKey({
      recordingId: recording._id,
      matchId: recording.match,
    });
  const hlsManifestObjectKey =
    livePlayback.hlsManifestObjectKey ||
    buildRecordingLiveHlsObjectKey({
      recordingId: recording._id,
      matchId: recording.match,
    });
  const publicBaseUrl =
    livePlayback.publicBaseUrl ||
    getRecordingPublicBaseUrl(recording.r2TargetId) ||
    null;
  return {
    ...livePlayback,
    manifestObjectKey,
    manifestUrl:
      livePlayback.manifestUrl ||
      (!sourceCleanupCompleted
        ? buildPublicObjectUrlFromBase(publicBaseUrl, manifestObjectKey)
        : null),
    hlsManifestObjectKey,
    hlsManifestUrl:
      livePlayback.hlsManifestUrl ||
      (!sourceCleanupCompleted
        ? buildPublicObjectUrlFromBase(publicBaseUrl, hlsManifestObjectKey)
        : null),
    publicBaseUrl,
    delaySeconds: livePlayback.delaySeconds || getLiveServer2DelaySeconds(),
  };
}

function isRecordingTemporaryPlaybackReady(recording) {
  if (!recording?.finalizedAt) return false;
  return (
    getUploadedRecordingSegments(recording).length > 0 &&
    getPendingRecordingSegments(recording).length === 0
  );
}

function buildTemporaryPlaybackTitle(recording) {
  const matchId = asTrimmed(recording?.match);
  const recordingId = asTrimmed(recording?._id);
  return `Recording ${recordingId || "-"}${
    matchId ? ` - Match ${matchId}` : ""
  }`;
}

function buildTemporaryPlaybackHtml({ recording, playlistUrl, playbackUrl }) {
  const title = buildTemporaryPlaybackTitle(recording);
  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      :root {
        color-scheme: dark;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: #050816;
        color: #e5eefb;
        font-family: Arial, sans-serif;
      }
      .wrap {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
      }
      .player {
        width: 100%;
        max-width: 1280px;
        margin: 0 auto;
      }
      video {
        width: 100%;
        aspect-ratio: 16 / 9;
        background: #000;
        border-radius: 12px;
      }
      .meta {
        width: 100%;
        max-width: 1280px;
        margin: 0 auto;
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        font-size: 14px;
        opacity: 0.9;
      }
      .status {
        width: 100%;
        max-width: 1280px;
        margin: 0 auto;
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(59, 130, 246, 0.12);
      }
      .status.error {
        background: rgba(239, 68, 68, 0.18);
      }
      .hint {
        opacity: 0.72;
      }
      a {
        color: #8cc2ff;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="player">
        <video id="video" controls autoplay playsinline preload="metadata"></video>
      </div>
      <div class="meta">
        <div><strong>${safeTitle}</strong></div>
        <div id="segmentMeta">?ang t?i danh s?ch segment...</div>
      </div>
      <div id="status" class="status">?ang t?i temp playback t? R2...</div>
    </div>
    <script>
      const playlistUrl = ${JSON.stringify(playlistUrl)};
      const fallbackPlaybackUrl = ${JSON.stringify(playbackUrl)};
      const video = document.getElementById("video");
      const statusEl = document.getElementById("status");
      const segmentMetaEl = document.getElementById("segmentMeta");
      let playlist = [];
      let currentIndex = 0;

      function setStatus(message, isError = false) {
        statusEl.textContent = message;
        statusEl.className = isError ? "status error" : "status";
      }

      function setSegmentMeta() {
        if (!playlist.length) {
          segmentMetaEl.textContent = "Kh?ng c? segment n?o ?? ph?t";
          return;
        }
        const current = playlist[currentIndex] || playlist[0];
        segmentMetaEl.textContent =
          "Segment " +
          (currentIndex + 1) +
          "/" +
          playlist.length +
          " - #" +
          current.index +
          " - " +
          (current.durationSeconds || 0) +
          "s";
      }

      function playIndex(index) {
        if (!playlist[index]) {
          setStatus("?? ph?t xong recording t?m.");
          return;
        }

        currentIndex = index;
        setSegmentMeta();
        const item = playlist[index];
        setStatus(
          "?ang ph?t segment " +
            (index + 1) +
            "/" +
            playlist.length +
            " tu R2..."
        );
        video.src = item.url;
        video.play().catch(() => {});
      }

      video.addEventListener("ended", () => {
        playIndex(currentIndex + 1);
      });

      video.addEventListener("error", () => {
        const failedSegment = playlist[currentIndex];
        const failedLabel = failedSegment ? "#" + failedSegment.index : "hien tai";
        setStatus("Kh?ng th? ph?t segment " + failedLabel + ".", true);
      });

      async function bootstrap() {
        try {
          const response = await fetch(playlistUrl, {
            credentials: "omit",
            cache: "no-store",
          });
          const payload = await response.json();
          if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.message || "Kh?ng t?i ???c playlist temp.");
          }
          if (payload?.redirectUrl) {
            window.location.replace(payload.redirectUrl);
            return;
          }
          playlist = Array.isArray(payload?.segments) ? payload.segments : [];
          if (!playlist.length) {
            throw new Error(payload?.message || "Recording t?m ch?a c? segment.");
          }
          playIndex(0);
        } catch (error) {
          setStatus(error?.message || "Kh?ng th? m? temp playback.", true);
          if (fallbackPlaybackUrl && window.location.href !== fallbackPlaybackUrl) {
            const link = document.createElement("a");
            link.href = fallbackPlaybackUrl;
            link.textContent = "Th? m? playback URL";
            link.target = "_top";
            statusEl.innerHTML = "";
            statusEl.appendChild(document.createTextNode(error?.message || "Kh?ng th? m? temp playback."));
            statusEl.appendChild(document.createElement("br"));
            statusEl.appendChild(link);
          }
        }
      }

      bootstrap();
    </script>
  </body>
</html>`;
}

function buildRequestedByActor(user = {}) {
  return {
    _id: user?._id || null,
    name:
      asTrimmed(user?.name) ||
      asTrimmed(user?.fullName) ||
      asTrimmed(user?.nickname) ||
      "",
    email: asTrimmed(user?.email) || "",
  };
}

function getAiCommentaryAsset(recording) {
  const ai = recording?.aiCommentary || {};
  const fileId = asTrimmed(ai?.dubbedDriveFileId);
  const rawUrl = asTrimmed(ai?.dubbedDriveRawUrl);
  const previewUrl = asTrimmed(ai?.dubbedDrivePreviewUrl);
  const playbackUrl =
    asTrimmed(ai?.dubbedPlaybackUrl) ||
    (recording?._id && (fileId || rawUrl)
      ? buildRecordingAiCommentaryPlaybackUrl(recording._id)
      : "");

  return {
    fileId,
    rawUrl,
    previewUrl,
    playbackUrl,
    ready: Boolean(fileId || rawUrl || playbackUrl || previewUrl),
  };
}

function normalizeDriveAssetTarget(value) {
  return String(value || "").trim().toLowerCase() === "ai" ? "ai" : "source";
}

function getRecordingDriveAssetInfo(recording, target = "source") {
  const normalizedTarget = normalizeDriveAssetTarget(target);
  if (normalizedTarget === "ai") {
    const aiAsset = getAiCommentaryAsset(recording);
    return {
      target: "ai",
      label: "BLV AI",
      fileId: aiAsset.fileId || null,
      rawUrl: aiAsset.rawUrl || null,
      previewUrl: aiAsset.previewUrl || null,
      playbackUrl: aiAsset.playbackUrl || null,
      ready: Boolean(aiAsset.ready),
    };
  }

  return {
    target: "source",
    label: "Video gốc",
    fileId: asTrimmed(recording?.driveFileId) || null,
    rawUrl: asTrimmed(recording?.driveRawUrl) || null,
    previewUrl: asTrimmed(recording?.drivePreviewUrl) || null,
    playbackUrl: recording?._id
      ? buildRecordingPlaybackUrl(recording._id)
      : asTrimmed(recording?.playbackUrl) || null,
    ready: Boolean(recording?.driveFileId || recording?.driveRawUrl),
  };
}

function setRecordingDriveAssetMeta(recording, target, file = null) {
  if (!recording) return;
  const normalizedTarget = normalizeDriveAssetTarget(target);
  const nextMeta = getRecordingMeta(recording);
  const currentDriveAdmin =
    nextMeta.driveAdmin && typeof nextMeta.driveAdmin === "object"
      ? { ...nextMeta.driveAdmin }
      : {};

  currentDriveAdmin[normalizedTarget] = file
    ? {
        fileId: asTrimmed(file?.id) || null,
        name: asTrimmed(file?.name) || null,
        mimeType: asTrimmed(file?.mimeType) || null,
        driveId: asTrimmed(file?.driveId) || null,
        parents: Array.isArray(file?.parents)
          ? file.parents.map((value) => asTrimmed(value)).filter(Boolean)
          : [],
        trashed: Boolean(file?.trashed),
        deleted: Boolean(file?.deleted),
        size: file?.size != null ? String(file.size) : null,
        modifiedTime: file?.modifiedTime || null,
        syncedAt: new Date(),
      }
    : null;

  nextMeta.driveAdmin = currentDriveAdmin;
  recording.meta = nextMeta;
}

function clearRecordingDriveAsset(recording, target, reason = "", file = null) {
  const normalizedTarget = normalizeDriveAssetTarget(target);
  const message =
    asTrimmed(reason) ||
    (normalizedTarget === "ai"
      ? "AI commentary Drive file was permanently deleted by admin."
      : "Drive file was permanently deleted by admin.");
  const deletedFileMeta =
    file && typeof file === "object" ? file : { deleted: true };

  if (normalizedTarget === "ai") {
    recording.aiCommentary = {
      ...(recording.aiCommentary || {}),
      status: "failed",
      dubbedDriveFileId: null,
      dubbedDriveRawUrl: null,
      dubbedDrivePreviewUrl: null,
      dubbedPlaybackUrl: null,
      error: message,
    };
    setRecordingDriveAssetMeta(recording, "ai", deletedFileMeta);
    recording.markModified("aiCommentary");
    return;
  }

  const nextMeta = getRecordingMeta(recording);
  const currentPipeline =
    nextMeta.exportPipeline &&
    typeof nextMeta.exportPipeline === "object" &&
    !Array.isArray(nextMeta.exportPipeline)
      ? { ...nextMeta.exportPipeline }
      : {};

  nextMeta.exportPipeline = {
    ...currentPipeline,
    stage: "failed",
    label: "Video Drive đã bị xóa vĩnh viễn",
    updatedAt: new Date(),
    failedAt: new Date(),
    error: message,
    adminAction: "drive_source_deleted",
  };

  recording.meta = nextMeta;
  recording.driveFileId = null;
  recording.driveRawUrl = null;
  recording.drivePreviewUrl = null;
  recording.playbackUrl = null;
  recording.readyAt = null;
  recording.status = "failed";
  recording.error = message;
  setRecordingDriveAssetMeta(recording, "source", deletedFileMeta);
}

async function trashRecordingDriveAssetByAdmin(recording, target = "source") {
  const normalizedTarget = normalizeDriveAssetTarget(target);
  const asset = getRecordingDriveAssetInfo(recording, normalizedTarget);

  if (!asset.fileId) {
    const error = new Error(`${asset.label} chưa có Drive fileId`);
    error.statusCode = 404;
    error.code = "DRIVE_FILE_ID_MISSING";
    throw error;
  }

  try {
    const result = await deleteRecordingDriveFile(asset.fileId);
    clearRecordingDriveAsset(
      recording,
      normalizedTarget,
      normalizedTarget === "ai"
        ? "AI commentary Drive file was permanently deleted by admin."
        : "Drive file was permanently deleted by admin.",
      result.file
    );
    await recording.save();
    await publishRecordingMonitor(
      recording,
      `recording_drive_asset_deleted_${normalizedTarget}`
    );

    return {
      target: normalizedTarget,
      file: result.file,
      driveAuthMode: result.driveAuthMode,
      recording: serializeRecording(recording),
    };
  } catch (error) {
    if (!error?.statusCode) {
      error.statusCode = 502;
    }
    if (!error?.code) {
      error.code = "DRIVE_ASSET_DELETE_FAILED";
    }
    throw error;
  }
}

function serializeRecording(recording) {
  if (!recording) return null;
  const links = ensureRecordingPlaybackUrl(recording);
  const temporaryPlaybackReady = isRecordingTemporaryPlaybackReady(recording);
  const livePlayback = buildSerializedLivePlayback(recording);
  const storageFailoverHistory = Array.isArray(
    recording?.meta?.storageFailoverHistory
  )
    ? recording.meta.storageFailoverHistory
        .map((entry) => ({
          fromTargetId: asTrimmed(entry?.fromTargetId) || null,
          toTargetId: asTrimmed(entry?.toTargetId) || null,
          reason: asTrimmed(entry?.reason) || null,
          checkedAt: entry?.checkedAt || null,
          detail: asTrimmed(entry?.detail) || null,
        }))
        .filter(
          (entry) =>
            entry.fromTargetId ||
            entry.toTargetId ||
            entry.reason ||
            entry.checkedAt ||
            entry.detail
        )
    : [];
  const latestStorageFailover =
    storageFailoverHistory.length > 0
      ? storageFailoverHistory[storageFailoverHistory.length - 1]
      : null;
  const source = buildRecordingSourceSummary(recording);
  return {
    id: String(recording._id),
    matchId: String(recording.match),
    courtId: recording.courtId ? String(recording.courtId) : null,
    mode: recording.mode,
    quality: recording.quality || "",
    status: recording.status,
    recordingSessionId: recording.recordingSessionId,
    durationSeconds: recording.durationSeconds || 0,
    sizeBytes: recording.sizeBytes || 0,
    r2TargetId: recording.r2TargetId || null,
    r2BucketName: recording.r2BucketName || null,
    latestStorageFailover,
    storageFailoverHistory,
    driveFileId: recording.driveFileId || null,
    driveRawUrl: recording.driveRawUrl || null,
    drivePreviewUrl: recording.drivePreviewUrl || null,
    playbackUrl: links.playbackUrl,
    rawStreamUrl: links.rawStreamUrl,
    rawStatusUrl: links.rawStatusUrl,
    temporaryPlaybackUrl: links.temporaryPlaybackUrl,
    temporaryPlaylistUrl: links.temporaryPlaylistUrl,
    temporaryPlaybackReady,
    livePlayback,
    source,
    facebookVod: recording?.meta?.facebookVod || null,
    aiCommentary: buildAiCommentarySummary(recording),
    rawStreamAvailable: Boolean(recording.driveFileId || recording.driveRawUrl),
    driveAuthMode: recording?.meta?.exportPipeline?.driveAuthMode || null,
    exportAttempts: recording.exportAttempts || 0,
    error: recording.error || null,
    finalizedAt: recording.finalizedAt || null,
    scheduledExportAt: recording.scheduledExportAt || null,
    readyAt: recording.readyAt || null,
    createdAt: recording.createdAt || null,
    updatedAt: recording.updatedAt || null,
    segments: (recording.segments || []).map((segment) => ({
      index: segment.index,
      objectKey: segment.objectKey,
      storageTargetId: getSegmentStorageTargetId(segment, recording) || null,
      bucketName: getSegmentStorageBucketName(segment, recording) || null,
      uploadStatus: segment.uploadStatus,
      sizeBytes: segment.sizeBytes || 0,
      durationSeconds: segment.durationSeconds || 0,
      isFinal: Boolean(segment.isFinal),
      uploadedAt: segment.uploadedAt || null,
    })),
  };
}

export const startLiveRecordingV2 = asyncHandler(async (req, res) => {
  const matchId = asTrimmed(req.body?.matchId);
  const mode = normalizeMode(req.body?.mode);
  const quality = asTrimmed(req.body?.quality);
  const courtId = asTrimmed(req.body?.courtId) || null;
  const recordingSessionId =
    asTrimmed(req.body?.recordingSessionId) ||
    `recording_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  if (!isValidObjectId(matchId)) {
    return res.status(400).json({ message: "matchId is required" });
  }
  if (!mode) {
    return res.status(400).json({ message: "mode is invalid" });
  }

  const match = await Match.findById(matchId).select("_id court").lean();
  if (!match) {
    return res.status(404).json({ message: "Match not found" });
  }

  let recording = await LiveRecordingV2.findOne({
    recordingSessionId,
  });
  const configuredExistingStorageTarget = recording?.r2TargetId
    ? getRecordingStorageTarget(recording.r2TargetId)
    : null;
  if (recording?.r2TargetId && !configuredExistingStorageTarget) {
    return res.status(503).json({
      message: `Recording storage target "${recording.r2TargetId}" is no longer configured`,
    });
  }
  const selectedStorageTarget = recording
    ? configuredExistingStorageTarget ||
      (await selectRecordingStorageTarget("", {
        requireHealthy: true,
        healthSummary: await getRecordingStorageHealthSummary().catch(
          () => null
        ),
      })) ||
      (await selectRecordingStorageTarget())
    : (await selectRecordingStorageTarget("", {
        requireHealthy: true,
        healthSummary: await getRecordingStorageHealthSummary({
          forceRefresh: true,
        }).catch(() => null),
      })) || (await selectRecordingStorageTarget());

  if (!recording) {
    recording = await LiveRecordingV2.create({
      match: match._id,
      courtId:
        courtId && isValidObjectId(courtId)
          ? courtId
          : match.court && isValidObjectId(match.court)
          ? match.court
          : null,
      mode,
      quality,
      recordingSessionId,
      status: "recording",
      r2TargetId: selectedStorageTarget?.id || null,
      r2BucketName: selectedStorageTarget?.bucketName || null,
      r2Prefix: buildRecordingPrefix({
        recordingId: new mongoose.Types.ObjectId(),
        matchId,
      }),
    });
    recording.r2Prefix = buildRecordingPrefix({
      recordingId: recording._id,
      matchId,
    });
    ensureRecordingPlaybackUrl(recording);
    await recording.save();
  } else {
    const ensuredStorageTarget =
      (await ensureRecordingStorageTargetForWrite(recording, {
        reason: "recording_session_resume",
      })) || configuredExistingStorageTarget;
    recording.mode = mode;
    recording.quality = quality;
    if (
      !recording.r2TargetId &&
      (ensuredStorageTarget?.id || selectedStorageTarget?.id)
    ) {
      recording.r2TargetId =
        ensuredStorageTarget?.id || selectedStorageTarget?.id || null;
      recording.r2BucketName =
        ensuredStorageTarget?.bucketName ||
        selectedStorageTarget?.bucketName ||
        null;
    } else if (recording.r2TargetId) {
      const configuredTarget = getRecordingStorageTarget(recording.r2TargetId);
      if (configuredTarget?.bucketName) {
        recording.r2BucketName = configuredTarget.bucketName;
      } else if (ensuredStorageTarget?.bucketName) {
        recording.r2BucketName = ensuredStorageTarget.bucketName;
      }
    }
    recording.status =
      recording.status === "ready"
        ? "recording"
        : recording.status || "recording";
    if (!recording.playbackUrl) {
      ensureRecordingPlaybackUrl(recording);
    }
    await recording.save();
  }

  await publishRecordingMonitor(recording, "recording_started");

  return res.json({
    ok: true,
    storage: {
      r2Configured: isRecordingR2Configured(),
    },
    recording: serializeRecording(recording),
  });
});

export const presignLiveRecordingSegmentV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.body?.recordingId);
  const segmentIndex = Number(req.body?.segmentIndex);
  const contentType = asTrimmed(req.body?.contentType) || "video/mp4";

  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "recordingId is required" });
  }
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    return res.status(400).json({ message: "segmentIndex must be >= 0" });
  }

  const recording = await LiveRecordingV2.findById(recordingId);
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  const [entry] = await presignRecordingSegmentEntries({
    recording,
    segmentIndexes: [segmentIndex],
    contentType,
  });

  return res.json({
    ok: true,
    recordingId: String(recording._id),
    segmentIndex: entry.segmentIndex,
    objectKey: entry.objectKey,
    upload: entry.upload,
  });
});

export const presignLiveRecordingSegmentBatchV2 = asyncHandler(
  async (req, res) => {
    const recordingId = asTrimmed(req.body?.recordingId);
    const startSegmentIndex = Number(req.body?.startSegmentIndex);
    const requestedCount = Number(req.body?.count);
    const contentType = asTrimmed(req.body?.contentType) || "video/mp4";

    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "recordingId is required" });
    }

    let segmentIndexes = Array.isArray(req.body?.segmentIndexes)
      ? req.body.segmentIndexes
      : [];

    if (!segmentIndexes.length) {
      if (!Number.isInteger(startSegmentIndex) || startSegmentIndex < 0) {
        return res
          .status(400)
          .json({ message: "startSegmentIndex must be >= 0" });
      }
      const count = Math.max(
        1,
        Math.min(25, Number.isFinite(requestedCount) ? requestedCount : 10)
      );
      segmentIndexes = Array.from(
        { length: count },
        (_, index) => startSegmentIndex + index
      );
    }

    const recording = await LiveRecordingV2.findById(recordingId);
    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    const segments = await presignRecordingSegmentEntries({
      recording,
      segmentIndexes,
      contentType,
    });

    return res.json({
      ok: true,
      recordingId: String(recording._id),
      count: segments.length,
      segments,
    });
  }
);

export const presignLiveRecordingManifestV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.body?.recordingId);

  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "recordingId is required" });
  }

  const recording = await LiveRecordingV2.findById(recordingId);
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  const activeStorageTarget =
    (await ensureRecordingStorageTargetForWrite(recording, {
      reason: "live_manifest_presign",
    })) || getRecordingStorageTarget(recording.r2TargetId);

  if (!activeStorageTarget?.id) {
    return res.status(503).json({
      message: "Recording R2 storage is not configured",
    });
  }

  const livePlayback = buildSerializedLivePlayback(recording);
  if (!livePlayback?.manifestObjectKey) {
    return res.status(409).json({
      message: "Public CDN live playback is not configured for this recording",
    });
  }
  if (
    !livePlayback?.publicBaseUrl ||
    !livePlayback?.manifestUrl ||
    !livePlayback?.hlsManifestObjectKey ||
    !livePlayback?.hlsManifestUrl
  ) {
    return res.status(409).json({
      message: "LIVE_RECORDING_PUBLIC_CDN_BASE_URL is not configured",
    });
  }

  const upload = await createRecordingLiveManifestUploadUrl({
    objectKey: livePlayback.manifestObjectKey,
    storageTargetId: activeStorageTarget.id,
  });
  const hlsUpload = await createRecordingLiveManifestUploadUrl({
    objectKey: livePlayback.hlsManifestObjectKey,
    storageTargetId: activeStorageTarget.id,
    contentType: "application/vnd.apple.mpegurl",
    cacheControl: "public, max-age=2, stale-while-revalidate=4",
  });

  if (!recording.meta || typeof recording.meta !== "object") {
    recording.meta = {};
  }
  recording.meta.livePlayback = {
    ...(recording.meta.livePlayback || {}),
    enabled: true,
    manifestObjectKey: livePlayback.manifestObjectKey,
    manifestUrl: livePlayback.manifestUrl,
    hlsManifestObjectKey: livePlayback.hlsManifestObjectKey,
    hlsManifestUrl: livePlayback.hlsManifestUrl,
    publicBaseUrl: livePlayback.publicBaseUrl,
    delaySeconds: livePlayback.delaySeconds,
    status: livePlayback.status,
    finalPlaybackUrl: livePlayback.finalPlaybackUrl || null,
  };
  await recording.save();

  return res.json({
    ok: true,
    recordingId: String(recording._id),
    livePlayback: buildSerializedLivePlayback(recording),
    upload,
    hlsUpload,
  });
});

export const startMultipartLiveRecordingSegmentV2 = asyncHandler(
  async (req, res) => {
    const recordingId = asTrimmed(req.body?.recordingId);
    const segmentIndex = Number(req.body?.segmentIndex);
    const contentType = asTrimmed(req.body?.contentType) || "video/mp4";
    const requestedStartedAt = normalizeIsoTimestamp(req.body?.startedAt);

    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "recordingId is required" });
    }
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
      return res.status(400).json({ message: "segmentIndex must be >= 0" });
    }

    const recording = await LiveRecordingV2.findById(recordingId);
    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    const activeStorageTarget =
      (await ensureRecordingStorageTargetForWrite(recording, {
        reason: "multipart_segment_start",
      })) || getRecordingStorageTarget(recording.r2TargetId);

    if (!activeStorageTarget?.id) {
      return res
        .status(503)
        .json({ message: "Recording R2 storage is not configured" });
    }

    let segment = findRecordingSegment(recording, segmentIndex);
    const objectKey =
      segment?.objectKey ||
      buildRecordingSegmentObjectKey({
        recordingId: recording._id,
        matchId: recording.match,
        segmentIndex,
      });
    const segmentMeta = getSegmentMeta(segment);

    if (segment?.uploadStatus === "uploaded") {
      return res.json({
        ok: true,
        recordingId: String(recording._id),
        segmentIndex,
        objectKey,
        uploadId: null,
        partSizeBytes:
          Number(segmentMeta.partSizeBytes) ||
          getRecordingMultipartPartSizeBytes(),
        alreadyUploaded: true,
      });
    }

    let uploadId = asTrimmed(segmentMeta.uploadId);
    let partSizeBytes =
      Number(segmentMeta.partSizeBytes) || getRecordingMultipartPartSizeBytes();
    const segmentStorageTargetId = getSegmentStorageTargetId(
      segment,
      recording
    );
    const shouldRestartMultipartSession =
      !uploadId ||
      segment?.uploadStatus === "aborted" ||
      segment?.uploadStatus === "failed" ||
      !segmentStorageTargetId ||
      segmentStorageTargetId !== activeStorageTarget.id;

    if (shouldRestartMultipartSession) {
      const multipart = await createRecordingMultipartUpload({
        objectKey,
        contentType,
        storageTargetId: activeStorageTarget.id,
      });
      uploadId = multipart.uploadId;
      partSizeBytes = multipart.partSizeBytes;
    }

    const nextMeta = {
      ...segmentMeta,
      uploadId,
      partSizeBytes,
      contentType,
      startedAt:
        segmentMeta.startedAt || requestedStartedAt || new Date().toISOString(),
      abortedAt: null,
      completedParts: shouldRestartMultipartSession
        ? []
        : Array.isArray(segmentMeta.completedParts)
        ? segmentMeta.completedParts
        : [],
      completedPartCount: shouldRestartMultipartSession
        ? 0
        : Number(segmentMeta.completedPartCount) || 0,
      completedBytes: shouldRestartMultipartSession
        ? 0
        : Number(segmentMeta.completedBytes) || 0,
      nextByteOffset: shouldRestartMultipartSession
        ? 0
        : Number(segmentMeta.nextByteOffset) || 0,
      storageTargetId: activeStorageTarget.id,
    };

    if (segment) {
      segment.objectKey = objectKey;
      assignSegmentStorageTarget(segment, activeStorageTarget);
      segment.uploadStatus = "uploading_parts";
      segment.meta = nextMeta;
    } else {
      recording.segments.push({
        index: segmentIndex,
        objectKey,
        storageTargetId: activeStorageTarget.id,
        bucketName: activeStorageTarget.bucketName || null,
        uploadStatus: "uploading_parts",
        isFinal: false,
        meta: nextMeta,
      });
    }

    recording.error = null;
    await recording.save();
    await publishRecordingMonitor(recording, "multipart_segment_started");

    return res.json({
      ok: true,
      recordingId: String(recording._id),
      segmentIndex,
      objectKey,
      uploadId,
      partSizeBytes,
      alreadyUploaded: false,
    });
  }
);

export const presignMultipartLiveRecordingSegmentPartV2 = asyncHandler(
  async (req, res) => {
    const recordingId = asTrimmed(req.body?.recordingId);
    const segmentIndex = Number(req.body?.segmentIndex);
    const partNumber = Number(req.body?.partNumber);

    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "recordingId is required" });
    }
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
      return res.status(400).json({ message: "segmentIndex must be >= 0" });
    }
    if (!Number.isInteger(partNumber) || partNumber <= 0) {
      return res.status(400).json({ message: "partNumber must be >= 1" });
    }

    const recording = await LiveRecordingV2.findById(recordingId);
    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    const segment = findRecordingSegment(recording, segmentIndex);
    if (!segment) {
      return res.status(404).json({ message: "Recording segment not found" });
    }
    if (segment.uploadStatus === "uploaded") {
      return res
        .status(409)
        .json({ message: "Recording segment already uploaded" });
    }

    const segmentMeta = getSegmentMeta(segment);
    const uploadId = asTrimmed(segmentMeta.uploadId);
    if (!uploadId) {
      return res.status(409).json({
        message: "Multipart upload has not been started for this segment",
      });
    }
    const segmentStorageTargetId = getSegmentStorageTargetId(
      segment,
      recording
    );

    const upload = await createRecordingMultipartUploadPartUrl({
      objectKey: segment.objectKey,
      uploadId,
      partNumber,
      storageTargetId: segmentStorageTargetId,
    });

    return res.json({
      ok: true,
      recordingId: String(recording._id),
      segmentIndex,
      partNumber,
      objectKey: segment.objectKey,
      uploadId,
      upload,
    });
  }
);

export const reportMultipartLiveRecordingSegmentProgressV2 = asyncHandler(
  async (req, res) => {
    const recordingId = asTrimmed(req.body?.recordingId);
    const segmentIndex = Number(req.body?.segmentIndex);
    const partNumber = Number(req.body?.partNumber);
    const etag = asTrimmed(req.body?.etag);
    const sizeBytes = Number(req.body?.sizeBytes) || 0;
    const totalSizeBytes = Number(req.body?.totalSizeBytes) || 0;

    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "recordingId is required" });
    }
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
      return res.status(400).json({ message: "segmentIndex must be >= 0" });
    }
    if (!Number.isInteger(partNumber) || partNumber <= 0) {
      return res.status(400).json({ message: "partNumber must be >= 1" });
    }

    return res.json({
      ok: true,
      accepted: true,
      recordingId,
      segmentIndex,
      partNumber,
      etag,
      sizeBytes,
      totalSizeBytes,
    });
  }
);

export const completeMultipartLiveRecordingSegmentV2 = asyncHandler(
  async (req, res) => {
    const recordingId = asTrimmed(req.body?.recordingId);
    const segmentIndex = Number(req.body?.segmentIndex);
    const sizeBytes = Number(req.body?.sizeBytes) || 0;
    const durationSeconds = Number(req.body?.durationSeconds) || 0;
    const isFinal = Boolean(req.body?.isFinal);
    const parts = Array.isArray(req.body?.parts) ? req.body.parts : [];

    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "recordingId is required" });
    }
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
      return res.status(400).json({ message: "segmentIndex must be >= 0" });
    }
    if (!parts.length) {
      return res
        .status(400)
        .json({ message: "parts are required for multipart completion" });
    }

    const recording = await LiveRecordingV2.findById(recordingId);
    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    const segment = findRecordingSegment(recording, segmentIndex);
    if (!segment) {
      return res.status(404).json({ message: "Recording segment not found" });
    }
    if (segment.uploadStatus === "uploaded") {
      return res.json({
        ok: true,
        recording: serializeRecording(recording),
      });
    }

    const segmentMeta = getSegmentMeta(segment);
    const uploadId = asTrimmed(segmentMeta.uploadId);
    if (!uploadId) {
      return res.status(409).json({
        message: "Multipart upload has not been started for this segment",
      });
    }

    await completeRecordingMultipartUpload({
      objectKey: segment.objectKey,
      uploadId,
      parts,
      storageTargetId: getSegmentStorageTargetId(segment, recording),
    });

    segment.uploadStatus = "uploaded";
    assignSegmentStorageTarget(
      segment,
      getRecordingStorageTarget(getSegmentStorageTargetId(segment, recording))
    );
    segment.etag = asTrimmed(parts[parts.length - 1]?.etag) || null;
    segment.sizeBytes = sizeBytes;
    segment.durationSeconds = durationSeconds;
    segment.isFinal = isFinal;
    segment.uploadedAt = new Date();
    segment.meta = {
      ...segmentMeta,
      uploadId: null,
      completedParts: parts.map((part) => {
        const existingPart = Array.isArray(segmentMeta.completedParts)
          ? segmentMeta.completedParts.find(
              (item) => Number(item?.partNumber) === Number(part?.partNumber)
            )
          : null;
        return {
          partNumber: Number(part.partNumber) || 0,
          etag: asTrimmed(part.etag),
          sizeBytes: Number(existingPart?.sizeBytes) || 0,
        };
      }),
      completedPartCount: parts.length,
      completedBytes: parts.reduce((sum, part) => {
        const existingPart = Array.isArray(segmentMeta.completedParts)
          ? segmentMeta.completedParts.find(
              (item) => Number(item?.partNumber) === Number(part?.partNumber)
            )
          : null;
        return sum + (Number(existingPart?.sizeBytes) || 0);
      }, 0),
      totalSizeBytes: sizeBytes,
      completedAt: new Date().toISOString(),
    };

    if (!shouldPreserveExportState(recording)) {
      recording.status = "uploading";
      recording.error = null;
    }
    recording.sizeBytes = (recording.segments || []).reduce(
      (sum, item) => sum + (Number(item.sizeBytes) || 0),
      0
    );
    recording.durationSeconds = (recording.segments || []).reduce(
      (sum, item) => sum + (Number(item.durationSeconds) || 0),
      0
    );
    await recording.save();
    await publishRecordingMonitor(recording, "multipart_segment_uploaded");

    return res.json({
      ok: true,
      recording: serializeRecording(recording),
    });
  }
);

export const abortMultipartLiveRecordingSegmentV2 = asyncHandler(
  async (req, res) => {
    const recordingId = asTrimmed(req.body?.recordingId);
    const segmentIndex = Number(req.body?.segmentIndex);

    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "recordingId is required" });
    }
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
      return res.status(400).json({ message: "segmentIndex must be >= 0" });
    }

    const recording = await LiveRecordingV2.findById(recordingId);
    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    const segment = findRecordingSegment(recording, segmentIndex);
    if (!segment) {
      return res.json({ ok: true, aborted: false });
    }
    if (segment.uploadStatus === "uploaded") {
      return res.json({ ok: true, aborted: false, alreadyUploaded: true });
    }

    const segmentMeta = getSegmentMeta(segment);
    const uploadId = asTrimmed(segmentMeta.uploadId);

    if (uploadId && segment.objectKey) {
      try {
        await abortRecordingMultipartUpload({
          objectKey: segment.objectKey,
          uploadId,
          storageTargetId: getSegmentStorageTargetId(segment, recording),
        });
      } catch (error) {
        const message = String(error?.message || "");
        if (!/NoSuchUpload/i.test(message)) {
          throw error;
        }
      }
    }

    segment.uploadStatus = "aborted";
    segment.meta = {
      ...segmentMeta,
      uploadId: null,
      abortedAt: new Date().toISOString(),
    };
    await recording.save();
    await publishRecordingMonitor(recording, "multipart_segment_aborted");

    return res.json({
      ok: true,
      aborted: true,
      recording: serializeRecording(recording),
    });
  }
);

export const completeLiveRecordingSegmentV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.body?.recordingId);
  const segmentIndex = Number(req.body?.segmentIndex);
  const objectKey = asTrimmed(req.body?.objectKey);
  const etag = asTrimmed(req.body?.etag) || null;
  const sizeBytes = Number(req.body?.sizeBytes) || 0;
  const durationSeconds = Number(req.body?.durationSeconds) || 0;
  const startedAt = normalizeIsoTimestamp(req.body?.startedAt);
  const isFinal = Boolean(req.body?.isFinal);

  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "recordingId is required" });
  }
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    return res.status(400).json({ message: "segmentIndex must be >= 0" });
  }
  if (!objectKey) {
    return res.status(400).json({ message: "objectKey is required" });
  }

  const recording = await LiveRecordingV2.findById(recordingId);
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  const existing = recording.segments.find(
    (segment) => segment.index === segmentIndex
  );
  if (existing) {
    existing.objectKey = objectKey;
    if (!getSegmentStorageTargetId(existing, recording)) {
      assignSegmentStorageTarget(
        existing,
        getRecordingStorageTarget(recording.r2TargetId)
      );
    }
    existing.uploadStatus = "uploaded";
    existing.etag = etag;
    existing.sizeBytes = sizeBytes;
    existing.durationSeconds = durationSeconds;
    existing.isFinal = isFinal;
    existing.uploadedAt = new Date();
    existing.meta = {
      ...getSegmentMeta(existing),
      ...(startedAt ? { startedAt } : {}),
    };
  } else {
    const activeStorageTarget =
      getRecordingStorageTarget(recording.r2TargetId) ||
      (await ensureRecordingStorageTargetForWrite(recording, {
        reason: "segment_single_put_complete",
      }));
    recording.segments.push({
      index: segmentIndex,
      objectKey,
      storageTargetId: activeStorageTarget?.id || recording.r2TargetId || null,
      bucketName:
        activeStorageTarget?.bucketName || recording.r2BucketName || null,
      uploadStatus: "uploaded",
      etag,
      sizeBytes,
      durationSeconds,
      isFinal,
      uploadedAt: new Date(),
      meta: startedAt ? { startedAt } : {},
    });
  }

  if (!shouldPreserveExportState(recording)) {
    recording.status = "uploading";
    recording.error = null;
  }
  recording.sizeBytes = (recording.segments || []).reduce(
    (sum, segment) => sum + (Number(segment.sizeBytes) || 0),
    0
  );
  recording.durationSeconds = (recording.segments || []).reduce(
    (sum, segment) => sum + (Number(segment.durationSeconds) || 0),
    0
  );
  await recording.save();
  await publishRecordingMonitor(recording, "segment_uploaded_legacy");

  return res.json({
    ok: true,
    recording: serializeRecording(recording),
  });
});

export const finalizeLiveRecordingV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.body?.recordingId);
  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "recordingId is required" });
  }

  const recording = await LiveRecordingV2.findById(recordingId);
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  const uploadedSegments = getUploadedRecordingSegments(recording);
  const pendingSegments = getPendingRecordingSegments(recording);

  if (!uploadedSegments.length) {
    return res.status(400).json({
      message: "Cannot finalize a recording with no uploaded segments",
    });
  }
  if (pendingSegments.length) {
    return res.status(409).json({
      message: "Cannot finalize recording until all segments are uploaded",
      pendingSegments: pendingSegments.length,
    });
  }

  await queueLiveRecordingExport(recording, {
    publishReason: "recording_export_queued",
  });

  return res.json({
    ok: true,
    queued: true,
    scheduledForWindow: recording.status === "pending_export_window",
    recording: serializeRecording(recording),
  });
});

export const getLiveRecordingByMatchV2 = asyncHandler(async (req, res) => {
  const matchId = asTrimmed(req.params?.matchId);
  if (!isValidObjectId(matchId)) {
    return res.status(400).json({ message: "matchId is invalid" });
  }

  const recording = await LiveRecordingV2.findOne({ match: matchId }).sort({
    createdAt: -1,
  });

  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  return res.json({
    ok: true,
    recording: serializeRecording(recording),
  });
});

export const getLiveRecordingMonitorV2 = asyncHandler(async (req, res) => {
  const snapshot = await buildLiveRecordingMonitorPage({
    section: req.query?.section,
    status: req.query?.status,
    commentary: req.query?.commentary,
    view: req.query?.view,
    q: req.query?.q,
    tournament: req.query?.tournament,
    page: req.query?.page,
    limit: req.query?.limit,
    forceRefresh:
      String(req.query?.forceRefresh || "").trim().toLowerCase() === "true",
  });
  return res.json(snapshot);
});

export const getLiveRecordingMonitorRowV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.params?.id || req.query?.recordingId);
  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "Recording id is invalid" });
  }

  const row = await getLiveRecordingMonitorRow(recordingId);
  if (!row) {
    return res.status(404).json({ message: "Recording not found" });
  }

  return res.json({
    ok: true,
    row,
  });
});

export const getLiveRecordingWorkerHealthV2 = asyncHandler(
  async (_req, res) => {
    await reconcileStaleLiveRecordingExports().catch(() => {});
    const health = await getLiveRecordingWorkerHealth();
    return res.json(health);
  }
);

export const getLiveRecordingAiCommentaryMonitorV2 = asyncHandler(
  async (_req, res) => {
    const monitor = await getLiveRecordingAiCommentaryMonitor();
    return res.json(monitor);
  }
);

export const queueLiveRecordingAiCommentaryV2 = asyncHandler(
  async (req, res) => {
    const recordingId = asTrimmed(req.params?.id || req.body?.recordingId);
    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "Recording id is invalid" });
    }

    try {
      const result = await enqueueLiveRecordingAiCommentaryJob({
        recordingId,
        triggerMode: "manual",
        requestedBy: buildRequestedByActor(req.user),
        forceRerender: false,
      });
      return res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      return res.status(error?.statusCode || 500).json({
        message: error?.message || "Failed to queue AI commentary job",
      });
    }
  }
);

export const rerenderLiveRecordingAiCommentaryV2 = asyncHandler(
  async (req, res) => {
    const recordingId = asTrimmed(req.params?.id || req.body?.recordingId);
    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "Recording id is invalid" });
    }

    try {
      const result = await enqueueLiveRecordingAiCommentaryJob({
        recordingId,
        triggerMode: "manual",
        requestedBy: buildRequestedByActor(req.user),
        forceRerender: true,
      });
      return res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      return res.status(error?.statusCode || 500).json({
        message: error?.message || "Failed to rerender AI commentary",
      });
    }
  }
);

export const getLiveRecordingDriveAssetV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.params?.id || req.query?.recordingId);
  const target = normalizeDriveAssetTarget(req.query?.target || req.body?.target);

  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "Recording id is invalid" });
  }

  const recording = await LiveRecordingV2.findById(recordingId);
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  const asset = getRecordingDriveAssetInfo(recording, target);
  if (!asset.fileId) {
    return res.status(404).json({
      message: `${asset.label} chưa có Drive fileId`,
      target,
      recording: serializeRecording(recording),
    });
  }

  try {
    const result = await getRecordingDriveFileMetadata(asset.fileId);
    setRecordingDriveAssetMeta(recording, target, result.file);
    await recording.save();
    await publishRecordingMonitor(recording, `recording_drive_asset_inspected_${target}`);

    return res.json({
      ok: true,
      target,
      asset,
      file: result.file,
      driveAuthMode: result.driveAuthMode,
      recording: serializeRecording(recording),
    });
  } catch (error) {
    return res.status(502).json({
      message: error?.message || "Failed to inspect Drive asset",
      target,
      recording: serializeRecording(recording),
    });
  }
});

export const renameLiveRecordingDriveAssetV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.params?.id || req.body?.recordingId);
  const target = normalizeDriveAssetTarget(req.body?.target);
  const name = asTrimmed(req.body?.name);

  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "Recording id is invalid" });
  }
  if (!name) {
    return res.status(400).json({ message: "Drive file name is required" });
  }

  const recording = await LiveRecordingV2.findById(recordingId);
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  const asset = getRecordingDriveAssetInfo(recording, target);
  if (!asset.fileId) {
    return res.status(404).json({ message: `${asset.label} chưa có Drive fileId` });
  }

  try {
    const result = await renameRecordingDriveFile({
      fileId: asset.fileId,
      name,
    });
    setRecordingDriveAssetMeta(recording, target, result.file);
    await recording.save();
    await publishRecordingMonitor(recording, `recording_drive_asset_renamed_${target}`);

    return res.json({
      ok: true,
      target,
      file: result.file,
      driveAuthMode: result.driveAuthMode,
      recording: serializeRecording(recording),
    });
  } catch (error) {
    return res.status(502).json({
      message: error?.message || "Failed to rename Drive asset",
      target,
      recording: serializeRecording(recording),
    });
  }
});

export const moveLiveRecordingDriveAssetV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.params?.id || req.body?.recordingId);
  const target = normalizeDriveAssetTarget(req.body?.target);
  const folderId = asTrimmed(req.body?.folderId);

  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "Recording id is invalid" });
  }

  const recording = await LiveRecordingV2.findById(recordingId);
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  const asset = getRecordingDriveAssetInfo(recording, target);
  if (!asset.fileId) {
    return res.status(404).json({ message: `${asset.label} chưa có Drive fileId` });
  }

  try {
    const result = await moveRecordingDriveFile({
      fileId: asset.fileId,
      folderId,
    });
    setRecordingDriveAssetMeta(recording, target, result.file);
    await recording.save();
    await publishRecordingMonitor(recording, `recording_drive_asset_moved_${target}`);

    return res.json({
      ok: true,
      target,
      file: result.file,
      targetFolder: result.targetFolder || null,
      driveAuthMode: result.driveAuthMode,
      recording: serializeRecording(recording),
    });
  } catch (error) {
    return res.status(502).json({
      message: error?.message || "Failed to move Drive asset",
      target,
      recording: serializeRecording(recording),
    });
  }
});

export const trashLiveRecordingDriveAssetV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.params?.id || req.body?.recordingId);
  const target = normalizeDriveAssetTarget(req.body?.target);

  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "Recording id is invalid" });
  }

  const recording = await LiveRecordingV2.findById(recordingId);
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  const asset = getRecordingDriveAssetInfo(recording, target);
  if (!asset.fileId) {
    return res.status(404).json({ message: `${asset.label} chưa có Drive fileId` });
  }

  try {
    const result = await trashRecordingDriveAssetByAdmin(recording, target);
    return res.json({
      ok: true,
      target,
      ...result,
    });
  } catch (error) {
    return res.status(502).json({
      message: error?.message || "Failed to permanently delete Drive asset",
      target,
      recording: serializeRecording(recording),
    });
  }
});

export const bulkTrashLiveRecordingDriveAssetV2 = asyncHandler(async (req, res) => {
  const target = normalizeDriveAssetTarget(req.body?.target);
  const rawRecordingIds = Array.isArray(req.body?.recordingIds)
    ? req.body.recordingIds
    : Array.isArray(req.body?.ids)
    ? req.body.ids
    : [];
  const recordingIds = [
    ...new Set(rawRecordingIds.map((value) => asTrimmed(value)).filter(Boolean)),
  ];
  const invalidRecordingIds = recordingIds.filter((value) => !isValidObjectId(value));
  const validRecordingIds = recordingIds.filter((value) => isValidObjectId(value));

  if (!validRecordingIds.length) {
    return res.status(400).json({
      message: "Cần ít nhất một recording hợp lệ để xóa",
      target,
      invalidRecordingIds,
    });
  }

  const recordings = await LiveRecordingV2.find({ _id: { $in: validRecordingIds } });
  const recordingsById = new Map(recordings.map((recording) => [String(recording._id), recording]));
  const limit = pLimit(4);

  const results = await Promise.all(
    validRecordingIds.map((recordingId) => {
      const recording = recordingsById.get(recordingId);
      if (!recording) {
        return {
          ok: false,
          recordingId,
          target,
          code: "RECORDING_NOT_FOUND",
          message: "Recording not found",
        };
      }

      return limit(async () => {
        try {
          const result = await trashRecordingDriveAssetByAdmin(recording, target);
          return {
            ok: true,
            recordingId,
            target,
            file: result.file,
            driveAuthMode: result.driveAuthMode,
            recording: result.recording,
          };
        } catch (error) {
          return {
            ok: false,
            recordingId,
            target,
            code: error?.code || "DRIVE_ASSET_DELETE_FAILED",
            statusCode: Number(error?.statusCode || 502),
            message: error?.message || "Failed to permanently delete Drive asset",
            recording: serializeRecording(recording),
          };
        }
      });
    })
  );

  const deletedCount = results.filter((item) => item?.ok).length;
  const failedCount = results.length - deletedCount;

  return res.json({
    ok: true,
    target,
    total: recordingIds.length,
    processedCount: results.length,
    invalidRecordingIds,
    invalidCount: invalidRecordingIds.length,
    deletedCount,
    failedCount,
    results,
  });
});

export const retryLiveRecordingExportV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.params?.id || req.body?.recordingId);
  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "Recording id is invalid" });
  }

  await reconcileStaleLiveRecordingExports().catch(() => {});

  const recording = await LiveRecordingV2.findById(recordingId);
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  const health = await getLiveRecordingWorkerHealth().catch(() => null);
  const currentWorkerRecordingId = String(
    health?.worker?.currentRecordingId || ""
  );
  if (
    currentWorkerRecordingId &&
    currentWorkerRecordingId === String(recording._id)
  ) {
    return res
      .status(409)
      .json({ message: "Recording is already being exported by worker" });
  }

  const nextMeta = getRecordingMeta(recording);
  const currentPipeline =
    nextMeta.exportPipeline &&
    typeof nextMeta.exportPipeline === "object" &&
    !Array.isArray(nextMeta.exportPipeline)
      ? { ...nextMeta.exportPipeline }
      : {};

  const allowedRetry =
    recording.status === "pending_export_window" ||
    recording.status === "failed" ||
    currentPipeline.stage === "stale_no_job" ||
    currentPipeline.staleReason === "stale_no_job" ||
    currentPipeline.staleReason === "worker_offline";

  if (!allowedRetry) {
    return res.status(409).json({
      message:
        "Only failed, stale, or pending-window recordings can be retried",
    });
  }

  const exportSource = resolveLiveRecordingExportSource(recording);
  const uploadedSegments = getUploadedRecordingSegments(recording);
  if (
    !uploadedSegments.length &&
    exportSource.type !== RECORDING_SOURCE_FACEBOOK_VOD
  ) {
    return res.status(400).json({
      message: "Cannot retry export because recording has no uploaded segments",
    });
  }
  await queueLiveRecordingExport(recording, {
    publishReason: "recording_export_retried",
    replaceTerminalJob: true,
    replacePendingJob: true,
    currentPipeline,
  });

  return res.json({
    ok: true,
    queued: true,
    recording: serializeRecording(recording),
  });
});

export const forceUploadingRecordingToExportV2 = asyncHandler(
  async (req, res) => {
    const recordingId = asTrimmed(req.params?.id || req.body?.recordingId);
    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "Recording id is invalid" });
    }

    const recording = await LiveRecordingV2.findById(recordingId);
    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    if (!["uploading", "pending_export_window"].includes(recording.status)) {
      return res.status(409).json({
        message:
          "Only uploading or pending-window recordings can be moved to exporting",
      });
    }

    const uploadedSegments = getUploadedRecordingSegments(recording);
    if (!uploadedSegments.length) {
      return res.status(400).json({
        message:
          "Cannot move to exporting because recording has no uploaded segments",
      });
    }

    const pendingSegments = getPendingRecordingSegments(recording);
    const skippedPendingSegments = pendingSegments.length;

    await queueLiveRecordingExport(recording, {
      publishReason:
        recording.status === "pending_export_window"
          ? "recording_export_forced_from_pending_window"
          : "recording_export_forced_from_uploading",
      forceFromUploading: recording.status === "uploading",
      replacePendingJob: recording.status === "pending_export_window",
      forceReason: skippedPendingSegments
        ? "manual_force_export_with_pending_segments"
        : "manual_force_export",
      ignoreWindow: true,
    });

    return res.json({
      ok: true,
      queued: true,
      skippedPendingSegments,
      recording: serializeRecording(recording),
    });
  }
);

export const playLiveRecordingV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.params?.id);
  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "Recording id is invalid" });
  }

  const recording = await LiveRecordingV2.findById(recordingId).lean();
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  if (recording.driveFileId) {
    return res.redirect(buildRecordingRawStreamUrl(recording._id));
  }
  if (recording.driveRawUrl) {
    return res.redirect(recording.driveRawUrl);
  }
  if (recording.status === "ready") {
    if (recording.drivePreviewUrl) {
      return res.redirect(recording.drivePreviewUrl);
    }
  }
  if (isRecordingTemporaryPlaybackReady(recording)) {
    return res.redirect(buildRecordingTemporaryPlaybackUrl(recording._id));
  }

  return res.status(409).json({
    ok: false,
    status: recording.status,
    message: "Recording is not ready yet",
    recording: serializeRecording(recording),
  });
});

export const playLiveRecordingAiCommentaryV2 = asyncHandler(
  async (req, res) => {
    const recordingId = asTrimmed(req.params?.id);
    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "Recording id is invalid" });
    }

    const recording = await LiveRecordingV2.findById(recordingId).lean();
    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    const commentary = getAiCommentaryAsset(recording);
    if (commentary.fileId) {
      return res.redirect(buildRecordingAiCommentaryRawUrl(recording._id));
    }
    if (commentary.rawUrl) {
      return res.redirect(commentary.rawUrl);
    }
    if (commentary.previewUrl) {
      return res.redirect(commentary.previewUrl);
    }

    return res.status(409).json({
      ok: false,
      status: recording?.aiCommentary?.status || "idle",
      message: "AI commentary video is not ready yet",
      recording: serializeRecording(recording),
    });
  }
);

export const getLiveRecordingTemporaryPlaylistV2 = asyncHandler(
  async (req, res) => {
    const recordingId = asTrimmed(req.params?.id);
    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "Recording id is invalid" });
    }

    const recording = await LiveRecordingV2.findById(recordingId).lean();
    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    // For finished recordings with a drive export, redirect to that
    if (
      recording.driveFileId || recording.driveRawUrl
    ) {
      // Only redirect if the recording is actually finalized
      if (recording.finalizedAt) {
        return res.json({
          ok: true,
          ready: true,
          redirectUrl: buildRecordingPlaybackUrl(recording._id),
          recording: serializeRecording(recording),
        });
      }
    }

    const uploadedSegments = getUploadedRecordingSegments(recording);
    if (uploadedSegments.length === 0) {
       return res.status(409).json({
        ok: false,
        status: recording.status,
        message: "Recording temporary playback is not ready yet",
        recording: serializeRecording(recording),
      });
    }

    const isFinished = isFinishedRecordingPlayback(recording);
    const delaySeconds = isFinished ? 0 : getLiveServer2DelaySeconds();
    const refreshSeconds = getPlaylistRefreshSeconds(uploadedSegments, {
      isFinished,
    });
    const targetDurationSeconds = getPlaylistTargetDurationSeconds(
      uploadedSegments
    );
    const recommendedStartIndex = getRecommendedStartSegmentIndex(
      uploadedSegments,
      {
        isFinished,
        delaySeconds,
      }
    );
    const afterIndex = parseOptionalSegmentIndex(req.query?.afterIndex);
    const requestedLimit = parseOptionalPositiveInteger(req.query?.limit);
    const windowSegmentCount = getPlaylistWindowSegmentCount(
      targetDurationSeconds,
      requestedLimit
    );
    const responseStartIndex =
      afterIndex != null
        ? afterIndex
        : !isFinished && recommendedStartIndex != null
          ? Math.max(0, recommendedStartIndex - 1)
          : null;
    const filteredSegments =
      responseStartIndex == null
        ? uploadedSegments
        : uploadedSegments.filter(
            (segment) => Number(segment?.index ?? -1) >= responseStartIndex
          );
    const responseSegments =
      !isFinished && filteredSegments.length > windowSegmentCount
        ? filteredSegments.slice(0, windowSegmentCount)
        : filteredSegments;

    const multiSourceEnabled = isLiveMultiSourceEnabled();
    let fallbackPublicBaseUrl = "";
    if (multiSourceEnabled) {
      fallbackPublicBaseUrl = asTrimmed(
        recording?.meta?.livePlayback?.publicBaseUrl
      );
      if (!fallbackPublicBaseUrl) {
        try {
          fallbackPublicBaseUrl = asTrimmed(
            getRecordingPublicBaseUrl(recording?.r2TargetId)
          );
        } catch {
          fallbackPublicBaseUrl = "";
        }
      }
    }
    const targetPublicBaseUrls = multiSourceEnabled
      ? buildRecordingTargetPublicBaseUrls(recording)
      : {};

    const segments = await Promise.all(
      responseSegments.map(async (segment) => {
        const cdnUrl = multiSourceEnabled
          ? buildSegmentPublicCdnUrl(segment, recording, {
              targetPublicBaseUrls,
              fallbackPublicBaseUrl,
            })
          : "";

        const download = !cdnUrl
          ? await createRecordingObjectDownloadUrl({
              objectKey: segment.objectKey,
              expiresInSeconds: 60 * 60 * 12,
              storageTargetId: getSegmentStorageTargetId(segment, recording),
            })
          : null;

        return {
          index: segment.index,
          objectKey: segment.objectKey,
          storageTargetId:
            getSegmentStorageTargetId(segment, recording) || null,
          durationSeconds: segment.durationSeconds || 0,
          sizeBytes: segment.sizeBytes || 0,
          isFinal: Boolean(segment.isFinal),
          url: cdnUrl || download?.downloadUrl || "",
          expiresInSeconds: download?.expiresInSeconds || null,
        };
      })
    );

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Cache-Control",
      isFinished
        ? "private, max-age=60, stale-while-revalidate=120"
        : "no-cache, max-age=2, stale-while-revalidate=2"
    );

    return res.json({
      ok: true,
      ready: true,
      isFinished,
      delaySeconds,
      refreshSeconds,
      targetDurationSeconds,
      windowSegmentCount,
      recommendedStartIndex,
      firstAvailableSegmentIndex:
        uploadedSegments[0]?.index != null ? Number(uploadedSegments[0].index) : null,
      lastAvailableSegmentIndex:
        uploadedSegments[uploadedSegments.length - 1]?.index != null
          ? Number(uploadedSegments[uploadedSegments.length - 1].index)
          : null,
      responseFromSegmentIndex:
        segments[0]?.index != null ? Number(segments[0].index) : null,
      responseToSegmentIndex:
        segments[segments.length - 1]?.index != null
          ? Number(segments[segments.length - 1].index)
          : null,
      playbackUrl: buildRecordingPlaybackUrl(recording._id),
      temporaryPlaybackUrl: buildRecordingTemporaryPlaybackUrl(recording._id),
      temporaryPlaylistUrl: buildRecordingTemporaryPlaylistUrl(recording._id),
      recording: serializeRecording(recording),
      segments,
    });
  }
);

// ── HLS Live Playlist (.m3u8) ──
// Generates a live HLS playlist from the recording's uploaded segments.
// During live: rolling window with delay truncation, no EXT-X-ENDLIST.
// After finished: all segments, with EXT-X-ENDLIST.
// hls.js on the frontend will auto-poll this and handle buffering seamlessly.
export const serveLiveHlsPlaylistV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.params?.id);
  if (!isValidObjectId(recordingId)) {
    return res.status(400).type("text/plain").send("Invalid recording id");
  }

  const recording = await LiveRecordingV2.findById(recordingId).lean();
  if (!recording) {
    return res.status(404).type("text/plain").send("Recording not found");
  }

  const multiSourceEnabled = isLiveMultiSourceEnabled();
  const delaySeconds = getLiveServer2DelaySeconds();
  const uploadedSegments = getUploadedRecordingSegments(recording);

  if (!uploadedSegments.length) {
    // Return an empty live playlist while no segments yet
    const empty = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:6",
      "#EXT-X-MEDIA-SEQUENCE:0",
      "",
    ].join("\n");
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache, no-store");
    return res.send(empty);
  }

  // Determine the public CDN base URL for segments
  let publicBaseUrl = "";
  let targetPublicBaseUrls = {};
  if (multiSourceEnabled) {
    publicBaseUrl = asTrimmed(recording?.meta?.livePlayback?.publicBaseUrl);
    if (!publicBaseUrl) {
      try {
        const baseResult = getRecordingPublicBaseUrl(recording.r2TargetId);
        publicBaseUrl = asTrimmed(baseResult);
      } catch {
        publicBaseUrl = "";
      }
    }
    targetPublicBaseUrls = buildRecordingTargetPublicBaseUrls(recording);
  }

  // Check if the recording is finished
  const isFinished = isFinishedRecordingPlayback(recording);

  // Build segment list with delay truncation for live streams
  let playableSegments;
  if (isFinished) {
    playableSegments = uploadedSegments;
  } else {
    // Apply delay truncation — same logic as native app
    const totalDuration = uploadedSegments.reduce(
      (sum, seg) => sum + Math.max(0, Number(seg.durationSeconds || 0)),
      0
    );
    const safeDuration = Math.max(0, totalDuration - delaySeconds);
    let cumulative = 0;
    playableSegments = [];
    for (const segment of uploadedSegments) {
      cumulative += Math.max(0, Number(segment.durationSeconds || 0));
      if (cumulative - safeDuration > 0.0001) break;
      playableSegments.push(segment);
    }
    // Rolling window: keep last 180 segments max
    if (playableSegments.length > 180) {
      playableSegments = playableSegments.slice(-180);
    }
  }

  if (!playableSegments.length) {
    const empty = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:6",
      "#EXT-X-MEDIA-SEQUENCE:0",
      "",
    ].join("\n");
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache, no-store");
    return res.send(empty);
  }

  // Calculate target duration (max segment duration, rounded up)
  const targetDuration = Math.ceil(
    playableSegments.reduce(
      (max, seg) => Math.max(max, Number(seg.durationSeconds || 0)),
      0
    )
  );
  const mediaSequence = playableSegments[0]?.index ?? 0;

  // Build segment URLs using per-target CDN public base URLs when available,
  // otherwise fall back to signed download URLs.
  const segmentLines = await Promise.all(
    playableSegments.map(async (segment, i) => {
      let prefix = "";
      if (
        i > 0 &&
        segment.index !== playableSegments[i - 1].index + 1
      ) {
        prefix = "#EXT-X-DISCONTINUITY\n";
      }

      const cdnUrl = multiSourceEnabled
        ? buildSegmentPublicCdnUrl(segment, recording, {
            targetPublicBaseUrls,
            fallbackPublicBaseUrl: publicBaseUrl,
          })
        : "";
      const dur = Number(segment.durationSeconds || 6).toFixed(3);
      if (cdnUrl) {
        return `${prefix}#EXTINF:${dur},\n${cdnUrl}`;
      }

      const download = await createRecordingObjectDownloadUrl({
        objectKey: segment.objectKey,
        expiresInSeconds: 60 * 60 * 2,
        storageTargetId: getSegmentStorageTargetId(segment, recording),
      });
      return `${prefix}#EXTINF:${dur},\n${download.downloadUrl}`;
    })
  );

  // Build the m3u8 playlist
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    isFinished ? "#EXT-X-PLAYLIST-TYPE:VOD" : "",
    `#EXT-X-TARGETDURATION:${targetDuration || 6}`,
    `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`,
    "",
    ...segmentLines,
  ];

  // The EXT-X-START was removed here because physical truncation of playableSegments
  // already delays the live edge. Adding an additional negative time-offset causes
  // players to seek outside the available window, causing buffering loops.
  // For finished recordings, signal end-of-stream
  if (isFinished) {
    lines.push("");
    lines.push("#EXT-X-ENDLIST");
  }

  const playlist = lines.filter(Boolean).join("\n") + "\n";

  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Live: short cache; Finished: longer cache
  res.setHeader(
    "Cache-Control",
    isFinished
      ? "public, max-age=3600"
      : "no-cache, max-age=2, stale-while-revalidate=2"
  );

  return res.send(playlist);
});

export const playLiveRecordingTemporaryV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.params?.id);
  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "Recording id is invalid" });
  }

  const recording = await LiveRecordingV2.findById(recordingId).lean();
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  if (recording.driveFileId || recording.driveRawUrl) {
    return res.redirect(buildRecordingPlaybackUrl(recording._id));
  }

  if (!isRecordingTemporaryPlaybackReady(recording)) {
    return res.status(409).json({
      ok: false,
      status: recording.status,
      message: "Recording temporary playback is not ready yet",
      recording: serializeRecording(recording),
    });
  }

  const playlistUrl = buildRecordingTemporaryPlaylistUrl(recording._id);
  const playbackUrl = buildRecordingPlaybackUrl(recording._id);

  res.removeHeader("X-Frame-Options");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src * data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors *"
  );
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader(
    "Cache-Control",
    "private, max-age=30, stale-while-revalidate=30"
  );
  res.type("html");
  return res.send(
    buildTemporaryPlaybackHtml({
      recording,
      playlistUrl,
      playbackUrl,
    })
  );
});

function applyRawVideoHeaders(
  res,
  headers = {},
  recordingId,
  fileLabel = `recording-${String(recordingId)}.mp4`
) {
  const headerEntries = [
    ["content-type", "Content-Type"],
    ["content-length", "Content-Length"],
    ["content-range", "Content-Range"],
    ["accept-ranges", "Accept-Ranges"],
    ["etag", "ETag"],
    ["last-modified", "Last-Modified"],
  ];

  headerEntries.forEach(([sourceKey, targetKey]) => {
    const value = headers[sourceKey];
    if (value != null && value !== "") {
      res.setHeader(targetKey, value);
    }
  });

  if (!res.getHeader("Content-Type")) {
    res.setHeader("Content-Type", "video/mp4");
  }
  if (!res.getHeader("Accept-Ranges")) {
    res.setHeader("Accept-Ranges", "bytes");
  }

  res.setHeader("Content-Disposition", `inline; filename="${fileLabel}"`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Accept-Ranges, Content-Length, Content-Range, Content-Type"
  );
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader(
    "Cache-Control",
    "public, max-age=300, stale-while-revalidate=60"
  );
}

function parseByteRangeHeader(rangeHeader, totalSize) {
  const total = Number(totalSize);
  if (!Number.isFinite(total) || total <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader || "").trim());
  if (!match) return null;

  const startRaw = match[1];
  const endRaw = match[2];

  if (!startRaw && !endRaw) return null;

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(0, total - suffixLength);
    const end = total - 1;
    return {
      start,
      end,
      length: end - start + 1,
      total,
    };
  }

  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0 || start >= total) return null;

  let end = endRaw ? Number(endRaw) : total - 1;
  if (!Number.isFinite(end) || end < start) return null;
  end = Math.min(end, total - 1);

  return {
    start,
    end,
    length: end - start + 1,
    total,
  };
}

function applyRawVideoFallbackRangeHeaders(res, { rangeHeader, totalSize }) {
  const parsedRange = parseByteRangeHeader(rangeHeader, totalSize);

  if (parsedRange) {
    if (!res.getHeader("Content-Range")) {
      res.setHeader(
        "Content-Range",
        `bytes ${parsedRange.start}-${parsedRange.end}/${parsedRange.total}`
      );
    }
    if (!res.getHeader("Content-Length")) {
      res.setHeader("Content-Length", String(parsedRange.length));
    }
    return;
  }

  const normalizedTotal = Number(totalSize);
  if (
    Number.isFinite(normalizedTotal) &&
    normalizedTotal > 0 &&
    !res.getHeader("Content-Length")
  ) {
    res.setHeader("Content-Length", String(normalizedTotal));
  }
}

export const streamLiveRecordingRawV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.params?.id);
  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "Recording id is invalid" });
  }

  const recording = await LiveRecordingV2.findById(recordingId).lean();
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  if (!recording.driveFileId && recording.driveRawUrl) {
    return res.redirect(recording.driveRawUrl);
  }

  if (!recording.driveFileId) {
    return res.status(409).json({
      ok: false,
      ready: false,
      status: recording.status,
      message: "Recording raw stream is not ready yet",
      recording: serializeRecording(recording),
    });
  }

  const rangeHeader = asTrimmed(req.headers?.range);
  let streamResult;
  try {
    streamResult = await streamRecordingDriveFile({
      fileId: recording.driveFileId,
      rangeHeader,
    });
  } catch (error) {
    if (recording.driveRawUrl) {
      return res.redirect(recording.driveRawUrl);
    }
    throw error;
  }

  const { response, driveAuthMode } = streamResult;

  applyRawVideoHeaders(res, response?.headers || {}, recording._id);
  applyRawVideoFallbackRangeHeaders(res, {
    rangeHeader,
    totalSize: recording.sizeBytes,
  });
  res.setHeader("X-Recording-Drive-Auth-Mode", driveAuthMode || "unknown");

  const statusCode = Number(response?.status) || (rangeHeader ? 206 : 200);
  res.status(statusCode);
  if (!response?.data?.pipe) {
    return res.status(502).json({
      ok: false,
      message: "Raw stream response is invalid",
      recording: serializeRecording(recording),
    });
  }

  response.data.on("error", () => {
    if (!res.headersSent) {
      res.status(502).end();
      return;
    }
    res.destroy();
  });
  req.on("close", () => {
    response?.data?.destroy?.();
  });
  response.data.pipe(res);
});

export const streamLiveRecordingAiCommentaryRawV2 = asyncHandler(
  async (req, res) => {
    const recordingId = asTrimmed(req.params?.id);
    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "Recording id is invalid" });
    }

    const recording = await LiveRecordingV2.findById(recordingId).lean();
    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    const commentary = getAiCommentaryAsset(recording);
    if (!commentary.fileId && commentary.rawUrl) {
      return res.redirect(commentary.rawUrl);
    }

    if (!commentary.fileId) {
      return res.status(409).json({
        ok: false,
        ready: false,
        status: recording?.aiCommentary?.status || "idle",
        message: "AI commentary raw stream is not ready yet",
        recording: serializeRecording(recording),
      });
    }

    const rangeHeader = asTrimmed(req.headers?.range);
    let streamResult;
    try {
      streamResult = await streamRecordingDriveFile({
        fileId: commentary.fileId,
        rangeHeader,
      });
    } catch (error) {
      if (commentary.rawUrl) {
        return res.redirect(commentary.rawUrl);
      }
      throw error;
    }

    const { response, driveAuthMode } = streamResult;

    applyRawVideoHeaders(
      res,
      response?.headers || {},
      recording._id,
      `recording-${String(recording._id)}-ai-commentary.mp4`
    );
    applyRawVideoFallbackRangeHeaders(res, {
      rangeHeader,
      totalSize:
        Number(recording?.aiCommentary?.outputSizeBytes) || recording.sizeBytes,
    });
    res.setHeader("X-Recording-Drive-Auth-Mode", driveAuthMode || "unknown");

    const statusCode = Number(response?.status) || (rangeHeader ? 206 : 200);
    res.status(statusCode);
    if (!response?.data?.pipe) {
      return res.status(502).json({
        ok: false,
        message: "AI commentary raw stream response is invalid",
        recording: serializeRecording(recording),
      });
    }

    response.data.on("error", () => {
      if (!res.headersSent) {
        res.status(502).end();
        return;
      }
      res.destroy();
    });
    req.on("close", () => {
      response?.data?.destroy?.();
    });
    response.data.pipe(res);
  }
);

export const getLiveRecordingRawStatusV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.params?.id);
  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "Recording id is invalid" });
  }

  const recording = await LiveRecordingV2.findById(recordingId).lean();
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  const links = ensureRecordingPlaybackUrl(recording);
  const payload = {
    ok: true,
    ready: false,
    status: recording.status,
    rawStreamUrl: links.rawStreamUrl,
    rawStatusUrl: links.rawStatusUrl,
    playbackUrl: links.playbackUrl,
    recording: serializeRecording(recording),
  };

  if (!recording.driveFileId && recording.driveRawUrl) {
    return res.json({
      ...payload,
      ready: true,
      message: "Raw video is available via stored Drive raw URL",
    });
  }

  if (!recording.driveFileId) {
    return res.json({
      ...payload,
      message: "Drive file has not been uploaded yet",
    });
  }

  try {
    const probe = await probeRecordingDriveFile(recording.driveFileId);
    return res.json({
      ...payload,
      ok: true,
      ready: true,
      message: "Raw video is ready to stream",
      probe,
    });
  } catch (error) {
    if (recording.driveRawUrl) {
      return res.json({
        ...payload,
        ok: true,
        ready: true,
        message: "Raw video fallback to stored Drive raw URL",
        probe: null,
        fallbackUrl: recording.driveRawUrl,
        warning: error?.message || "Primary Drive probe failed",
      });
    }

    return res.status(502).json({
      ...payload,
      ok: false,
      ready: false,
      message: error?.message || "Raw video is not accessible yet",
    });
  }
});
