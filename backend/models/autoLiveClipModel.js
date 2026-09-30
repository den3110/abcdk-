// Clip từng trận cắt từ bản ghi (recording) của phiên auto-live "xuyên suốt".
// Luồng: worker desktop ghi segment MP4 local → ban đêm đẩy segment về server →
// server cắt [Match.startedAt → Match.finishedAt] (copy) → upload Google Drive
// (tái dùng uploadRecordingToDrive) → set Match.video. Mỗi trận 1 document.
import mongoose from "mongoose";

const { Schema } = mongoose;

const autoLiveClipSchema = new Schema(
  {
    session: {
      type: Schema.Types.ObjectId,
      ref: "TournamentAutoLiveSession",
      index: true,
      required: true,
    },
    tournament: { type: Schema.Types.ObjectId, ref: "Tournament", index: true },
    court: { type: Schema.Types.ObjectId, ref: "CourtStation" },
    match: { type: Schema.Types.ObjectId, ref: "Match", index: true, required: true },
    title: { type: String, default: "" },
    // Mốc thời gian tuyệt đối (wallclock) của trận trong bản ghi.
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    clipDurationSec: { type: Number, default: 0 },
    // pending: chờ đủ segment phủ [startAt,endAt] đã upload về server.
    // cutting: đang cắt bằng ffmpeg. uploading: đang đẩy Drive.
    // done/failed/skipped.
    status: {
      type: String,
      enum: ["pending", "cutting", "uploading", "done", "failed", "skipped"],
      default: "pending",
      index: true,
    },
    driveFileId: { type: String, default: "" },
    driveUrl: { type: String, default: "" }, // link xem (preview/playback)
    fileSizeBytes: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    lastAttemptAt: { type: Date, default: null },
    startedProcessingAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// 1 trận trong 1 phiên chỉ có 1 clip.
autoLiveClipSchema.index({ session: 1, match: 1 }, { unique: true });

export default mongoose.model("AutoLiveClip", autoLiveClipSchema);
