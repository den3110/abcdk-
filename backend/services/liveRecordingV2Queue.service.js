import IORedis from "ioredis";
import { Queue } from "bullmq";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const QUEUE_NAME =
  process.env.LIVE_RECORDING_EXPORT_QUEUE_NAME || "live-recording-export";

export const liveRecordingExportConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

liveRecordingExportConnection.on("error", (error) => {
  console.error("[live-recording-v2] redis error:", error?.message || error);
});

export const liveRecordingExportQueue = new Queue(QUEUE_NAME, {
  connection: liveRecordingExportConnection,
});

export function getLiveRecordingExportQueueName() {
  return QUEUE_NAME;
}

function buildExportJobId(recordingId) {
  return `live-recording-export-${String(recordingId)}`;
}

function buildRetryExportJobId(recordingId, suffix = Date.now()) {
  return `${buildExportJobId(recordingId)}-retry-${String(suffix)}`;
}

function toRecordingKey(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export async function getLiveRecordingExportQueueSnapshot() {
  const [waitingJobs, activeJobs, delayedJobs] = await Promise.all([
    liveRecordingExportQueue.getWaiting(0, 1000),
    liveRecordingExportQueue.getActive(0, 100),
    liveRecordingExportQueue.getDelayed(0, 1000),
  ]);

  const waitingByRecordingId = {};
  const activeByRecordingId = {};
  const delayedByRecordingId = {};

  waitingJobs.forEach((job, index) => {
    const recordingId = toRecordingKey(job?.data?.recordingId);
    if (!recordingId || waitingByRecordingId[recordingId]) return;
    waitingByRecordingId[recordingId] = {
      position: index + 1,
      jobId: job?.id ? String(job.id) : null,
    };
  });

  activeJobs.forEach((job, index) => {
    const recordingId = toRecordingKey(job?.data?.recordingId);
    if (!recordingId || activeByRecordingId[recordingId]) return;
    activeByRecordingId[recordingId] = {
      position: index + 1,
      jobId: job?.id ? String(job.id) : null,
    };
  });

  delayedJobs.forEach((job, index) => {
    const recordingId = toRecordingKey(job?.data?.recordingId);
    if (!recordingId || delayedByRecordingId[recordingId]) return;
    const timestamp = Number(job?.timestamp) || 0;
    const delay = Number(job?.opts?.delay) || 0;
    delayedByRecordingId[recordingId] = {
      position: index + 1,
      jobId: job?.id ? String(job.id) : null,
      timestamp: timestamp || null,
      delay: delay || null,
      scheduledAt: timestamp > 0 ? timestamp + delay : null,
    };
  });

  return {
    queueName: QUEUE_NAME,
    waitingCount: waitingJobs.length,
    activeCount: activeJobs.length,
    delayedCount: delayedJobs.length,
    waitingByRecordingId,
    activeByRecordingId,
    delayedByRecordingId,
  };
}

export async function getLiveRecordingExportJob(recordingId) {
  return liveRecordingExportQueue.getJob(buildExportJobId(recordingId));
}

export async function enqueueLiveRecordingExport(
  recordingId,
  {
    replaceTerminalJob = false,
    delayMs = 0,
    replacePendingJob = false,
  } = {}
) {
  const jobId = buildExportJobId(recordingId);
  const normalizedDelayMs =
    Number.isFinite(Number(delayMs)) && Number(delayMs) > 0 ? Math.round(Number(delayMs)) : 0;

  const existingJob = await liveRecordingExportQueue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState().catch(() => null);

    if (state === "active") {
      return existingJob;
    }

    const shouldRemoveTerminal =
      replaceTerminalJob && ["completed", "failed"].includes(state);
    const shouldRemovePending =
      replacePendingJob &&
      ["waiting", "waiting-children", "delayed", "prioritized"].includes(state);

    if (shouldRemoveTerminal || shouldRemovePending) {
      await existingJob.remove().catch(() => {});
    } else {
      return existingJob;
    }
  }

  return liveRecordingExportQueue.add(
    "export-recording",
    { recordingId: String(recordingId) },
    {
      jobId,
      ...(normalizedDelayMs > 0 ? { delay: normalizedDelayMs } : {}),
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 10_000,
      },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600, count: 2000 },
    }
  );
}

export async function enqueueLiveRecordingExportRetry(
  recordingId,
  { delayMs = 0, retryReason = "retry" } = {}
) {
  const normalizedDelayMs =
    Number.isFinite(Number(delayMs)) && Number(delayMs) > 0
      ? Math.round(Number(delayMs))
      : 0;

  return liveRecordingExportQueue.add(
    "export-recording",
    {
      recordingId: String(recordingId),
      retryReason: String(retryReason || "retry"),
    },
    {
      jobId: buildRetryExportJobId(recordingId),
      ...(normalizedDelayMs > 0 ? { delay: normalizedDelayMs } : {}),
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 10_000,
      },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600, count: 2000 },
    }
  );
}
