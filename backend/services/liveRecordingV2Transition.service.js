import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import Match from "../models/matchModel.js";
import {
  buildRecordingPlaybackUrl,
  buildRecordingTemporaryPlaybackUrl,
} from "./liveRecordingV2Export.service.js";
import { getLiveRecordingExportWindowDecision } from "./liveRecordingExportWindow.service.js";
import {
  buildRecordingManifestObjectKey,
  putRecordingManifest,
} from "./liveRecordingV2Storage.service.js";
import { publishLiveRecordingMonitorUpdate } from "./liveRecordingMonitorEvents.service.js";
import { enqueueLiveRecordingExport } from "./liveRecordingV2Queue.service.js";
import {
  RECORDING_SOURCE_FACEBOOK_VOD,
  getPendingRecordingSegments,
  getUploadedRecordingSegments,
  resolveLiveRecordingExportSource,
} from "./liveRecordingFacebookVodShared.service.js";

function asMutableMeta(meta) {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? { ...meta } : {};
}

function asTrimmed(value) {
  return String(value || "").trim();
}

function getSegmentStorageTargetId(segment, recording) {
  return (
    asTrimmed(segment?.storageTargetId) ||
    asTrimmed(recording?.r2TargetId) ||
    ""
  );
}

export function getRecordingMeta(recording) {
  return asMutableMeta(recording?.meta);
}

export { getUploadedRecordingSegments, getPendingRecordingSegments };

export async function publishRecordingMonitor(recording, reason) {
  await publishLiveRecordingMonitorUpdate({
    reason,
    recordingIds: recording?._id ? [String(recording._id)] : [],
  });
}

export async function queueLiveRecordingExport(recordingOrId, options = {}) {
  const {
    publishReason = "recording_export_queued",
    replaceTerminalJob = false,
    replacePendingJob = false,
    currentPipeline = null,
    forceFromUploading = false,
    forceReason = "",
    latestSegmentActivityAt = null,
    segmentTimeoutMinutes = null,
    ignoreWindow = false,
  } = options;

  const recording =
    recordingOrId && typeof recordingOrId.save === "function"
      ? recordingOrId
      : await LiveRecordingV2.findById(recordingOrId);

  if (!recording) {
    throw new Error("Recording not found");
  }

  const sourceStatus = String(recording.status || "");
  const match =
    recording?.match &&
    typeof recording.match === "object" &&
    recording.match._id
      ? recording.match
      : await Match.findById(recording.match)
          .select("_id facebookLive updatedAt")
          .lean();
  const exportSource = resolveLiveRecordingExportSource(recording, match);
  const uploadedSegments = exportSource.uploadedSegments;
  const isFacebookVodSource =
    exportSource.type === RECORDING_SOURCE_FACEBOOK_VOD;
  if (!uploadedSegments.length && !isFacebookVodSource) {
    throw new Error("Recording has no uploaded segments");
  }
  const queuedAt = new Date();
  const exportWindow = ignoreWindow
    ? {
        enabled: false,
        shouldQueueNow: true,
        delayMs: 0,
        scheduledAt: null,
        scheduledAtIso: null,
        timezone: null,
        windowStart: null,
        windowEnd: null,
      }
    : getLiveRecordingExportWindowDecision(queuedAt);

  if (!isFacebookVodSource) {
    const manifestKey = buildRecordingManifestObjectKey({
      recordingId: recording._id,
      matchId: recording.match,
    });

    await putRecordingManifest({
      objectKey: manifestKey,
      storageTargetId: recording.r2TargetId,
      manifest: {
        recordingId: String(recording._id),
        matchId: String(recording.match),
        courtId: recording.courtId ? String(recording.courtId) : null,
        mode: recording.mode,
        quality: recording.quality,
        r2TargetId: recording.r2TargetId || null,
        r2BucketName: recording.r2BucketName || null,
        finalizedAt: queuedAt.toISOString(),
        segments: uploadedSegments.map((segment) => ({
          index: segment.index,
          objectKey: segment.objectKey,
          storageTargetId: getSegmentStorageTargetId(segment, recording) || null,
          bucketName:
            asTrimmed(segment?.bucketName) || recording?.r2BucketName || null,
          sizeBytes: segment.sizeBytes,
          durationSeconds: segment.durationSeconds,
          isFinal: segment.isFinal,
        })),
      },
    });

    recording.r2ManifestKey = manifestKey;
  }

  recording.finalizedAt = queuedAt;
  recording.status = exportWindow.shouldQueueNow
    ? "exporting"
    : "pending_export_window";
  recording.scheduledExportAt = exportWindow.shouldQueueNow
    ? null
    : exportWindow.scheduledAt || null;
  recording.readyAt = null;
  recording.error = null;
  recording.playbackUrl = buildRecordingPlaybackUrl(recording._id);

  const queuedJob = await enqueueLiveRecordingExport(recording._id, {
    replaceTerminalJob,
    replacePendingJob,
    delayMs: exportWindow.shouldQueueNow ? 0 : exportWindow.delayMs,
  });
  const nextMeta = getRecordingMeta(recording);
  const existingPipeline =
    currentPipeline && typeof currentPipeline === "object" && !Array.isArray(currentPipeline)
      ? { ...currentPipeline }
      : {};

  nextMeta.exportPipeline = {
    ...existingPipeline,
    stage: exportWindow.shouldQueueNow ? "queued" : "delayed_until_window",
    label: exportWindow.shouldQueueNow ? "Dang cho worker" : "Dang cho khung gio dem",
    sourceType: exportSource.type || null,
    queuedAt,
    queueJobId: queuedJob?.id ? String(queuedJob.id) : null,
    scheduledExportAt: exportWindow.shouldQueueNow
      ? null
      : exportWindow.scheduledAt || null,
    windowStart: exportWindow.windowStart || null,
    windowEnd: exportWindow.windowEnd || null,
    timezone: exportWindow.timezone || null,
    updatedAt: queuedAt,
    error: null,
  };

  if (replaceTerminalJob) {
    nextMeta.exportPipeline.retriedAt = queuedAt;
  }
  if (forceFromUploading) {
    nextMeta.exportPipeline.manualTransitionAt = queuedAt;
    nextMeta.exportPipeline.manualTransitionSource = "uploading";
  }
  if (replacePendingJob || ignoreWindow || sourceStatus === "pending_export_window") {
    nextMeta.exportPipeline.manualTransitionAt = queuedAt;
    nextMeta.exportPipeline.manualTransitionSource =
      sourceStatus === "pending_export_window" ? "pending_export_window" : sourceStatus || "manual";
  }
  if (forceReason) {
    nextMeta.exportPipeline.forceReason = forceReason;
    nextMeta.exportPipeline.forceTriggeredAt = queuedAt;
  }
  if (forceReason === "segment_timeout") {
    nextMeta.autoExportOnNoSegment = {
      sourceStatus,
      triggeredAt: queuedAt,
      latestSegmentActivityAt:
        latestSegmentActivityAt instanceof Date &&
        Number.isFinite(latestSegmentActivityAt.getTime())
          ? latestSegmentActivityAt
          : latestSegmentActivityAt || null,
      timeoutMinutes:
        Number.isFinite(Number(segmentTimeoutMinutes)) && Number(segmentTimeoutMinutes) > 0
          ? Number(segmentTimeoutMinutes)
          : null,
      uploadedSegmentCount: uploadedSegments.length,
      pendingSegmentCount: getPendingRecordingSegments(recording).length,
    };
  }
  if (isFacebookVodSource) {
    nextMeta.source = {
      ...(nextMeta.source && typeof nextMeta.source === "object"
        ? nextMeta.source
        : {}),
      ...exportSource.sourceMeta,
    };
  }

  recording.meta = nextMeta;
  await recording.save();
  if (!isFacebookVodSource) {
    const temporaryPlaybackUrl = buildRecordingTemporaryPlaybackUrl(recording._id);
    await Match.findByIdAndUpdate(recording.match, {
      $set: {
        video: temporaryPlaybackUrl,
      },
    }).catch(() => {});
  }
  await publishRecordingMonitor(recording, publishReason);

  return recording;
}
