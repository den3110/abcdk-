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
    delayedByRecordingId[recordingId] = {
      position: index + 1,
      jobId: job?.id ? String(job.id) : null,
      timestamp: Number(job?.timestamp) || null,
      delay: Number(job?.opts?.delay) || null,
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
  { replaceTerminalJob = false } = {}
) {
  const jobId = buildExportJobId(recordingId);

  if (replaceTerminalJob) {
    const existingJob = await liveRecordingExportQueue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState().catch(() => null);
      if (["completed", "failed"].includes(state)) {
        await existingJob.remove().catch(() => {});
      }
    }
  }

  return liveRecordingExportQueue.add(
    "export-recording",
    { recordingId: String(recordingId) },
    {
      jobId,
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
