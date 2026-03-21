import mongoose from "mongoose";

const { Schema } = mongoose;

const pushDispatchSchema = new Schema(
  {
    sourceKind: {
      type: String,
      enum: ["admin_broadcast", "admin_direct", "system_event"],
      required: true,
      index: true,
    },
    eventName: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed", "skipped"],
      required: true,
      default: "queued",
      index: true,
    },
    triggeredBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    payload: {
      title: { type: String, default: "" },
      body: { type: String, default: "" },
      url: { type: String, default: "" },
      badge: { type: Number, default: null },
      ttl: { type: Number, default: null },
    },
    target: {
      scope: { type: String, default: "" },
      topicType: { type: String, default: "" },
      topicId: { type: String, default: "" },
      userId: { type: String, default: "" },
      filters: { type: Schema.Types.Mixed, default: {} },
      audienceCount: { type: Number, default: 0 },
    },
    context: {
      type: Schema.Types.Mixed,
      default: {},
    },
    progress: {
      totalTokens: { type: Number, default: 0 },
      processedTokens: { type: Number, default: 0 },
      processedBatches: { type: Number, default: 0 },
      totalBatches: { type: Number, default: 0 },
    },
    summary: {
      tokens: { type: Number, default: 0 },
      ticketOk: { type: Number, default: 0 },
      ticketError: { type: Number, default: 0 },
      receiptOk: { type: Number, default: 0 },
      receiptError: { type: Number, default: 0 },
      disabledTokens: { type: Number, default: 0 },
      errorBreakdown: { type: Schema.Types.Mixed, default: {} },
      byPlatform: { type: Schema.Types.Mixed, default: {} },
      platforms: { type: [String], default: [] },
    },
    sampleFailures: {
      type: [
        {
          stage: { type: String, default: "" },
          token: { type: String, default: "" },
          platform: { type: String, default: "" },
          error: { type: String, default: "" },
          message: { type: String, default: "" },
        },
      ],
      default: [],
    },
    queueJobName: { type: String, default: "" },
    queueJobId: { type: String, default: "" },
    note: { type: String, default: "" },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    lastProgressAt: { type: Date, default: null },
  },
  { timestamps: true }
);

pushDispatchSchema.index({ sourceKind: 1, createdAt: -1 });
pushDispatchSchema.index({ eventName: 1, createdAt: -1 });
pushDispatchSchema.index({ "target.userId": 1, createdAt: -1 });

export default mongoose.models.PushDispatch ||
  mongoose.model("PushDispatch", pushDispatchSchema);
