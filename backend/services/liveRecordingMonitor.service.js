import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import SystemSettings from "../models/systemSettingsModel.js";
import {
  buildRecordingPlaybackUrl,
  buildRecordingRawStatusUrl,
  buildRecordingRawStreamUrl,
  buildRecordingTemporaryPlaybackUrl,
} from "./liveRecordingV2Export.service.js";
import { getRecordingDriveSettings } from "./driveRecordings.service.js";
import {
  getRecordingStorageConfiguredCapacityTotalBytes,
  getRecordingStorageTargets,
  getRecordingStorageUsageSummary,
} from "./liveRecordingV2Storage.service.js";
import {
  getLiveRecordingMonitorMeta,
  publishLiveRecordingMonitorUpdate,
} from "./liveRecordingMonitorEvents.service.js";
import { getLiveRecordingExportQueueSnapshot } from "./liveRecordingV2Queue.service.js";
import { getLiveRecordingWorkerHealth } from "./liveRecordingWorkerHealth.service.js";
import {
  getUploadedRecordingSegments,
  queueLiveRecordingExport,
} from "./liveRecordingV2Transition.service.js";
import { buildAiCommentarySummary } from "./liveRecordingAiCommentary.service.js";

const DEFAULT_AUTO_EXPORT_NO_SEGMENT_MINUTES = 15;
const AUTO_EXPORT_SWEEP_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.LIVE_RECORDING_AUTO_EXPORT_SWEEP_MS) || 60_000
);
let liveRecordingAutoExportSweepTimer = null;
let liveRecordingAutoExportSweepRunning = false;

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
  if (Number.isFinite(match?.court?.number))
    return `Court ${match.court.number}`;
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
  return getRecordingStorageConfiguredCapacityTotalBytes();
}

function getExportStaleThresholdMs() {
  const configured = Number(process.env.LIVE_RECORDING_EXPORT_STALE_MS || 0);
  if (Number.isFinite(configured) && configured >= 60_000) {
    return Math.floor(configured);
  }
  return 5 * 60 * 1000;
}

async function getAutoExportNoSegmentMinutes() {
  try {
    const doc = await SystemSettings.findById("system")
      .select("liveRecording.autoExportNoSegmentMinutes")
      .lean();
    const configured = Number(doc?.liveRecording?.autoExportNoSegmentMinutes);
    if (Number.isFinite(configured) && configured >= 1) {
      return Math.floor(configured);
    }
  } catch (_) {}
  return DEFAULT_AUTO_EXPORT_NO_SEGMENT_MINUTES;
}

function toActivityMs(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function getLatestSegmentActivityDate(recording) {
  let latestMs = 0;

  for (const segment of recording?.segments || []) {
    const meta = sanitizeSegmentMeta(segment?.meta);
    latestMs = Math.max(
      latestMs,
      toActivityMs(segment?.uploadedAt),
      toActivityMs(meta.lastPartUploadedAt),
      toActivityMs(meta.completedAt)
    );
  }

  return latestMs > 0 ? new Date(latestMs) : null;
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
        ? Math.max(
            0,
            Math.min(100, Math.round((completedBytes / totalSizeBytes) * 100))
          )
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
      storageTargetId:
        String(
          segment?.storageTargetId || recording?.r2TargetId || ""
        ).trim() || null,
      bucketName:
        String(segment?.bucketName || recording?.r2BucketName || "").trim() ||
        null,
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

  const detailedSegments = sortedSegments
    .map(buildSegmentProgress)
    .filter(Boolean);

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
    case "pending_export_window":
      return {
        code: "pending_export_window",
        color: "secondary",
        label: "Cho khung gio dem",
      };
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

async function buildR2StorageSummary(recordings = []) {
  const totalBytes = getConfiguredRecordingR2StorageTotalBytes();
  const configuredTargets = getRecordingStorageTargets();
  const estimatedUsedBytes = recordings.reduce(
    (sum, recording) => sum + estimateRecordingR2SourceBytes(recording),
    0
  );
  const estimatedRecordingsWithSourceOnR2 = recordings.filter(
    (recording) => estimateRecordingR2SourceBytes(recording) > 0
  ).length;

  let usedBytes = estimatedUsedBytes;
  let recordingsWithSourceOnR2 = estimatedRecordingsWithSourceOnR2;
  let actualUsage = null;
  let scanError = null;

  try {
    actualUsage = await getRecordingStorageUsageSummary();
    usedBytes = Number(actualUsage?.usedBytes) || 0;
    recordingsWithSourceOnR2 =
      Number(actualUsage?.recordingsWithSourceOnR2) || 0;
  } catch (error) {
    scanError = error?.message || String(error);
  }

  const remainingBytes =
    totalBytes != null ? Math.max(0, totalBytes - usedBytes) : null;
  const percentUsed =
    totalBytes && totalBytes > 0
      ? Math.max(0, Math.min(100, Math.round((usedBytes / totalBytes) * 100)))
      : null;
  const scannedTargetsById = new Map(
    (Array.isArray(actualUsage?.targets) ? actualUsage.targets : []).map(
      (target) => [String(target?.id || ""), target]
    )
  );
  const targetBreakdown = configuredTargets.map((target) => {
    const scannedTarget = scannedTargetsById.get(String(target.id || ""));

    if (scannedTarget) {
      return {
        ...target,
        ...scannedTarget,
        configured: Number.isFinite(
          Number(scannedTarget?.capacityBytes || target?.capacityBytes)
        ),
        measured: true,
      };
    }

    if (actualUsage) {
      const capacityBytes =
        Number.isFinite(Number(target?.capacityBytes)) &&
        Number(target.capacityBytes) > 0
          ? Number(target.capacityBytes)
          : null;
      return {
        ...target,
        capacityBytes,
        usedBytes: 0,
        remainingBytes: capacityBytes,
        percentUsed: capacityBytes ? 0 : null,
        objectCount: 0,
        recordingsWithSourceOnR2: 0,
        configured: capacityBytes != null,
        measured: true,
      };
    }

    return {
      ...target,
      capacityBytes:
        Number.isFinite(Number(target?.capacityBytes)) &&
        Number(target.capacityBytes) > 0
          ? Number(target.capacityBytes)
          : null,
      usedBytes: null,
      remainingBytes: null,
      percentUsed: null,
      objectCount: null,
      recordingsWithSourceOnR2: null,
      configured:
        Number.isFinite(Number(target?.capacityBytes)) &&
        Number(target.capacityBytes) > 0,
      measured: false,
    };
  });

  return {
    usedBytes,
    remainingBytes,
    totalBytes,
    percentUsed,
    configured: totalBytes != null,
    recordingsWithSourceOnR2,
    estimatedUsedBytes,
    estimatedRecordingsWithSourceOnR2,
    source: actualUsage?.source || "db_estimate",
    scannedAt: actualUsage?.scannedAt || null,
    objectCount: Number(actualUsage?.objectCount) || 0,
    configuredTargetCount: configuredTargets.length,
    scannedTargetCount: Array.isArray(actualUsage?.targets)
      ? actualUsage.targets.length
      : 0,
    targetBreakdown,
    scanError,
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

function isGroupBracketType(type) {
  const t = String(type || "").toLowerCase();
  return ["group", "round_robin", "gsl", "groups", "rr"].includes(t);
}

function resolvePoolIndex(match) {
  const poolName = String(match?.pool?.name || "")
    .trim()
    .toUpperCase();
  if (poolName.length === 1 && poolName >= "A" && poolName <= "Z") {
    return poolName.charCodeAt(0) - 64; // A=1, B=2, ...
  }
  const numMatch = poolName.match(/(\d+)/);
  if (numMatch) return Number(numMatch[1]);
  return null;
}

function buildMatchVBTCode(match) {
  if (!match) return "";
  const bracket =
    match.bracket && typeof match.bracket === "object" ? match.bracket : null;
  const bracketType = String(
    bracket?.type || match?.format || ""
  ).toLowerCase();
  const round = Number(match.rrRound || match.round || 1);
  const orderOneBased = Number.isFinite(Number(match.order))
    ? Number(match.order) + 1
    : 1;

  if (isGroupBracketType(bracketType)) {
    const poolIdx = resolvePoolIndex(match);
    if (poolIdx) return `V${1}-B${poolIdx}-T${orderOneBased}`;
  }

  return `V${round}-T${orderOneBased}`;
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
  if (recording?.status === "pending_export_window") {
    if (delayed && !stage) stage = "delayed_until_window";
    else if (waiting && !stage) stage = "queued";
    else if (!stage) {
      stage = recentlyUpdated ? "awaiting_queue_sync" : "stale_no_job";
    }
  } else if (recording?.status === "exporting") {
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
    delayed_until_window: "Dang cho khung gio dem",
    queued: "Đang chờ worker",
    queued_retry: "Đang đợi retry",
    awaiting_queue_sync: "Đang đồng bộ trạng thái queue",
    downloading: "Worker đang tải segment từ R2",
    merging: "Worker đang ghép video",
    uploading_drive: "Đang upload lên Drive",
    cleaning_r2: "Đang dọn segment trên R2",
    completed: "Hoàn tất",
    failed: "Export thất bại",
    stale_no_job: "Export treo — không có job trong queue",
    worker_offline: "Worker đang offline",
  };

  const scheduledExportAtMs =
    Number(
      recording?.scheduledExportAt
        ? new Date(recording.scheduledExportAt).getTime()
        : 0
    ) ||
    Number(
      exportPipeline?.scheduledExportAt
        ? new Date(exportPipeline.scheduledExportAt).getTime()
        : 0
    ) ||
    Number(delayed?.scheduledAt) ||
    0;

  let detail = "";
  if (stage === "delayed_until_window") {
    detail = scheduledExportAtMs
      ? `Du kien export luc ${new Date(scheduledExportAtMs).toISOString()}`
      : "Dang doi toi khung gio export dem.";
  } else if (stage === "queued" && waiting?.position) {
    detail = `Queue #${waiting.position}`;
  } else if (stage === "queued_retry" && delayed?.position) {
    detail = `Retry queue #${delayed.position}`;
  } else if (stage === "awaiting_queue_sync") {
    detail = "Bản ghi vừa vào exporting, đang chờ queue/worker đồng bộ.";
  } else if (inWorker) {
    detail = workerHealth?.worker?.currentJobStartedAt
      ? `Worker bắt đầu ${new Date(
          workerHealth.worker.currentJobStartedAt
        ).toISOString()}`
      : "Worker đang xử lý";
  } else if (active) {
    detail = "Worker đang xử lý";
  } else if (stage === "stale_no_job") {
    detail =
      "Không tìm thấy job nào trong queue cho recording này. Cần kiểm tra và retry export.";
  } else if (stage === "worker_offline") {
    detail = "Worker không có heartbeat nên chưa thể xử lý export này.";
  }

  return {
    stage,
    label: stageLabels[stage] || exportPipeline.label || "",
    detail,
    driveAuthMode: exportPipeline.driveAuthMode || null,
    queuePosition: waiting?.position || delayed?.position || null,
    staleReason: exportPipeline.staleReason || null,
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
    scheduledExportAt:
      recording?.scheduledExportAt ||
      exportPipeline.scheduledExportAt ||
      (scheduledExportAtMs ? new Date(scheduledExportAtMs) : null),
    updatedAt: exportPipeline.updatedAt || null,
  };
}

function shouldMarkExportAsStale(recording, exportPipeline = {}) {
  if (recording?.status !== "exporting") return false;
  if (!["stale_no_job", "worker_offline"].includes(exportPipeline.stage))
    return false;

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
    providedWorkerHealth ||
    (await getLiveRecordingWorkerHealth().catch(() => null));
  const queueSnapshot =
    providedQueueSnapshot ||
    (await getLiveRecordingExportQueueSnapshot().catch(() => null));

  const exportingRecordings = await LiveRecordingV2.find({
    status: "exporting",
  });
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
      recording.meta &&
      typeof recording.meta === "object" &&
      !Array.isArray(recording.meta)
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
      label: "Export thất bại",
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

export async function autoExportInactiveLiveRecordings() {
  const timeoutMinutes = await getAutoExportNoSegmentMinutes();
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const nowMs = Date.now();

  const candidates = await LiveRecordingV2.find({
    status: { $in: ["recording", "uploading"] },
  });

  const queuedRecordingIds = [];
  const skippedRecordingIds = [];

  for (const recording of candidates) {
    const latestSegmentActivityAt = getLatestSegmentActivityDate(recording);
    const uploadedSegments = getUploadedRecordingSegments(recording);

    if (!uploadedSegments.length || !latestSegmentActivityAt) {
      skippedRecordingIds.push(String(recording._id));
      continue;
    }

    const idleMs = nowMs - latestSegmentActivityAt.getTime();
    if (!Number.isFinite(idleMs) || idleMs < timeoutMs) {
      continue;
    }

    try {
      await queueLiveRecordingExport(recording, {
        publishReason: "recording_export_auto_queued_no_segment",
        forceFromUploading: recording.status === "uploading",
        forceReason: "segment_timeout",
        latestSegmentActivityAt,
        segmentTimeoutMinutes: timeoutMinutes,
      });
      queuedRecordingIds.push(String(recording._id));
    } catch (error) {
      console.warn(
        `[live-recording-monitor] auto export sweep failed for recording ${String(
          recording._id
        )}:`,
        error?.message || error
      );
    }
  }

  return {
    timeoutMinutes,
    queuedRecordingIds,
    skippedRecordingIds,
  };
}

async function runLiveRecordingAutoExportSweep() {
  if (liveRecordingAutoExportSweepRunning) return;
  liveRecordingAutoExportSweepRunning = true;
  try {
    await autoExportInactiveLiveRecordings();
  } catch (error) {
    console.warn(
      "[live-recording-monitor] auto export sweep crashed:",
      error?.message || error
    );
  } finally {
    liveRecordingAutoExportSweepRunning = false;
  }
}

export function startLiveRecordingAutoExportSweep() {
  if (liveRecordingAutoExportSweepTimer) {
    return liveRecordingAutoExportSweepTimer;
  }

  console.log(
    `[live-recording-monitor] auto export sweep interval=${AUTO_EXPORT_SWEEP_INTERVAL_MS}ms`
  );

  liveRecordingAutoExportSweepTimer = setInterval(() => {
    void runLiveRecordingAutoExportSweep();
  }, AUTO_EXPORT_SWEEP_INTERVAL_MS);
  liveRecordingAutoExportSweepTimer.unref?.();

  const bootTimer = setTimeout(() => {
    void runLiveRecordingAutoExportSweep();
  }, 15_000);
  bootTimer.unref?.();

  return liveRecordingAutoExportSweepTimer;
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
    exportPipeline.driveAuthMode ||
    context.currentDriveMode ||
    "serviceAccount";
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
    matchCode: buildMatchVBTCode(match) || match?.code || "",
    participantsLabel: participantsLabel || "Unknown match",
    tournamentName: tournamentName || "",
    tournamentStatus: match?.tournament?.status || "",
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
    temporaryPlaybackUrl: buildRecordingTemporaryPlaybackUrl(recording._id),
    temporaryPlaybackReady: Boolean(
      recording.finalizedAt &&
        segmentSummary.uploadedSegments > 0 &&
        segmentSummary.uploadingSegments === 0 &&
        segmentSummary.failedSegments === 0
    ),
    rawStreamUrl: buildRecordingRawStreamUrl(recording._id),
    rawStatusUrl: buildRecordingRawStatusUrl(recording._id),
    rawStreamAvailable: Boolean(recording.driveFileId || recording.driveRawUrl),
    driveRawUrl: recording.driveRawUrl || null,
    drivePreviewUrl: recording.drivePreviewUrl || null,
    driveFileId: recording.driveFileId || null,
    driveAuthMode,
    r2SourceBytes: estimateRecordingR2SourceBytes(recording),
    r2TargetId: recording.r2TargetId || null,
    r2BucketName: recording.r2BucketName || null,
    scheduledExportAt:
      recording.scheduledExportAt || exportPipeline.scheduledExportAt || null,
    sourceCleanupStatus: recording?.meta?.sourceCleanup?.status || null,
    aiCommentary: buildAiCommentarySummary(recording),
    exportPipeline,
    error: recording.error || "",
    segmentSummary,
  };
}

function sortRows(rows) {
  const priority = {
    recording: 0,
    uploading: 1,
    pending_export_window: 2,
    exporting: 3,
    failed: 4,
    ready: 5,
  };
  return [...rows].sort((a, b) => {
    const pa = priority[a.status] ?? 99;
    const pb = priority[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return (
      new Date(b.updatedAt || 0).getTime() -
      new Date(a.updatedAt || 0).getTime()
    );
  });
}

export async function buildLiveRecordingMonitorSnapshot() {
  const { workerHealth, queueSnapshot } =
    await reconcileStaleLiveRecordingExports();
  const currentDriveSettings = await getRecordingDriveSettings().catch(() => ({
    mode: "serviceAccount",
  }));

  const recordings = await LiveRecordingV2.find({})
    .sort({ updatedAt: -1, createdAt: -1 })
    .populate({
      path: "match",
      select:
        "code courtLabel pairA pairB court bracket tournament status round order format pool rrRound",
      populate: [
        {
          path: "pairA",
          select: "player1 player2 teamName label",
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
          select: "player1 player2 teamName label",
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
        { path: "bracket", select: "name stage type" },
        { path: "tournament", select: "name status" },
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
      if (row.status === "pending_export_window") acc.pendingExportWindow += 1;
      if (row.status === "exporting") acc.exporting += 1;
      if (row.status === "ready") acc.ready += 1;
      if (row.status === "failed") acc.failed += 1;
      if (
        [
          "recording",
          "uploading",
          "pending_export_window",
          "exporting",
        ].includes(row.status)
      ) {
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
      pendingExportWindow: 0,
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

  summary.r2Storage = await buildR2StorageSummary(recordings);

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
