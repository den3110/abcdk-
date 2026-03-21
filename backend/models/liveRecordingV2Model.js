import mongoose from "mongoose";

const liveRecordingV2SegmentSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    objectKey: { type: String, required: true },
    uploadStatus: {
      type: String,
      enum: ["presigned", "uploading_parts", "uploaded", "failed", "aborted"],
      default: "presigned",
    },
    etag: { type: String, default: null },
    sizeBytes: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },
    isFinal: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: null },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    _id: false,
  }
);

const liveRecordingV2Schema = new mongoose.Schema(
  {
    match: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      required: true,
      index: true,
    },
    courtId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Court",
      default: null,
      index: true,
    },
    mode: {
      type: String,
      enum: ["STREAM_AND_RECORD", "RECORD_ONLY", "STREAM_ONLY"],
      required: true,
    },
    quality: { type: String, default: "" },
    recordingSessionId: {
      type: String,
      required: true,
      index: true,
      unique: true,
    },
    status: {
      type: String,
      enum: [
        "recording",
        "uploading",
        "pending_export_window",
        "exporting",
        "ready",
        "failed",
      ],
      default: "recording",
      index: true,
    },
    segments: {
      type: [liveRecordingV2SegmentSchema],
      default: [],
    },
    durationSeconds: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },
    r2TargetId: { type: String, default: null, index: true },
    r2BucketName: { type: String, default: null },
    r2ManifestKey: { type: String, default: null },
    r2Prefix: { type: String, default: null },
    driveFileId: { type: String, default: null },
    driveRawUrl: { type: String, default: null },
    drivePreviewUrl: { type: String, default: null },
    playbackUrl: { type: String, default: null },
    exportAttempts: { type: Number, default: 0 },
    finalizedAt: { type: Date, default: null },
    scheduledExportAt: { type: Date, default: null, index: true },
    readyAt: { type: Date, default: null },
    error: { type: String, default: null },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

liveRecordingV2Schema.index({ match: 1, createdAt: -1 });

const LiveRecordingV2 = mongoose.model(
  "LiveRecordingV2",
  liveRecordingV2Schema
);

export default LiveRecordingV2;
