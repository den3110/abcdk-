import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import {
  buildRecordingPlaybackUrl,
  buildRecordingRawStatusUrl,
  buildRecordingRawStreamUrl,
} from "../services/liveRecordingV2Export.service.js";
import {
  probeRecordingDriveFile,
  streamRecordingDriveFile,
} from "../services/driveRecordings.service.js";
import {
  abortRecordingMultipartUpload,
  buildRecordingManifestObjectKey,
  buildRecordingPrefix,
  buildRecordingSegmentObjectKey,
  completeRecordingMultipartUpload,
  createRecordingMultipartUpload,
  createRecordingMultipartUploadPartUrl,
  createRecordingSegmentUploadUrl,
  getRecordingMultipartPartSizeBytes,
  isRecordingR2Configured,
  putRecordingManifest,
} from "../services/liveRecordingV2Storage.service.js";
import { enqueueLiveRecordingExport } from "../services/liveRecordingV2Queue.service.js";
import {
  buildLiveRecordingMonitorSnapshot,
  reconcileStaleLiveRecordingExports,
} from "../services/liveRecordingMonitor.service.js";
import { publishLiveRecordingMonitorUpdate } from "../services/liveRecordingMonitorEvents.service.js";
import { getLiveRecordingWorkerHealth } from "../services/liveRecordingWorkerHealth.service.js";

function isValidObjectId(value) {
  return mongoose.isValidObjectId(String(value || ""));
}

function asTrimmed(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function normalizeMode(mode) {
  const normalized = asTrimmed(mode).toUpperCase();
  return ["STREAM_AND_RECORD", "RECORD_ONLY", "STREAM_ONLY"].includes(normalized)
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

function getRecordingMeta(recording) {
  return recording?.meta && typeof recording.meta === "object"
    ? { ...recording.meta }
    : {};
}

function findRecordingSegment(recording, segmentIndex) {
  return (recording.segments || []).find((segment) => segment.index === segmentIndex);
}

async function publishRecordingMonitor(recording, reason) {
  await publishLiveRecordingMonitorUpdate({
    reason,
    recordingIds: recording?._id ? [String(recording._id)] : [],
  });
}

function serializeRecording(recording) {
  if (!recording) return null;
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
    driveFileId: recording.driveFileId || null,
    driveRawUrl: recording.driveRawUrl || null,
    drivePreviewUrl: recording.drivePreviewUrl || null,
    playbackUrl: buildRecordingPlaybackUrl(recording._id),
    rawStreamUrl: buildRecordingRawStreamUrl(recording._id),
    rawStatusUrl: buildRecordingRawStatusUrl(recording._id),
    rawStreamAvailable: Boolean(recording.driveFileId || recording.driveRawUrl),
    driveAuthMode: recording?.meta?.exportPipeline?.driveAuthMode || null,
    exportAttempts: recording.exportAttempts || 0,
    error: recording.error || null,
    finalizedAt: recording.finalizedAt || null,
    readyAt: recording.readyAt || null,
    createdAt: recording.createdAt || null,
    updatedAt: recording.updatedAt || null,
    segments: (recording.segments || []).map((segment) => ({
      index: segment.index,
      objectKey: segment.objectKey,
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
      r2Prefix: buildRecordingPrefix({
        recordingId: new mongoose.Types.ObjectId(),
        matchId,
      }),
    });
    recording.r2Prefix = buildRecordingPrefix({
      recordingId: recording._id,
      matchId,
    });
    recording.playbackUrl = buildRecordingPlaybackUrl(recording._id);
    await recording.save();
  } else {
    recording.mode = mode;
    recording.quality = quality;
    recording.status =
      recording.status === "ready" ? "recording" : recording.status || "recording";
    if (!recording.playbackUrl) {
      recording.playbackUrl = buildRecordingPlaybackUrl(recording._id);
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

  const objectKey = buildRecordingSegmentObjectKey({
    recordingId: recording._id,
    matchId: recording.match,
    segmentIndex,
  });

  const upload = await createRecordingSegmentUploadUrl({
    objectKey,
    contentType,
  });

  const existing = recording.segments.find((segment) => segment.index === segmentIndex);
  if (!existing) {
    recording.segments.push({
      index: segmentIndex,
      objectKey,
      uploadStatus: "presigned",
      isFinal: false,
    });
    await recording.save();
  }

  return res.json({
    ok: true,
    recordingId: String(recording._id),
    segmentIndex,
    objectKey,
    upload,
  });
});

export const startMultipartLiveRecordingSegmentV2 = asyncHandler(async (req, res) => {
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
        Number(segmentMeta.partSizeBytes) || getRecordingMultipartPartSizeBytes(),
      alreadyUploaded: true,
    });
  }

  let uploadId = asTrimmed(segmentMeta.uploadId);
  let partSizeBytes =
    Number(segmentMeta.partSizeBytes) || getRecordingMultipartPartSizeBytes();

  if (!uploadId || segment?.uploadStatus === "aborted" || segment?.uploadStatus === "failed") {
    const multipart = await createRecordingMultipartUpload({
      objectKey,
      contentType,
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
      segmentMeta.startedAt || new Date().toISOString(),
    abortedAt: null,
  };

  if (segment) {
    segment.objectKey = objectKey;
    segment.uploadStatus = "uploading_parts";
    segment.meta = nextMeta;
  } else {
    recording.segments.push({
      index: segmentIndex,
      objectKey,
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
});

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
      return res.status(409).json({ message: "Recording segment already uploaded" });
    }

    const segmentMeta = getSegmentMeta(segment);
    const uploadId = asTrimmed(segmentMeta.uploadId);
    if (!uploadId) {
      return res
        .status(409)
        .json({ message: "Multipart upload has not been started for this segment" });
    }

    const upload = await createRecordingMultipartUploadPartUrl({
      objectKey: segment.objectKey,
      uploadId,
      partNumber,
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

    const recording = await LiveRecordingV2.findById(recordingId);
    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    const segment = findRecordingSegment(recording, segmentIndex);
    if (!segment) {
      return res.status(404).json({ message: "Recording segment not found" });
    }
    if (segment.uploadStatus === "uploaded") {
      return res.json({ ok: true, uploaded: true, recording: serializeRecording(recording) });
    }

    const segmentMeta = getSegmentMeta(segment);
    const existingParts = Array.isArray(segmentMeta.completedParts)
      ? segmentMeta.completedParts
      : [];
    const nextParts = [
      ...existingParts.filter(
        (part) => Number(part?.partNumber) !== partNumber
      ),
      {
        partNumber,
        etag,
        sizeBytes,
        uploadedAt: new Date().toISOString(),
      },
    ].sort((a, b) => Number(a.partNumber) - Number(b.partNumber));
    const completedBytes = nextParts.reduce(
      (sum, part) => sum + (Number(part?.sizeBytes) || 0),
      0
    );

    segment.uploadStatus = "uploading_parts";
    segment.meta = {
      ...segmentMeta,
      completedParts: nextParts,
      completedPartCount: nextParts.length,
      completedBytes,
      totalSizeBytes:
        totalSizeBytes > 0
          ? totalSizeBytes
          : Number(segmentMeta.totalSizeBytes) || Number(segment.sizeBytes) || 0,
      lastPartUploadedAt: new Date().toISOString(),
    };
    recording.status = "uploading";
    recording.error = null;
    await recording.save();
    await publishRecordingMonitor(recording, "multipart_part_progress");

    return res.json({
      ok: true,
      recording: serializeRecording(recording),
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
      return res.status(400).json({ message: "parts are required for multipart completion" });
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
      return res
        .status(409)
        .json({ message: "Multipart upload has not been started for this segment" });
    }

    await completeRecordingMultipartUpload({
      objectKey: segment.objectKey,
      uploadId,
      parts,
    });

    segment.uploadStatus = "uploaded";
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
      completedBytes: parts.reduce(
        (sum, part) => {
          const existingPart = Array.isArray(segmentMeta.completedParts)
            ? segmentMeta.completedParts.find(
                (item) => Number(item?.partNumber) === Number(part?.partNumber)
              )
            : null;
          return sum + (Number(existingPart?.sizeBytes) || 0);
        },
        0
      ),
      totalSizeBytes: sizeBytes,
      completedAt: new Date().toISOString(),
    };

    recording.status = "uploading";
    recording.sizeBytes = (recording.segments || []).reduce(
      (sum, item) => sum + (Number(item.sizeBytes) || 0),
      0
    );
    recording.durationSeconds = (recording.segments || []).reduce(
      (sum, item) => sum + (Number(item.durationSeconds) || 0),
      0
    );
    recording.error = null;
    await recording.save();
    await publishRecordingMonitor(recording, "multipart_segment_uploaded");

    return res.json({
      ok: true,
      recording: serializeRecording(recording),
    });
  }
);

export const abortMultipartLiveRecordingSegmentV2 = asyncHandler(async (req, res) => {
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
});

export const completeLiveRecordingSegmentV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.body?.recordingId);
  const segmentIndex = Number(req.body?.segmentIndex);
  const objectKey = asTrimmed(req.body?.objectKey);
  const etag = asTrimmed(req.body?.etag) || null;
  const sizeBytes = Number(req.body?.sizeBytes) || 0;
  const durationSeconds = Number(req.body?.durationSeconds) || 0;
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

  const existing = recording.segments.find((segment) => segment.index === segmentIndex);
  if (existing) {
    existing.objectKey = objectKey;
    existing.uploadStatus = "uploaded";
    existing.etag = etag;
    existing.sizeBytes = sizeBytes;
    existing.durationSeconds = durationSeconds;
    existing.isFinal = isFinal;
    existing.uploadedAt = new Date();
  } else {
    recording.segments.push({
      index: segmentIndex,
      objectKey,
      uploadStatus: "uploaded",
      etag,
      sizeBytes,
      durationSeconds,
      isFinal,
      uploadedAt: new Date(),
    });
  }

  recording.status = "uploading";
  recording.sizeBytes = (recording.segments || []).reduce(
    (sum, segment) => sum + (Number(segment.sizeBytes) || 0),
    0
  );
  recording.durationSeconds = (recording.segments || []).reduce(
    (sum, segment) => sum + (Number(segment.durationSeconds) || 0),
    0
  );
  recording.error = null;
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

  const uploadedSegments = [...(recording.segments || [])]
    .filter((segment) => segment.uploadStatus === "uploaded")
    .sort((a, b) => a.index - b.index);

  if (!uploadedSegments.length) {
    return res.status(400).json({
      message: "Cannot finalize a recording with no uploaded segments",
    });
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

  const queuedJob = await enqueueLiveRecordingExport(recording._id);
  const nextMeta = getRecordingMeta(recording);
  nextMeta.exportPipeline = {
    stage: "queued",
    label: "Dang cho worker",
    queuedAt,
    queueJobId: queuedJob?.id ? String(queuedJob.id) : null,
    updatedAt: queuedAt,
  };
  recording.meta = nextMeta;
  await recording.save();

  await publishRecordingMonitor(recording, "recording_export_queued");

  return res.json({
    ok: true,
    queued: true,
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

export const getLiveRecordingMonitorV2 = asyncHandler(async (_req, res) => {
  const snapshot = await buildLiveRecordingMonitorSnapshot();
  return res.json(snapshot);
});

export const getLiveRecordingWorkerHealthV2 = asyncHandler(async (_req, res) => {
  await reconcileStaleLiveRecordingExports().catch(() => {});
  const health = await getLiveRecordingWorkerHealth();
  return res.json(health);
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
  const currentWorkerRecordingId = String(health?.worker?.currentRecordingId || "");
  if (currentWorkerRecordingId && currentWorkerRecordingId === String(recording._id)) {
    return res.status(409).json({ message: "Recording is already being exported by worker" });
  }

  const nextMeta = getRecordingMeta(recording);
  const currentPipeline =
    nextMeta.exportPipeline &&
    typeof nextMeta.exportPipeline === "object" &&
    !Array.isArray(nextMeta.exportPipeline)
      ? { ...nextMeta.exportPipeline }
      : {};

  const allowedRetry =
    recording.status === "failed" ||
    currentPipeline.stage === "stale_no_job" ||
    currentPipeline.staleReason === "stale_no_job" ||
    currentPipeline.staleReason === "worker_offline";

  if (!allowedRetry) {
    return res.status(409).json({
      message: "Only failed or stale exporting recordings can be retried",
    });
  }

  const uploadedSegments = [...(recording.segments || [])].filter(
    (segment) => segment.uploadStatus === "uploaded"
  );
  if (!uploadedSegments.length) {
    return res.status(400).json({
      message: "Cannot retry export because recording has no uploaded segments",
    });
  }

  const queuedAt = new Date();
  const queuedJob = await enqueueLiveRecordingExport(recording._id, {
    replaceTerminalJob: true,
  });

  nextMeta.exportPipeline = {
    ...currentPipeline,
    stage: "queued",
    label: "Dang cho worker",
    queuedAt,
    queueJobId: queuedJob?.id ? String(queuedJob.id) : null,
    retriedAt: queuedAt,
    updatedAt: queuedAt,
    error: null,
  };

  recording.status = "exporting";
  recording.error = null;
  recording.meta = nextMeta;
  await recording.save();
  await publishRecordingMonitor(recording, "recording_export_retried");

  return res.json({
    ok: true,
    queued: true,
    recording: serializeRecording(recording),
  });
});

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

  return res.status(409).json({
    ok: false,
    status: recording.status,
    message: "Recording is not ready yet",
    recording: serializeRecording(recording),
  });
});

function applyRawVideoHeaders(res, headers = {}, recordingId) {
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

  res.setHeader(
    "Content-Disposition",
    `inline; filename="recording-${String(recordingId)}.mp4"`
  );
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Accept-Ranges, Content-Length, Content-Range, Content-Type"
  );
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
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
  const { response, driveAuthMode } = await streamRecordingDriveFile({
    fileId: recording.driveFileId,
    rangeHeader,
  });

  applyRawVideoHeaders(res, response?.headers || {}, recording._id);
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

export const getLiveRecordingRawStatusV2 = asyncHandler(async (req, res) => {
  const recordingId = asTrimmed(req.params?.id);
  if (!isValidObjectId(recordingId)) {
    return res.status(400).json({ message: "Recording id is invalid" });
  }

  const recording = await LiveRecordingV2.findById(recordingId).lean();
  if (!recording) {
    return res.status(404).json({ message: "Recording not found" });
  }

  const payload = {
    ok: true,
    ready: false,
    status: recording.status,
    rawStreamUrl: buildRecordingRawStreamUrl(recording._id),
    rawStatusUrl: buildRecordingRawStatusUrl(recording._id),
    playbackUrl: buildRecordingPlaybackUrl(recording._id),
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
    return res.status(502).json({
      ...payload,
      ok: false,
      ready: false,
      message: error?.message || "Raw video is not accessible yet",
    });
  }
});
