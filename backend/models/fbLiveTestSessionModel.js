// models/fbLiveTestSessionModel.js
// Phiên "test live nhiều page cùng lúc" — lưu ở Mongo để trang admin list/stop
// được kể cả khi request rơi vào instance PM2 khác với instance đã spawn ffmpeg.
import mongoose from "mongoose";

const { Schema } = mongoose;

const fbLiveTestSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    pageId: { type: String, required: true, index: true },
    pageName: { type: String, default: "" },
    ownerName: { type: String, default: "" }, // tên tài khoản FB sở hữu page
    liveVideoId: { type: String, default: "" },
    permalinkUrl: { type: String, default: "" },
    status: {
      type: String,
      enum: ["starting", "live", "stopped", "error"],
      default: "starting",
      index: true,
    },
    error: { type: String, default: "" },
    hostPid: { type: Number, default: 0 }, // process đã spawn ffmpeg (best-effort)
    startedBy: { type: String, default: "" },
    startedAt: { type: Date, default: Date.now },
    stoppedAt: { type: Date, default: null },
    autoStopAt: { type: Date, default: null }, // tự dừng để không chạy vô hạn
  },
  { timestamps: true }
);

fbLiveTestSessionSchema.index({ status: 1, startedAt: -1 });

export default mongoose.models.FbLiveTestSession ||
  mongoose.model("FbLiveTestSession", fbLiveTestSessionSchema);
