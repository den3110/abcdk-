import "dotenv/config";
import { QueueEvents, Worker } from "bullmq";
import { liveRecordingExportConnection, getLiveRecordingExportQueueName } from "../services/liveRecordingV2Queue.service.js";
import { exportLiveRecordingV2 } from "../services/liveRecordingV2Export.service.js";

const QUEUE_NAME = getLiveRecordingExportQueueName();

const queueEvents = new QueueEvents(QUEUE_NAME, {
  connection: liveRecordingExportConnection,
});

queueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error("[live-recording-export-worker] Job failed", jobId, failedReason);
});

queueEvents.on("completed", ({ jobId }) => {
  console.log("[live-recording-export-worker] Job completed", jobId);
});

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const recordingId = job?.data?.recordingId;
    if (!recordingId) {
      throw new Error("Missing recordingId");
    }
    await exportLiveRecordingV2(recordingId);
    return { ok: true, recordingId };
  },
  {
    connection: liveRecordingExportConnection,
    concurrency: 1,
  }
);

console.log("[live-recording-export-worker] running");

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    try {
      await worker.close();
      await queueEvents.close();
      await liveRecordingExportConnection.quit();
    } finally {
      process.exit(0);
    }
  });
}
