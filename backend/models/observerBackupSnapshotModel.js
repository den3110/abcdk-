import mongoose from "mongoose";

const observerBackupSnapshotSchema = new mongoose.Schema(
  {
    source: { type: String, required: true, trim: true, index: true },
    scope: { type: String, required: true, trim: true, index: true },
    backupType: { type: String, default: "", trim: true, index: true },
    status: { type: String, default: "unknown", trim: true, index: true },
    capturedAt: { type: Date, required: true, index: true },
    receivedAt: { type: Date, default: Date.now, index: true },
    expireAt: { type: Date, required: true, index: { expires: 0 } },
    sizeBytes: { type: Number, default: null },
    durationMs: { type: Number, default: null },
    manifestUrl: { type: String, default: "", trim: true },
    checksum: { type: String, default: "", trim: true },
    note: { type: String, default: "", trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    minimize: false,
    timestamps: true,
  }
);

observerBackupSnapshotSchema.index({ source: 1, scope: 1, capturedAt: -1 });

export default mongoose.models.ObserverBackupSnapshot ||
  mongoose.model("ObserverBackupSnapshot", observerBackupSnapshotSchema);
