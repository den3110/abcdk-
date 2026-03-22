import dotenv from "dotenv";
import mongoose from "mongoose";

import connectDB from "../config/db.js";
import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import Match from "../models/matchModel.js";
import { deleteExportedRecordingSegments } from "../services/liveRecordingV2Export.service.js";
import { publishLiveRecordingMonitorUpdate } from "../services/liveRecordingMonitorEvents.service.js";

dotenv.config();

function asMutableMeta(meta) {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? { ...meta } : {};
}

function parseCsv(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function parseDateInput(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseArgs(argv = []) {
  const options = {
    execute: false,
    limit: 100,
    statuses: ["ready"],
    tournamentId: "",
    recordingIds: [],
    matchIds: [],
    before: null,
    includeManifest: true,
    includeCompleted: false,
  };

  for (const rawArg of argv) {
    const arg = String(rawArg || "").trim();
    if (!arg) continue;

    if (arg === "--execute") {
      options.execute = true;
      continue;
    }

    if (arg === "--no-manifest") {
      options.includeManifest = false;
      continue;
    }

    if (arg === "--include-completed") {
      options.includeCompleted = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.split("=")[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = Math.floor(parsed);
      }
      continue;
    }

    if (arg.startsWith("--statuses=")) {
      const parsed = parseCsv(arg.split("=")[1]);
      if (parsed.length) {
        options.statuses = parsed;
      }
      continue;
    }

    if (arg.startsWith("--tournamentId=")) {
      options.tournamentId = String(arg.split("=")[1] || "").trim();
      continue;
    }

    if (arg.startsWith("--recordingIds=")) {
      options.recordingIds = parseCsv(arg.split("=")[1]);
      continue;
    }

    if (arg.startsWith("--matchIds=")) {
      options.matchIds = parseCsv(arg.split("=")[1]);
      continue;
    }

    if (arg.startsWith("--before=")) {
      options.before = parseDateInput(arg.split("=")[1]);
    }
  }

  return options;
}

async function resolveMatchIds({ tournamentId, matchIds }) {
  const directMatchIds = Array.from(new Set((matchIds || []).filter(Boolean)));
  if (!tournamentId) return directMatchIds;

  const matches = await Match.find({ tournament: tournamentId })
    .select("_id")
    .lean();

  const tournamentMatchIds = matches.map((item) => String(item._id));
  return Array.from(new Set([...directMatchIds, ...tournamentMatchIds]));
}

async function buildQuery(options) {
  const conditions = [];

  if (Array.isArray(options.statuses) && options.statuses.length) {
    conditions.push({ status: { $in: options.statuses } });
  }

  if (options.recordingIds.length) {
    conditions.push({ _id: { $in: options.recordingIds } });
  }

  const resolvedMatchIds = await resolveMatchIds(options);
  if (resolvedMatchIds.length) {
    conditions.push({ match: { $in: resolvedMatchIds } });
  } else if (options.tournamentId) {
    conditions.push({ match: { $in: [] } });
  }

  conditions.push({
    $or: [
      { driveFileId: { $exists: true, $nin: [null, ""] } },
      { driveRawUrl: { $exists: true, $nin: [null, ""] } },
      { drivePreviewUrl: { $exists: true, $nin: [null, ""] } },
      { "meta.exportPipeline.stage": "completed" },
    ],
  });

  if (options.before) {
    conditions.push({
      $or: [
        { readyAt: { $lte: options.before } },
        { finalizedAt: { $lte: options.before } },
        { createdAt: { $lte: options.before } },
      ],
    });
  }

  if (!options.includeCompleted) {
    conditions.push({
      $or: [
        { "meta.sourceCleanup.status": { $exists: false } },
        { "meta.sourceCleanup.status": { $in: ["retained", "failed"] } },
        { r2ManifestKey: { $nin: [null, ""] } },
      ],
    });
  }

  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

function collectObjectKeys(recording, includeManifest = true) {
  const objectKeys = new Set();
  for (const segment of recording?.segments || []) {
    if (segment?.objectKey) objectKeys.add(String(segment.objectKey));
  }
  if (includeManifest && recording?.r2ManifestKey) {
    objectKeys.add(String(recording.r2ManifestKey));
  }
  return [...objectKeys];
}

function summarizeRecording(recording, options) {
  const objectKeys = collectObjectKeys(recording, options.includeManifest);
  return {
    recordingId: String(recording._id),
    matchId: String(recording.match?._id || recording.match || ""),
    matchCode: String(recording.match?.code || ""),
    status: String(recording.status || ""),
    sourceCleanupStatus: String(recording.meta?.sourceCleanup?.status || "pending"),
    r2TargetId: recording.r2TargetId || null,
    objectCount: objectKeys.length,
    estimatedSourceBytes: (recording.segments || []).reduce(
      (sum, segment) => sum + (Number(segment?.sizeBytes) || 0),
      0
    ),
    readyAt: recording.readyAt || null,
    finalizedAt: recording.finalizedAt || null,
    hasDriveFile: Boolean(recording.driveFileId || recording.driveRawUrl || recording.drivePreviewUrl),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await connectDB();

  try {
    const query = await buildQuery(options);
    const recordings = await LiveRecordingV2.find(query)
      .select(
        [
          "match",
          "status",
          "segments.objectKey",
          "segments.sizeBytes",
          "r2TargetId",
          "r2ManifestKey",
          "driveFileId",
          "driveRawUrl",
          "drivePreviewUrl",
          "meta",
          "readyAt",
          "finalizedAt",
          "createdAt",
        ].join(" ")
      )
      .populate({ path: "match", select: "code tournament" })
      .sort({ readyAt: 1, finalizedAt: 1, createdAt: 1 })
      .limit(options.limit);

    const preview = recordings.map((recording) => summarizeRecording(recording, options));
    const summary = {
      mode: options.execute ? "execute" : "dry-run",
      filters: {
        statuses: options.statuses,
        tournamentId: options.tournamentId || null,
        recordingIds: options.recordingIds,
        matchIds: options.matchIds,
        before: options.before?.toISOString() || null,
        includeManifest: options.includeManifest,
        includeCompleted: options.includeCompleted,
        limit: options.limit,
      },
      matchedCount: preview.length,
      totalObjectCount: preview.reduce((sum, item) => sum + item.objectCount, 0),
      totalEstimatedSourceBytes: preview.reduce(
        (sum, item) => sum + (Number(item.estimatedSourceBytes) || 0),
        0
      ),
      recordings: preview,
    };

    if (!options.execute) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const results = [];
    for (const recording of recordings) {
      const recordingId = String(recording._id);
      try {
        const cleanupResult = await deleteExportedRecordingSegments(recording, {
          includeManifest: options.includeManifest,
        });

        const nextMeta = asMutableMeta(recording.meta);
        nextMeta.sourceCleanup = {
          status: "completed",
          deletedAt: new Date(),
          deletedObjectCount: cleanupResult.deletedObjectCount,
          deletedManifest: cleanupResult.deletedManifest,
          objectKeys: cleanupResult.objectKeys,
          via: "cleanupExportedRecordingR2.js",
        };

        recording.meta = nextMeta;
        if (options.includeManifest) {
          recording.r2ManifestKey = null;
        }
        await recording.save();
        await publishLiveRecordingMonitorUpdate({
          reason: "recording_source_cleanup_manual",
          recordingIds: [recordingId],
        }).catch(() => {});

        results.push({
          recordingId,
          status: "completed",
          deletedObjectCount: cleanupResult.deletedObjectCount,
          deletedManifest: cleanupResult.deletedManifest,
        });
      } catch (error) {
        const nextMeta = asMutableMeta(recording.meta);
        nextMeta.sourceCleanup = {
          status: "failed",
          attemptedAt: new Date(),
          error: error?.message || String(error),
          via: "cleanupExportedRecordingR2.js",
        };
        recording.meta = nextMeta;
        await recording.save().catch(() => {});
        await publishLiveRecordingMonitorUpdate({
          reason: "recording_source_cleanup_manual_failed",
          recordingIds: [recordingId],
        }).catch(() => {});

        results.push({
          recordingId,
          status: "failed",
          error: error?.message || String(error),
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          ...summary,
          executedCount: results.length,
          completedCount: results.filter((item) => item.status === "completed").length,
          failedCount: results.filter((item) => item.status === "failed").length,
          results,
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[cleanupExportedRecordingR2] failed:", error?.message || error);
  process.exitCode = 1;
});
