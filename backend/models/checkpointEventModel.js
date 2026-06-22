import mongoose from "mongoose";

const checkpointEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    subjectUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    type: { type: String, required: true, index: true },
    category: {
      type: String,
      enum: [
        "auth",
        "admin_route",
        "spam",
        "abuse",
        "checkpoint",
        "client_signal",
        "rate_limit",
        "system",
      ],
      default: "system",
      index: true,
    },
    outcome: {
      type: String,
      enum: [
        "success",
        "failed",
        "denied",
        "blocked",
        "rate_limited",
        "suspicious",
        "observed",
      ],
      default: "observed",
      index: true,
    },
    severity: {
      type: String,
      enum: ["info", "low", "medium", "high", "critical"],
      default: "low",
    },
    weight: { type: Number, default: 1 },
    ip: { type: String, default: "", index: true },
    userAgent: { type: String, default: "" },
    deviceId: { type: String, default: "", index: true },
    deviceName: { type: String, default: "" },
    method: { type: String, default: "" },
    path: { type: String, default: "", index: true },
    routeGroup: { type: String, default: "", index: true },
    target: {
      type: { type: String, default: "" },
      id: { type: String, default: "" },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

checkpointEventSchema.index({ createdAt: -1 });
checkpointEventSchema.index({ user: 1, createdAt: -1 });
checkpointEventSchema.index({ ip: 1, createdAt: -1 });
checkpointEventSchema.index({ deviceId: 1, createdAt: -1 });
checkpointEventSchema.index({ category: 1, outcome: 1, createdAt: -1 });
checkpointEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 120 * 24 * 60 * 60 });

export default mongoose.model("CheckpointEvent", checkpointEventSchema);
