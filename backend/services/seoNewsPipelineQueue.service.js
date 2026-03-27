import crypto from "crypto";
import os from "os";

import SeoNewsLinkCandidate from "../models/seoNewsLinkCandidateModel.js";
import SeoNewsPipelineJob from "../models/seoNewsPipelineJobModel.js";
import SeoNewsSettings from "../models/seoNewsSettingsModel.js";
import { runSeoNewsCrawl } from "./seoNewsCrawlService.js";
import { generateSeoNewsEvergreenArticles } from "./seoNewsEvergreenService.js";
import { runSeoNewsPipeline } from "./seoNewsPipelineService.js";

const WORKER_TICK_MS = Math.max(
  5_000,
  Number(process.env.SEO_NEWS_PIPELINE_WORKER_TICK_MS) || 8_000
);
const WORKER_LEASE_MS = Math.max(
  60_000,
  Number(process.env.SEO_NEWS_PIPELINE_WORKER_LEASE_MS) || 300_000
);

const workerIdentity = `${os.hostname()}:${process.pid}:seo-news-pipeline`;
let queueWorkerTimer = null;
let tickRunning = false;

function safeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function clearWorkerLease(job) {
  job.worker = {
    lockId: null,
    lockedBy: null,
    hostname: null,
    pid: null,
    lockedAt: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
  };
}

function recalculateJobCounters(job) {
  const counts = {
    completedSteps: 0,
    failedSteps: 0,
    skippedSteps: 0,
    queuedSteps: 0,
    processingSteps: 0,
  };

  for (const step of job.steps || []) {
    if (step.status === "completed") counts.completedSteps += 1;
    else if (step.status === "failed") counts.failedSteps += 1;
    else if (step.status === "skipped") counts.skippedSteps += 1;
    else if (step.status === "processing") counts.processingSteps += 1;
    else counts.queuedSteps += 1;
  }

  Object.assign(job, counts, {
    totalSteps: Array.isArray(job.steps) ? job.steps.length : 0,
  });
}

function mergeSummary(job, delta = {}) {
  const current = job.summary || {};
  job.summary = {
    externalGenerated:
      Number(current.externalGenerated || 0) +
      Number(delta.externalGenerated || 0),
    evergreenGenerated:
      Number(current.evergreenGenerated || 0) +
      Number(delta.evergreenGenerated || 0),
    reviewPassed:
      Number(current.reviewPassed || 0) + Number(delta.reviewPassed || 0),
    reviewFailed:
      Number(current.reviewFailed || 0) + Number(delta.reviewFailed || 0),
    published: Number(current.published || 0) + Number(delta.published || 0),
    draft: Number(current.draft || 0) + Number(delta.draft || 0),
    failed: Number(current.failed || 0) + Number(delta.failed || 0),
  };
}

function extractSummaryFromResult(type, result) {
  if (type === "pipeline_round") {
    return {
      externalGenerated: Number(result?.stats?.externalGenerated) || 0,
      evergreenGenerated: Number(result?.stats?.evergreenGenerated) || 0,
      reviewPassed: Number(result?.stats?.reviewPassed) || 0,
      reviewFailed: Number(result?.stats?.reviewFailed) || 0,
      published: Number(result?.stats?.published) || 0,
      draft: Number(result?.stats?.draft) || 0,
      failed:
        (Number(result?.crawl?.failed) || 0) +
        (Number(result?.generation?.failed) || 0),
    };
  }

  if (type === "pending_candidates") {
    return {
      externalGenerated: Number(result?.stats?.externalGenerated) || 0,
      evergreenGenerated: Number(result?.stats?.evergreenGenerated) || 0,
      reviewPassed: Number(result?.stats?.reviewPassed) || 0,
      reviewFailed: Number(result?.stats?.reviewFailed) || 0,
      published: Number(result?.stats?.published) || 0,
      draft: Number(result?.stats?.draft) || 0,
      failed: Number(result?.crawl?.failed) || 0,
    };
  }

  if (type === "create_ready_articles") {
    return {
      externalGenerated: 0,
      evergreenGenerated: Number(result?.generated) || 0,
      reviewPassed: Number(result?.reviewPassed) || 0,
      reviewFailed: Number(result?.reviewFailed) || 0,
      published: Number(result?.published) || 0,
      draft: Number(result?.draft) || 0,
      failed: Number(result?.failed) || 0,
    };
  }

  return {
    externalGenerated: 0,
    evergreenGenerated: 0,
    reviewPassed: 0,
    reviewFailed: 0,
    published: 0,
    draft: 0,
    failed: 0,
  };
}

function serializeJob(jobDoc) {
  if (!jobDoc) return null;
  const job = jobDoc.toObject ? jobDoc.toObject() : jobDoc;
  const totalSteps =
    Number(job.totalSteps) || (Array.isArray(job.steps) ? job.steps.length : 0);
  const doneSteps =
    (Number(job.completedSteps) || 0) +
    (Number(job.failedSteps) || 0) +
    (Number(job.skippedSteps) || 0);
  const progressPercent = totalSteps
    ? Math.min(100, Math.round((doneSteps / totalSteps) * 100))
    : 0;

  return {
    id: String(job._id),
    type: job.type,
    status: job.status,
    request: job.request || {},
    requestedBy: job.requestedBy || {},
    totalSteps,
    completedSteps: Number(job.completedSteps) || 0,
    failedSteps: Number(job.failedSteps) || 0,
    skippedSteps: Number(job.skippedSteps) || 0,
    queuedSteps: Number(job.queuedSteps) || 0,
    processingSteps: Number(job.processingSteps) || 0,
    progressPercent,
    currentStep: job.currentStep || null,
    summary: job.summary || {},
    startedAt: job.startedAt || null,
    lastProcessedAt: job.lastProcessedAt || null,
    finishedAt: job.finishedAt || null,
    nextRunAt: job.nextRunAt || null,
    cooldownRemainingMs:
      job.nextRunAt && new Date(job.nextRunAt).getTime() > Date.now()
        ? new Date(job.nextRunAt).getTime() - Date.now()
        : 0,
    lastError: job.lastError || "",
    notes: Array.isArray(job.notes) ? job.notes : [],
    worker: job.worker || null,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || null,
    steps: Array.isArray(job.steps)
      ? job.steps.map((step) => ({
          index: step.index,
          type: step.type,
          label: step.label,
          status: step.status,
          startedAt: step.startedAt || null,
          completedAt: step.completedAt || null,
          message: step.message || "",
          error: step.error || "",
          result: step.result || null,
        }))
      : [],
  };
}

function buildJobSteps(type, request = {}) {
  if (type === "pipeline") {
    const rounds = Math.max(1, Math.min(Number(request.rounds) || 1, 6));
    return Array.from({ length: rounds }, (_, index) => ({
      index: index + 1,
      type: "pipeline_round",
      label: rounds > 1 ? `Pipeline round ${index + 1}/${rounds}` : "Pipeline round",
      status: "queued",
      message: "",
      error: "",
      result: null,
    }));
  }

  if (type === "pending_candidates") {
    return [
      {
        index: 1,
        type: "pending_candidates",
        label: "Run pending candidates",
        status: "queued",
        message: "",
        error: "",
        result: null,
      },
    ];
  }

  return [
    {
      index: 1,
      type: "create_ready_articles",
      label: `Create ready AI posts (${Math.max(
        1,
        Number(request.count) || 1
      )})`,
      status: "queued",
      message: "",
      error: "",
      result: null,
    },
  ];
}

export async function enqueueSeoNewsPipelineJob({
  type = "pipeline",
  request = {},
  requestedBy = {},
} = {}) {
  const normalizedType = [
    "pipeline",
    "pending_candidates",
    "create_ready_articles",
  ].includes(String(type || "").trim())
    ? String(type || "").trim()
    : "pipeline";

  const jobRequest = {
    discoveryMode: safeText(request.discoveryMode).toLowerCase(),
    rounds: Math.max(1, Math.min(Number(request.rounds) || 1, 6)),
    count: Math.max(1, Math.min(Number(request.count) || 3, 10)),
    limit: Math.max(1, Number(request.limit) || 1),
    forcePublish:
      request.forcePublish === true || String(request.forcePublish) === "true",
  };

  const steps = buildJobSteps(normalizedType, jobRequest);

  const job = await SeoNewsPipelineJob.create({
    type: normalizedType,
    status: "queued",
    request: jobRequest,
    requestedBy: {
      userId: requestedBy.userId || null,
      name: safeText(requestedBy.name),
      email: safeText(requestedBy.email),
    },
    totalSteps: steps.length,
    queuedSteps: steps.length,
    nextRunAt: new Date(),
    steps,
    notes: [],
  });

  return {
    job: serializeJob(job),
  };
}

export async function getSeoNewsPipelineMonitor() {
  const [activeJobDoc, recentJobDocs, queuedCount, runningCount] =
    await Promise.all([
      SeoNewsPipelineJob.findOne({
        status: { $in: ["queued", "running"] },
      }).sort({ createdAt: 1 }),
      SeoNewsPipelineJob.find({})
        .sort({ createdAt: -1 })
        .limit(8),
      SeoNewsPipelineJob.countDocuments({ status: "queued" }),
      SeoNewsPipelineJob.countDocuments({ status: "running" }),
    ]);

  const recentJobs = recentJobDocs.map((job) => serializeJob(job));
  const activeJob = serializeJob(activeJobDoc);

  return {
    activeJob,
    recentJobs,
    summary: {
      queued: queuedCount,
      running: runningCount,
      completed: recentJobs.filter((job) => job.status === "completed").length,
      failed: recentJobs.filter((job) => job.status === "failed").length,
    },
  };
}

async function claimNextDueJob() {
  const now = new Date();
  const lockId = crypto.randomUUID();

  return SeoNewsPipelineJob.findOneAndUpdate(
    {
      status: { $in: ["queued", "running"] },
      nextRunAt: { $lte: now },
      $or: [
        { "worker.leaseExpiresAt": { $exists: false } },
        { "worker.leaseExpiresAt": null },
        { "worker.leaseExpiresAt": { $lte: now } },
      ],
    },
    {
      $set: {
        status: "running",
        "worker.lockId": lockId,
        "worker.lockedBy": workerIdentity,
        "worker.hostname": os.hostname(),
        "worker.pid": process.pid,
        "worker.lockedAt": now,
        "worker.leaseExpiresAt": new Date(Date.now() + WORKER_LEASE_MS),
        "worker.lastHeartbeatAt": now,
      },
    },
    {
      sort: { nextRunAt: 1, createdAt: 1 },
      new: true,
    }
  );
}

async function loadSeoNewsSettings() {
  return (
    (await SeoNewsSettings.findOne({ key: "default" })) ||
    (await SeoNewsSettings.create({ key: "default" }))
  );
}

async function executeStep(job, step) {
  if (step.type === "pipeline_round") {
    return runSeoNewsPipeline({
      discoveryMode: ["auto", "gemini", "openai"].includes(
        safeText(job.request?.discoveryMode)
      )
        ? safeText(job.request?.discoveryMode)
        : undefined,
      runId: `worker_pipeline_${job._id}_${step.index}_${Date.now().toString(
        36
      )}`,
    });
  }

  if (step.type === "pending_candidates") {
    const settings = await loadSeoNewsSettings();
    const pendingCount = await SeoNewsLinkCandidate.countDocuments({
      status: "pending",
    });
    const runLimit = Math.min(
      Math.max(1, Number(job.request?.limit) || pendingCount),
      pendingCount
    );

    if (!runLimit) {
      return {
        ok: true,
        pendingBefore: pendingCount,
        processedLimit: 0,
        crawl: {
          crawled: 0,
          skipped: 0,
          failed: 0,
          externalGenerated: 0,
          reviewPassed: 0,
          reviewFailed: 0,
          published: 0,
          draft: 0,
          errorsByType: {},
          failedSamples: [],
        },
        stats: {
          externalGenerated: 0,
          evergreenGenerated: 0,
          reviewPassed: 0,
          reviewFailed: 0,
          published: 0,
          draft: 0,
        },
      };
    }

    const crawl = await runSeoNewsCrawl({
      limit: runLimit,
      settings,
      runId: `worker_pending_${job._id}_${Date.now().toString(36)}`,
    });

    return {
      ok: true,
      pendingBefore: pendingCount,
      processedLimit: runLimit,
      crawl,
      stats: {
        externalGenerated: crawl.externalGenerated || 0,
        evergreenGenerated: 0,
        reviewPassed: crawl.reviewPassed || 0,
        reviewFailed: crawl.reviewFailed || 0,
        published: crawl.published || 0,
        draft: crawl.draft || 0,
      },
    };
  }

  const settings = await loadSeoNewsSettings();
  return generateSeoNewsEvergreenArticles({
    count: Math.max(1, Number(job.request?.count) || 3),
    settings,
    runId: `worker_ready_${job._id}_${Date.now().toString(36)}`,
    forcePublish: job.request?.forcePublish === true,
  });
}

function maybeSkipRemainingPipelineSteps(job, step, result) {
  if (job.type !== "pipeline") return false;
  if (Number(step.index) < 2) return false;

  const producedThisRound =
    (Number(result?.stats?.externalGenerated) || 0) +
    (Number(result?.stats?.evergreenGenerated) || 0);

  if (producedThisRound > 0) return false;

  let skippedAny = false;
  for (const nextStep of job.steps || []) {
    if (Number(nextStep.index) <= Number(step.index)) continue;
    if (nextStep.status !== "queued") continue;
    nextStep.status = "skipped";
    nextStep.completedAt = new Date();
    nextStep.message = "Stopped early because previous round produced no new article.";
    skippedAny = true;
  }

  if (skippedAny) {
    job.notes = Array.isArray(job.notes) ? job.notes : [];
    job.notes.push(
      `Dung som sau round ${step.index} vi khong phat sinh bai moi.`
    );
  }

  return skippedAny;
}

async function processClaimedJob(job) {
  const now = new Date();

  for (const step of job.steps || []) {
    if (step.status === "processing") {
      step.status = "queued";
      step.error = step.error || "Recovered after stale worker lease";
      step.startedAt = null;
    }
  }

  if (!job.startedAt) {
    job.startedAt = now;
  }

  recalculateJobCounters(job);
  const nextStep = (job.steps || []).find((step) => step.status === "queued");

  if (!nextStep) {
    job.currentStep = {
      index: null,
      label: null,
      type: null,
      startedAt: null,
    };
    job.finishedAt = now;
    job.nextRunAt = null;
    job.status =
      Number(job.completedSteps) > 0 || Number(job.skippedSteps) > 0
        ? "completed"
        : "failed";
    clearWorkerLease(job);
    await job.save();
    return;
  }

  nextStep.status = "processing";
  nextStep.startedAt = now;
  nextStep.completedAt = null;
  nextStep.error = "";
  nextStep.message = "";
  job.currentStep = {
    index: nextStep.index,
    label: nextStep.label,
    type: nextStep.type,
    startedAt: now,
  };
  job.worker.lastHeartbeatAt = now;
  recalculateJobCounters(job);
  await job.save();

  try {
    const result = await executeStep(job, nextStep);
    nextStep.status = "completed";
    nextStep.completedAt = new Date();
    nextStep.result = result || null;
    nextStep.message = result?.message || "Step completed";
    mergeSummary(job, extractSummaryFromResult(nextStep.type, result));
    maybeSkipRemainingPipelineSteps(job, nextStep, result);
  } catch (error) {
    nextStep.status = "failed";
    nextStep.completedAt = new Date();
    nextStep.error = error?.message || "seo_news_pipeline_step_failed";
    job.lastError = nextStep.error;
    mergeSummary(job, { failed: 1 });
  }

  job.currentStep = {
    index: null,
    label: null,
    type: null,
    startedAt: null,
  };
  job.lastProcessedAt = new Date();
  recalculateJobCounters(job);

  const hasMoreQueued = (job.steps || []).some((step) => step.status === "queued");
  if (hasMoreQueued) {
    job.status = "running";
    job.nextRunAt = new Date();
  } else {
    job.finishedAt = new Date();
    job.nextRunAt = null;
    job.status =
      Number(job.completedSteps) > 0 || Number(job.skippedSteps) > 0
        ? "completed"
        : "failed";
  }

  clearWorkerLease(job);
  await job.save();
}

async function tickSeoNewsPipelineWorker() {
  if (tickRunning) return;
  tickRunning = true;

  try {
    const job = await claimNextDueJob();
    if (!job) return;
    await processClaimedJob(job);
  } catch (error) {
    console.error(
      "[SeoNewsPipelineQueue] worker tick failed:",
      error?.message || error
    );
  } finally {
    tickRunning = false;
  }
}

export function startSeoNewsPipelineWorker() {
  if (queueWorkerTimer) return queueWorkerTimer;

  queueWorkerTimer = setInterval(() => {
    void tickSeoNewsPipelineWorker();
  }, WORKER_TICK_MS);

  void tickSeoNewsPipelineWorker();
  console.log(
    `[SeoNewsPipelineQueue] worker started interval=${WORKER_TICK_MS}ms`
  );

  return queueWorkerTimer;
}
