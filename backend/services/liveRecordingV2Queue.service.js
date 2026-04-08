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

export async function removeLiveRecordingExportJobs(recordingId) {
  const normalizedRecordingId = toRecordingKey(recordingId);
  if (!normalizedRecordingId) {
    return {
      removedJobIds: [],
      skippedActiveJobIds: [],
      errors: [],
    };
  }

  const [standardJob, waitingJobs, delayedJobs] = await Promise.all([
    getLiveRecordingExportJob(normalizedRecordingId).catch(() => null),
    liveRecordingExportQueue.getWaiting(0, 1000).catch(() => []),
    liveRecordingExportQueue.getDelayed(0, 1000).catch(() => []),
  ]);

  const jobs = [standardJob, ...waitingJobs, ...delayedJobs].filter(Boolean);
  const seenJobIds = new Set();
  const matchedJobs = jobs.filter((job) => {
    const jobId = String(job?.id || "").trim();
    const jobRecordingId = toRecordingKey(job?.data?.recordingId);
    const matchesRecording =
      jobRecordingId === normalizedRecordingId ||
      jobId.startsWith(buildExportJobId(normalizedRecordingId));
    if (!matchesRecording || !jobId || seenJobIds.has(jobId)) {
      return false;
    }
    seenJobIds.add(jobId);
    return true;
  });

  const removedJobIds = [];
  const skippedActiveJobIds = [];
  const errors = [];

  for (const job of matchedJobs) {
    const jobId = String(job?.id || "").trim();
    if (!jobId) continue;

    const state = await job.getState().catch(() => null);
    if (state === "active") {
      skippedActiveJobIds.push(jobId);
      continue;
    }

    try {
      await job.remove();
      removedJobIds.push(jobId);
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  return {
    removedJobIds,
    skippedActiveJobIds,
    errors,
  };
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
