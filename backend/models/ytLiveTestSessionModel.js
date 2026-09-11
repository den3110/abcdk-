// models/ytLiveTestSessionModel.js
// Phiên "test live YouTube nhiều luồng cùng lúc" (mỗi luồng 1 broadcast + liveStream riêng).
// Lưu Mongo để list/stop hoạt động cả khi PM2 cluster ×2.
import mongoose from "mongoose";

const { Schema } = mongoose;

const ytLiveTestSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    broadcastId: { type: String, default: "", index: true },
    streamId: { type: String, default: "" },
    title: { type: String, default: "" },
    permalinkUrl: { type: String, default: "" },
    status: {
      type: String,
      enum: ["starting", "live", "stopped", "error"],
      default: "starting",
      index: true,
    },
    error: { type: String, default: "" },
    hostPid: { type: Number, default: 0 },
    startedBy: { type: String, default: "" },
    startedAt: { type: Date, default: Date.now },
    stoppedAt: { type: Date, default: null },
    autoStopAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ytLiveTestSessionSchema.index({ status: 1, startedAt: -1 });

export default mongoose.models.YtLiveTestSession ||
  mongoose.model("YtLiveTestSession", ytLiveTestSessionSchema);
