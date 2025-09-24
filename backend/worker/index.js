// jobs/cccd.worker.js
import "dotenv/config";
import IORedis from "ioredis";
import { Worker, QueueEvents } from "bullmq";
import fs from "fs/promises";

import {
  initOcr,
  recognizeCCCDLite, // ưu tiên
  recognizeBest, // fallback
} from "../services/ocr/ocrEngine.js";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  // enableReadyCheck: false,
});
const QUEUE_NAME = "cccd-ocr";

await initOcr();

const queueEvents = new QueueEvents(QUEUE_NAME, { connection });
queueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error("[cccd-worker] Job failed", jobId, failedReason);
});
queueEvents.on("completed", ({ jobId }) => {
  console.log("[cccd-worker] Job completed", jobId);
});

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { tmpPath } = job.data;
    const buff = await fs.readFile(tmpPath);

    let primary, outLite, outBest;

    // 1) Thử nhận dạng theo layout (ROI cố định + thử 0/180°)
    try {
      outLite = await recognizeCCCDLite(buff);
      primary = "lite";
    } catch (e) {
      // nếu hàm chưa có/ lỗi bất ngờ -> bỏ qua, sẽ fallback
      primary = "error-lite";
    }

    // 2) Nếu thiếu bất kỳ trường quan trọng nào -> fallback sang engine đa pipeline
    if (!outLite || !outLite.fullName || !outLite.dob || !outLite.hometown) {
      outBest = await recognizeBest(buff);
      primary = outLite ? "lite+fallback-best" : "best-only";
    }

    // 3) Gộp kết quả: ưu tiên lite, thiếu đâu bù best
    const fullName = outLite?.fullName || outBest?.fullName || null;
    const dob = outLite?.dob || outBest?.dob || null;
    const hometown = outLite?.hometown || outBest?.hometown || null;
    const rawText = outLite?.rawText || outBest?.rawText || "";

    try {
      await fs.unlink(tmpPath);
    } catch {}

    return {
      source: "ocr",
      fullName,
      dob,
      hometown,
      rawText,
      debug: {
        primary,
        lite: outLite?.debug || null,
        best: outBest?.debug || null,
      },
    };
  },
  {
    connection,
    concurrency: Math.max(1, Number(process.env.OCR_CONCURRENCY) || 2),
  }
);

console.log(
  `[cccd-worker] running with concurrency=${worker.opts.concurrency}`
);

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    try {
      await worker.close();
      await queueEvents.close();
      await connection.quit();
    } finally {
      process.exit(0);
    }
  });
}
