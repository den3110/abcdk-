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

export async function enqueueLiveRecordingExport(recordingId) {
  return liveRecordingExportQueue.add(
    "export-recording",
    { recordingId: String(recordingId) },
    {
      jobId: `live-recording-export:${String(recordingId)}`,
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
