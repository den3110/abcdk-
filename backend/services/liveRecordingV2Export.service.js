import fs from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import Match from "../models/matchModel.js";
import {
  buildRecordingManifestObjectKey,
  deleteRecordingObjects,
  downloadRecordingObjectToFile,
  putRecordingManifest,
} from "./liveRecordingV2Storage.service.js";
import {
  getRecordingDriveStatus,
  uploadRecordingToDrive,
} from "./driveRecordings.service.js";
import { publishLiveRecordingMonitorUpdate } from "./liveRecordingMonitorEvents.service.js";

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

  return `${getAppHost()}/api`;
}

export function buildRecordingPlaybackUrl(recordingId) {
  return `${getPlaybackApiBase()}/api/live/recordings/v2/${String(recordingId)}/play`;
}

export function buildRecordingRawStreamUrl(recordingId) {
  return `${getPlaybackApiBase()}/api/live/recordings/v2/${String(recordingId)}/raw`;
}

export function buildRecordingRawStatusUrl(recordingId) {
  return `${getPlaybackApiBase()}/api/live/recordings/v2/${String(recordingId)}/raw/status`;
}

function asMutableMeta(meta) {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? { ...meta } : {};
}

function buildSourceCleanupObjectKeys(recording) {
  const objectKeys = new Set();

  for (const segment of recording?.segments || []) {
    if (segment?.objectKey) {
      objectKeys.add(segment.objectKey);
    }
  }

  if (recording?.r2ManifestKey) {
    objectKeys.add(recording.r2ManifestKey);
  }

  return [...objectKeys];
}

async function updateExportPipelineState(
  recording,
  stage,
  extra = {},
  publishReason = "recording_export_stage_updated"
) {
  const nextMeta = asMutableMeta(recording.meta);
  const currentPipeline =
    nextMeta.exportPipeline &&
    typeof nextMeta.exportPipeline === "object" &&
    !Array.isArray(nextMeta.exportPipeline)
      ? { ...nextMeta.exportPipeline }
      : {};

  nextMeta.exportPipeline = {
    ...currentPipeline,
    ...extra,
    stage,
    updatedAt: new Date(),
  };

  recording.meta = nextMeta;
  await recording.save();
  await publishLiveRecordingMonitorUpdate({
    reason: publishReason,
    recordingIds: [String(recording._id)],
  });
}

function buildTempRoot() {
  const raw =
    process.env.RECORDING_EXPORT_WORK_DIR ||
    path.join(os.tmpdir(), "pickletour-live-recordings");
  return path.resolve(raw);
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

async function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegStatic, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      }
    });
  });
}

async function concatSegmentsWithCopy({ concatPath, outputPath }) {
  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-c",
    "copy",
    outputPath,
  ]);
}

async function remuxMp4ForStreaming({ inputPath, outputPath }) {
  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-map",
    "0",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

async function reencodeConcatToMp4({ concatPath, outputPath }) {
  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

async function mergeSegmentsToOutput({ inputPaths, outputPath, workDir }) {
  const concatPath = path.join(workDir, "concat.txt");
  const concatBody = inputPaths
    .map((segmentPath) => `file '${segmentPath.replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fs.writeFile(concatPath, concatBody, "utf8");

  try {
    const concatCopyPath = path.join(workDir, "merged_copy.mp4");
    await concatSegmentsWithCopy({
      concatPath,
      outputPath: concatCopyPath,
    });

    try {
      await remuxMp4ForStreaming({
        inputPath: concatCopyPath,
        outputPath,
      });
    } catch (remuxError) {
      await reencodeConcatToMp4({
        concatPath,
        outputPath,
      });
    }
  } catch (copyError) {
    await reencodeConcatToMp4({
      concatPath,
      outputPath,
    });
  }
}

async function cleanupDir(dirPath) {
  if (!dirPath) return;
  await fs.rm(dirPath, { recursive: true, force: true });
}

export async function exportLiveRecordingV2(recordingId) {
  const recording = await LiveRecordingV2.findById(recordingId);
  if (!recording) {
    throw new Error("Recording v2 not found");
  }

  const uploadedSegments = [...(recording.segments || [])]
    .filter((segment) => segment.uploadStatus === "uploaded")
    .sort((a, b) => a.index - b.index);

  if (!uploadedSegments.length) {
    throw new Error("Recording v2 has no uploaded segments");
  }

  const manifestKey = recording.r2ManifestKey ||
    buildRecordingManifestObjectKey({
      recordingId: recording._id,
      matchId: recording.match,
    });

  const manifestPayload = {
    recordingId: String(recording._id),
    matchId: String(recording.match),
    courtId: recording.courtId ? String(recording.courtId) : null,
    mode: recording.mode,
    quality: recording.quality,
    finalizedAt: recording.finalizedAt?.toISOString() || new Date().toISOString(),
    segments: uploadedSegments.map((segment) => ({
      index: segment.index,
      objectKey: segment.objectKey,
      sizeBytes: segment.sizeBytes,
      durationSeconds: segment.durationSeconds,
      isFinal: segment.isFinal,
    })),
  };

  await putRecordingManifest({
    objectKey: manifestKey,
    manifest: manifestPayload,
  });

  recording.r2ManifestKey = manifestKey;
  recording.status = "exporting";
  recording.exportAttempts = (recording.exportAttempts || 0) + 1;
  recording.error = null;
  await updateExportPipelineState(
    recording,
    "downloading",
    {
      startedAt: new Date(),
      downloadStartedAt: new Date(),
      label: "Worker dang tai segment tu R2",
    },
    "recording_export_started"
  );

  const workDir = await ensureDir(
    path.join(buildTempRoot(), String(recording._id), `${Date.now()}`)
  );

  try {
    const segmentPaths = [];
    for (const segment of uploadedSegments) {
      const localSegmentPath = path.join(
        workDir,
        `segment_${String(segment.index).padStart(5, "0")}.mp4`
      );
      await downloadRecordingObjectToFile({
        objectKey: segment.objectKey,
        targetPath: localSegmentPath,
      });
      segmentPaths.push(localSegmentPath);
    }

    await updateExportPipelineState(recording, "merging", {
      mergeStartedAt: new Date(),
      label: "Worker dang ghep video",
    });

    const outputPath = path.join(workDir, "final.mp4");
    await mergeSegmentsToOutput({
      inputPaths: segmentPaths,
      outputPath,
      workDir,
    });

    const outputStat = await fs.stat(outputPath);
    const totalDurationSeconds = uploadedSegments.reduce(
      (sum, segment) => sum + (Number(segment.durationSeconds) || 0),
      0
    );

    let driveInfo = null;
    const driveStatus = await getRecordingDriveStatus();
    if (!driveStatus.enabled) {
      throw new Error("Google Drive recording output is disabled");
    }
    if (!driveStatus.connected) {
      throw new Error(driveStatus.message || "My Drive OAuth chua ket noi");
    }
    if (!driveStatus.configured || !driveStatus.ready) {
      throw new Error(
        driveStatus.message || "Google Drive recording destination is not configured"
      );
    }

    await updateExportPipelineState(recording, "uploading_drive", {
      driveUploadStartedAt: new Date(),
      label: "Dang upload len Drive",
      driveAuthMode: driveStatus.mode || null,
    });

    driveInfo = await uploadRecordingToDrive({
      filePath: outputPath,
      fileName: `match_${String(recording.match)}_${Date.now()}.mp4`,
    });

    recording.status = "exporting";
    recording.sizeBytes = outputStat.size;
    recording.durationSeconds = totalDurationSeconds;
    recording.driveFileId = driveInfo.fileId;
    recording.driveRawUrl = driveInfo.rawUrl;
    recording.drivePreviewUrl = driveInfo.previewUrl;
    recording.playbackUrl = buildRecordingPlaybackUrl(recording._id);
    recording.error = null;
    await updateExportPipelineState(
      recording,
      "cleaning_r2",
      {
        driveUploadedAt: new Date(),
        label: "Dang don segment tren R2",
        driveAuthMode: driveInfo.driveAuthMode || driveStatus.mode || null,
      },
      "recording_drive_uploaded"
    );

    await Match.findByIdAndUpdate(recording.match, {
      $set: {
        video: recording.playbackUrl,
      },
    }).catch(() => {});

    try {
      const cleanupResult = await deleteExportedRecordingSegments(recording, {
        includeManifest: true,
      });

      const nextMeta = asMutableMeta(recording.meta);
      nextMeta.sourceCleanup = {
        status: "completed",
        deletedAt: new Date(),
        deletedObjectCount: cleanupResult.deletedObjectCount,
        deletedManifest: cleanupResult.deletedManifest,
        objectKeys: cleanupResult.objectKeys,
      };

      recording.meta = nextMeta;
      recording.r2ManifestKey = null;
      recording.status = "ready";
      recording.readyAt = new Date();
      await recording.save();
      await publishLiveRecordingMonitorUpdate({
        reason: "recording_source_cleanup_completed",
        recordingIds: [String(recording._id)],
      });
    } catch (cleanupError) {
      const nextMeta = asMutableMeta(recording.meta);
      nextMeta.sourceCleanup = {
        status: "failed",
        attemptedAt: new Date(),
        error: cleanupError?.message || String(cleanupError),
      };

      recording.meta = nextMeta;
      recording.status = "ready";
      recording.readyAt = new Date();
      await recording.save().catch(() => {});
      await publishLiveRecordingMonitorUpdate({
        reason: "recording_source_cleanup_failed",
        recordingIds: [String(recording._id)],
      }).catch(() => {});
      console.error(
        `[recording-export] source cleanup failed for recording ${String(recording._id)}:`,
        cleanupError
      );
    }

    const completedMeta = asMutableMeta(recording.meta);
    const completedPipeline =
      completedMeta.exportPipeline &&
      typeof completedMeta.exportPipeline === "object" &&
      !Array.isArray(completedMeta.exportPipeline)
        ? { ...completedMeta.exportPipeline }
        : {};
    completedMeta.exportPipeline = {
      ...completedPipeline,
      stage: "completed",
      label: "Hoan tat",
      completedAt: new Date(),
      updatedAt: new Date(),
    };
    recording.meta = completedMeta;
    await recording.save();
    await publishLiveRecordingMonitorUpdate({
      reason: "recording_ready",
      recordingIds: [String(recording._id)],
    });

    return recording;
  } catch (error) {
    recording.status = "failed";
    recording.error = error?.message || String(error);
    const failedMeta = asMutableMeta(recording.meta);
    const failedPipeline =
      failedMeta.exportPipeline &&
      typeof failedMeta.exportPipeline === "object" &&
      !Array.isArray(failedMeta.exportPipeline)
        ? { ...failedMeta.exportPipeline }
        : {};
    failedMeta.exportPipeline = {
      ...failedPipeline,
      stage: "failed",
      label: "Export that bai",
      failedAt: new Date(),
      updatedAt: new Date(),
      error: recording.error,
    };
    recording.meta = failedMeta;
    await recording.save();
    await publishLiveRecordingMonitorUpdate({
      reason: "recording_export_failed",
      recordingIds: [String(recording._id)],
    });
    throw error;
  } finally {
    await cleanupDir(workDir);
  }
}

export async function deleteExportedRecordingSegments(
  recordingOrId,
  { includeManifest = true } = {}
) {
  const recording =
    recordingOrId && typeof recordingOrId === "object"
      ? recordingOrId
      : await LiveRecordingV2.findById(recordingOrId).lean();

  if (!recording || recording.status !== "ready") {
    return {
      deletedObjectCount: 0,
      deletedManifest: false,
      objectKeys: [],
    };
  }

  const objectKeys = includeManifest
    ? buildSourceCleanupObjectKeys(recording)
    : [...new Set((recording.segments || []).map((segment) => segment?.objectKey).filter(Boolean))];

  if (!objectKeys.length) {
    return {
      deletedObjectCount: 0,
      deletedManifest: false,
      objectKeys: [],
    };
  }

  await deleteRecordingObjects(objectKeys);

  return {
    deletedObjectCount: objectKeys.length,
    deletedManifest: includeManifest && Boolean(recording.r2ManifestKey),
    objectKeys,
  };
}
