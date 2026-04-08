import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import Match from "../models/matchModel.js";
import SystemSettings from "../models/systemSettingsModel.js";
import Tournament from "../models/tournamentModel.js";
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
import { getLiveRecordingExportWindowConfig } from "./liveRecordingExportWindow.service.js";
import {
  getUploadedRecordingSegments,
  queueLiveRecordingExport,
} from "./liveRecordingV2Transition.service.js";
import { autoScheduleFacebookVodFallbackRecordings } from "./liveRecordingFacebookVodFallback.service.js";
import { buildRecordingSourceSummary } from "./liveRecordingFacebookVodShared.service.js";
import { buildAiCommentarySummary } from "./liveRecordingAiCommentary.service.js";
import { buildMatchCodePayload } from "../utils/matchDisplayCode.js";

const DEFAULT_AUTO_EXPORT_NO_SEGMENT_MINUTES = 15;
const AUTO_EXPORT_SWEEP_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.LIVE_RECORDING_AUTO_EXPORT_SWEEP_MS) || 60_000
);
const DEFAULT_MONITOR_SNAPSHOT_TTL_MS = 2_500;
let liveRecordingAutoExportSweepTimer = null;
let liveRecordingAutoExportSweepRunning = false;
let liveRecordingMonitorSnapshotCache = {
  value: null,
  expiresAt: 0,
  signature: "",
  promise: null,
};

const LIVE_RECORDING_MONITOR_SNAPSHOT_RECORDING_SELECT = [
  "_id",
  "match",
  "courtId",
  "mode",
  "quality",
  "recordingSessionId",
  "status",
  "segments.index",
  "segments.uploadStatus",
  "segments.sizeBytes",
  "segments.isFinal",
  "segments.meta.totalSizeBytes",
  "segments.meta.segmentSizeBytes",
  "segments.meta.partSizeBytes",
  "segments.meta.completedParts.sizeBytes",
  "segments.meta.lastPartUploadedAt",
  "segments.meta.startedAt",
  "durationSeconds",
  "sizeBytes",
  "r2TargetId",
  "r2BucketName",
  "driveFileId",
  "driveRawUrl",
  "drivePreviewUrl",
  "exportAttempts",
  "finalizedAt",
  "scheduledExportAt",
  "readyAt",
  "error",
  "createdAt",
  "updatedAt",
  "meta.source",
  "meta.facebookVod",
  "meta.exportPipeline",
  "meta.sourceCleanup.status",
  "aiCommentary.status",
  "aiCommentary.latestJobId",
  "aiCommentary.sourceDriveFileId",
  "aiCommentary.language",
  "aiCommentary.voicePreset",
  "aiCommentary.tonePreset",
  "aiCommentary.sourceFingerprint",
  "aiCommentary.dubbedDriveFileId",
  "aiCommentary.dubbedDriveRawUrl",
  "aiCommentary.dubbedDrivePreviewUrl",
  "aiCommentary.dubbedPlaybackUrl",
  "aiCommentary.outputSizeBytes",
  "aiCommentary.renderedAt",
  "aiCommentary.error",
].join(" ");

const LIVE_RECORDING_MONITOR_DETAIL_RECORDING_SELECT = [
  LIVE_RECORDING_MONITOR_SNAPSHOT_RECORDING_SELECT,
  "segments.objectKey",
  "segments.storageTargetId",
  "segments.bucketName",
  "segments.etag",
  "segments.durationSeconds",
  "segments.uploadedAt",
  "segments.meta.completedAt",
].join(" ");

const LIVE_RECORDING_MONITOR_STORAGE_RECORDING_SELECT = [
  "segments.uploadStatus",
  "segments.sizeBytes",
  "segments.meta.completedParts.sizeBytes",
  "meta.sourceCleanup.status",
].join(" ");

const LIVE_RECORDING_MONITOR_RECORDING_POPULATE = [
  {
    path: "match",
    select:
      "code displayCode labelKey globalRound stageIndex courtLabel pairA pairB court bracket tournament status round order format pool rrRound",
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
  },
  { path: "courtId", select: "name label number" },
];

function getLiveRecordingMonitorSnapshotTtlMs() {
  const configured = Number(process.env.LIVE_RECORDING_MONITOR_SNAPSHOT_TTL_MS);
  if (Number.isFinite(configured) && configured >= 500) {
    return Math.floor(configured);
  }
  return DEFAULT_MONITOR_SNAPSHOT_TTL_MS;
}

function getLiveRecordingMonitorSnapshotSignature() {
  const meta = getLiveRecordingMonitorMeta();
  const lastPublishAt = meta?.lastPublishAt
    ? new Date(meta.lastPublishAt).getTime()
    : 0;
  const lastReconcileAt = meta?.lastReconcileAt
    ? new Date(meta.lastReconcileAt).getTime()
    : 0;

  return [
    lastPublishAt,
    lastReconcileAt,
    String(meta?.lastPublishMode || ""),
    String(meta?.lastEventReason || ""),
    String(meta?.lastEventMode || ""),
  ].join("|");
}

export function invalidateLiveRecordingMonitorSnapshotCache() {
  liveRecordingMonitorSnapshotCache = {
    value: null,
    expiresAt: 0,
    signature: "",
    promise: null,
  };
}

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
  if (match?.courtStationName) return match.courtStationName;
  if (match?.courtStationLabel) return match.courtStationLabel;
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

function formatMonitorDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const timezone = getLiveRecordingExportWindowConfig().timezone || "Asia/Ho_Chi_Minh";
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: timezone,
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.day || "??"}/${map.month || "??"} ${map.hour || "??"}:${map.minute || "??"}:${
    map.second || "??"
  }`;
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

function applyLiveRecordingMonitorRecordingPopulate(query) {
  return query.populate(LIVE_RECORDING_MONITOR_RECORDING_POPULATE);
}

function hasCompletedSourceCleanup(recording) {
  return recording?.meta?.sourceCleanup?.status === "completed";
}

function summarizeSegments(
  segments = [],
  recording = null,
  { includeDetailedSegments = true } = {}
) {
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

  const detailedSegments = includeDetailedSegments
    ? sortedSegments.map(buildSegmentProgress).filter(Boolean)
    : [];
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

async function buildR2StorageSummary(recordings = [], options = {}) {
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
    actualUsage = await getRecordingStorageUsageSummary({
      forceRefresh: Boolean(options.forceRefresh),
    });
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

function buildMatchCode(match) {
  const codePayload = buildMatchCodePayload(match);
  return (
    String(codePayload?.displayCode || "").trim() ||
    String(codePayload?.code || "").trim() ||
    String(match?.displayCode || "").trim() ||
    String(match?.code || "").trim()
  );
}

export function buildExportPipelineInfo(recording, context = {}) {
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
  const nowMs = Date.now();
  const recentlyUpdated =
    Number.isFinite(updatedAtMs) && updatedAtMs > 0
      ? nowMs - updatedAtMs < 60 * 1000
      : false;
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
  const pendingWindowPastDue =
    Number.isFinite(scheduledExportAtMs) &&
    scheduledExportAtMs > 0 &&
    nowMs >= scheduledExportAtMs;
  const pendingWindowOverdue =
    pendingWindowPastDue &&
    nowMs - scheduledExportAtMs >= getExportStaleThresholdMs();

  let stage = exportPipeline.stage || null;
  if (recording?.status === "pending_export_window") {
    if (inWorker) stage = "downloading";
    else if (active) stage = "downloading";
    else if (waiting) stage = "queued";
    else if (pendingWindowOverdue) {
      stage = workerHealth?.alive ? "stale_no_job" : "worker_offline";
    } else if (pendingWindowPastDue) {
      stage = "awaiting_queue_sync";
    } else if (delayed) {
      stage = "delayed_until_window";
    } else {
      stage = recentlyUpdated ? "awaiting_queue_sync" : "stale_no_job";
    }
  } else if (recording?.status === "exporting") {
    // Always reconcile stored stage with live queue/worker state.
    // The stored stage may be stale if the BullMQ job was cleaned up
    // (by removeOnComplete/removeOnFail) without updating the recording.
    if (inWorker) stage = stage || "downloading";
    else if (active) stage = stage || "downloading";
    else if (waiting) stage = "queued";
    else if (delayed)
      stage = stage === "waiting_facebook_vod" ? stage : "queued_retry";
    else {
      // No job in queue and worker is not processing this recording.
      // Override any stale stored stage (e.g., "queued") to reflect reality.
      stage = workerHealth?.alive
        ? recentlyUpdated
          ? "awaiting_queue_sync"
          : "stale_no_job"
        : "worker_offline";
    }
  }

  const stageLabels = {
    delayed_until_window: "Dang cho khung gio dem",
    downloading_facebook_vod: "Worker dang tai video Facebook",
    waiting_facebook_vod: "Dang cho video Facebook hoan tat",
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

  let detail = "";
  if (stage === "delayed_until_window") {
    detail = scheduledExportAtMs
      ? `Mo queue luc ${formatMonitorDateTime(
          scheduledExportAtMs
        )}. Worker se xu ly tuan tu theo thu tu cho.`
      : "Dang doi toi khung gio export dem. Worker se xu ly tuan tu tung video.";
  } else if (stage === "waiting_facebook_vod") {
    detail = scheduledExportAtMs
      ? `Thu lai luc ${formatMonitorDateTime(scheduledExportAtMs)}`
      : "Dang cho Facebook hoan tat VOD.";
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

  if (stage === "awaiting_queue_sync") {
    detail = pendingWindowPastDue
      ? "Da toi gio export nhung queue/worker chua dong bo job nay."
      : "Ban ghi vua vao exporting, dang cho queue/worker dong bo.";
  } else if (stage === "stale_no_job") {
    detail = pendingWindowPastDue
      ? "Da qua gio export nhung khong thay job hop le trong queue. Can retry/force export."
      : "Khong tim thay job nao trong queue cho recording nay. Can kiem tra va retry export.";
  } else if (stage === "worker_offline") {
    detail = pendingWindowPastDue
      ? "Da qua gio export nhung worker dang offline, nen job chua duoc xu ly."
      : "Worker khong co heartbeat nen chua the xu ly export nay.";
  } else if (inWorker) {
    detail = workerHealth?.worker?.currentJobStartedAt
      ? `Worker bat dau ${formatMonitorDateTime(workerHealth.worker.currentJobStartedAt)}`
      : "Worker dang xu ly";
  } else if (active) {
    detail = "Worker dang xu ly";
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

export function shouldMarkExportAsStale(recording, exportPipeline = {}) {
  if (!["exporting", "pending_export_window"].includes(recording?.status))
    return false;
  if (!["stale_no_job", "worker_offline"].includes(exportPipeline.stage))
    return false;

  const updatedAtMs = Math.max(
    recording?.updatedAt ? new Date(recording.updatedAt).getTime() : 0,
    exportPipeline?.updatedAt ? new Date(exportPipeline.updatedAt).getTime() : 0
  );
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

  const candidateRecordings = await LiveRecordingV2.find({
    status: { $in: ["exporting", "pending_export_window"] },
  });
  const autoRequeuedRecordingIds = [];
  const failedRecordingIds = [];

  for (const recording of candidateRecordings) {
    const exportPipeline = buildExportPipelineInfo(recording, {
      workerHealth,
      queueSnapshot,
    });

    if (!shouldMarkExportAsStale(recording, exportPipeline)) {
      continue;
    }

    const nextMetaTemp =
      recording.meta &&
      typeof recording.meta === "object" &&
      !Array.isArray(recording.meta)
        ? { ...recording.meta }
        : {};
    const pipelineTemp =
      nextMetaTemp.exportPipeline &&
      typeof nextMetaTemp.exportPipeline === "object" &&
      !Array.isArray(nextMetaTemp.exportPipeline)
        ? { ...nextMetaTemp.exportPipeline }
        : {};

    const autoRequeueCount = Number(pipelineTemp.autoRequeueCount) || 0;
    const maxAutoRequeues = 3;

    // Always try to re-queue the export instead of failing it, up to maxAutoRequeues times
    if (autoRequeueCount < maxAutoRequeues) {
      try {
        await queueLiveRecordingExport(recording, {
          publishReason: "recording_export_auto_requeued",
          replaceTerminalJob: true,
          replacePendingJob: true,
          ignoreWindow: true,
          currentPipeline: {
            ...pipelineTemp,
            autoRequeueCount: autoRequeueCount + 1,
            lastAutoRequeuedAt: new Date()
          },
          forceReason: "stale_reconciliation",
        });
        autoRequeuedRecordingIds.push(String(recording._id));
        console.log(
          `[live-recording-monitor] auto-requeued stale export for recording ${String(recording._id)} (attempt ${autoRequeueCount + 1}/${maxAutoRequeues})`
        );
        continue;
      } catch (requeueError) {
        console.warn(
          `[live-recording-monitor] failed to auto-requeue recording ${String(recording._id)}:`,
          requeueError?.message || requeueError
        );
        // Fall through to mark as failed
      }
    } else {
      console.warn(
        `[live-recording-monitor] exhausted auto-requeues (${maxAutoRequeues}) for recording ${String(recording._id)}, marking as failed.`
      );
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
    failedRecordingIds.push(String(recording._id));
  }

  if (failedRecordingIds.length) {
    await publishLiveRecordingMonitorUpdate({
      reason: "recording_export_reconciled_failed",
      recordingIds: failedRecordingIds,
    }).catch(() => {});
  }

  const refreshedQueueSnapshot = autoRequeuedRecordingIds.length
    ? await getLiveRecordingExportQueueSnapshot().catch(() => queueSnapshot)
    : queueSnapshot;

  return {
    updatedRecordingIds: [
      ...autoRequeuedRecordingIds,
      ...failedRecordingIds,
    ],
    autoRequeuedRecordingIds,
    failedRecordingIds,
    workerHealth,
    queueSnapshot: refreshedQueueSnapshot,
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

  const facebookVodSweep = await autoScheduleFacebookVodFallbackRecordings().catch(
    (error) => ({
      queuedMatchIds: [],
      skipped: [
        {
          matchId: null,
          reason: error?.message || String(error),
        },
      ],
    })
  );

  return {
    timeoutMinutes,
    queuedRecordingIds,
    skippedRecordingIds,
    facebookVodQueuedMatchIds: facebookVodSweep.queuedMatchIds || [],
    facebookVodSkipped: facebookVodSweep.skipped || [],
  };
}

async function runLiveRecordingAutoExportSweep() {
  if (liveRecordingAutoExportSweepRunning) return;
  liveRecordingAutoExportSweepRunning = true;
  try {
    await reconcileStaleLiveRecordingExports();
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

function buildRow(
  recording,
  context = {},
  { includeDetailedSegments = true } = {}
) {
  const match = recording.match || {};
  const participantsLabel = buildParticipantsLabel(match);
  const tournamentName = match?.tournament?.name || "";
  const bracketName = match?.bracket?.name || "";
  const bracketStage = match?.bracket?.stage || "";
  const courtLabel = buildCourtLabel(match, recording);
  const segmentSummary = summarizeSegments(recording.segments || [], recording, {
    includeDetailedSegments,
  });
  const statusMeta = buildStatusMeta(recording.status);
  const exportPipeline = buildExportPipelineInfo(recording, context);
  const driveAuthMode =
    exportPipeline.driveAuthMode ||
    context.currentDriveMode ||
    "serviceAccount";
  const source = buildRecordingSourceSummary(recording, match);
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
    matchCode: buildMatchCode(match),
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
    source,
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

const LIVE_RECORDING_MONITOR_SECTIONS = new Set([
  "all",
  "export",
  "commentary",
]);
const LIVE_RECORDING_MONITOR_VIEWS = new Set([
  "all",
  "ready",
  "needs_action",
  "ai_ready",
]);
const LIVE_RECORDING_MONITOR_COMMENTARY_FILTERS = new Set([
  "all",
  "ready",
  "processing",
  "missing",
  "failed",
]);
const LIVE_RECORDING_MONITOR_STATUS_FILTERS = new Set([
  "ALL",
  "recording",
  "uploading",
  "pending_export_window",
  "exporting",
  "ready",
  "failed",
  "needs_action",
]);
const FAST_MONITOR_ROW_SECTIONS = new Set(["all", "export"]);
const FAST_MONITOR_ROW_STATUSES = new Set([
  "ALL",
  "recording",
  "uploading",
  "pending_export_window",
  "exporting",
  "ready",
  "failed",
]);

function parsePositiveInt(
  value,
  fallback,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {}
) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const normalized = Math.trunc(number);
  if (normalized < min) return fallback;
  return Math.min(normalized, max);
}

function normalizeMonitorSection(section) {
  const normalized = String(section || "").trim().toLowerCase() || "all";
  return LIVE_RECORDING_MONITOR_SECTIONS.has(normalized) ? normalized : "all";
}

function normalizeMonitorView(view) {
  const normalized = String(view || "").trim().toLowerCase() || "all";
  return LIVE_RECORDING_MONITOR_VIEWS.has(normalized) ? normalized : "all";
}

function normalizeMonitorStatus(status) {
  const raw = String(status || "").trim();
  if (!raw) return "ALL";
  if (raw === "ALL") return "ALL";
  const normalized = raw.toLowerCase();
  if (normalized === "all") return "ALL";
  return LIVE_RECORDING_MONITOR_STATUS_FILTERS.has(normalized)
    ? normalized
    : "ALL";
}

function normalizeMonitorCommentaryFilter(filter) {
  const normalized = String(filter || "").trim().toLowerCase() || "all";
  return LIVE_RECORDING_MONITOR_COMMENTARY_FILTERS.has(normalized)
    ? normalized
    : "all";
}

function hasDriveLinks(row) {
  return Boolean(
    row?.playbackUrl ||
      row?.drivePreviewUrl ||
      row?.driveRawUrl ||
      row?.rawStreamAvailable ||
      row?.rawStreamUrl
  );
}

function canRetryExport(row) {
  const stage = String(row?.exportPipeline?.stage || "").toLowerCase();
  const staleReason = String(row?.exportPipeline?.staleReason || "").toLowerCase();
  return (
    row?.status === "failed" ||
    stage === "stale_no_job" ||
    staleReason === "stale_no_job" ||
    staleReason === "worker_offline"
  );
}

function canForceExport(row) {
  return row?.status === "pending_export_window";
}

function rowNeedsAction(row) {
  return (
    row?.status !== "ready" ||
    canRetryExport(row) ||
    canForceExport(row) ||
    (row?.status === "ready" && !hasDriveLinks(row))
  );
}

function matchesCommentaryFilter(row, commentaryFilter) {
  if (commentaryFilter === "all") return true;
  const status = String(row?.aiCommentary?.status || "idle").toLowerCase();
  const ready = Boolean(row?.aiCommentary?.ready);
  if (commentaryFilter === "ready") return ready;
  if (commentaryFilter === "processing") {
    return ["queued", "running"].includes(status);
  }
  if (commentaryFilter === "failed") return status === "failed";
  if (commentaryFilter === "missing") {
    return !ready && !["queued", "running"].includes(status);
  }
  return true;
}

function matchesViewMode(row, view) {
  if (view === "ready") return row?.status === "ready";
  if (view === "needs_action") return rowNeedsAction(row);
  if (view === "ai_ready") return Boolean(row?.aiCommentary?.ready);
  return true;
}

function buildMonitorSearchText(row) {
  return [
    row?.recordingId,
    row?.recordingSessionId,
    row?.matchId,
    row?.matchCode,
    row?.participantsLabel,
    row?.competitionLabel,
    row?.tournamentName,
    row?.bracketName,
    row?.courtLabel,
    row?.modeLabel,
    row?.status,
    row?.exportPipeline?.label,
    row?.exportPipeline?.detail,
    row?.exportPipeline?.stage,
    row?.error,
    row?.driveFileId,
    row?.drivePreviewUrl,
    row?.driveRawUrl,
    row?.playbackUrl,
    row?.aiCommentary?.status,
    row?.aiCommentary?.error,
    row?.aiCommentary?.latestJobId,
    row?.aiCommentary?.language,
    row?.aiCommentary?.voicePreset,
    row?.aiCommentary?.sourceFingerprint,
    row?.source?.label,
    row?.source?.type,
    row?.source?.videoId,
    row?.source?.pageId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function paginateRows(items = [], page = 1, limit = 50) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * limit;
  return {
    total,
    page: safePage,
    pages,
    items: items.slice(start, start + limit),
  };
}

function buildTournamentFacets(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const name = String(row?.tournamentName || "").trim();
    if (!name) continue;
    const current = map.get(name) || {
      name,
      status: row?.tournamentStatus || "",
      count: 0,
    };
    current.count += 1;
    map.set(name, current);
  }
  return [...map.values()].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""))
  );
}

function buildSectionRows(rows = [], section = "all") {
  if (section === "export") {
    return rows.filter((row) =>
      ["pending_export_window", "exporting", "ready", "failed"].includes(
        row.status
      )
    );
  }

  if (section === "commentary") {
    return rows.filter((row) => {
      const commentaryStatus = String(row?.aiCommentary?.status || "").toLowerCase();
      return (
        row?.status === "ready" ||
        Boolean(row?.aiCommentary?.ready) ||
        ["queued", "running", "failed", "completed"].includes(commentaryStatus)
      );
    });
  }

  return rows;
}

function getSectionStatusSet(section = "all") {
  if (section === "export") {
    return new Set([
      "pending_export_window",
      "exporting",
      "ready",
      "failed",
    ]);
  }
  return null;
}

function resolveFastMonitorStatusList(section = "all", status = "ALL") {
  if (!FAST_MONITOR_ROW_SECTIONS.has(section)) {
    return null;
  }
  if (!FAST_MONITOR_ROW_STATUSES.has(status) || status === "needs_action") {
    return null;
  }

  const sectionStatuses = getSectionStatusSet(section);
  if (status === "ALL") {
    return sectionStatuses ? [...sectionStatuses] : [];
  }

  if (!sectionStatuses || sectionStatuses.has(status)) {
    return [status];
  }

  return [];
}

function buildEmptyMonitorSummary() {
  return {
    total: 0,
    active: 0,
    recording: 0,
    uploading: 0,
    pendingExportWindow: 0,
    exporting: 0,
    ready: 0,
    failed: 0,
    commentaryReady: 0,
    commentaryMissing: 0,
    needsAction: 0,
    totalDurationSeconds: 0,
    totalSizeBytes: 0,
    totalSegments: 0,
    uploadedSegments: 0,
    pendingSegments: 0,
  };
}

function buildMonitorSectionMongoMatch(section = "all") {
  if (section === "export") {
    return {
      status: {
        $in: ["pending_export_window", "exporting", "ready", "failed"],
      },
    };
  }

  if (section === "commentary") {
    return {
      $or: [
        { status: "ready" },
        { "aiCommentary.status": { $in: ["queued", "running", "failed", "completed"] } },
        {
          "aiCommentary.dubbedDriveFileId": {
            $exists: true,
            $nin: [null, ""],
          },
        },
        {
          "aiCommentary.dubbedDriveRawUrl": {
            $exists: true,
            $nin: [null, ""],
          },
        },
        {
          "aiCommentary.dubbedPlaybackUrl": {
            $exists: true,
            $nin: [null, ""],
          },
        },
      ],
    };
  }

  return {};
}

function buildNonEmptyStringAggregateExpression(fieldPath) {
  return {
    $gt: [
      {
        $strLenCP: {
          $trim: {
            input: {
              $toString: {
                $ifNull: [fieldPath, ""],
              },
            },
          },
        },
      },
      0,
    ],
  };
}

function canUseFastMonitorRowsPath({
  section = "all",
  status = "ALL",
  commentary = "all",
  view = "all",
  q = "",
} = {}) {
  return (
    FAST_MONITOR_ROW_SECTIONS.has(section) &&
    FAST_MONITOR_ROW_STATUSES.has(status) &&
    status !== "needs_action" &&
    commentary === "all" &&
    view === "all" &&
    !String(q || "").trim()
  );
}

async function resolveTournamentMatchIdsByName(tournamentName = "") {
  const normalizedTournamentName = String(tournamentName || "").trim();
  if (!normalizedTournamentName) {
    return null;
  }

  const tournaments = await Tournament.find({ name: normalizedTournamentName })
    .select("_id")
    .lean();
  if (!tournaments.length) {
    return [];
  }

  const tournamentIds = tournaments.map((item) => item._id);
  const matches = await Match.find({ tournament: { $in: tournamentIds } })
    .select("_id")
    .lean();

  return matches.map((item) => item._id);
}

function buildFastMonitorStatusPriorityExpression() {
  return {
    $switch: {
      branches: [
        { case: { $eq: ["$status", "recording"] }, then: 0 },
        { case: { $eq: ["$status", "uploading"] }, then: 1 },
        { case: { $eq: ["$status", "pending_export_window"] }, then: 2 },
        { case: { $eq: ["$status", "exporting"] }, then: 3 },
        { case: { $eq: ["$status", "failed"] }, then: 4 },
        { case: { $eq: ["$status", "ready"] }, then: 5 },
      ],
      default: 99,
    },
  };
}

async function buildFastLiveRecordingMonitorRowsPage(options = {}) {
  const section = normalizeMonitorSection(options.section);
  const status = normalizeMonitorStatus(options.status);
  const commentary = normalizeMonitorCommentaryFilter(options.commentary);
  const view = normalizeMonitorView(options.view);
  const q = String(options.q || "").trim();
  const tournament = String(options.tournament || "").trim();
  const page = parsePositiveInt(options.page, 1, { min: 1, max: 100000 });
  const limit = parsePositiveInt(options.limit, 40, { min: 1, max: 500 });

  if (
    !canUseFastMonitorRowsPath({
      section,
      status,
      commentary,
      view,
      q,
    })
  ) {
    return null;
  }

  const statuses = resolveFastMonitorStatusList(section, status);
  if (statuses == null) {
    return null;
  }

  const baseQuery = {};
  if (statuses.length) {
    baseQuery.status =
      statuses.length === 1 ? statuses[0] : { $in: statuses };
  }

  const matchIds = await resolveTournamentMatchIdsByName(tournament);
  if (Array.isArray(matchIds)) {
    if (!matchIds.length) {
      return {
        rows: [],
        count: 0,
        page: 1,
        pages: 1,
        limit,
        hasMore: false,
        meta: {
          section,
          filters: {
            status,
            commentary,
            view,
            q,
            tournament,
          },
          rowSource: "fast_db",
          generatedAt: new Date(),
        },
      };
    }
    baseQuery.match = { $in: matchIds };
  }

  const [currentDriveSettings, workerHealth, queueSnapshot, total] =
    await Promise.all([
      getRecordingDriveSettings().catch(() => ({
        mode: "serviceAccount",
      })),
      getLiveRecordingWorkerHealth().catch(() => null),
      getLiveRecordingExportQueueSnapshot().catch(() => null),
      LiveRecordingV2.countDocuments(baseQuery),
    ]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), pages);
  const idDocs = await LiveRecordingV2.aggregate([
    { $match: baseQuery },
    {
      $addFields: {
        __monitorStatusPriority: buildFastMonitorStatusPriorityExpression(),
      },
    },
    {
      $sort: {
        __monitorStatusPriority: 1,
        updatedAt: -1,
        createdAt: -1,
        _id: 1,
      },
    },
    { $skip: Math.max(0, (safePage - 1) * limit) },
    { $limit: limit },
    { $project: { _id: 1 } },
  ]);

  const pagedIds = idDocs.map((item) => String(item?._id || "")).filter(Boolean);
  if (!pagedIds.length) {
    return {
      rows: [],
      count: total,
      page: safePage,
      pages,
      limit,
      hasMore: safePage < pages,
      meta: {
        section,
        filters: {
          status,
          commentary,
          view,
          q,
          tournament,
        },
        rowSource: "fast_db",
        generatedAt: new Date(),
      },
    };
  }

  const recordings = await applyLiveRecordingMonitorRecordingPopulate(
    LiveRecordingV2.find({ _id: { $in: pagedIds } })
      .select(LIVE_RECORDING_MONITOR_SNAPSHOT_RECORDING_SELECT)
  ).lean();
  const recordingsById = new Map(
    recordings.map((recording) => [String(recording._id), recording])
  );
  const rows = pagedIds
    .map((recordingId) => recordingsById.get(recordingId))
    .filter(Boolean)
    .map((recording) =>
      buildRow(
        recording,
        {
          workerHealth,
          queueSnapshot,
          currentDriveMode: currentDriveSettings.mode,
        },
        {
          includeDetailedSegments: false,
        }
      )
    );

  return {
    rows,
    count: total,
    page: safePage,
    pages,
    limit,
    hasMore: safePage < pages,
    meta: {
      section,
      filters: {
        status,
        commentary,
        view,
        q,
        tournament,
      },
      rowSource: "fast_db",
      generatedAt: new Date(),
    },
  };
}

async function buildFastLiveRecordingMonitorSummary(options = {}) {
  const section = normalizeMonitorSection(options.section);
  const pipeline = [];
  const sectionMatch = buildMonitorSectionMongoMatch(section);
  if (Object.keys(sectionMatch).length > 0) {
    pipeline.push({ $match: sectionMatch });
  }

  pipeline.push(
    {
      $project: {
        status: 1,
        durationSeconds: { $ifNull: ["$durationSeconds", 0] },
        sizeBytes: { $ifNull: ["$sizeBytes", 0] },
        totalSegments: {
          $size: {
            $ifNull: ["$segments", []],
          },
        },
        uploadedSegments: {
          $size: {
            $filter: {
              input: { $ifNull: ["$segments", []] },
              as: "segment",
              cond: { $eq: ["$$segment.uploadStatus", "uploaded"] },
            },
          },
        },
        commentaryReady: {
          $or: [
            buildNonEmptyStringAggregateExpression("$aiCommentary.dubbedDriveFileId"),
            buildNonEmptyStringAggregateExpression("$aiCommentary.dubbedDriveRawUrl"),
            buildNonEmptyStringAggregateExpression("$aiCommentary.dubbedPlaybackUrl"),
          ],
        },
        commentaryStatus: {
          $toLower: {
            $toString: {
              $ifNull: ["$aiCommentary.status", "idle"],
            },
          },
        },
        hasDriveLinks: {
          $or: [
            buildNonEmptyStringAggregateExpression("$driveFileId"),
            buildNonEmptyStringAggregateExpression("$driveRawUrl"),
            buildNonEmptyStringAggregateExpression("$drivePreviewUrl"),
          ],
        },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: {
          $sum: {
            $cond: [
              {
                $in: [
                  "$status",
                  [
                    "recording",
                    "uploading",
                    "pending_export_window",
                    "exporting",
                  ],
                ],
              },
              1,
              0,
            ],
          },
        },
        recording: {
          $sum: { $cond: [{ $eq: ["$status", "recording"] }, 1, 0] },
        },
        uploading: {
          $sum: { $cond: [{ $eq: ["$status", "uploading"] }, 1, 0] },
        },
        pendingExportWindow: {
          $sum: {
            $cond: [{ $eq: ["$status", "pending_export_window"] }, 1, 0],
          },
        },
        exporting: {
          $sum: { $cond: [{ $eq: ["$status", "exporting"] }, 1, 0] },
        },
        ready: {
          $sum: { $cond: [{ $eq: ["$status", "ready"] }, 1, 0] },
        },
        failed: {
          $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
        },
        commentaryReady: {
          $sum: { $cond: ["$commentaryReady", 1, 0] },
        },
        commentaryMissing: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "ready"] },
                  { $not: ["$commentaryReady"] },
                  {
                    $not: [
                      {
                        $in: ["$commentaryStatus", ["queued", "running"]],
                      },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
        needsAction: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $ne: ["$status", "ready"] },
                  { $not: ["$hasDriveLinks"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        totalDurationSeconds: { $sum: "$durationSeconds" },
        totalSizeBytes: { $sum: "$sizeBytes" },
        totalSegments: { $sum: "$totalSegments" },
        uploadedSegments: { $sum: "$uploadedSegments" },
      },
    },
    {
      $project: {
        _id: 0,
        total: 1,
        active: 1,
        recording: 1,
        uploading: 1,
        pendingExportWindow: 1,
        exporting: 1,
        ready: 1,
        failed: 1,
        commentaryReady: 1,
        commentaryMissing: 1,
        needsAction: 1,
        totalDurationSeconds: 1,
        totalSizeBytes: 1,
        totalSegments: 1,
        uploadedSegments: 1,
        pendingSegments: {
          $max: [0, { $subtract: ["$totalSegments", "$uploadedSegments"] }],
        },
      },
    }
  );

  const [summary] = await LiveRecordingV2.aggregate(pipeline);
  return {
    ...buildEmptyMonitorSummary(),
    ...(summary || {}),
    pendingSegments: Math.max(
      0,
      Number(summary?.pendingSegments) ||
        Number(summary?.totalSegments || 0) - Number(summary?.uploadedSegments || 0)
    ),
  };
}

async function buildFastLiveRecordingMonitorTournamentFacets(options = {}) {
  const section = normalizeMonitorSection(options.section);
  const pipeline = [];
  const sectionMatch = buildMonitorSectionMongoMatch(section);
  if (Object.keys(sectionMatch).length > 0) {
    pipeline.push({ $match: sectionMatch });
  }

  pipeline.push(
    {
      $lookup: {
        from: Match.collection.name,
        localField: "match",
        foreignField: "_id",
        as: "matchDoc",
      },
    },
    {
      $unwind: "$matchDoc",
    },
    {
      $lookup: {
        from: Tournament.collection.name,
        localField: "matchDoc.tournament",
        foreignField: "_id",
        as: "tournamentDoc",
      },
    },
    {
      $unwind: "$tournamentDoc",
    },
    {
      $project: {
        name: {
          $trim: {
            input: {
              $toString: {
                $ifNull: ["$tournamentDoc.name", ""],
              },
            },
          },
        },
        status: {
          $toString: {
            $ifNull: ["$tournamentDoc.status", ""],
          },
        },
      },
    },
    {
      $match: {
        name: { $ne: "" },
      },
    },
    {
      $group: {
        _id: "$name",
        status: { $first: "$status" },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        name: "$_id",
        status: 1,
        count: 1,
      },
    },
    {
      $sort: {
        name: 1,
      },
    }
  );

  return LiveRecordingV2.aggregate(pipeline);
}

function buildSectionSummary(rows = [], baseSummary = null) {
  if (baseSummary && rows.length === Number(baseSummary.total || 0)) {
    return { ...baseSummary };
  }

  return rows.reduce(
    (acc, row) => {
      const commentaryStatus = String(row?.aiCommentary?.status || "").toLowerCase();
      const commentaryReady = Boolean(row?.aiCommentary?.ready);
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
      if (commentaryReady) acc.commentaryReady += 1;
      if (
        row.status === "ready" &&
        !commentaryReady &&
        !["queued", "running"].includes(commentaryStatus)
      ) {
        acc.commentaryMissing += 1;
      }
      if (rowNeedsAction(row)) acc.needsAction += 1;
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
    buildEmptyMonitorSummary()
  );
}

function filterSectionRows(
  rows = [],
  {
    status = "ALL",
    q = "",
    tournament = "",
    commentary = "all",
    view = "all",
  } = {}
) {
  const keyword = String(q || "").trim().toLowerCase();
  const normalizedTournament = String(tournament || "").trim();

  return rows.filter((row) => {
    if (status !== "ALL") {
      if (status === "needs_action") {
        if (!rowNeedsAction(row)) return false;
      } else if (row.status !== status) {
        return false;
      }
    }

    if (normalizedTournament && row.tournamentName !== normalizedTournament) {
      return false;
    }

    if (!matchesCommentaryFilter(row, commentary)) return false;
    if (!matchesViewMode(row, view)) return false;
    if (!keyword) return true;
    return buildMonitorSearchText(row).includes(keyword);
  });
}

async function buildLiveRecordingMonitorSnapshotUncached({
  workerHealth,
  queueSnapshot,
} = {}) {
  const currentDriveSettings = await getRecordingDriveSettings().catch(() => ({
    mode: "serviceAccount",
  }));

  const recordings = await applyLiveRecordingMonitorRecordingPopulate(
    LiveRecordingV2.find({})
      .select(LIVE_RECORDING_MONITOR_SNAPSHOT_RECORDING_SELECT)
      .sort({ updatedAt: -1, createdAt: -1 })
  ).lean();

  const rows = sortRows(
    recordings.map((recording) =>
      buildRow(recording, {
        workerHealth,
        queueSnapshot,
        currentDriveMode: currentDriveSettings.mode,
      }, {
        includeDetailedSegments: false,
      })
    )
  );
  const summary = rows.reduce(
    (acc, row) => {
      const commentaryStatus = String(row?.aiCommentary?.status || "").toLowerCase();
      const commentaryReady = Boolean(row?.aiCommentary?.ready);
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
      if (commentaryReady) acc.commentaryReady += 1;
      if (
        row.status === "ready" &&
        !commentaryReady &&
        !["queued", "running"].includes(commentaryStatus)
      ) {
        acc.commentaryMissing += 1;
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
    buildEmptyMonitorSummary()
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

export async function buildLiveRecordingMonitorSnapshot({
  forceRefresh = false,
} = {}) {
  const { workerHealth, queueSnapshot } =
    await reconcileStaleLiveRecordingExports();
  const signature = getLiveRecordingMonitorSnapshotSignature();
  const now = Date.now();

  if (
    !forceRefresh &&
    liveRecordingMonitorSnapshotCache.value &&
    liveRecordingMonitorSnapshotCache.signature === signature &&
    now < liveRecordingMonitorSnapshotCache.expiresAt
  ) {
    return liveRecordingMonitorSnapshotCache.value;
  }

  if (
    !forceRefresh &&
    liveRecordingMonitorSnapshotCache.promise &&
    liveRecordingMonitorSnapshotCache.signature === signature
  ) {
    return liveRecordingMonitorSnapshotCache.promise;
  }

  const snapshotPromise = buildLiveRecordingMonitorSnapshotUncached({
    workerHealth,
    queueSnapshot,
  })
    .then((snapshot) => {
      liveRecordingMonitorSnapshotCache = {
        value: snapshot,
        expiresAt: Date.now() + getLiveRecordingMonitorSnapshotTtlMs(),
        signature,
        promise: null,
      };
      return snapshot;
    })
    .catch((error) => {
      if (liveRecordingMonitorSnapshotCache.signature === signature) {
        invalidateLiveRecordingMonitorSnapshotCache();
      }
      throw error;
    });

  liveRecordingMonitorSnapshotCache = {
    ...liveRecordingMonitorSnapshotCache,
    signature,
    promise: snapshotPromise,
  };

  return snapshotPromise;
}

export async function buildLiveRecordingMonitorPage(options = {}) {
  const snapshot = await buildLiveRecordingMonitorSnapshot({
    forceRefresh: Boolean(options.forceRefresh),
  });

  const section = normalizeMonitorSection(options.section);
  const rawLimit = Number(options.limit);
  const useFullSnapshot = Number.isFinite(rawLimit) && Math.trunc(rawLimit) === 0;
  const page = useFullSnapshot
    ? 1
    : parsePositiveInt(options.page, 1, { min: 1, max: 100000 });
  const limit = useFullSnapshot
    ? 0
    : parsePositiveInt(options.limit, 40, { min: 1, max: 500 });
  const status = normalizeMonitorStatus(options.status);
  const commentary = normalizeMonitorCommentaryFilter(options.commentary);
  const view = normalizeMonitorView(options.view);
  const q = String(options.q || "").trim();
  const tournament = String(options.tournament || "").trim();

  const sectionRows = buildSectionRows(snapshot?.rows || [], section);
  const summary =
    section === "all"
      ? { ...(snapshot?.summary || {}) }
      : buildSectionSummary(sectionRows);
  const filteredRows = filterSectionRows(sectionRows, {
    status,
    q,
    tournament,
    commentary,
    view,
  });
  const paged = useFullSnapshot
    ? {
        items: filteredRows,
        total: filteredRows.length,
        page: 1,
        pages: 1,
      }
    : paginateRows(filteredRows, page, limit);

  return {
    summary,
    rows: paged.items,
    count: paged.total,
    page: paged.page,
    pages: paged.pages,
    limit,
    hasMore: paged.page < paged.pages,
    meta: {
      ...(snapshot?.meta || {}),
      section,
      filters: {
        status,
        commentary,
        view,
        q,
        tournament,
      },
      tournaments: buildTournamentFacets(sectionRows),
      generatedAt: new Date(),
    },
  };
}

export async function buildLiveRecordingMonitorOverview(options = {}) {
  const section = normalizeMonitorSection(options.section);
  const status = normalizeMonitorStatus(options.status);
  const commentary = normalizeMonitorCommentaryFilter(options.commentary);
  const view = normalizeMonitorView(options.view);
  const q = String(options.q || "").trim();
  const tournament = String(options.tournament || "").trim();
  const forceRefresh = Boolean(options.forceRefresh);

  if (
    section === "all" &&
    canUseFastMonitorRowsPath({
      section,
      status,
      commentary,
      view,
      q,
    })
  ) {
    const [summary, tournaments, countPage, storageSummary, meta] =
      await Promise.all([
        buildFastLiveRecordingMonitorSummary({ section }),
        buildFastLiveRecordingMonitorTournamentFacets({ section }),
        buildFastLiveRecordingMonitorRowsPage({
          section,
          status,
          commentary,
          view,
          q,
          tournament,
          page: 1,
          limit: 1,
        }),
        buildLiveRecordingMonitorStorageSummary({ forceRefresh }),
        buildLiveRecordingMonitorMetaPayload({
          includeWorkerHealth: true,
          includeExportQueue: true,
        }),
      ]);

    return {
      summary: {
        ...summary,
        r2Storage: storageSummary,
      },
      count: Number(countPage?.count || 0),
      meta: {
        ...meta,
        section,
        filters: {
          status,
          commentary,
          view,
          q,
          tournament,
        },
        tournaments,
        generatedAt: new Date(),
      },
    };
  }

  const snapshot = await buildLiveRecordingMonitorSnapshot({
    forceRefresh,
  });

  const sectionRows = buildSectionRows(snapshot?.rows || [], section);
  const filteredRows = filterSectionRows(sectionRows, {
    status,
    q,
    tournament,
    commentary,
    view,
  });
  const summary =
    section === "all"
      ? { ...(snapshot?.summary || {}) }
      : buildSectionSummary(filteredRows);

  return {
    summary,
    count: filteredRows.length,
    meta: {
      ...(snapshot?.meta || {}),
      section,
      filters: {
        status,
        commentary,
        view,
        q,
        tournament,
      },
      tournaments: buildTournamentFacets(sectionRows),
      generatedAt: new Date(),
    },
  };
}

export async function buildLiveRecordingMonitorSummary(options = {}) {
  const section = normalizeMonitorSection(options.section);
  return buildFastLiveRecordingMonitorSummary({ section });
}

export async function buildLiveRecordingMonitorMetaPayload({
  includeWorkerHealth = false,
  includeExportQueue = false,
} = {}) {
  const [eventsMeta, driveSettings, workerHealth, exportQueue] =
    await Promise.all([
    Promise.resolve(getLiveRecordingMonitorMeta()),
    getRecordingDriveSettings().catch(() => ({
      mode: "serviceAccount",
    })),
    includeWorkerHealth
      ? getLiveRecordingWorkerHealth().catch(() => null)
      : Promise.resolve(null),
    includeExportQueue
      ? getLiveRecordingExportQueueSnapshot().catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    ...(eventsMeta || {}),
    driveSettings,
    ...(includeWorkerHealth ? { workerHealth } : {}),
    ...(includeExportQueue ? { exportQueue } : {}),
    generatedAt: new Date(),
  };
}

export async function buildLiveRecordingMonitorTournaments(options = {}) {
  const section = normalizeMonitorSection(options.section);
  return buildFastLiveRecordingMonitorTournamentFacets({ section });
}

export async function buildLiveRecordingMonitorStorageSummary(options = {}) {
  const recordings = await LiveRecordingV2.find({})
    .select(LIVE_RECORDING_MONITOR_STORAGE_RECORDING_SELECT)
    .lean();

  return buildR2StorageSummary(recordings, {
    forceRefresh: Boolean(options.forceRefresh),
  });
}

export async function buildLiveRecordingMonitorExportQueueSnapshot() {
  const [currentDriveSettings, workerHealth, queueSnapshot, recordings] =
    await Promise.all([
      getRecordingDriveSettings().catch(() => ({
        mode: "serviceAccount",
      })),
      getLiveRecordingWorkerHealth().catch(() => null),
      getLiveRecordingExportQueueSnapshot().catch(() => null),
      applyLiveRecordingMonitorRecordingPopulate(
        LiveRecordingV2.find({
          status: { $in: ["pending_export_window", "exporting", "failed"] },
        })
          .select(LIVE_RECORDING_MONITOR_SNAPSHOT_RECORDING_SELECT)
          .sort({ updatedAt: -1, createdAt: -1 })
      ).lean(),
    ]);

  return {
    rows: sortRows(
      recordings.map((recording) =>
        buildRow(
          recording,
          {
            workerHealth,
            queueSnapshot,
            currentDriveMode: currentDriveSettings.mode,
          },
          {
            includeDetailedSegments: false,
          }
        )
      )
    ),
    queueSnapshot,
    generatedAt: new Date(),
  };
}

export async function buildLiveRecordingMonitorRowsPage(options = {}) {
  const fastPage = await buildFastLiveRecordingMonitorRowsPage(options);
  if (fastPage) {
    return fastPage;
  }

  const pageData = await buildLiveRecordingMonitorPage(options);
  return {
    rows: pageData.rows || [],
    count: Number(pageData.count || 0),
    page: Number(pageData.page || 1),
    pages: Number(pageData.pages || 1),
    limit: Number(pageData.limit || 0),
    hasMore: Boolean(pageData.hasMore),
    meta: {
      ...(pageData.meta || {}),
      rowSource: "snapshot_fallback",
    },
  };
}

export async function getLiveRecordingMonitorRowsByIds(
  recordingIds = [],
  { includeDetailedSegments = false } = {}
) {
  const normalizedRecordingIds = Array.from(
    new Set(
      (Array.isArray(recordingIds) ? recordingIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  if (!normalizedRecordingIds.length) {
    return {
      rows: [],
      missingRecordingIds: [],
    };
  }

  const [currentDriveSettings, workerHealth, queueSnapshot, recordings] =
    await Promise.all([
      getRecordingDriveSettings().catch(() => ({
        mode: "serviceAccount",
      })),
      getLiveRecordingWorkerHealth().catch(() => null),
      getLiveRecordingExportQueueSnapshot().catch(() => null),
      applyLiveRecordingMonitorRecordingPopulate(
        LiveRecordingV2.find({ _id: { $in: normalizedRecordingIds } }).select(
          includeDetailedSegments
            ? LIVE_RECORDING_MONITOR_DETAIL_RECORDING_SELECT
            : LIVE_RECORDING_MONITOR_SNAPSHOT_RECORDING_SELECT
        )
      ).lean(),
    ]);

  const recordingsById = new Map(
    recordings.map((recording) => [String(recording?._id || ""), recording])
  );
  const rows = [];
  const missingRecordingIds = [];

  for (const recordingId of normalizedRecordingIds) {
    const recording = recordingsById.get(recordingId);
    if (!recording) {
      missingRecordingIds.push(recordingId);
      continue;
    }

    rows.push(
      buildRow(
        recording,
        {
          workerHealth,
          queueSnapshot,
          currentDriveMode: currentDriveSettings.mode,
        },
        {
          includeDetailedSegments,
        }
      )
    );
  }

  return {
    rows,
    missingRecordingIds,
  };
}

export async function getLiveRecordingMonitorRow(recordingId) {
  const normalizedRecordingId = String(recordingId || "").trim();
  if (!normalizedRecordingId) return null;

  const [currentDriveSettings, workerHealth, queueSnapshot, recording] =
    await Promise.all([
      getRecordingDriveSettings().catch(() => ({
        mode: "serviceAccount",
      })),
      getLiveRecordingWorkerHealth().catch(() => null),
      getLiveRecordingExportQueueSnapshot().catch(() => null),
      applyLiveRecordingMonitorRecordingPopulate(
        LiveRecordingV2.findById(normalizedRecordingId).select(
          LIVE_RECORDING_MONITOR_DETAIL_RECORDING_SELECT
        )
      ).lean(),
    ]);

  if (!recording) return null;

  return buildRow(
    recording,
    {
      workerHealth,
      queueSnapshot,
      currentDriveMode: currentDriveSettings.mode,
    },
    {
      includeDetailedSegments: true,
    }
  );
}
