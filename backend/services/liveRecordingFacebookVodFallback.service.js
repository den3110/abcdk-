import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import Match from "../models/matchModel.js";
import { buildRecordingPlaybackUrl } from "./liveRecordingV2Export.service.js";
import { queueLiveRecordingExport } from "./liveRecordingV2Transition.service.js";
import {
  buildFacebookVodRetryPlan,
  buildFacebookVodSourceMeta,
  getFacebookLiveIdentifiers,
  getUploadedRecordingSegments,
  hasDriveRecordingOutput,
  isFacebookEndedStatus,
  RECORDING_SOURCE_FACEBOOK_VOD,
} from "./liveRecordingFacebookVodShared.service.js";

const FACEBOOK_VOD_SWEEP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function asTrimmed(value) {
  return String(value || "").trim();
}

function asMutableMeta(meta) {
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? { ...meta }
    : {};
}

function createFacebookVodRecordingSessionId(matchId) {
  return [
    "facebook_vod",
    String(matchId),
    Date.now(),
    Math.random().toString(36).slice(2, 8),
  ].join("_");
}

function isFacebookVodRecording(recording) {
  const sourceType = asTrimmed(recording?.meta?.source?.type).toLowerCase();
  return sourceType === RECORDING_SOURCE_FACEBOOK_VOD;
}

function shouldSkipQueuedRetry(recording) {
  const stage = asTrimmed(recording?.meta?.exportPipeline?.stage).toLowerCase();
  const scheduledAt = recording?.scheduledExportAt
    ? new Date(recording.scheduledExportAt)
    : recording?.meta?.facebookVod?.nextAttemptAt
    ? new Date(recording.meta.facebookVod.nextAttemptAt)
    : null;

  return (
    recording?.status === "exporting" &&
    stage === "waiting_facebook_vod" &&
    scheduledAt instanceof Date &&
    Number.isFinite(scheduledAt.getTime()) &&
    scheduledAt.getTime() > Date.now()
  );
}

function buildRecordingBootstrapMeta(match, recording) {
  const nextMeta = asMutableMeta(recording?.meta);
  nextMeta.source = buildFacebookVodSourceMeta(match, nextMeta.source);
  const retryPlan = buildFacebookVodRetryPlan({ recording, match, now: new Date() });
  const currentFacebookVod =
    nextMeta.facebookVod &&
    typeof nextMeta.facebookVod === "object" &&
    !Array.isArray(nextMeta.facebookVod)
      ? { ...nextMeta.facebookVod }
      : {};
  nextMeta.facebookVod = {
    ...currentFacebookVod,
    startedAt: currentFacebookVod.startedAt || retryPlan.startedAt,
    deadlineAt: currentFacebookVod.deadlineAt || retryPlan.deadlineAt,
    attemptCount: Number.isFinite(Number(currentFacebookVod.attemptCount))
      ? Math.max(0, Math.floor(Number(currentFacebookVod.attemptCount)))
      : 0,
    lastAttemptAt: currentFacebookVod.lastAttemptAt || null,
    nextAttemptAt: currentFacebookVod.nextAttemptAt || null,
    lastError: currentFacebookVod.lastError || null,
  };
  return nextMeta;
}

function isMatchEligibleForFacebookVod(match) {
  const facebook = getFacebookLiveIdentifiers(match);
  return Boolean(
    facebook.videoId &&
      (facebook.endedAt || isFacebookEndedStatus(facebook.status))
  );
}

async function findReusableFacebookVodRecording(matchId) {
  const recordings = await LiveRecordingV2.find({ match: matchId }).sort({
    createdAt: -1,
    updatedAt: -1,
  });

  for (const recording of recordings) {
    if (hasDriveRecordingOutput(recording)) {
      return {
        recording: null,
        skipped: true,
        reason: "recording_output_already_ready",
      };
    }

    if (getUploadedRecordingSegments(recording).length > 0) {
      return {
        recording: null,
        skipped: true,
        reason: "recording_has_uploaded_segments",
      };
    }

    return {
      recording,
      skipped: false,
      reason: isFacebookVodRecording(recording)
        ? "reuse_existing_facebook_vod_recording"
        : "reuse_existing_recording_without_segments",
    };
  }

  return {
    recording: null,
    skipped: false,
    reason: "create_new_facebook_vod_recording",
  };
}

async function ensureFacebookVodFallbackRecording(match) {
  const reusable = await findReusableFacebookVodRecording(match._id);
  if (reusable.skipped) {
    return reusable;
  }

  if (reusable.recording) {
    const recording = reusable.recording;
    recording.meta = buildRecordingBootstrapMeta(match, recording);
    if (!recording.playbackUrl) {
      recording.playbackUrl = buildRecordingPlaybackUrl(recording._id);
    }
    if (!recording.finalizedAt) {
      recording.finalizedAt =
        getFacebookLiveIdentifiers(match).endedAt || new Date();
    }
    recording.error = null;
    await recording.save();
    return {
      recording,
      skipped: false,
      created: false,
      reason: reusable.reason,
    };
  }

  let recording = await LiveRecordingV2.create({
    match: match._id,
    courtId: match?.court || null,
    mode: "STREAM_ONLY",
    quality: "facebook_vod",
    recordingSessionId: createFacebookVodRecordingSessionId(match._id),
    status: "recording",
    finalizedAt: getFacebookLiveIdentifiers(match).endedAt || new Date(),
    meta: {
      source: buildFacebookVodSourceMeta(match),
      facebookVod: {},
    },
  });

  recording.playbackUrl = buildRecordingPlaybackUrl(recording._id);
  recording.meta = buildRecordingBootstrapMeta(match, recording);
  await recording.save();

  return {
    recording,
    skipped: false,
    created: true,
    reason: reusable.reason,
  };
}

export async function scheduleFacebookVodFallbackForMatch(matchOrId) {
  const match =
    matchOrId && typeof matchOrId === "object" && matchOrId._id
      ? matchOrId
      : await Match.findById(matchOrId)
          .select("_id court facebookLive updatedAt")
          .lean();

  if (!match) {
    return { skipped: true, reason: "match_not_found" };
  }

  if (!isMatchEligibleForFacebookVod(match)) {
    return { skipped: true, reason: "facebook_vod_not_eligible" };
  }

  const ensured = await ensureFacebookVodFallbackRecording(match);
  if (ensured.skipped || !ensured.recording) {
    return ensured;
  }

  if (shouldSkipQueuedRetry(ensured.recording)) {
    return {
      ...ensured,
      queued: false,
      reason: "facebook_vod_retry_already_scheduled",
    };
  }

  const currentPipeline =
    ensured.recording?.meta?.exportPipeline &&
    typeof ensured.recording.meta.exportPipeline === "object" &&
    !Array.isArray(ensured.recording.meta.exportPipeline)
      ? { ...ensured.recording.meta.exportPipeline }
      : null;

  const replaceTerminalJob = ensured.recording.status === "failed";
  await queueLiveRecordingExport(ensured.recording, {
    publishReason: ensured.created
      ? "recording_export_facebook_vod_created"
      : "recording_export_facebook_vod_scheduled",
    replaceTerminalJob,
    replacePendingJob: true,
    currentPipeline,
    ignoreWindow: true,
    forceReason: "facebook_vod_fallback",
  });

  return {
    ...ensured,
    queued: true,
  };
}

export async function autoScheduleFacebookVodFallbackRecordings({
  limit = 100,
} = {}) {
  const cutoff = new Date(Date.now() - FACEBOOK_VOD_SWEEP_LOOKBACK_MS);
  const matches = await Match.find({
    "facebookLive.videoId": { $type: "string" },
    $or: [
      { "facebookLive.endedAt": { $gte: cutoff } },
      {
        "facebookLive.status": { $in: ["ENDED", "STOPPED", "FINISHED"] },
        updatedAt: { $gte: cutoff },
      },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, Math.floor(Number(limit) || 100)))
    .select("_id court facebookLive updatedAt")
    .lean();

  const queuedMatchIds = [];
  const skipped = [];

  for (const match of matches) {
    try {
      const result = await scheduleFacebookVodFallbackForMatch(match);
      if (result?.queued && result?.recording?._id) {
        queuedMatchIds.push(String(match._id));
      } else if (result?.reason) {
        skipped.push({
          matchId: String(match._id),
          reason: result.reason,
        });
      }
    } catch (error) {
      skipped.push({
        matchId: String(match._id),
        reason: error?.message || String(error),
      });
    }
  }

  return {
    queuedMatchIds,
    skipped,
  };
}
