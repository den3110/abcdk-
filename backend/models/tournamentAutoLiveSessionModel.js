// Session livestream tự động cho 1 court trong 1 giải: cam Imou → server ffmpeg
// → RTMP FB/YT/custom. Mỗi court chỉ có tối đa 1 session ACTIVE cùng lúc
// (unique partial index).
import mongoose from "mongoose";

const { Schema } = mongoose;

const destinationSchema = new Schema(
  {
    // fb | youtube | rtmp (custom)
    type: { type: String, enum: ["fb", "youtube", "rtmp"], required: true },
    label: { type: String, default: "" },
    // rtmp full URL (đã có key gộp) HOẶC rtmp base + streamKey riêng
    streamUrl: { type: String, required: true },
    streamKey: { type: String, default: "" },
    // Cho FB/YT: reference các bản ghi trong FbToken / YoutubeToken
    pageId: { type: String, default: "" },
    pageName: { type: String, default: "" },
    broadcastId: { type: String, default: "" },
    // Ẩn khi trả API để không lộ key
    _isSecret: { type: Boolean, default: true },
  },
  { _id: false }
);

const tournamentAutoLiveSessionSchema = new Schema(
  {
    tournament: { type: Schema.Types.ObjectId, ref: "Tournament", index: true, required: true },
    court: { type: Schema.Types.ObjectId, ref: "CourtStation", index: true, required: true },
    // Venue chứa cam Imou (nơi lấy imouCreds / imouSession đã mã hoá)
    venue: { type: Schema.Types.ObjectId, ref: "Venue", index: true, required: true },
    // Cam Imou đã gắn vào court — chọn cam nào (thường Toàn cảnh)
    imouDeviceId: { type: String, required: true },
    imouCamName: { type: String, default: "" },
    // User bấm Start (owner giải / staff)
    startedBy: { type: Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["starting", "live", "reconnecting", "paused", "stopped", "error"],
      default: "starting",
      index: true,
    },
    destinations: { type: [destinationSchema], default: [] },
    // Trận đang phát overlay — do orchestrator poll /next-match update
    currentMatch: { type: Schema.Types.ObjectId, ref: "Match", default: null },
    currentMatchLabel: { type: String, default: "" },
    // Tăng khi overlay data đổi — worker fetch PNG dùng ?v={version} để bust cache
    overlayVersion: { type: Number, default: 0 },
    // Metadata process Python
    workerId: { type: String, default: "" }, // uuid nội bộ
    workerPid: { type: Number, default: 0 },
    workerStartedAt: { type: Date, default: null },
    workerLastHeartbeatAt: { type: Date, default: null },
    // Stats
    startedAt: { type: Date, default: Date.now },
    stoppedAt: { type: Date, default: null },
    lastMatchChangeAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    lastErrorAt: { type: Date, default: null },
    // Auto behaviour
    autoNext: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// 1 court chỉ có 1 session không phải stopped
tournamentAutoLiveSessionSchema.index(
  { court: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["starting", "live", "reconnecting", "paused"] } },
  }
);
tournamentAutoLiveSessionSchema.index({ tournament: 1, status: 1 });

export default mongoose.model("TournamentAutoLiveSession", tournamentAutoLiveSessionSchema);
