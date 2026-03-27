import mongoose from "mongoose";

const SeoNewsPipelineJobStepSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    type: {
      type: String,
      enum: ["pipeline_round", "pending_candidates", "create_ready_articles"],
      required: true,
    },
    label: { type: String, required: true },
    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed", "skipped"],
      default: "queued",
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    message: { type: String, default: "" },
    error: { type: String, default: "" },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: false }
);

const SeoNewsPipelineJobSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["pipeline", "pending_candidates", "create_ready_articles"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed", "cancelled"],
      default: "queued",
      index: true,
    },
    request: {
      discoveryMode: { type: String, default: "" },
      rounds: { type: Number, default: 1 },
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 0 },
      forcePublish: { type: Boolean, default: false },
    },
    requestedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, default: null },
      name: { type: String, default: "" },
      email: { type: String, default: "" },
    },
    totalSteps: { type: Number, default: 0 },
    completedSteps: { type: Number, default: 0 },
    failedSteps: { type: Number, default: 0 },
    skippedSteps: { type: Number, default: 0 },
    queuedSteps: { type: Number, default: 0 },
    processingSteps: { type: Number, default: 0 },
    currentStep: {
      index: { type: Number, default: null },
      label: { type: String, default: null },
      type: { type: String, default: null },
      startedAt: { type: Date, default: null },
    },
    summary: {
      externalGenerated: { type: Number, default: 0 },
      evergreenGenerated: { type: Number, default: 0 },
      reviewPassed: { type: Number, default: 0 },
      reviewFailed: { type: Number, default: 0 },
      published: { type: Number, default: 0 },
      draft: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    startedAt: { type: Date, default: null },
    lastProcessedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: Date.now, index: true },
    lastError: { type: String, default: "" },
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
    steps: {
      type: [SeoNewsPipelineJobStepSchema],
      default: [],
    },
  },
  { timestamps: true }
);

SeoNewsPipelineJobSchema.index({ status: 1, nextRunAt: 1, createdAt: 1 });

export default mongoose.model("SeoNewsPipelineJob", SeoNewsPipelineJobSchema);
