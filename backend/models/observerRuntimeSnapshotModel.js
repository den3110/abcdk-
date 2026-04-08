import mongoose from "mongoose";

const observerRuntimeSnapshotSchema = new mongoose.Schema(
  {
    source: { type: String, required: true, trim: true, index: true },
    capturedAt: { type: Date, required: true, index: true },
    receivedAt: { type: Date, default: Date.now, index: true },
    expireAt: { type: Date, required: true, index: { expires: 0 } },
    totals: { type: mongoose.Schema.Types.Mixed, default: {} },
    hotPaths: { type: mongoose.Schema.Types.Mixed, default: {} },
    process: { type: mongoose.Schema.Types.Mixed, default: {} },
    endpoints: { type: [mongoose.Schema.Types.Mixed], default: [] },
    recordingExport: { type: mongoose.Schema.Types.Mixed, default: {} },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    minimize: false,
    timestamps: true,
  }
);

observerRuntimeSnapshotSchema.index({ source: 1, capturedAt: -1 });

export default mongoose.models.ObserverRuntimeSnapshot ||
  mongoose.model("ObserverRuntimeSnapshot", observerRuntimeSnapshotSchema);
