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
  isRecordingDriveConfigured,
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

async function mergeSegmentsToOutput({ inputPaths, outputPath, workDir }) {
  const concatPath = path.join(workDir, "concat.txt");
  const concatBody = inputPaths
    .map((segmentPath) => `file '${segmentPath.replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fs.writeFile(concatPath, concatBody, "utf8");

  try {
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
  } catch (copyError) {
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
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
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
  await recording.save();
  await publishLiveRecordingMonitorUpdate({
    reason: "recording_export_started",
    recordingIds: [String(recording._id)],
  });

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
    if (!isRecordingDriveConfigured()) {
      throw new Error("Google Drive recording destination is not configured");
    }

    driveInfo = await uploadRecordingToDrive({
      filePath: outputPath,
      fileName: `match_${String(recording.match)}_${Date.now()}.mp4`,
    });

    recording.status = "ready";
    recording.sizeBytes = outputStat.size;
    recording.durationSeconds = totalDurationSeconds;
    recording.driveFileId = driveInfo.fileId;
    recording.driveRawUrl = driveInfo.rawUrl;
    recording.drivePreviewUrl = driveInfo.previewUrl;
    recording.playbackUrl = buildRecordingPlaybackUrl(recording._id);
    recording.readyAt = new Date();
    recording.error = null;
    await recording.save();
    await publishLiveRecordingMonitorUpdate({
      reason: "recording_ready",
      recordingIds: [String(recording._id)],
    });

    await Match.findByIdAndUpdate(recording.match, {
      $set: {
        video: recording.playbackUrl,
      },
    }).catch(() => {});

    return recording;
  } catch (error) {
    recording.status = "failed";
    recording.error = error?.message || String(error);
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

export async function deleteExportedRecordingSegments(recordingId) {
  const recording = await LiveRecordingV2.findById(recordingId).lean();
  if (!recording || recording.status !== "ready") return false;
  const objectKeys = (recording.segments || []).map((segment) => segment.objectKey);
  await deleteRecordingObjects(objectKeys);
  return true;
}
