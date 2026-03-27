import mongoose from "mongoose";

const stepSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed", "skipped"],
      default: "queued",
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    message: { type: String, default: "" },
    error: { type: String, default: "" },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const liveRecordingAiCommentaryJobSchema = new mongoose.Schema(
  {
    recording: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LiveRecordingV2",
      required: true,
      index: true,
    },
    match: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      required: true,
      index: true,
    },
    triggerMode: {
      type: String,
      enum: ["auto", "manual"],
      default: "manual",
      index: true,
    },
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed", "canceled"],
      default: "queued",
      index: true,
    },
    language: {
      type: String,
      enum: ["vi", "en"],
      default: "vi",
    },
    voicePreset: { type: String, default: "vi_male_pro" },
    tonePreset: { type: String, default: "professional" },
    mixMode: {
      type: String,
      enum: ["bed_duck", "narration_only"],
      default: "bed_duck",
    },
    sourceFingerprint: { type: String, required: true, index: true },
    settingsHash: { type: String, default: "" },
    progressPercent: { type: Number, default: 0 },
    currentStepKey: { type: String, default: null },
    currentStepLabel: { type: String, default: null },
    lastError: { type: String, default: "" },
    requestedBy: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      name: { type: String, default: "" },
      email: { type: String, default: "" },
    },
    scriptSegments: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    summary: {
      segmentCount: { type: Number, default: 0 },
      sceneCount: { type: Number, default: 0 },
      alignedSceneCount: { type: Number, default: 0 },
      visualMomentCount: { type: Number, default: 0 },
      keyframeCount: { type: Number, default: 0 },
      transcriptSnippetCount: { type: Number, default: 0 },
      renderedDurationSeconds: { type: Number, default: 0 },
    },
    analysisPreview: {
      sceneWindows: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
      },
      transcriptSnippets: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
      },
    },
    artifacts: {
      dubbedDriveFileId: { type: String, default: null },
      dubbedDriveRawUrl: { type: String, default: null },
      dubbedDrivePreviewUrl: { type: String, default: null },
      dubbedPlaybackUrl: { type: String, default: null },
      outputSizeBytes: { type: Number, default: 0 },
    },
    worker: {
      hostname: { type: String, default: null },
      pid: { type: Number, default: null },
      startedAt: { type: Date, default: null },
      lastHeartbeatAt: { type: Date, default: null },
    },
    steps: {
      type: [stepSchema],
      default: [],
    },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

liveRecordingAiCommentaryJobSchema.index({
  recording: 1,
  sourceFingerprint: 1,
  status: 1,
});

const LiveRecordingAiCommentaryJob = mongoose.model(
  "LiveRecordingAiCommentaryJob",
  liveRecordingAiCommentaryJobSchema
);

export default LiveRecordingAiCommentaryJob;
