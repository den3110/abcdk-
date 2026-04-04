import os from "os";

import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import LiveRecordingAiCommentaryJob from "../models/liveRecordingAiCommentaryJobModel.js";
import { publishLiveRecordingMonitorUpdate } from "./liveRecordingMonitorEvents.service.js";
import {
  buildAiCommentarySummary,
  buildLiveRecordingAiCommentaryFingerprint,
  computeLiveRecordingAiCommentarySettingsHash,
  DEFAULT_AI_COMMENTARY_SETTINGS,
  generateLiveRecordingAiCommentaryArtifact,
  loadLiveRecordingAiCommentarySettings,
} from "./liveRecordingAiCommentary.service.js";
import {
  checkLiveRecordingAiCommentaryGatewayHealth,
  getAiCommentaryTonePresets,
  getAiCommentaryVoicePresets,
} from "./liveRecordingAiCommentaryGateway.service.js";
import { buildMatchCodePayload } from "../utils/matchDisplayCode.js";

const WORKER_TICK_MS = Math.max(
  5_000,
  Number(process.env.LIVE_RECORDING_AI_COMMENTARY_WORKER_TICK_MS) || 10_000
);
const STALE_RUNNING_MS = Math.max(
  10 * 60_000,
  Number(process.env.LIVE_RECORDING_AI_COMMENTARY_STALE_MS) || 45 * 60_000
);

const workerIdentity = `${os.hostname()}:${
  process.pid
}:live-recording-ai-commentary`;
let workerTimer = null;
let tickRunning = false;

const STEP_DEFS = [
  { key: "resolve_source", label: "Chuẩn bị video nguồn", progressPercent: 10 },
  {
    key: "analyze_video",
    label: "Phân tích khung hình video",
    progressPercent: 22,
  },
  {
    key: "analyze_audio",
    label: "Phân tích âm thanh và transcript",
    progressPercent: 26,
  },
  {
    key: "write_script",
    label: "Viết kịch bản bình luận",
    progressPercent: 30,
  },
  { key: "tts", label: "Render giọng đọc AI", progressPercent: 55 },
  { key: "mix_video", label: "Ghép giọng đọc vào video", progressPercent: 78 },
  {
    key: "upload_drive",
    label: "Upload bản BLV AI lên Drive",
    progressPercent: 92,
  },
];

function safeText(value) {
  return String(value || "").trim();
}

function pickPersonName(person) {
  return (
    person?.nickname ||
    person?.nickName ||
    person?.fullName ||
    person?.name ||
    person?.shortName ||
    person?.displayName ||
    person?.user?.nickname ||
    person?.user?.nickName ||
    person?.user?.fullName ||
    person?.user?.name ||
    ""
  );
}

function buildPairLabel(pair, displayMode = "fullName") {
  if (!pair) return "";
  const explicit =
    safeText(pair.teamName) ||
    safeText(pair.label) ||
    safeText(pair.displayName) ||
    safeText(pair.title);
  if (explicit) return explicit;

  const first =
    displayMode === "nickname"
      ? pickPersonName({
          nickname: pair?.player1?.nickname,
          nickName: pair?.player1?.nickName,
          user: pair?.player1?.user,
          fullName: pair?.player1?.fullName,
          name: pair?.player1?.name,
          shortName: pair?.player1?.shortName,
        })
      : pickPersonName({
          fullName: pair?.player1?.fullName,
          name: pair?.player1?.name,
          user: pair?.player1?.user,
          nickname: pair?.player1?.nickname,
          nickName: pair?.player1?.nickName,
          shortName: pair?.player1?.shortName,
        });
  const second =
    displayMode === "nickname"
      ? pickPersonName({
          nickname: pair?.player2?.nickname,
          nickName: pair?.player2?.nickName,
          user: pair?.player2?.user,
          fullName: pair?.player2?.fullName,
          name: pair?.player2?.name,
          shortName: pair?.player2?.shortName,
        })
      : pickPersonName({
          fullName: pair?.player2?.fullName,
          name: pair?.player2?.name,
          user: pair?.player2?.user,
          nickname: pair?.player2?.nickname,
          nickName: pair?.player2?.nickName,
          shortName: pair?.player2?.shortName,
        });

  return [first, second].filter(Boolean).join(" / ");
}

function buildParticipantsLabel(match) {
  const displayMode = safeText(
    match?.tournament?.nameDisplayMode
  ).toLowerCase();
  const pairA = buildPairLabel(match?.pairA, displayMode);
  const pairB = buildPairLabel(match?.pairB, displayMode);
  return [pairA, pairB].filter(Boolean).join(" vs ");
}

function isFinishedLikeStatus(status) {
  return ["finished", "ended", "stopped"].includes(
    safeText(status).toLowerCase()
  );
}

function buildJobSteps() {
  return STEP_DEFS.map((step) => ({
    key: step.key,
    label: step.label,
    status: "queued",
    startedAt: null,
    completedAt: null,
    message: "",
    error: "",
    result: null,
  }));
}

function applyWorkerInfo(job) {
  const now = new Date();
  job.worker = {
    hostname: os.hostname(),
    pid: process.pid,
    startedAt: job.worker?.startedAt || now,
    lastHeartbeatAt: now,
  };
}

function clearWorkerInfo(job) {
  job.worker = {
    hostname: null,
    pid: null,
    startedAt: null,
    lastHeartbeatAt: null,
  };
}

function findStep(job, key) {
  return Array.isArray(job?.steps)
    ? job.steps.find((step) => safeText(step?.key) === safeText(key))
    : null;
}

function refreshJobProgress(job, fallbackPercent = 0) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const completedCount = steps.filter(
    (step) => step.status === "completed"
  ).length;
  const failedCount = steps.filter((step) => step.status === "failed").length;
  const totalCount = steps.length || 1;
  const derivedPercent = Math.round(
    ((completedCount + failedCount) / totalCount) * 100
  );
  job.progressPercent = Math.max(
    derivedPercent,
    Math.min(100, Math.round(Number(fallbackPercent) || 0))
  );
}

function updateJobStep(job, key, status, extra = {}) {
  const step = findStep(job, key);
  if (!step) return;
  const now = new Date();
  if (status === "processing") {
    step.startedAt = step.startedAt || now;
  }
  if (["completed", "failed", "skipped"].includes(status)) {
    step.completedAt = now;
    step.startedAt = step.startedAt || now;
  }
  step.status = status;
  if (extra.message !== undefined) step.message = safeText(extra.message);
  if (extra.error !== undefined) step.error = safeText(extra.error);
  if (extra.result !== undefined) step.result = extra.result;
}

function buildRequestedBy(user = {}) {
  return {
    userId: user?._id || user?.userId || null,
    name: safeText(user?.name || user?.fullName),
    email: safeText(user?.email),
  };
}

async function loadRecordingForCommentary(recordingId) {
  return LiveRecordingV2.findById(recordingId).populate({
    path: "match",
    select: [
      "code",
      "status",
      "winner",
      "courtLabel",
      "gameScores",
      "liveLog",
      "pairA",
      "pairB",
      "court",
      "bracket",
      "tournament",
    ].join(" "),
    populate: [
      {
        path: "pairA",
        select: "player1 player2 teamName label displayName title",
        populate: [
          {
            path: "player1",
            select: "fullName name shortName nickname nickName user",
            populate: {
              path: "user",
              select: "name fullName nickname nickName",
            },
          },
          {
            path: "player2",
            select: "fullName name shortName nickname nickName user",
            populate: {
              path: "user",
              select: "name fullName nickname nickName",
            },
          },
        ],
      },
      {
        path: "pairB",
        select: "player1 player2 teamName label displayName title",
        populate: [
          {
            path: "player1",
            select: "fullName name shortName nickname nickName user",
            populate: {
              path: "user",
              select: "name fullName nickname nickName",
            },
          },
          {
            path: "player2",
            select: "fullName name shortName nickname nickName user",
            populate: {
              path: "user",
              select: "name fullName nickname nickName",
            },
          },
        ],
      },
      { path: "court", select: "name label number" },
      { path: "bracket", select: "name stage" },
      { path: "tournament", select: "name nameDisplayMode" },
    ],
  });
}

async function publishRecordingUpdate(recordingId, reason) {
  if (!recordingId) return;
  await publishLiveRecordingMonitorUpdate({
    reason,
    recordingIds: [String(recordingId)],
  }).catch(() => {});
}

async function saveQueuedRecordingState(
  recording,
  { jobId, status, settings, sourceFingerprint, error = "" } = {}
) {
  const current =
    recording?.aiCommentary &&
    typeof recording.aiCommentary === "object" &&
    !Array.isArray(recording.aiCommentary)
      ? { ...recording.aiCommentary }
      : {};

  recording.aiCommentary = {
    ...current,
    status,
    latestJobId: jobId || current.latestJobId || null,
    sourceDriveFileId:
      safeText(recording?.driveFileId) || current.sourceDriveFileId || null,
    language: settings?.defaultLanguage || current.language || null,
    voicePreset: settings?.defaultVoicePreset || current.voicePreset || null,
    tonePreset: settings?.defaultTonePreset || current.tonePreset || null,
    sourceFingerprint: sourceFingerprint || current.sourceFingerprint || null,
    error: safeText(error) || null,
  };

  await recording.save();
}

function serializeJob(jobDoc) {
  if (!jobDoc) return null;
  const job = jobDoc.toObject ? jobDoc.toObject() : jobDoc;
  const match = job?.match || {};
  const recording = job?.recording || {};
  const matchCodePayload = buildMatchCodePayload(match);
  const displayMode = safeText(
    match?.tournament?.nameDisplayMode
  ).toLowerCase();
  const scriptPreview = Array.isArray(job?.scriptSegments)
    ? job.scriptSegments
        .filter((segment) => safeText(segment?.text))
        .slice(0, 8)
        .map((segment, index) => ({
          segmentIndex: index,
          startSec: Number(segment?.startSec) || 0,
          endSec: Number(segment?.endSec) || 0,
          sceneIndex: Number.isInteger(segment?.sceneIndex)
            ? Number(segment.sceneIndex)
            : null,
          windowKind: safeText(segment?.windowKind) || null,
          emotion: safeText(segment?.emotion) || null,
          energy:
            segment?.energy === null || segment?.energy === undefined
              ? null
              : Number(segment.energy),
          text: safeText(segment?.text),
        }))
    : [];
  return {
    id: String(job._id),
    recordingId: recording?._id
      ? String(recording._id)
      : String(job.recording || ""),
    matchId: match?._id ? String(match._id) : String(job.match || ""),
    matchCode:
      safeText(matchCodePayload?.displayCode) ||
      safeText(matchCodePayload?.code) ||
      safeText(match?.code),
    participantsLabel: buildParticipantsLabel({
      ...match,
      tournament: match?.tournament || { nameDisplayMode: displayMode },
    }),
    tournamentName: safeText(match?.tournament?.name),
    triggerMode: safeText(job.triggerMode) || "manual",
    status: safeText(job.status) || "queued",
    language: safeText(job.language) || null,
    voicePreset: safeText(job.voicePreset) || null,
    tonePreset: safeText(job.tonePreset) || null,
    mixMode: safeText(job.mixMode) || null,
    sourceFingerprint: safeText(job.sourceFingerprint) || null,
    settingsHash: safeText(job.settingsHash) || null,
    progressPercent: Number(job.progressPercent) || 0,
    currentStepKey: safeText(job.currentStepKey) || null,
    currentStepLabel: safeText(job.currentStepLabel) || null,
    lastError: safeText(job.lastError) || "",
    summary: job.summary || {},
    analysisPreview: {
      ...(job.analysisPreview || {}),
      scriptPreview,
    },
    artifacts: job.artifacts || {},
    requestedBy: job.requestedBy || {},
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || null,
    worker: job.worker || null,
    recordingStatus: safeText(recording?.status) || null,
    recordingPlaybackUrl:
      recording?._id && buildAiCommentarySummary(recording).ready
        ? buildAiCommentarySummary(recording).dubbedPlaybackUrl
        : null,
    steps: Array.isArray(job.steps)
      ? job.steps.map((step) => ({
          key: step.key,
          label: step.label,
          status: step.status,
          startedAt: step.startedAt || null,
          completedAt: step.completedAt || null,
          message: step.message || "",
          error: step.error || "",
          result: step.result || null,
        }))
      : [],
  };
}

async function getQueuedOrRunningConflict(recordingId) {
  return LiveRecordingAiCommentaryJob.findOne({
    recording: recordingId,
    status: { $in: ["queued", "running"] },
  }).sort({ createdAt: 1 });
}

async function createCommentaryJob({
  recording,
  match,
  triggerMode = "manual",
  requestedBy = {},
  forceRerender = false,
  allowWhenGlobalDisabled = false,
} = {}) {
  const settings = await loadLiveRecordingAiCommentarySettings();
  if (!allowWhenGlobalDisabled && !settings.enabled) {
    const error = new Error("AI commentary is disabled in system settings");
    error.statusCode = 409;
    throw error;
  }

  if (!recording) {
    const error = new Error("Recording not found");
    error.statusCode = 404;
    throw error;
  }
  if (safeText(recording.status).toLowerCase() !== "ready") {
    const error = new Error(
      "Only ready recordings can be dubbed with AI commentary"
    );
    error.statusCode = 409;
    throw error;
  }
  if (!safeText(recording.driveFileId) && !safeText(recording.driveRawUrl)) {
    const error = new Error("Recording Drive source is not ready");
    error.statusCode = 409;
    throw error;
  }
  if (!match || !isFinishedLikeStatus(match.status)) {
    const error = new Error(
      "Only finished matches can be dubbed with AI commentary"
    );
    error.statusCode = 409;
    throw error;
  }

  const existingActiveJob = await getQueuedOrRunningConflict(recording._id);
  if (existingActiveJob) {
    const error = new Error(
      "AI commentary job already exists for this recording"
    );
    error.statusCode = 409;
    throw error;
  }

  const { sourceFingerprint, settingsHash } =
    buildLiveRecordingAiCommentaryFingerprint(recording, settings);

  const currentSummary = buildAiCommentarySummary(recording);
  if (
    !forceRerender &&
    currentSummary.ready &&
    currentSummary.sourceFingerprint &&
    currentSummary.sourceFingerprint === sourceFingerprint
  ) {
    return {
      queued: false,
      skipped: true,
      reason: "already_rendered_for_same_source",
      recording,
      job: null,
      settings,
    };
  }

  const existingCompletedJob = await LiveRecordingAiCommentaryJob.findOne({
    recording: recording._id,
    sourceFingerprint,
    status: "completed",
  })
    .sort({ createdAt: -1 })
    .lean();

  if (existingCompletedJob && !forceRerender) {
    return {
      queued: false,
      skipped: true,
      reason: "existing_completed_job",
      recording,
      job: existingCompletedJob,
      settings,
    };
  }

  const job = await LiveRecordingAiCommentaryJob.create({
    recording: recording._id,
    match: match._id,
    triggerMode,
    status: "queued",
    language: settings.defaultLanguage,
    voicePreset: settings.defaultVoicePreset,
    tonePreset: settings.defaultTonePreset,
    mixMode: settings.keepOriginalAudioBed ? "bed_duck" : "narration_only",
    sourceFingerprint,
    settingsHash:
      settingsHash ||
      computeLiveRecordingAiCommentarySettingsHash({
        language: settings.defaultLanguage,
        voicePreset: settings.defaultVoicePreset,
        tonePreset: settings.defaultTonePreset,
        keepOriginalAudioBed: settings.keepOriginalAudioBed,
        audioBedLevelDb: settings.audioBedLevelDb,
        duckAmountDb: settings.duckAmountDb,
      }),
    progressPercent: 0,
    currentStepKey: STEP_DEFS[0].key,
    currentStepLabel: STEP_DEFS[0].label,
    requestedBy: buildRequestedBy(requestedBy),
    steps: buildJobSteps(),
  });

  await saveQueuedRecordingState(recording, {
    jobId: String(job._id),
    status: "queued",
    settings,
    sourceFingerprint,
  });
  await publishRecordingUpdate(recording._id, "recording_ai_commentary_queued");

  return {
    queued: true,
    skipped: false,
    reason: "",
    recording,
    job,
    settings,
  };
}

export async function enqueueLiveRecordingAiCommentaryJob({
  recordingId,
  triggerMode = "manual",
  requestedBy = {},
  forceRerender = false,
} = {}) {
  const recording = await loadRecordingForCommentary(recordingId);
  const match = recording?.match || null;
  const result = await createCommentaryJob({
    recording,
    match,
    triggerMode,
    requestedBy,
    forceRerender,
    allowWhenGlobalDisabled: false,
  });

  return {
    ...result,
    recording: recording ? buildAiCommentarySummary(recording) : null,
    job: result.job ? serializeJob(result.job) : result.job,
  };
}

export async function maybeAutoQueueLiveRecordingAiCommentary(recordingId) {
  const settings = await loadLiveRecordingAiCommentarySettings();
  if (!settings.enabled || !settings.autoGenerateAfterDriveUpload) {
    return {
      queued: false,
      skipped: true,
      reason: settings.enabled ? "auto_disabled" : "global_disabled",
    };
  }

  const recording = await loadRecordingForCommentary(recordingId);
  if (!recording) {
    return { queued: false, skipped: true, reason: "recording_not_found" };
  }

  try {
    const result = await createCommentaryJob({
      recording,
      match: recording.match,
      triggerMode: "auto",
      requestedBy: {},
      forceRerender: false,
      allowWhenGlobalDisabled: true,
    });
    return {
      ...result,
      recording: buildAiCommentarySummary(recording),
      job: result.job ? serializeJob(result.job) : null,
    };
  } catch (error) {
    return {
      queued: false,
      skipped: true,
      reason: safeText(error?.message) || "auto_queue_failed",
    };
  }
}

async function markStaleRunningJobs() {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
  const staleJobs = await LiveRecordingAiCommentaryJob.find({
    status: "running",
    $or: [
      { "worker.lastHeartbeatAt": { $exists: false } },
      { "worker.lastHeartbeatAt": null },
      { "worker.lastHeartbeatAt": { $lte: staleBefore } },
    ],
  }).limit(10);

  for (const job of staleJobs) {
    job.status = "failed";
    job.lastError = "AI commentary worker stalled before completion";
    job.finishedAt = new Date();
    clearWorkerInfo(job);
    if (safeText(job.currentStepKey)) {
      updateJobStep(job, job.currentStepKey, "failed", {
        error: job.lastError,
      });
    }
    refreshJobProgress(job, job.progressPercent);
    await job.save();

    const recording = await LiveRecordingV2.findById(job.recording);
    if (recording) {
      await saveQueuedRecordingState(recording, {
        jobId: String(job._id),
        status: "failed",
        settings: {
          defaultLanguage:
            job.language || DEFAULT_AI_COMMENTARY_SETTINGS.defaultLanguage,
          defaultVoicePreset:
            job.voicePreset ||
            DEFAULT_AI_COMMENTARY_SETTINGS.defaultVoicePreset,
          defaultTonePreset:
            job.tonePreset || DEFAULT_AI_COMMENTARY_SETTINGS.defaultTonePreset,
        },
        sourceFingerprint: job.sourceFingerprint,
        error: job.lastError,
      });
      await publishRecordingUpdate(
        recording._id,
        "recording_ai_commentary_worker_stale"
      );
    }
  }
}

async function claimNextJob() {
  return LiveRecordingAiCommentaryJob.findOneAndUpdate(
    { status: "queued" },
    {
      $set: {
        status: "running",
        startedAt: new Date(),
        "worker.hostname": os.hostname(),
        "worker.pid": process.pid,
        "worker.startedAt": new Date(),
        "worker.lastHeartbeatAt": new Date(),
      },
    },
    {
      new: true,
      sort: { createdAt: 1 },
    }
  );
}

async function markProcessing(job, stepKey, label, progressPercent) {
  applyWorkerInfo(job);
  job.currentStepKey = stepKey;
  job.currentStepLabel = label;
  updateJobStep(job, stepKey, "processing", { message: label, error: "" });
  refreshJobProgress(job, progressPercent);
  await job.save();
}

async function markCompleted(
  job,
  stepKey,
  label,
  progressPercent,
  result = null
) {
  applyWorkerInfo(job);
  job.currentStepKey = stepKey;
  job.currentStepLabel = label;
  updateJobStep(job, stepKey, "completed", {
    message: label,
    result,
  });
  refreshJobProgress(job, progressPercent);
  await job.save();
}

async function markFailed(job, errorMessage) {
  const message = safeText(errorMessage) || "AI commentary generation failed";
  applyWorkerInfo(job);
  job.status = "failed";
  job.lastError = message;
  job.finishedAt = new Date();
  if (safeText(job.currentStepKey)) {
    updateJobStep(job, job.currentStepKey, "failed", {
      error: message,
      message,
    });
  }
  refreshJobProgress(job, job.progressPercent);
  clearWorkerInfo(job);
  await job.save();
}

async function loadJobForMonitor(jobId) {
  if (!jobId) return null;
  return LiveRecordingAiCommentaryJob.findById(jobId)
    .populate({
      path: "match",
      select: "code status pairA pairB tournament",
      populate: [
        {
          path: "pairA",
          select: "player1 player2 teamName label displayName title",
          populate: [
            {
              path: "player1",
              select: "fullName name shortName nickname nickName user",
              populate: {
                path: "user",
                select: "name fullName nickname nickName",
              },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: {
                path: "user",
                select: "name fullName nickname nickName",
              },
            },
          ],
        },
        {
          path: "pairB",
          select: "player1 player2 teamName label displayName title",
          populate: [
            {
              path: "player1",
              select: "fullName name shortName nickname nickName user",
              populate: {
                path: "user",
                select: "name fullName nickname nickName",
              },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: {
                path: "user",
                select: "name fullName nickname nickName",
              },
            },
          ],
        },
        { path: "tournament", select: "name nameDisplayMode" },
      ],
    })
    .populate({ path: "recording", select: "status aiCommentary" });
}

async function processJob(jobId) {
  const job = await LiveRecordingAiCommentaryJob.findById(jobId);
  if (!job) return;

  const recording = await loadRecordingForCommentary(job.recording);
  const match = recording?.match || null;
  if (!recording || !match) {
    await markFailed(job, "Recording or match not found for AI commentary job");
    return;
  }

  const settings = await loadLiveRecordingAiCommentarySettings();
  if (!settings.enabled) {
    await markFailed(job, "AI commentary is disabled in system settings");
    await saveQueuedRecordingState(recording, {
      jobId: String(job._id),
      status: "failed",
      settings,
      sourceFingerprint: job.sourceFingerprint,
      error: "AI commentary is disabled in system settings",
    });
    await publishRecordingUpdate(
      recording._id,
      "recording_ai_commentary_disabled"
    );
    return;
  }

  await saveQueuedRecordingState(recording, {
    jobId: String(job._id),
    status: "running",
    settings,
    sourceFingerprint: job.sourceFingerprint,
  });
  await publishRecordingUpdate(
    recording._id,
    "recording_ai_commentary_started"
  );

  let currentStepKey = STEP_DEFS[0].key;
  try {
    const result = await generateLiveRecordingAiCommentaryArtifact({
      recording,
      match,
      settings: {
        ...settings,
        defaultLanguage: job.language || settings.defaultLanguage,
        defaultVoicePreset: job.voicePreset || settings.defaultVoicePreset,
        defaultTonePreset: job.tonePreset || settings.defaultTonePreset,
      },
      onProgress: async ({ key, label, progressPercent }) => {
        currentStepKey = safeText(key) || currentStepKey;
        const currentIndex = STEP_DEFS.findIndex(
          (step) => step.key === currentStepKey
        );
        for (let index = 0; index < STEP_DEFS.length; index += 1) {
          const stepKey = STEP_DEFS[index].key;
          if (index < currentIndex) {
            updateJobStep(job, stepKey, "completed");
          }
        }
        await markProcessing(
          job,
          currentStepKey,
          label || STEP_DEFS[currentIndex]?.label || currentStepKey,
          progressPercent
        );
      },
    });

    for (const stepDef of STEP_DEFS) {
      const isCurrent = stepDef.key === currentStepKey;
      if (isCurrent) {
        await markCompleted(job, stepDef.key, stepDef.label, 100);
      } else if (findStep(job, stepDef.key)?.status === "processing") {
        await markCompleted(
          job,
          stepDef.key,
          stepDef.label,
          stepDef.progressPercent
        );
      } else if (findStep(job, stepDef.key)?.status === "queued") {
        updateJobStep(job, stepDef.key, "completed");
      }
    }

    job.status = "completed";
    job.progressPercent = 100;
    job.currentStepKey = "completed";
    job.currentStepLabel = "Hoàn tất";
    job.scriptSegments = Array.isArray(result?.scriptSegments)
      ? result.scriptSegments
      : [];
    job.summary = result?.summary || {};
    job.analysisPreview = result?.analysisPreview || {};
    job.artifacts = result?.artifacts || {};
    job.lastError = "";
    job.finishedAt = new Date();
    clearWorkerInfo(job);
    await job.save();

    const current =
      recording?.aiCommentary &&
      typeof recording.aiCommentary === "object" &&
      !Array.isArray(recording.aiCommentary)
        ? { ...recording.aiCommentary }
        : {};
    recording.aiCommentary = {
      ...current,
      status: "completed",
      latestJobId: String(job._id),
      sourceDriveFileId:
        safeText(recording.driveFileId) || current.sourceDriveFileId || null,
      language: job.language,
      voicePreset: job.voicePreset,
      tonePreset: job.tonePreset,
      sourceFingerprint: job.sourceFingerprint,
      dubbedDriveFileId: result?.artifacts?.dubbedDriveFileId || null,
      dubbedDriveRawUrl: result?.artifacts?.dubbedDriveRawUrl || null,
      dubbedDrivePreviewUrl: result?.artifacts?.dubbedDrivePreviewUrl || null,
      dubbedPlaybackUrl: result?.artifacts?.dubbedPlaybackUrl || null,
      outputSizeBytes: Number(result?.artifacts?.outputSizeBytes) || 0,
      renderedAt: new Date(),
      error: null,
    };
    await recording.save();
    await publishRecordingUpdate(
      recording._id,
      "recording_ai_commentary_completed"
    );
  } catch (error) {
    const message =
      safeText(error?.message) || "AI commentary generation failed";
    job.currentStepKey = currentStepKey;
    job.currentStepLabel =
      STEP_DEFS.find((step) => step.key === currentStepKey)?.label ||
      currentStepKey;
    await markFailed(job, message);

    await saveQueuedRecordingState(recording, {
      jobId: String(job._id),
      status: "failed",
      settings,
      sourceFingerprint: job.sourceFingerprint,
      error: message,
    });
    await publishRecordingUpdate(
      recording._id,
      "recording_ai_commentary_failed"
    );
  }
}

async function runWorkerTick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await markStaleRunningJobs();
    const job = await claimNextJob();
    if (!job) return;
    await processJob(job._id);
  } catch (error) {
    console.error(
      "[live-recording-ai-commentary] worker tick failed:",
      error?.message || error
    );
  } finally {
    tickRunning = false;
  }
}

export function startLiveRecordingAiCommentaryWorker() {
  if (workerTimer) return workerTimer;

  workerTimer = setInterval(() => {
    void runWorkerTick();
  }, WORKER_TICK_MS);
  workerTimer.unref?.();

  const bootTimer = setTimeout(() => {
    void runWorkerTick();
  }, 10_000);
  bootTimer.unref?.();

  return workerTimer;
}

export async function getLiveRecordingAiCommentaryMonitor() {
  const activeJobId =
    (
      await LiveRecordingAiCommentaryJob.findOne({
        status: { $in: ["queued", "running"] },
      })
        .sort({ createdAt: 1 })
        .select("_id")
        .lean()
    )?._id || null;

  const [settings, gatewayHealth, activeJobDoc, recentJobDocs, summary] =
    await Promise.all([
      loadLiveRecordingAiCommentarySettings(),
      checkLiveRecordingAiCommentaryGatewayHealth(),
      loadJobForMonitor(activeJobId),
      LiveRecordingAiCommentaryJob.find({})
        .sort({ createdAt: -1 })
        .limit(8)
        .populate({
          path: "match",
          select: "code status pairA pairB tournament",
          populate: [
            {
              path: "pairA",
              select: "player1 player2 teamName label displayName title",
              populate: [
                {
                  path: "player1",
                  select: "fullName name shortName nickname nickName user",
                  populate: {
                    path: "user",
                    select: "name fullName nickname nickName",
                  },
                },
                {
                  path: "player2",
                  select: "fullName name shortName nickname nickName user",
                  populate: {
                    path: "user",
                    select: "name fullName nickname nickName",
                  },
                },
              ],
            },
            {
              path: "pairB",
              select: "player1 player2 teamName label displayName title",
              populate: [
                {
                  path: "player1",
                  select: "fullName name shortName nickname nickName user",
                  populate: {
                    path: "user",
                    select: "name fullName nickname nickName",
                  },
                },
                {
                  path: "player2",
                  select: "fullName name shortName nickname nickName user",
                  populate: {
                    path: "user",
                    select: "name fullName nickname nickName",
                  },
                },
              ],
            },
            { path: "tournament", select: "name nameDisplayMode" },
          ],
        })
        .populate({ path: "recording", select: "status aiCommentary" }),
      Promise.all([
        LiveRecordingAiCommentaryJob.countDocuments({ status: "queued" }),
        LiveRecordingAiCommentaryJob.countDocuments({ status: "running" }),
        LiveRecordingAiCommentaryJob.countDocuments({ status: "completed" }),
        LiveRecordingAiCommentaryJob.countDocuments({ status: "failed" }),
      ]),
    ]);

  return {
    settings,
    gatewayHealth,
    presets: {
      voice: getAiCommentaryVoicePresets(),
      tone: getAiCommentaryTonePresets(),
    },
    activeJob: serializeJob(activeJobDoc),
    recentJobs: recentJobDocs.map((job) => serializeJob(job)),
    summary: {
      queued: summary[0],
      running: summary[1],
      completed: summary[2],
      failed: summary[3],
    },
    meta: {
      workerIdentity,
      tickMs: WORKER_TICK_MS,
      staleMs: STALE_RUNNING_MS,
      generatedAt: new Date(),
    },
  };
}
