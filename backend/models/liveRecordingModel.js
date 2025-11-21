// models/liveRecordingModel.js
import mongoose from "mongoose";

const liveRecordingSchema = new mongoose.Schema(
  {
    match: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      required: true,
    },

    // tổng chunk đã upload
    totalChunks: { type: Number, default: 0 },
    totalSizeMB: { type: Number, default: 0 },

    // file cuối cùng sau khi merge (nếu có dùng worker để merge)
    finalFilePath: { type: String },
    finalFileSizeMB: { type: Number },
    finalDurationSeconds: { type: Number },

    // recording | merging | ready | failed
    status: {
      type: String,
      enum: ["recording", "merging", "ready", "failed"],
      default: "recording",
    },

    // flag để biết đã nhận chunk final chưa (isFinal:true)
    hasFinalChunk: { type: Boolean, default: false },

    // metadata phụ
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

const LiveRecording = mongoose.model("LiveRecording", liveRecordingSchema);
export default LiveRecording;
