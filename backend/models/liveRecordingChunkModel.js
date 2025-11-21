// models/liveRecordingChunkModel.js
import mongoose from "mongoose";

const liveRecordingChunkSchema = new mongoose.Schema(
  {
    recording: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LiveRecording",
      required: true,
    },
    match: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      required: true,
    },

    chunkIndex: { type: Number, required: true }, // 0,1,2,...
    isFinal: { type: Boolean, default: false },

    filePath: { type: String, required: true }, // path trên server
    fileSizeBytes: { type: Number, default: 0 },
    fileSizeMB: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["uploaded", "processing", "merged", "deleted"],
      default: "uploaded",
    },
  },
  {
    timestamps: true,
  }
);

liveRecordingChunkSchema.index({ match: 1, chunkIndex: 1 }, { unique: true });

const LiveRecordingChunk = mongoose.model(
  "LiveRecordingChunk",
  liveRecordingChunkSchema
);
export default LiveRecordingChunk;
