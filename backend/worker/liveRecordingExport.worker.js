import "dotenv/config";
import os from "os";
import mongoose from "mongoose";
import { QueueEvents, Worker } from "bullmq";
import connectDB from "../config/db.js";
import { liveRecordingExportConnection, getLiveRecordingExportQueueName } from "../services/liveRecordingV2Queue.service.js";
import { exportLiveRecordingV2 } from "../services/liveRecordingV2Export.service.js";
import { loadLiveRecordingStorageTargetsConfig } from "../services/liveRecordingStorageTargetsConfig.service.js";
import {
  clearLiveRecordingWorkerHeartbeat,
  getLiveRecordingWorkerHeartbeatConfig,
  publishLiveRecordingWorkerHeartbeat,
} from "../services/liveRecordingWorkerHealth.service.js";

const QUEUE_NAME = getLiveRecordingExportQueueName();
const WORKER_NAME = "live-recording-export-worker";
const WORKER_STARTED_AT = new Date().toISOString();

let currentJobId = null;
let currentRecordingId = null;
let currentJobStartedAt = null;
let lastCompletedAt = null;
let lastFailedAt = null;
let lastFailedReason = null;

async function heartbeat(status = "idle") {
  await publishLiveRecordingWorkerHeartbeat({
    workerName: WORKER_NAME,
    queueName: QUEUE_NAME,
    hostname: os.hostname(),
    pid: process.pid,
    startedAt: WORKER_STARTED_AT,
    status,
    currentJobId,
    currentRecordingId,
    currentJobStartedAt,
    lastCompletedAt,
    lastFailedAt,
    lastFailedReason,
  });
}

const queueEvents = new QueueEvents(QUEUE_NAME, {
  connection: liveRecordingExportConnection,
});

queueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error("[live-recording-export-worker] Job failed", jobId, failedReason);
  lastFailedAt = new Date().toISOString();
  lastFailedReason = failedReason ? String(failedReason) : null;
  void heartbeat(currentJobId ? "busy" : "idle");
});

queueEvents.on("completed", ({ jobId }) => {
  console.log("[live-recording-export-worker] Job completed", jobId);
  lastCompletedAt = new Date().toISOString();
  lastFailedReason = null;
  void heartbeat(currentJobId ? "busy" : "idle");
});

await connectDB();
await loadLiveRecordingStorageTargetsConfig().catch((error) => {
  console.warn(
    "[live-recording-export-worker] failed to preload storage targets config:",
    error?.message || error
  );
});

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const recordingId = job?.data?.recordingId;
    if (!recordingId) {
      throw new Error("Missing recordingId");
    }
    currentJobId = job.id ? String(job.id) : null;
    currentRecordingId = String(recordingId);
    currentJobStartedAt = new Date().toISOString();
    await heartbeat("busy");
    try {
      await loadLiveRecordingStorageTargetsConfig().catch((error) => {
        console.warn(
          "[live-recording-export-worker] failed to refresh storage targets config before export:",
          error?.message || error
        );
      });
      await exportLiveRecordingV2(recordingId);
      lastCompletedAt = new Date().toISOString();
      lastFailedReason = null;
      return { ok: true, recordingId };
    } catch (error) {
      lastFailedAt = new Date().toISOString();
      lastFailedReason = error?.message || String(error);
      throw error;
    } finally {
      currentJobId = null;
      currentRecordingId = null;
      currentJobStartedAt = null;
      await heartbeat("idle");
    }
  },
  {
    connection: liveRecordingExportConnection,
    concurrency: 1,
  }
);

console.log("[live-recording-export-worker] running");
void heartbeat("idle");

const heartbeatTimer = setInterval(() => {
  void heartbeat(currentJobId ? "busy" : "idle");
}, getLiveRecordingWorkerHeartbeatConfig().intervalMs);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    try {
      clearInterval(heartbeatTimer);
      await clearLiveRecordingWorkerHeartbeat().catch(() => {});
      await worker.close();
      await queueEvents.close();
      await liveRecordingExportConnection.quit();
      await mongoose.connection.close().catch(() => {});
    } finally {
      process.exit(0);
    }
  });
}
