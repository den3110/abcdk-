import crypto from "crypto";
import os from "os";

import SeoNewsArticle from "../models/seoNewsArticleModel.js";
import SeoNewsImageRegenerationJob from "../models/seoNewsImageRegenerationJobModel.js";
import SeoNewsSettings from "../models/seoNewsSettingsModel.js";
import {
  checkSeoNewsImageGenerationHealth,
  regenerateSeoNewsArticleImage,
} from "./seoNewsImageService.js";

const DEFAULT_IMAGE_REGEN_ITEM_INTERVAL_MS = Math.max(
  15_000,
  Number(process.env.SEO_NEWS_AI_REGEN_INTERVAL_MS) || 120_000
);
const IMAGE_REGEN_MAX_ITEMS_PER_JOB = Math.max(
  1,
  Number(process.env.SEO_NEWS_AI_REGEN_MAX_ITEMS_PER_JOB) || 50
);
const IMAGE_REGEN_WORKER_TICK_MS = Math.max(
  5_000,
  Number(process.env.SEO_NEWS_AI_REGEN_WORKER_TICK_MS) || 10_000
);
const IMAGE_REGEN_WORKER_LEASE_MS = Math.max(
  60_000,
  Number(process.env.SEO_NEWS_AI_REGEN_WORKER_LEASE_MS) || 300_000
);
const IMAGE_REGEN_HEALTH_CACHE_MS = Math.max(
  5_000,
  Number(process.env.SEO_NEWS_AI_REGEN_HEALTH_CACHE_MS) || 30_000
);

const workerIdentity = `${os.hostname()}:${process.pid}:seo-news-image-regen`;
let queueWorkerTimer = null;
let tickRunning = false;
let healthCache = {
  expiresAt: 0,
  value: null,
};

export function invalidateSeoNewsImageRegenerationHealthCache() {
  healthCache = {
    expiresAt: 0,
    value: null,
  };
}

function safeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeImageRegenerationIntervalMs(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_IMAGE_REGEN_ITEM_INTERVAL_MS;
  }

  return Math.max(5_000, Math.floor(numericValue));
}

function intervalMsToSeconds(value) {
  return Math.max(
    1,
    Math.round(normalizeImageRegenerationIntervalMs(value) / 1000)
  );
}

async function getSeoNewsImageRegenerationSettings() {
  return SeoNewsSettings.findOne({ key: "default" })
    .select("imageGenerationDelaySeconds imageRegenerationPaused")
    .lean();
}

function getImageRegenerationIntervalMsFromSettings(settings) {
  const delaySeconds = Number(settings?.imageGenerationDelaySeconds);
  if (!Number.isFinite(delaySeconds)) {
    return DEFAULT_IMAGE_REGEN_ITEM_INTERVAL_MS;
  }

  return normalizeImageRegenerationIntervalMs(delaySeconds * 1000);
}

function isImageRegenerationPaused(settings) {
  return settings?.imageRegenerationPaused === true;
}

function buildPendingImageConditions() {
  return [
    { heroImageUrl: { $exists: false } },
    { heroImageUrl: null },
    { heroImageUrl: "" },
    { heroImageUrl: /^data:image\//i },
    { thumbImageUrl: { $exists: false } },
    { thumbImageUrl: null },
    { thumbImageUrl: "" },
    { thumbImageUrl: /^data:image\//i },
  ];
}

function buildHasImageConditions() {
  return {
    heroImageUrl: {
      $exists: true,
      $ne: null,
      $ne: "",
      $not: /^data:image\//i,
    },
  };
}

function buildGeneratedGatewayConditions() {
  return {
    heroImageUrl: {
      $regex: /^\/uploads\/public\/seo-news\//,
      $ne: null,
    },
  };
}

function buildRegenerationQuery({ imageFilter = "", keyword = "" } = {}) {
  const query = {
    status: { $in: ["published", "draft"] },
    origin: "generated",
  };

  const normalizedKeyword = safeText(keyword);
  if (normalizedKeyword) {
    query.$or = [
      { title: { $regex: normalizedKeyword, $options: "i" } },
      { slug: { $regex: normalizedKeyword, $options: "i" } },
    ];
  }

  const normalizedImageFilter = safeText(imageFilter).toLowerCase();
  if (normalizedImageFilter === "pending") {
    const pendingCondition = buildPendingImageConditions();
    if (query.$or) {
      query.$and = [{ $or: query.$or }, { $or: pendingCondition }];
      delete query.$or;
    } else {
      query.$or = pendingCondition;
    }
  } else if (normalizedImageFilter === "has-image") {
    Object.assign(query, buildHasImageConditions());
  } else if (normalizedImageFilter === "ai-generated") {
    Object.assign(query, buildGeneratedGatewayConditions());
  }

  return query;
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
    completedItems: 0,
    failedItems: 0,
    skippedItems: 0,
    queuedItems: 0,
    processingItems: 0,
  };

  for (const item of job.items || []) {
    if (item.status === "completed") counts.completedItems += 1;
    else if (item.status === "failed") counts.failedItems += 1;
    else if (item.status === "skipped") counts.skippedItems += 1;
    else if (item.status === "processing") counts.processingItems += 1;
    else counts.queuedItems += 1;
  }

  Object.assign(job, counts, {
    totalItems: Array.isArray(job.items) ? job.items.length : 0,
  });
}

function serializeJob(jobDoc) {
  if (!jobDoc) return null;
  const job = jobDoc.toObject ? jobDoc.toObject() : jobDoc;
  const totalItems =
    Number(job.totalItems) || (Array.isArray(job.items) ? job.items.length : 0);
  const doneItems =
    (Number(job.completedItems) || 0) +
    (Number(job.failedItems) || 0) +
    (Number(job.skippedItems) || 0);
  const progressPercent = totalItems
    ? Math.min(100, Math.round((doneItems / totalItems) * 100))
    : 0;
  const currentState = job.currentItem?.slug
    ? "processing"
    : job.status === "queued"
    ? "queued"
    : job.status === "running" && job.nextRunAt
    ? "cooldown"
    : job.status;

  return {
    id: String(job._id),
    status: job.status,
    state: currentState,
    request: job.request || {},
    requestedBy: job.requestedBy || {},
    totalItems,
    completedItems: Number(job.completedItems) || 0,
    failedItems: Number(job.failedItems) || 0,
    skippedItems: Number(job.skippedItems) || 0,
    queuedItems: Number(job.queuedItems) || 0,
    processingItems: Number(job.processingItems) || 0,
    progressPercent,
    currentItem: job.currentItem || null,
    nextRunAt: job.nextRunAt || null,
    cooldownRemainingMs:
      job.nextRunAt && new Date(job.nextRunAt).getTime() > Date.now()
        ? new Date(job.nextRunAt).getTime() - Date.now()
        : 0,
    startedAt: job.startedAt || null,
    lastProcessedAt: job.lastProcessedAt || null,
    finishedAt: job.finishedAt || null,
    lastError: job.lastError || null,
    notes: Array.isArray(job.notes) ? job.notes : [],
    worker: job.worker || null,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || null,
    items: Array.isArray(job.items)
      ? job.items.map((item) => ({
          articleId: String(item.articleId || ""),
          slug: item.slug,
          title: item.title,
          status: item.status,
          attempts: item.attempts || 0,
          startedAt: item.startedAt || null,
          completedAt: item.completedAt || null,
          error: item.error || null,
          previousHeroImageUrl: item.previousHeroImageUrl || null,
          resultHeroImageUrl: item.resultHeroImageUrl || null,
          resultThumbImageUrl: item.resultThumbImageUrl || null,
          resultImageOrigin: item.resultImageOrigin || null,
        }))
      : [],
  };
}

async function getQueuedArticleIdsFromOpenJobs() {
  const openJobs = await SeoNewsImageRegenerationJob.find({
    status: { $in: ["queued", "running"] },
  })
    .select("items.articleId")
    .lean();

  const ids = new Set();
  for (const job of openJobs) {
    for (const item of job.items || []) {
      if (!item?.articleId) continue;
      ids.add(String(item.articleId));
    }
  }
  return ids;
}

export async function enqueueSeoNewsImageRegenerationJob({
  filters = {},
  requestedBy = {},
} = {}) {
  const imageFilter = safeText(filters.imageFilter);
  const keyword = safeText(filters.keyword);
  const requestedLimit = Math.max(
    1,
    Number(filters.limit) || IMAGE_REGEN_MAX_ITEMS_PER_JOB
  );
  const maxItemsPerJob = Math.min(
    requestedLimit,
    IMAGE_REGEN_MAX_ITEMS_PER_JOB
  );

  const query = buildRegenerationQuery({ imageFilter, keyword });
  const [queuedArticleIds, settings] = await Promise.all([
    getQueuedArticleIdsFromOpenJobs(),
    getSeoNewsImageRegenerationSettings(),
  ]);
  const itemIntervalMs = getImageRegenerationIntervalMsFromSettings(settings);

  if (queuedArticleIds.size) {
    query._id = { $nin: Array.from(queuedArticleIds) };
  }

  const totalMatching = await SeoNewsArticle.countDocuments(query);
  const articles = await SeoNewsArticle.find(query)
    .sort({ createdAt: -1 })
    .limit(maxItemsPerJob)
    .select("_id slug title heroImageUrl")
    .lean();

  if (!articles.length) {
    const error = new Error(
      "Khong co bai generated nao san sang cho hang cho gen lai anh"
    );
    error.statusCode = 409;
    throw error;
  }

  const notes = [];
  if (totalMatching > maxItemsPerJob) {
    notes.push(`Job bi gioi han ${maxItemsPerJob} bai de tranh queue qua dai.`);
  }
  if (queuedArticleIds.size) {
    notes.push(
      `${queuedArticleIds.size} bai da nam trong queue dang mo se duoc bo qua de tranh gen trung.`
    );
  }

  const job = await SeoNewsImageRegenerationJob.create({
    status: "queued",
    request: {
      imageFilter,
      origin: "generated",
      keyword,
      requestedLimit,
      maxItemsPerJob,
      itemIntervalMs,
    },
    requestedBy: {
      userId: requestedBy.userId || null,
      name: safeText(requestedBy.name),
      email: safeText(requestedBy.email),
    },
    totalItems: articles.length,
    queuedItems: articles.length,
    nextRunAt: new Date(),
    notes,
    items: articles.map((article) => ({
      articleId: article._id,
      slug: article.slug,
      title: article.title,
      previousHeroImageUrl: article.heroImageUrl || null,
      status: "queued",
    })),
  });

  return {
    job: serializeJob(job),
    selectedCount: articles.length,
    totalMatching,
    maxItemsPerJob,
    queuedArticleIdsSkipped: queuedArticleIds.size,
  };
}

async function getCachedHealth(force = false) {
  if (!force && healthCache.value && healthCache.expiresAt > Date.now()) {
    return healthCache.value;
  }

  const value = await checkSeoNewsImageGenerationHealth();
  healthCache = {
    value,
    expiresAt: Date.now() + IMAGE_REGEN_HEALTH_CACHE_MS,
  };
  return value;
}

export async function getSeoNewsImageRegenerationMonitor({
  forceHealthRefresh = false,
} = {}) {
  const [
    activeJobDoc,
    recentJobDocs,
    aiHealth,
    queuedCount,
    runningCount,
    settings,
  ] = await Promise.all([
    SeoNewsImageRegenerationJob.findOne({
      status: { $in: ["queued", "running"] },
    }).sort({ createdAt: 1 }),
    SeoNewsImageRegenerationJob.find({}).sort({ createdAt: -1 }).limit(8),
    getCachedHealth(forceHealthRefresh),
    SeoNewsImageRegenerationJob.countDocuments({ status: "queued" }),
    SeoNewsImageRegenerationJob.countDocuments({ status: "running" }),
    getSeoNewsImageRegenerationSettings(),
  ]);
  const intervalMs = getImageRegenerationIntervalMsFromSettings(settings);
  const paused = isImageRegenerationPaused(settings);

  const recentJobs = recentJobDocs.map((job) => serializeJob(job));
  const activeJob = serializeJob(activeJobDoc);

  return {
    aiHealth,
    activeJob,
    recentJobs,
    summary: {
      queued: queuedCount,
      running: runningCount,
      completed: recentJobs.filter((job) => job.status === "completed").length,
      failed: recentJobs.filter((job) => job.status === "failed").length,
      intervalMs,
      intervalSeconds: intervalMsToSeconds(intervalMs),
      isPaused: paused,
      maxItemsPerJob: IMAGE_REGEN_MAX_ITEMS_PER_JOB,
    },
  };
}

async function claimNextDueJob() {
  const now = new Date();
  const lockId = crypto.randomUUID();

  const job = await SeoNewsImageRegenerationJob.findOneAndUpdate(
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
        "worker.leaseExpiresAt": new Date(
          Date.now() + IMAGE_REGEN_WORKER_LEASE_MS
        ),
        "worker.lastHeartbeatAt": now,
      },
    },
    {
      sort: { nextRunAt: 1, createdAt: 1 },
      new: true,
    }
  );

  return job;
}

async function processClaimedJob(job) {
  const now = new Date();

  for (const item of job.items || []) {
    if (item.status === "processing") {
      item.status = "queued";
      item.error = item.error || "Recovered after stale worker lease";
      item.startedAt = null;
    }
  }

  if (!job.startedAt) {
    job.startedAt = now;
  }

  recalculateJobCounters(job);
  const nextItem = (job.items || []).find((item) => item.status === "queued");

  if (!nextItem) {
    job.currentItem = {
      articleId: null,
      slug: null,
      title: null,
      startedAt: null,
    };
    job.finishedAt = now;
    job.nextRunAt = null;
    job.status =
      Number(job.completedItems) > 0 || Number(job.skippedItems) > 0
        ? "completed"
        : "failed";
    clearWorkerLease(job);
    await job.save();
    return;
  }

  nextItem.status = "processing";
  nextItem.attempts = (Number(nextItem.attempts) || 0) + 1;
  nextItem.startedAt = now;
  nextItem.completedAt = null;
  nextItem.error = null;
  job.currentItem = {
    articleId: nextItem.articleId,
    slug: nextItem.slug,
    title: nextItem.title,
    startedAt: now,
  };
  job.worker.lastHeartbeatAt = now;
  recalculateJobCounters(job);
  await job.save();

  try {
    const result = await regenerateSeoNewsArticleImage({
      articleId: nextItem.articleId,
    });
    nextItem.status = "completed";
    nextItem.resultHeroImageUrl = result.heroImageUrl || null;
    nextItem.resultThumbImageUrl = result.thumbImageUrl || null;
    nextItem.resultImageOrigin = result.imageOrigin || "generated-gateway";
    nextItem.completedAt = new Date();
  } catch (error) {
    nextItem.status = "failed";
    nextItem.error = error?.message || "AI image regeneration failed";
    nextItem.completedAt = new Date();
    job.lastError = nextItem.error;
  }

  job.currentItem = {
    articleId: null,
    slug: null,
    title: null,
    startedAt: null,
  };
  job.lastProcessedAt = new Date();
  recalculateJobCounters(job);

  const hasMoreQueued = (job.items || []).some(
    (item) => item.status === "queued"
  );
  const itemIntervalMs = normalizeImageRegenerationIntervalMs(
    job?.request?.itemIntervalMs
  );
  if (hasMoreQueued) {
    job.status = "running";
    job.nextRunAt = new Date(Date.now() + itemIntervalMs);
  } else {
    job.finishedAt = new Date();
    job.nextRunAt = null;
    job.status =
      Number(job.completedItems) > 0 || Number(job.skippedItems) > 0
        ? "completed"
        : "failed";
  }

  clearWorkerLease(job);
  await job.save();
}

async function tickSeoNewsImageRegenerationWorker() {
  if (tickRunning) return;
  tickRunning = true;

  try {
    const settings = await getSeoNewsImageRegenerationSettings();
    if (isImageRegenerationPaused(settings)) return;

    const job = await claimNextDueJob();
    if (!job) return;
    await processClaimedJob(job);
  } catch (error) {
    console.error(
      "[SeoNewsImageQueue] worker tick failed:",
      error?.message || error
    );
  } finally {
    tickRunning = false;
  }
}

export function startSeoNewsImageRegenerationWorker() {
  if (queueWorkerTimer) return queueWorkerTimer;

  queueWorkerTimer = setInterval(() => {
    void tickSeoNewsImageRegenerationWorker();
  }, IMAGE_REGEN_WORKER_TICK_MS);

  void tickSeoNewsImageRegenerationWorker();
  console.log(
    `[SeoNewsImageQueue] worker started interval=${IMAGE_REGEN_WORKER_TICK_MS}ms itemInterval=${DEFAULT_IMAGE_REGEN_ITEM_INTERVAL_MS}ms maxItems=${IMAGE_REGEN_MAX_ITEMS_PER_JOB}`
  );

  return queueWorkerTimer;
}
