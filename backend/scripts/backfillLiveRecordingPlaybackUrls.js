import dotenv from "dotenv";
import mongoose from "mongoose";

import connectDB from "../config/db.js";
import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import Match from "../models/matchModel.js";
import {
  buildRecordingPlaybackUrl,
  buildRecordingTemporaryPlaybackUrl,
} from "../services/liveRecordingV2Export.service.js";

dotenv.config();

function getAppHost() {
  return String(
    process.env.HOST || process.env.FRONTEND_URL || "https://pickletour.vn"
  ).replace(/\/+$/, "");
}

function getExplicitPlaybackBase() {
  return String(
    process.env.LIVE_RECORDING_PLAYBACK_BASE_URL ||
      process.env.PUBLIC_API_BASE_URL ||
      process.env.API_URL ||
      ""
  )
    .trim()
    .replace(/\/+$/, "");
}

function getLegacyPlaybackApiBase() {
  const explicitBase = getExplicitPlaybackBase();
  if (explicitBase) return explicitBase;
  return `${getAppHost()}/api`;
}

function buildLegacyRecordingPlaybackUrl(recordingId) {
  return `${getLegacyPlaybackApiBase()}/live/recordings/v2/${String(recordingId)}/play`;
}

function buildLegacyRecordingTemporaryPlaybackUrl(recordingId) {
  return `${getLegacyPlaybackApiBase()}/live/recordings/v2/${String(recordingId)}/temp`;
}

function parseCsv(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function parseArgs(argv = []) {
  const options = {
    execute: false,
    limit: 200,
    statuses: [],
    tournamentId: "",
    recordingIds: [],
    matchIds: [],
  };

  for (const rawArg of argv) {
    const arg = String(rawArg || "").trim();
    if (!arg) continue;

    if (arg === "--execute") {
      options.execute = true;
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
      options.statuses = parseCsv(arg.split("=")[1]);
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

  return Array.from(
    new Set([...directMatchIds, ...matches.map((match) => String(match._id))])
  );
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

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

function buildFixPlan(recording) {
  const recordingId = String(recording._id);
  const desiredPlaybackUrl = buildRecordingPlaybackUrl(recordingId);
  const desiredTemporaryPlaybackUrl =
    buildRecordingTemporaryPlaybackUrl(recordingId);
  const legacyPlaybackUrl = buildLegacyRecordingPlaybackUrl(recordingId);
  const legacyTemporaryPlaybackUrl =
    buildLegacyRecordingTemporaryPlaybackUrl(recordingId);
  const currentPlaybackUrl = String(recording.playbackUrl || "");
  const currentMatchVideo = String(recording.match?.video || "");

  const updateRecordingPlaybackUrl = currentPlaybackUrl !== desiredPlaybackUrl;
  let nextMatchVideo = null;
  let matchVideoReason = null;

  if (currentMatchVideo === legacyPlaybackUrl) {
    nextMatchVideo = desiredPlaybackUrl;
    matchVideoReason = "legacy_playback_url";
  } else if (currentMatchVideo === legacyTemporaryPlaybackUrl) {
    nextMatchVideo = desiredTemporaryPlaybackUrl;
    matchVideoReason = "legacy_temporary_playback_url";
  }

  return {
    recordingId,
    matchId: recording.match?._id ? String(recording.match._id) : null,
    matchCode: String(recording.match?.code || ""),
    status: String(recording.status || ""),
    currentPlaybackUrl,
    desiredPlaybackUrl,
    updateRecordingPlaybackUrl,
    currentMatchVideo,
    nextMatchVideo,
    matchVideoReason,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await connectDB();

  try {
    const query = await buildQuery(options);
    const recordings = await LiveRecordingV2.find(query)
      .select("match status playbackUrl readyAt finalizedAt createdAt")
      .populate({ path: "match", select: "code video tournament" })
      .sort({ readyAt: -1, finalizedAt: -1, createdAt: -1 })
      .limit(options.limit);

    const plans = recordings
      .map((recording) => buildFixPlan(recording))
      .filter(
        (plan) => plan.updateRecordingPlaybackUrl || Boolean(plan.nextMatchVideo)
      );

    const summary = {
      mode: options.execute ? "execute" : "dry-run",
      playbackBase: getExplicitPlaybackBase() || null,
      legacyPlaybackBase: getLegacyPlaybackApiBase(),
      matchedCount: plans.length,
      filters: {
        statuses: options.statuses,
        tournamentId: options.tournamentId || null,
        recordingIds: options.recordingIds,
        matchIds: options.matchIds,
        limit: options.limit,
      },
      recordings: plans,
    };

    if (!options.execute) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const results = [];
    for (const plan of plans) {
      try {
        const recording = await LiveRecordingV2.findById(plan.recordingId);
        if (!recording) {
          results.push({
            recordingId: plan.recordingId,
            status: "skipped",
            reason: "recording_not_found",
          });
          continue;
        }

        const result = {
          recordingId: plan.recordingId,
          matchId: plan.matchId,
          status: "updated",
          updatedRecordingPlaybackUrl: false,
          updatedMatchVideo: false,
        };

        if (plan.updateRecordingPlaybackUrl) {
          recording.playbackUrl = plan.desiredPlaybackUrl;
          await recording.save();
          result.updatedRecordingPlaybackUrl = true;
        }

        if (plan.nextMatchVideo && plan.matchId) {
          const updateMatchResult = await Match.updateOne(
            {
              _id: plan.matchId,
              video: plan.currentMatchVideo,
            },
            {
              $set: {
                video: plan.nextMatchVideo,
              },
            }
          );
          result.updatedMatchVideo =
            Number(updateMatchResult?.modifiedCount || 0) > 0;
          result.matchVideoReason = plan.matchVideoReason;
        }

        results.push(result);
      } catch (error) {
        results.push({
          recordingId: plan.recordingId,
          matchId: plan.matchId,
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
          updatedPlaybackUrlCount: results.filter(
            (item) => item.updatedRecordingPlaybackUrl
          ).length,
          updatedMatchVideoCount: results.filter(
            (item) => item.updatedMatchVideo
          ).length,
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
  console.error(
    "[backfillLiveRecordingPlaybackUrls] failed:",
    error?.message || error
  );
  process.exitCode = 1;
});
