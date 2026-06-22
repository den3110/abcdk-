import mongoose from "mongoose";

const CheckpointRequestSchema = new mongoose.Schema(
  {
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    deviceId: { type: String, default: "" },
    deviceName: { type: String, default: "" },
    reason: { type: String, default: "" },
  },
  { _id: false }
);

const CheckpointFactorSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      enum: ["phone_otp", "email_otp", "cccd_upload", "face_video"],
      required: true,
    },
    status: {
      type: String,
      enum: ["required", "sent", "passed", "submitted", "failed"],
      default: "required",
    },
    passedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
  },
  { _id: false }
);

const CheckpointEvidenceSchema = new mongoose.Schema(
  {
    factor: { type: String, default: "" },
    kind: { type: String, default: "" },
    url: { type: String, default: "" },
    filename: { type: String, default: "" },
    mimetype: { type: String, default: "" },
    size: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const CheckpointReviewSchema = new mongoose.Schema(
  {
    decision: {
      type: String,
      enum: ["", "approved", "rejected", "cancelled"],
      default: "",
    },
    note: { type: String, default: "" },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
  },
  { _id: false }
);

const checkpointSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    mandate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CheckpointMandate",
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ["login"],
      default: "login",
      index: true,
    },
    channel: {
      type: String,
      enum: ["web", "app", "unknown"],
      default: "web",
      index: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "passed",
        "failed",
        "expired",
        "cancelled",
        "review_required",
      ],
      default: "pending",
      index: true,
    },
    level: {
      type: Number,
      enum: [1, 2, 3],
      default: 1,
      index: true,
    },
    factors: { type: [CheckpointFactorSchema], default: [] },
    evidence: { type: [CheckpointEvidenceSchema], default: [] },
    risk: {
      score: { type: Number, default: 0 },
      rawScore: { type: Number, default: 0 },
      level: { type: Number, default: 1 },
      confidence: { type: String, default: "low" },
      reasons: { type: [String], default: [] },
      signals: { type: [mongoose.Schema.Types.Mixed], default: [] },
      dampeners: { type: [mongoose.Schema.Types.Mixed], default: [] },
      counters: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    tokenHash: { type: String, required: true, unique: true, index: true },
    codeHash: { type: String, default: "" },
    delivery: {
      method: {
        type: String,
        enum: ["zalo_otp", "email_otp"],
        default: "zalo_otp",
      },
      targetMasked: { type: String, default: "" },
      phone: { type: String, default: "" },
      tranId: { type: String, default: "" },
      cost: { type: Number, default: 0 },
      lastSentAt: { type: Date, default: null },
      sendCount: { type: Number, default: 0 },
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    expiresAt: { type: Date, required: true, index: true },
    codeExpiresAt: { type: Date, default: null },
    resendAvailableAt: { type: Date, default: null },
    passedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    trustExpiresAt: { type: Date, default: null, index: true },
    review: { type: CheckpointReviewSchema, default: () => ({}) },
    request: { type: CheckpointRequestSchema, default: () => ({}) },
  },
  { timestamps: true }
);

checkpointSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
checkpointSessionSchema.index({
  user: 1,
  type: 1,
  status: 1,
  "request.deviceId": 1,
  trustExpiresAt: -1,
});

export default mongoose.model("CheckpointSession", checkpointSessionSchema);
