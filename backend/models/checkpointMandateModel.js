import mongoose from "mongoose";

const checkpointMandateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    level: {
      type: Number,
      enum: [1, 2, 3],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "consumed", "cancelled", "expired"],
      default: "active",
      index: true,
    },
    scope: {
      type: String,
      enum: ["next_login"],
      default: "next_login",
      index: true,
    },
    reason: { type: String, default: "" },
    note: { type: String, default: "" },
    expiresAt: { type: Date, required: true, index: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancelledAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    consumedBySession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CheckpointSession",
      default: null,
    },
  },
  { timestamps: true }
);

checkpointMandateSchema.index({ user: 1, status: 1, expiresAt: 1 });
checkpointMandateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model("CheckpointMandate", checkpointMandateSchema);
