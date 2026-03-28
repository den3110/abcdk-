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
import {
  downloadFacebookVodWithYtDlp,
  downloadFacebookVodToFile,
  resolveFacebookVodDownloadInfo,
} from "./liveRecordingFacebookVod.service.js";
import {
  buildFacebookVodRetryPlan,
  getFacebookVodRetryMeta,
  getUploadedRecordingSegments,
  RECORDING_SOURCE_FACEBOOK_VOD,
  resolveLiveRecordingExportSource,
} from "./liveRecordingFacebookVodShared.service.js";
import { maybeAutoQueueLiveRecordingAiCommentary } from "./liveRecordingAiCommentaryQueue.service.js";
import { publishLiveRecordingMonitorUpdate } from "./liveRecordingMonitorEvents.service.js";
import { getLiveRecordingExportScheduleFor } from "./liveRecordingExportWindow.service.js";

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

export function buildRecordingPlaybackUrl(recordingId) {
  return `${getPlaybackApiBase()}/api/live/recordings/v2/${String(
    recordingId
  )}/play`;
}

export function buildRecordingRawStreamUrl(recordingId) {
  return `${getPlaybackApiBase()}/api/live/recordings/v2/${String(
    recordingId
  )}/raw`;
}

export function buildRecordingRawStatusUrl(recordingId) {
  return `${getPlaybackApiBase()}/api/live/recordings/v2/${String(
    recordingId
  )}/raw/status`;
}

export function buildRecordingTemporaryPlaybackUrl(recordingId) {
  return `${getPlaybackApiBase()}/api/live/recordings/v2/${String(
    recordingId
  )}/temp`;
}

export function buildRecordingTemporaryPlaylistUrl(recordingId) {
  return `${getPlaybackApiBase()}/api/live/recordings/v2/${String(
    recordingId
  )}/temp/playlist`;
}

export function buildRecordingLiveHlsUrl(recordingId) {
  return `${getPlaybackApiBase()}/api/live/recordings/v2/${String(
    recordingId
  )}/live.m3u8`;
}

function asMutableMeta(meta) {
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? { ...meta }
    : {};
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

function groupRecordingObjectKeysByTarget(
  recording,
  { includeManifest = true } = {}
) {
  const grouped = new Map();

  const pushObjectKey = (storageTargetId, objectKey) => {
    const normalizedTargetId = asTrimmed(storageTargetId);
    const normalizedObjectKey = asTrimmed(objectKey);
    if (!normalizedTargetId || !normalizedObjectKey) return;
    if (!grouped.has(normalizedTargetId)) {
      grouped.set(normalizedTargetId, new Set());
    }
    grouped.get(normalizedTargetId).add(normalizedObjectKey);
  };

  for (const segment of recording?.segments || []) {
    pushObjectKey(
      getSegmentStorageTargetId(segment, recording),
      segment?.objectKey
    );
  }

  if (includeManifest && recording?.r2ManifestKey) {
    pushObjectKey(recording?.r2TargetId, recording.r2ManifestKey);
  }

  return grouped;
}

function shouldDeleteRecordingSourceAfterExport() {
  const raw = String(
    process.env.LIVE_RECORDING_DELETE_R2_SOURCE_AFTER_EXPORT || ""
  )
    .trim()
    .toLowerCase();

  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw);
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

function getFfmpegThreads() {
  const raw = Number(process.env.LIVE_RECORDING_FFMPEG_THREADS || 1);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.floor(raw));
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

async function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegStatic,
      ["-threads", String(getFfmpegThreads()), ...args],
      {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      }
    );
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

function buildExportResult(recording, extra = {}) {
  return {
    recording,
    retryDelayMs: 0,
    retryReason: null,
    retryAt: null,
    ...extra,
  };
}

function getCurrentExportPipeline(recording) {
  const nextMeta = asMutableMeta(recording?.meta);
  return nextMeta.exportPipeline &&
    typeof nextMeta.exportPipeline === "object" &&
    !Array.isArray(nextMeta.exportPipeline)
    ? { ...nextMeta.exportPipeline }
    : {};
}

async function prepareRecordingOutputUpload(recording, outputPath) {
  const driveStatus = await getRecordingDriveStatus();
  if (!driveStatus.enabled) {
    throw new Error("Google Drive recording output is disabled");
  }
  if (!driveStatus.connected) {
    throw new Error(driveStatus.message || "My Drive OAuth chua ket noi");
  }
  if (!driveStatus.configured || !driveStatus.ready) {
    throw new Error(
      driveStatus.message ||
        "Google Drive recording destination is not configured"
    );
  }

  await updateExportPipelineState(recording, "uploading_drive", {
    driveUploadStartedAt: new Date(),
    label: "Dang upload len Drive",
    driveAuthMode: driveStatus.mode || null,
  });

  const driveInfo = await uploadRecordingToDrive({
    filePath: outputPath,
    fileName: `match_${String(recording.match)}_${Date.now()}.mp4`,
  });

  return {
    driveInfo,
    driveStatus,
    outputStat: await fs.stat(outputPath),
  };
}

async function applyRecordingDriveOutput(
  recording,
  { driveInfo, sizeBytes, durationSeconds }
) {
  recording.status = "exporting";
  recording.sizeBytes = Number(sizeBytes) || 0;
  recording.durationSeconds = Number(durationSeconds) || 0;
  recording.driveFileId = driveInfo.fileId;
  recording.driveRawUrl = driveInfo.rawUrl;
  recording.drivePreviewUrl = driveInfo.previewUrl;
  recording.playbackUrl = buildRecordingPlaybackUrl(recording._id);
  recording.error = null;
  await Match.findByIdAndUpdate(recording.match, {
    $set: {
      video: recording.playbackUrl,
    },
  }).catch(() => {});
}

async function markRecordingReady(
  recording,
  { sourceCleanup, publishReason = "recording_ready" } = {}
) {
  const nextMeta = asMutableMeta(recording.meta);
  if (sourceCleanup) {
    nextMeta.sourceCleanup = sourceCleanup;
  }
  const currentPipeline =
    nextMeta.exportPipeline &&
    typeof nextMeta.exportPipeline === "object" &&
    !Array.isArray(nextMeta.exportPipeline)
      ? { ...nextMeta.exportPipeline }
      : {};
  nextMeta.exportPipeline = {
    ...currentPipeline,
    stage: "completed",
    label: "Hoan tat",
    completedAt: new Date(),
    updatedAt: new Date(),
  };
  recording.meta = nextMeta;
  recording.status = "ready";
  recording.scheduledExportAt = null;
  recording.readyAt = new Date();
  await recording.save();
  await publishLiveRecordingMonitorUpdate({
    reason: publishReason,
    recordingIds: [String(recording._id)],
  }).catch(() => {});
  await maybeAutoQueueLiveRecordingAiCommentary(recording._id).catch(
    (queueError) => {
      console.error(
        `[recording-ai-commentary] auto queue failed for recording ${String(
          recording._id
        )}:`,
        queueError?.message || queueError
      );
    }
  );
}

async function markRecordingFailed(recording, error) {
  recording.status = "failed";
  recording.scheduledExportAt = null;
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
  }).catch(() => {});
}

async function markFacebookVodWaiting(recording, { match, attemptedAt, error }) {
  const retryPlan = buildFacebookVodRetryPlan({
    recording,
    match,
    now: attemptedAt,
  });
  const currentRetry = getFacebookVodRetryMeta(recording);
  const attemptCount = currentRetry.attemptCount;

  if (attemptedAt.getTime() >= retryPlan.deadlineAt.getTime()) {
    const failedMeta = asMutableMeta(recording.meta);
    failedMeta.facebookVod = {
      ...(failedMeta.facebookVod &&
      typeof failedMeta.facebookVod === "object" &&
      !Array.isArray(failedMeta.facebookVod)
        ? failedMeta.facebookVod
        : {}),
      startedAt: currentRetry.startedAt || retryPlan.startedAt,
      deadlineAt: currentRetry.deadlineAt || retryPlan.deadlineAt,
      attemptCount,
      lastAttemptAt: attemptedAt,
      nextAttemptAt: null,
      lastError: error?.message || String(error),
    };
    recording.meta = failedMeta;
    const terminalError = new Error(
      "Facebook VOD not ready within retry window"
    );
    await markRecordingFailed(recording, terminalError);
    return buildExportResult(recording);
  }

  const nextAttemptSchedule = getLiveRecordingExportScheduleFor(
    retryPlan.nextAttemptAt,
    attemptedAt
  );
  const nextAttemptAt = nextAttemptSchedule.scheduledAt;
  const nextMeta = asMutableMeta(recording.meta);
  const currentPipeline = getCurrentExportPipeline(recording);
  nextMeta.facebookVod = {
    ...(nextMeta.facebookVod &&
    typeof nextMeta.facebookVod === "object" &&
    !Array.isArray(nextMeta.facebookVod)
      ? nextMeta.facebookVod
      : {}),
    startedAt: currentRetry.startedAt || retryPlan.startedAt,
    deadlineAt: currentRetry.deadlineAt || retryPlan.deadlineAt,
    attemptCount,
    lastAttemptAt: attemptedAt,
    nextAttemptAt,
    lastError: error?.message || String(error),
  };
  nextMeta.exportPipeline = {
    ...currentPipeline,
    stage: "waiting_facebook_vod",
    label: "Dang cho video Facebook hoan tat",
    scheduledExportAt: nextAttemptAt,
    updatedAt: new Date(),
    error: null,
  };
  recording.meta = nextMeta;
  recording.status = "exporting";
  recording.scheduledExportAt = nextAttemptAt;
  recording.error = null;
  await recording.save();
  await publishLiveRecordingMonitorUpdate({
    reason: "recording_export_facebook_vod_waiting",
    recordingIds: [String(recording._id)],
  }).catch(() => {});

  return buildExportResult(recording, {
    retryDelayMs: Math.max(0, nextAttemptAt.getTime() - Date.now()),
    retryReason: "facebook_vod_not_ready",
    retryAt: nextAttemptAt,
  });
}

function shouldTreatFacebookVodDownloadErrorAsRetryable(error) {
  const code = String(error?.code || "").toUpperCase();
  return [
    "YTDLP_UNAVAILABLE",
    "YTDLP_NO_FORMATS",
    "YTDLP_LOGIN_REQUIRED",
    "YTDLP_PRIVATE_VIDEO",
    "YTDLP_VIDEO_UNAVAILABLE",
    "YTDLP_TIMEOUT",
  ].includes(code);
}

async function exportUploadedSegmentRecording(recording, uploadedSegments) {
  const manifestKey =
    recording.r2ManifestKey ||
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
    r2TargetId: recording.r2TargetId || null,
    r2BucketName: recording.r2BucketName || null,
    finalizedAt:
      recording.finalizedAt?.toISOString() || new Date().toISOString(),
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
  };

  await putRecordingManifest({
    objectKey: manifestKey,
    storageTargetId: recording.r2TargetId,
    manifest: manifestPayload,
  });

  recording.r2ManifestKey = manifestKey;
  recording.status = "exporting";
  recording.scheduledExportAt = null;
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
        storageTargetId: getSegmentStorageTargetId(segment, recording),
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

    const totalDurationSeconds = uploadedSegments.reduce(
      (sum, segment) => sum + (Number(segment.durationSeconds) || 0),
      0
    );
    const { driveInfo, driveStatus, outputStat } =
      await prepareRecordingOutputUpload(recording, outputPath);

    await applyRecordingDriveOutput(recording, {
      driveInfo,
      sizeBytes: outputStat.size,
      durationSeconds: totalDurationSeconds,
    });

    if (shouldDeleteRecordingSourceAfterExport()) {
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

      try {
        const cleanupResult = await deleteExportedRecordingSegments(recording, {
          includeManifest: true,
        });

        recording.r2ManifestKey = null;
        await markRecordingReady(recording, {
          sourceCleanup: {
            status: "completed",
            deletedAt: new Date(),
            deletedObjectCount: cleanupResult.deletedObjectCount,
            deletedManifest: cleanupResult.deletedManifest,
            objectKeys: cleanupResult.objectKeys,
          },
          publishReason: "recording_source_cleanup_completed",
        });
      } catch (cleanupError) {
        await markRecordingReady(recording, {
          sourceCleanup: {
            status: "failed",
            attemptedAt: new Date(),
            error: cleanupError?.message || String(cleanupError),
          },
          publishReason: "recording_source_cleanup_failed",
        });
        console.error(
          `[recording-export] source cleanup failed for recording ${String(
            recording._id
          )}:`,
          cleanupError
        );
      }
    } else {
      await markRecordingReady(recording, {
        sourceCleanup: {
          status: "retained",
          retainedAt: new Date(),
          reason: "config_keep_r2_source",
        },
        publishReason: "recording_ready",
      });
    }

    return buildExportResult(recording);
  } catch (error) {
    await markRecordingFailed(recording, error);
    throw error;
  } finally {
    await cleanupDir(workDir);
  }
}

async function exportFacebookVodRecording(recording, match) {
  const attemptedAt = new Date();
  const currentRetry = getFacebookVodRetryMeta(recording);
  const retryPlan = buildFacebookVodRetryPlan({
    recording,
    match,
    now: attemptedAt,
  });

  const nextMeta = asMutableMeta(recording.meta);
  nextMeta.facebookVod = {
    ...(nextMeta.facebookVod &&
    typeof nextMeta.facebookVod === "object" &&
    !Array.isArray(nextMeta.facebookVod)
      ? nextMeta.facebookVod
      : {}),
    startedAt: currentRetry.startedAt || retryPlan.startedAt,
    deadlineAt: currentRetry.deadlineAt || retryPlan.deadlineAt,
    attemptCount: currentRetry.attemptCount + 1,
    lastAttemptAt: attemptedAt,
    nextAttemptAt: null,
    lastError: null,
  };
  recording.meta = nextMeta;
  recording.status = "exporting";
  recording.scheduledExportAt = null;
  recording.exportAttempts = (recording.exportAttempts || 0) + 1;
  recording.error = null;
  await recording.save();

  let downloadInfo = null;
  try {
    downloadInfo = await resolveFacebookVodDownloadInfo(match);
  } catch (error) {
    return markFacebookVodWaiting(recording, {
      match,
      attemptedAt,
      error,
    });
  }

  if (!downloadInfo?.ready) {
    return markFacebookVodWaiting(recording, {
      match,
      attemptedAt,
      error: new Error(
        downloadInfo?.graphError || "Facebook VOD source is not ready yet"
      ),
    });
  }

  await updateExportPipelineState(
    recording,
    "downloading_facebook_vod",
    {
      startedAt: currentRetry.startedAt || retryPlan.startedAt,
      downloadStartedAt: attemptedAt,
      label: "Worker dang tai video Facebook",
    },
    "recording_export_started"
  );

  const workDir = await ensureDir(
    path.join(buildTempRoot(), String(recording._id), `${Date.now()}`)
  );

  try {
    const outputPath = path.join(workDir, "facebook_vod.mp4");
    if (downloadInfo.downloadMethod === "yt_dlp") {
      await downloadFacebookVodWithYtDlp({
        videoUrl: downloadInfo.ytDlpUrl || downloadInfo.permalinkUrl,
        targetPath: outputPath,
      });
    } else {
      await downloadFacebookVodToFile({
        sourceUrl: downloadInfo.sourceUrl,
        targetPath: outputPath,
      });
    }

    const { driveInfo, outputStat } = await prepareRecordingOutputUpload(
      recording,
      outputPath
    );

    await applyRecordingDriveOutput(recording, {
      driveInfo,
      sizeBytes: outputStat.size,
      durationSeconds:
        Number(downloadInfo.durationSeconds) || recording.durationSeconds || 0,
    });

    const readyMeta = asMutableMeta(recording.meta);
    readyMeta.facebookVod = {
      ...(readyMeta.facebookVod &&
      typeof readyMeta.facebookVod === "object" &&
      !Array.isArray(readyMeta.facebookVod)
        ? readyMeta.facebookVod
        : {}),
      startedAt: currentRetry.startedAt || retryPlan.startedAt,
      deadlineAt: currentRetry.deadlineAt || retryPlan.deadlineAt,
      attemptCount: currentRetry.attemptCount + 1,
      lastAttemptAt: attemptedAt,
      nextAttemptAt: null,
      lastError: null,
      downloadedAt: new Date(),
      sourceStatus: downloadInfo.status || null,
      downloadMethod: downloadInfo.downloadMethod || "graph_source",
    };
    recording.meta = readyMeta;

    await markRecordingReady(recording, {
      sourceCleanup: {
        status: "retained",
        retainedAt: new Date(),
        reason: "facebook_vod_no_r2_source",
      },
      publishReason: "recording_ready",
    });

    return buildExportResult(recording);
  } catch (error) {
    if (shouldTreatFacebookVodDownloadErrorAsRetryable(error)) {
      return markFacebookVodWaiting(recording, {
        match,
        attemptedAt,
        error,
      });
    }
    await markRecordingFailed(recording, error);
    throw error;
  } finally {
    await cleanupDir(workDir);
  }
}

export async function exportLiveRecordingV2(recordingId) {
  const recording = await LiveRecordingV2.findById(recordingId);
  if (!recording) {
    throw new Error("Recording v2 not found");
  }

  const match = await Match.findById(recording.match)
    .select("_id court facebookLive updatedAt")
    .lean();
  const exportSource = resolveLiveRecordingExportSource(recording, match);
  const effectiveMatch =
    exportSource.type === RECORDING_SOURCE_FACEBOOK_VOD
      ? {
          ...(match || {}),
          facebookLive: {
            ...((match && match.facebookLive) || {}),
            videoId:
              exportSource.sourceMeta.videoId ||
              match?.facebookLive?.videoId ||
              null,
            pageId:
              exportSource.sourceMeta.pageId ||
              match?.facebookLive?.pageId ||
              null,
          },
        }
      : match;

  if (exportSource.type === RECORDING_SOURCE_FACEBOOK_VOD) {
    return exportFacebookVodRecording(recording, effectiveMatch);
  }

  if (!exportSource.uploadedSegments.length) {
    throw new Error("Recording v2 has no uploaded segments");
  }

  return exportUploadedSegmentRecording(recording, exportSource.uploadedSegments);
}

export async function deleteExportedRecordingSegments(
  recordingOrId,
  { includeManifest = true } = {}
) {
  const recording =
    recordingOrId && typeof recordingOrId === "object"
      ? recordingOrId
      : await LiveRecordingV2.findById(recordingOrId).lean();

  if (!recording) {
    return {
      deletedObjectCount: 0,
      deletedManifest: false,
      objectKeys: [],
    };
  }

  const objectKeys = includeManifest
    ? buildSourceCleanupObjectKeys(recording)
    : [
        ...new Set(
          (recording.segments || [])
            .map((segment) => segment?.objectKey)
            .filter(Boolean)
        ),
      ];

  if (!objectKeys.length) {
    return {
      deletedObjectCount: 0,
      deletedManifest: false,
      objectKeys: [],
    };
  }

  const groupedObjectKeys = groupRecordingObjectKeysByTarget(recording, {
    includeManifest,
  });
  const deletedKeys = [];
  for (const [
    storageTargetId,
    targetObjectKeys,
  ] of groupedObjectKeys.entries()) {
    if (!targetObjectKeys.size) continue;
    const deleteResult = await deleteRecordingObjects([...targetObjectKeys], {
      storageTargetId,
    });
    deletedKeys.push(...(deleteResult?.deletedKeys || []));
  }

  return {
    deletedObjectCount: deletedKeys.length,
    deletedManifest: includeManifest && Boolean(recording.r2ManifestKey),
    objectKeys: deletedKeys.length ? deletedKeys : objectKeys,
  };
}
