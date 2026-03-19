import mongoose from "mongoose";

const SeoNewsImageRegenerationItemSchema = new mongoose.Schema(
  {
    articleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SeoNewsArticle",
      required: true,
    },
    slug: { type: String, required: true },
    title: { type: String, required: true },
    previousHeroImageUrl: { type: String, default: null },
    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed", "skipped"],
      default: "queued",
    },
    attempts: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error: { type: String, default: null },
    resultHeroImageUrl: { type: String, default: null },
    resultThumbImageUrl: { type: String, default: null },
    resultImageOrigin: { type: String, default: null },
  },
  { _id: false }
);

const SeoNewsImageRegenerationJobSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["regenerate_ai_images"],
      default: "regenerate_ai_images",
      index: true,
    },
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed", "cancelled"],
      default: "queued",
      index: true,
    },
    request: {
      imageFilter: { type: String, default: "" },
      origin: { type: String, default: "generated" },
      keyword: { type: String, default: "" },
      requestedLimit: { type: Number, default: 0 },
      maxItemsPerJob: { type: Number, default: 0 },
      itemIntervalMs: { type: Number, default: 0 },
    },
    requestedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, default: null },
      name: { type: String, default: "" },
      email: { type: String, default: "" },
    },
    totalItems: { type: Number, default: 0 },
    completedItems: { type: Number, default: 0 },
    failedItems: { type: Number, default: 0 },
    skippedItems: { type: Number, default: 0 },
    queuedItems: { type: Number, default: 0 },
    processingItems: { type: Number, default: 0 },
    currentItem: {
      articleId: { type: mongoose.Schema.Types.ObjectId, default: null },
      slug: { type: String, default: null },
      title: { type: String, default: null },
      startedAt: { type: Date, default: null },
    },
    nextRunAt: { type: Date, default: Date.now, index: true },
    startedAt: { type: Date, default: null },
    lastProcessedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    notes: [{ type: String }],
    worker: {
      lockId: { type: String, default: null },
      lockedBy: { type: String, default: null },
      hostname: { type: String, default: null },
      pid: { type: Number, default: null },
      lockedAt: { type: Date, default: null },
      leaseExpiresAt: { type: Date, default: null },
      lastHeartbeatAt: { type: Date, default: null },
    },
    items: {
      type: [SeoNewsImageRegenerationItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

SeoNewsImageRegenerationJobSchema.index({ status: 1, nextRunAt: 1, createdAt: 1 });

export default mongoose.model(
  "SeoNewsImageRegenerationJob",
  SeoNewsImageRegenerationJobSchema
);
