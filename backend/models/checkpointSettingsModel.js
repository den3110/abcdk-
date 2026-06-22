import mongoose from "mongoose";

const ruleSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    category: { type: String, default: "system" },
    threshold: { type: Number, default: 1 },
    points: { type: Number, default: 0 },
    levelHint: { type: Number, default: 1 },
    window: { type: String, default: "" },
    reason: { type: String, default: "" },
  },
  { _id: false }
);

const dampenerSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    threshold: { type: Number, default: 1 },
    points: { type: Number, default: 0 },
    reason: { type: String, default: "" },
  },
  { _id: false }
);

const allowlistEntrySchema = new mongoose.Schema(
  {
    value: { type: String, default: "", trim: true },
    reason: { type: String, default: "" },
    expiresAt: { type: Date, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const checkpointSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "checkpoint-engine" },
    enabled: { type: Boolean, default: true },
    roleBypassEnabled: { type: Boolean, default: true },
    manualReviewLevel: { type: Number, default: 3 },
    sessionTtlMinutes: { type: Number, default: 30 },
    codeTtlMinutes: { type: Number, default: 5 },
    resendCooldownSeconds: { type: Number, default: 60 },
    trustDays: { type: Number, default: 15 },
    maxAttempts: { type: Number, default: 5 },
    primaryContactPriority: {
      type: [String],
      default: () => ["email_otp", "phone_otp"],
    },
    thresholds: {
      level1Score: { type: Number, default: 25 },
      level2Score: { type: Number, default: 55 },
      level3Score: { type: Number, default: 85 },
      minSignalsForLevel1: { type: Number, default: 2 },
      minCategoriesForLevel2: { type: Number, default: 2 },
      minCategoriesForLevel3: { type: Number, default: 3 },
    },
    hardSignals: {
      checkpointFailedWeek: { type: Number, default: 8 },
      abuseWeek: { type: Number, default: 2 },
      criticalMonth: { type: Number, default: 1 },
      authFailedDay: { type: Number, default: 20 },
      rateLimitedDay: { type: Number, default: 8 },
    },
    rules: {
      authFailedDay: { type: ruleSchema, default: undefined },
      authFailedDayBurst: { type: ruleSchema, default: undefined },
      authFailedWeek: { type: ruleSchema, default: undefined },
      adminDeniedDay: { type: ruleSchema, default: undefined },
      adminDeniedWeek: { type: ruleSchema, default: undefined },
      spamHour: { type: ruleSchema, default: undefined },
      spamDay: { type: ruleSchema, default: undefined },
      rateLimitedDay: { type: ruleSchema, default: undefined },
      checkpointFailedWeek: { type: ruleSchema, default: undefined },
      abuseWeek: { type: ruleSchema, default: undefined },
      clientSuspiciousDay: { type: ruleSchema, default: undefined },
      criticalMonth: { type: ruleSchema, default: undefined },
    },
    dampeners: {
      authSuccessWeek: { type: dampenerSchema, default: undefined },
      checkpointPassedMonth: { type: dampenerSchema, default: undefined },
      verifiedIdentity: { type: dampenerSchema, default: undefined },
      agedAccount: { type: dampenerSchema, default: undefined },
    },
    allowlist: {
      enabled: { type: Boolean, default: true },
      users: { type: [allowlistEntrySchema], default: [] },
      emails: { type: [allowlistEntrySchema], default: [] },
      phones: { type: [allowlistEntrySchema], default: [] },
      deviceIds: { type: [allowlistEntrySchema], default: [] },
      ips: { type: [allowlistEntrySchema], default: [] },
    },
    review: {
      requireNoteOnReject: { type: Boolean, default: true },
      extendPendingMinutesOnApprove: { type: Number, default: 10 },
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, strict: true }
);

export default mongoose.model("CheckpointSettings", checkpointSettingsSchema);
