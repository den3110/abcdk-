import mongoose from "mongoose";

const observerEventSchema = new mongoose.Schema(
  {
    source: { type: String, required: true, trim: true, index: true },
    category: { type: String, required: true, trim: true, index: true },
    type: { type: String, required: true, trim: true, index: true },
    level: { type: String, default: "info", trim: true, index: true },
    requestId: { type: String, default: "", trim: true, index: true },
    method: { type: String, default: "", trim: true },
    path: { type: String, default: "", trim: true, index: true },
    url: { type: String, default: "", trim: true },
    statusCode: { type: Number, default: null },
    durationMs: { type: Number, default: null },
    ip: { type: String, default: "", trim: true },
    tags: { type: [String], default: [] },
    occurredAt: { type: Date, required: true, index: true },
    receivedAt: { type: Date, default: Date.now, index: true },
    expireAt: { type: Date, required: true, index: { expires: 0 } },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    minimize: false,
    timestamps: true,
  }
);

observerEventSchema.index({ source: 1, type: 1, occurredAt: -1 });
observerEventSchema.index({ category: 1, level: 1, occurredAt: -1 });

export default mongoose.models.ObserverEvent ||
  mongoose.model("ObserverEvent", observerEventSchema);
