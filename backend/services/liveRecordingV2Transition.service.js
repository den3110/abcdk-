import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import { buildRecordingPlaybackUrl } from "./liveRecordingV2Export.service.js";
import {
  buildRecordingManifestObjectKey,
  putRecordingManifest,
} from "./liveRecordingV2Storage.service.js";
import { publishLiveRecordingMonitorUpdate } from "./liveRecordingMonitorEvents.service.js";
import { enqueueLiveRecordingExport } from "./liveRecordingV2Queue.service.js";

function asMutableMeta(meta) {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? { ...meta } : {};
}

export function getRecordingMeta(recording) {
  return asMutableMeta(recording?.meta);
}

export function getUploadedRecordingSegments(recording) {
  return [...(recording?.segments || [])]
    .filter((segment) => segment.uploadStatus === "uploaded")
    .sort((a, b) => a.index - b.index);
}

export function getPendingRecordingSegments(recording) {
  return [...(recording?.segments || [])].filter(
    (segment) => segment.uploadStatus !== "uploaded"
  );
}

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
    currentPipeline = null,
    forceFromUploading = false,
    forceReason = "",
    latestSegmentActivityAt = null,
    segmentTimeoutMinutes = null,
  } = options;

  const recording =
    recordingOrId && typeof recordingOrId.save === "function"
      ? recordingOrId
      : await LiveRecordingV2.findById(recordingOrId);

  if (!recording) {
    throw new Error("Recording not found");
  }

  const sourceStatus = String(recording.status || "");
  const uploadedSegments = getUploadedRecordingSegments(recording);
  if (!uploadedSegments.length) {
    throw new Error("Recording has no uploaded segments");
  }

  const manifestKey = buildRecordingManifestObjectKey({
    recordingId: recording._id,
    matchId: recording.match,
  });

  await putRecordingManifest({
    objectKey: manifestKey,
    manifest: {
      recordingId: String(recording._id),
      matchId: String(recording.match),
      courtId: recording.courtId ? String(recording.courtId) : null,
      mode: recording.mode,
      quality: recording.quality,
      finalizedAt: new Date().toISOString(),
      segments: uploadedSegments.map((segment) => ({
        index: segment.index,
        objectKey: segment.objectKey,
        sizeBytes: segment.sizeBytes,
        durationSeconds: segment.durationSeconds,
        isFinal: segment.isFinal,
      })),
    },
  });

  const queuedAt = new Date();
  recording.r2ManifestKey = manifestKey;
  recording.finalizedAt = queuedAt;
  recording.status = "exporting";
  recording.error = null;
  recording.playbackUrl = buildRecordingPlaybackUrl(recording._id);

  const queuedJob = await enqueueLiveRecordingExport(recording._id, {
    replaceTerminalJob,
  });
  const nextMeta = getRecordingMeta(recording);
  const existingPipeline =
    currentPipeline && typeof currentPipeline === "object" && !Array.isArray(currentPipeline)
      ? { ...currentPipeline }
      : {};

  nextMeta.exportPipeline = {
    ...existingPipeline,
    stage: "queued",
    label: "Dang cho worker",
    queuedAt,
    queueJobId: queuedJob?.id ? String(queuedJob.id) : null,
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

  recording.meta = nextMeta;
  await recording.save();
  await publishRecordingMonitor(recording, publishReason);

  return recording;
}
