import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import { buildRecordingPlaybackUrl } from "./liveRecordingV2Export.service.js";
import { getRecordingDriveSettings } from "./driveRecordings.service.js";
import {
  getLiveRecordingMonitorMeta,
  publishLiveRecordingMonitorUpdate,
} from "./liveRecordingMonitorEvents.service.js";
import { getLiveRecordingExportQueueSnapshot } from "./liveRecordingV2Queue.service.js";
import { getLiveRecordingWorkerHealth } from "./liveRecordingWorkerHealth.service.js";

function pickPersonName(person) {
  return (
    person?.nickname ||
    person?.nickName ||
    person?.fullName ||
    person?.name ||
    person?.shortName ||
    person?.displayName ||
    ""
  );
}

function buildPairLabel(pair) {
  if (!pair) return "";
  if (pair.teamName) return pair.teamName;
  const p1 = pickPersonName(pair.player1?.user || pair.player1);
  const p2 = pickPersonName(pair.player2?.user || pair.player2);
  return [p1, p2].filter(Boolean).join(" / ") || pair.label || "";
}

function buildParticipantsLabel(match) {
  const sideA = buildPairLabel(match?.pairA);
  const sideB = buildPairLabel(match?.pairB);
  return [sideA, sideB].filter(Boolean).join(" vs ");
}

function buildCourtLabel(match, recording) {
  if (match?.courtLabel) return match.courtLabel;
  if (match?.court?.name) return match.court.name;
  if (match?.court?.label) return match.court.label;
  if (Number.isFinite(match?.court?.number)) return `Court ${match.court.number}`;
  if (recording?.courtId?.label) return recording.courtId.label;
  if (recording?.courtId?.name) return recording.courtId.name;
  if (Number.isFinite(recording?.courtId?.number)) {
    return `Court ${recording.courtId.number}`;
  }
  return "";
}

function compactLabel(parts) {
  return parts.filter(Boolean).join(" • ");
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getConfiguredRecordingR2StorageTotalBytes() {
  const configured = Number(
    process.env.R2_RECORDINGS_STORAGE_TOTAL_BYTES ||
      process.env.R2_STORAGE_TOTAL_BYTES ||
      0
  );
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : null;
}

function getExportStaleThresholdMs() {
  const configured = Number(process.env.LIVE_RECORDING_EXPORT_STALE_MS || 0);
  if (Number.isFinite(configured) && configured >= 60_000) {
    return Math.floor(configured);
  }
  return 5 * 60 * 1000;
}

function sanitizeSegmentMeta(meta) {
  return meta && typeof meta === "object" ? { ...meta } : {};
}

function hasCompletedSourceCleanup(recording) {
  return recording?.meta?.sourceCleanup?.status === "completed";
}

function summarizeSegments(segments = []) {
  const sortedSegments = [...segments].sort((a, b) => a.index - b.index);
  const uploadedSegments = sortedSegments.filter(
    (segment) => segment.uploadStatus === "uploaded"
  );
  const uploadingSegments = sortedSegments.filter((segment) =>
    ["presigned", "uploading_parts"].includes(segment.uploadStatus)
  );
  const failedSegments = sortedSegments.filter(
    (segment) => segment.uploadStatus === "failed"
  );
  const abortedSegments = sortedSegments.filter(
    (segment) => segment.uploadStatus === "aborted"
  );
  const latestSegment = sortedSegments[sortedSegments.length - 1] || null;
  const activeUploadSegment =
    uploadingSegments.sort((a, b) => b.index - a.index)[0] || null;

  const buildSegmentProgress = (segment) => {
    if (!segment) return null;
    const meta = sanitizeSegmentMeta(segment.meta);
    const completedParts = Array.isArray(meta.completedParts)
      ? meta.completedParts
      : [];
    const completedBytes = completedParts.reduce(
      (sum, part) => sum + toNumber(part?.sizeBytes),
      0
    );
    const totalSizeBytes =
      toNumber(meta.totalSizeBytes) ||
      toNumber(meta.segmentSizeBytes) ||
      toNumber(segment.sizeBytes);
    const partSizeBytes = toNumber(meta.partSizeBytes);
    const percent =
      totalSizeBytes > 0
        ? Math.max(0, Math.min(100, Math.round((completedBytes / totalSizeBytes) * 100)))
        : segment.uploadStatus === "uploaded"
        ? 100
        : 0;
    const totalParts =
      partSizeBytes > 0 && totalSizeBytes > 0
        ? Math.max(1, Math.ceil(totalSizeBytes / partSizeBytes))
        : 0;
    return {
      index: segment.index,
      objectKey: segment.objectKey || "",
      etag: segment.etag || "",
      uploadStatus: segment.uploadStatus,
      isFinal: Boolean(segment.isFinal),
      sizeBytes: toNumber(segment.sizeBytes),
      durationSeconds: toNumber(segment.durationSeconds),
      uploadedAt: segment.uploadedAt || null,
      completedPartCount: completedParts.length,
      completedBytes,
      totalSizeBytes,
      percent,
      partSizeBytes,
      totalParts,
      lastPartUploadedAt: meta.lastPartUploadedAt || null,
      startedAt: meta.startedAt || null,
    };
  };

  const detailedSegments = sortedSegments.map(buildSegmentProgress).filter(Boolean);

  return {
    totalSegments: sortedSegments.length,
    uploadedSegments: uploadedSegments.length,
    uploadingSegments: uploadingSegments.length,
    failedSegments: failedSegments.length,
    abortedSegments: abortedSegments.length,
    totalUploadedBytes: uploadedSegments.reduce(
      (sum, segment) => sum + toNumber(segment.sizeBytes),
      0
    ),
    finalSegmentUploaded: uploadedSegments.some((segment) => segment.isFinal),
    segments: detailedSegments,
    latestSegment: buildSegmentProgress(latestSegment),
    activeUploadSegment: buildSegmentProgress(activeUploadSegment),
  };
}

function buildStatusMeta(status) {
  switch (String(status || "").toLowerCase()) {
    case "recording":
      return { code: "recording", color: "error", label: "Recording" };
    case "uploading":
      return { code: "uploading", color: "warning", label: "Uploading" };
    case "exporting":
      return { code: "exporting", color: "info", label: "Exporting" };
    case "ready":
      return { code: "ready", color: "success", label: "Ready" };
    case "failed":
      return { code: "failed", color: "error", label: "Failed" };
    default:
      return {
        code: String(status || "unknown").toLowerCase(),
        color: "default",
        label: status || "Unknown",
      };
  }
}

function estimateRecordingR2SourceBytes(recording) {
  if (!recording || hasCompletedSourceCleanup(recording)) return 0;

  return (recording.segments || []).reduce((sum, segment) => {
    const meta = sanitizeSegmentMeta(segment?.meta);
    const completedPartBytes = Array.isArray(meta.completedParts)
      ? meta.completedParts.reduce(
          (partSum, part) => partSum + toNumber(part?.sizeBytes),
          0
        )
      : 0;

    if (segment?.uploadStatus === "uploaded") {
      return sum + toNumber(segment?.sizeBytes);
    }

    return sum + completedPartBytes;
  }, 0);
}

function buildR2StorageSummary(recordings = []) {
  const totalBytes = getConfiguredRecordingR2StorageTotalBytes();
  const usedBytes = recordings.reduce(
    (sum, recording) => sum + estimateRecordingR2SourceBytes(recording),
    0
  );
  const remainingBytes =
    totalBytes != null ? Math.max(0, totalBytes - usedBytes) : null;
  const percentUsed =
    totalBytes && totalBytes > 0
      ? Math.max(0, Math.min(100, Math.round((usedBytes / totalBytes) * 100)))
      : null;
  const recordingsWithSourceOnR2 = recordings.filter(
    (recording) => estimateRecordingR2SourceBytes(recording) > 0
  ).length;

  return {
    usedBytes,
    remainingBytes,
    totalBytes,
    percentUsed,
    configured: totalBytes != null,
    recordingsWithSourceOnR2,
  };
}

function buildModeLabel(mode) {
  switch (String(mode || "").toUpperCase()) {
    case "STREAM_AND_RECORD":
      return "Livestream + Record";
    case "RECORD_ONLY":
      return "Record only";
    case "STREAM_ONLY":
      return "Livestream only";
    default:
      return mode || "Unknown";
  }
}

function buildExportPipelineInfo(recording, context = {}) {
  const recordingId = String(recording?._id || "");
  const exportPipeline =
    recording?.meta?.exportPipeline &&
    typeof recording.meta.exportPipeline === "object"
      ? { ...recording.meta.exportPipeline }
      : {};
  const workerHealth = context.workerHealth || {};
  const queueSnapshot = context.queueSnapshot || {};
  const waiting = queueSnapshot?.waitingByRecordingId?.[recordingId] || null;
  const active = queueSnapshot?.activeByRecordingId?.[recordingId] || null;
  const delayed = queueSnapshot?.delayedByRecordingId?.[recordingId] || null;
  const currentWorkerRecordingId = String(
    workerHealth?.worker?.currentRecordingId || ""
  );
  const inWorker = Boolean(
    workerHealth?.alive &&
      currentWorkerRecordingId &&
      currentWorkerRecordingId === recordingId
  );
  const updatedAtMs = recording?.updatedAt
    ? new Date(recording.updatedAt).getTime()
    : 0;
  const recentlyUpdated =
    Number.isFinite(updatedAtMs) && updatedAtMs > 0
      ? Date.now() - updatedAtMs < 60 * 1000
      : false;

  let stage = exportPipeline.stage || null;
  if (recording?.status === "exporting") {
    if (inWorker && !stage) stage = "downloading";
    else if (active && !stage) stage = "downloading";
    else if (waiting && !stage) stage = "queued";
    else if (delayed && !stage) stage = "queued_retry";
    else if (!stage) {
      stage = workerHealth?.alive
        ? recentlyUpdated
          ? "awaiting_queue_sync"
          : "stale_no_job"
        : "worker_offline";
    }
  }

  const stageLabels = {
    queued: "Dang cho worker",
    queued_retry: "Dang doi retry",
    awaiting_queue_sync: "Dang dong bo trang thai queue",
    downloading: "Worker dang tai segment tu R2",
    merging: "Worker dang ghep video",
    uploading_drive: "Dang upload len Drive",
    cleaning_r2: "Dang don segment tren R2",
    completed: "Hoan tat",
    failed: "Export that bai",
    stale_no_job: "Export treo - khong co job trong queue",
    worker_offline: "Worker dang offline",
  };

  let detail = "";
  if (stage === "queued" && waiting?.position) {
    detail = `Queue #${waiting.position}`;
  } else if (stage === "queued_retry" && delayed?.position) {
    detail = `Retry queue #${delayed.position}`;
  } else if (stage === "awaiting_queue_sync") {
    detail = "Ban ghi vua vao exporting, dang cho queue/worker dong bo.";
  } else if (inWorker) {
    detail = workerHealth?.worker?.currentJobStartedAt
      ? `Worker bat dau ${new Date(workerHealth.worker.currentJobStartedAt).toISOString()}`
      : "Worker dang xu ly";
  } else if (active) {
    detail = "Worker dang xu ly";
  } else if (stage === "stale_no_job") {
    detail = "Khong tim thay job nao trong queue cho recording nay. Can kiem tra va retry export.";
  } else if (stage === "worker_offline") {
    detail = "Worker khong co heartbeat nen chua the xu ly export nay.";
  }

  return {
    stage,
    label: stageLabels[stage] || exportPipeline.label || "",
    detail,
    driveAuthMode: exportPipeline.driveAuthMode || null,
    queuePosition: waiting?.position || delayed?.position || null,
    jobId:
      exportPipeline.queueJobId ||
      waiting?.jobId ||
      active?.jobId ||
      delayed?.jobId ||
      null,
    inWorker,
    startedAt: exportPipeline.startedAt || null,
    downloadStartedAt: exportPipeline.downloadStartedAt || null,
    mergeStartedAt: exportPipeline.mergeStartedAt || null,
    driveUploadStartedAt: exportPipeline.driveUploadStartedAt || null,
    driveUploadedAt: exportPipeline.driveUploadedAt || null,
    completedAt: exportPipeline.completedAt || null,
    failedAt: exportPipeline.failedAt || null,
    updatedAt: exportPipeline.updatedAt || null,
  };
}

function shouldMarkExportAsStale(recording, exportPipeline = {}) {
  if (recording?.status !== "exporting") return false;
  if (!["stale_no_job", "worker_offline"].includes(exportPipeline.stage)) return false;

  const updatedAtMs = recording?.updatedAt
    ? new Date(recording.updatedAt).getTime()
    : 0;
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return false;

  return Date.now() - updatedAtMs >= getExportStaleThresholdMs();
}

export async function reconcileStaleLiveRecordingExports({
  workerHealth: providedWorkerHealth = null,
  queueSnapshot: providedQueueSnapshot = null,
} = {}) {
  const workerHealth =
    providedWorkerHealth || (await getLiveRecordingWorkerHealth().catch(() => null));
  const queueSnapshot =
    providedQueueSnapshot || (await getLiveRecordingExportQueueSnapshot().catch(() => null));

  const exportingRecordings = await LiveRecordingV2.find({ status: "exporting" });
  const updatedRecordingIds = [];

  for (const recording of exportingRecordings) {
    const exportPipeline = buildExportPipelineInfo(recording, {
      workerHealth,
      queueSnapshot,
    });

    if (!shouldMarkExportAsStale(recording, exportPipeline)) {
      continue;
    }

    const nextMeta =
      recording.meta && typeof recording.meta === "object" && !Array.isArray(recording.meta)
        ? { ...recording.meta }
        : {};
    const currentPipeline =
      nextMeta.exportPipeline &&
      typeof nextMeta.exportPipeline === "object" &&
      !Array.isArray(nextMeta.exportPipeline)
        ? { ...nextMeta.exportPipeline }
        : {};
    const errorMessage =
      exportPipeline.stage === "worker_offline"
        ? "Export worker is offline. Recording export needs retry."
        : "Export job was lost from queue before completion. Retry export is required.";

    nextMeta.exportPipeline = {
      ...currentPipeline,
      stage: "failed",
      label: "Export that bai",
      reconciledAt: new Date(),
      staleReason: exportPipeline.stage,
      updatedAt: new Date(),
      error: errorMessage,
    };

    recording.meta = nextMeta;
    recording.status = "failed";
    recording.error = errorMessage;
    await recording.save();
    updatedRecordingIds.push(String(recording._id));
  }

  if (updatedRecordingIds.length) {
    await publishLiveRecordingMonitorUpdate({
      reason: "recording_export_reconciled_failed",
      recordingIds: updatedRecordingIds,
    }).catch(() => {});
  }

  return {
    updatedRecordingIds,
    workerHealth,
    queueSnapshot,
  };
}

function buildRow(recording, context = {}) {
  const match = recording.match || {};
  const participantsLabel = buildParticipantsLabel(match);
  const tournamentName = match?.tournament?.name || "";
  const bracketName = match?.bracket?.name || "";
  const bracketStage = match?.bracket?.stage || "";
  const courtLabel = buildCourtLabel(match, recording);
  const segmentSummary = summarizeSegments(recording.segments || []);
  const statusMeta = buildStatusMeta(recording.status);
  const exportPipeline = buildExportPipelineInfo(recording, context);
  const driveAuthMode =
    exportPipeline.driveAuthMode || context.currentDriveMode || "serviceAccount";
  const competitionLabel = compactLabel([
    tournamentName,
    compactLabel([bracketName, bracketStage]),
    courtLabel,
  ]);

  return {
    id: String(recording._id),
    recordingId: String(recording._id),
    recordingSessionId: recording.recordingSessionId,
    status: recording.status,
    statusMeta,
    mode: recording.mode,
    modeLabel: buildModeLabel(recording.mode),
    quality: recording.quality || "",
    matchId: match?._id ? String(match._id) : String(recording.match || ""),
    matchCode: match?.code || "",
    participantsLabel: participantsLabel || "Unknown match",
    tournamentName: tournamentName || "",
    bracketName: bracketName || "",
    bracketStage: bracketStage || "",
    courtLabel: courtLabel || "",
    competitionLabel: competitionLabel || "",
    createdAt: recording.createdAt || null,
    updatedAt: recording.updatedAt || null,
    finalizedAt: recording.finalizedAt || null,
    readyAt: recording.readyAt || null,
    durationSeconds: toNumber(recording.durationSeconds),
    sizeBytes: toNumber(recording.sizeBytes),
    exportAttempts: toNumber(recording.exportAttempts),
    playbackUrl: buildRecordingPlaybackUrl(recording._id),
    driveRawUrl: recording.driveRawUrl || null,
    drivePreviewUrl: recording.drivePreviewUrl || null,
    driveFileId: recording.driveFileId || null,
    driveAuthMode,
    r2SourceBytes: estimateRecordingR2SourceBytes(recording),
    sourceCleanupStatus: recording?.meta?.sourceCleanup?.status || null,
    exportPipeline,
    error: recording.error || "",
    segmentSummary,
  };
}

function sortRows(rows) {
  const priority = {
    recording: 0,
    uploading: 1,
    exporting: 2,
    failed: 3,
    ready: 4,
  };
  return [...rows].sort((a, b) => {
    const pa = priority[a.status] ?? 99;
    const pb = priority[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });
}

export async function buildLiveRecordingMonitorSnapshot() {
  const { workerHealth, queueSnapshot } = await reconcileStaleLiveRecordingExports();
  const currentDriveSettings = await getRecordingDriveSettings().catch(() => ({
    mode: "serviceAccount",
  }));

  const recordings = await LiveRecordingV2.find({})
    .sort({ updatedAt: -1, createdAt: -1 })
    .populate({
      path: "match",
      select: "code courtLabel pairA pairB court bracket tournament status",
      populate: [
        {
          path: "pairA",
          select: "player1 player2 teamName label",
          populate: [
            {
              path: "player1",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "name fullName nickname nickName" },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "name fullName nickname nickName" },
            },
          ],
        },
        {
          path: "pairB",
          select: "player1 player2 teamName label",
          populate: [
            {
              path: "player1",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "name fullName nickname nickName" },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "name fullName nickname nickName" },
            },
          ],
        },
        { path: "court", select: "name label number" },
        { path: "bracket", select: "name stage" },
        { path: "tournament", select: "name" },
      ],
    })
    .populate({ path: "courtId", select: "name label number" })
    .lean();

  const rows = sortRows(
    recordings.map((recording) =>
        buildRow(recording, {
          workerHealth,
          queueSnapshot,
          currentDriveMode: currentDriveSettings.mode,
        })
    )
  );
  const summary = rows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.status === "recording") acc.recording += 1;
      if (row.status === "uploading") acc.uploading += 1;
      if (row.status === "exporting") acc.exporting += 1;
      if (row.status === "ready") acc.ready += 1;
      if (row.status === "failed") acc.failed += 1;
      if (["recording", "uploading", "exporting"].includes(row.status)) {
        acc.active += 1;
      }
      acc.totalDurationSeconds += toNumber(row.durationSeconds);
      acc.totalSizeBytes += toNumber(row.sizeBytes);
      acc.totalSegments += toNumber(row.segmentSummary?.totalSegments);
      acc.uploadedSegments += toNumber(row.segmentSummary?.uploadedSegments);
      acc.pendingSegments += Math.max(
        0,
        toNumber(row.segmentSummary?.totalSegments) -
          toNumber(row.segmentSummary?.uploadedSegments)
      );
      return acc;
    },
    {
      total: 0,
      active: 0,
      recording: 0,
      uploading: 0,
      exporting: 0,
      ready: 0,
      failed: 0,
      totalDurationSeconds: 0,
      totalSizeBytes: 0,
      totalSegments: 0,
      uploadedSegments: 0,
      pendingSegments: 0,
    }
  );

  summary.r2Storage = buildR2StorageSummary(recordings);

  return {
    summary,
    rows,
    meta: {
      ...getLiveRecordingMonitorMeta(),
      workerHealth,
      exportQueue: queueSnapshot,
      driveSettings: currentDriveSettings,
      generatedAt: new Date(),
    },
  };
}
