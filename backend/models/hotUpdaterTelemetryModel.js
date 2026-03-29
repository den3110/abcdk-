import mongoose from "mongoose";

const hotUpdaterTelemetrySchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      index: true,
      sparse: true,
      trim: true,
    },
    platform: {
      type: String,
      enum: ["ios", "android"],
      required: true,
      index: true,
    },
    bundleId: {
      type: String,
      index: true,
      sparse: true,
      trim: true,
    },
    currentBundleId: {
      type: String,
      trim: true,
    },
    appVersion: {
      type: String,
      trim: true,
    },
    channel: {
      type: String,
      default: "production",
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        "checking",
        "up_to_date",
        "update_available",
        "dismissed",
        "downloading",
        "downloaded",
        "installing",
        "promoted",
        "recovered",
        "failed",
        "success",
        "skipped",
      ],
      required: true,
      index: true,
    },
    message: {
      type: String,
      default: "",
    },
    errorMessage: {
      type: String,
      default: "",
    },
    errorCode: {
      type: String,
      default: "",
    },
    duration: {
      type: Number,
    },
    deviceInfo: {
      deviceId: String,
      model: String,
      osVersion: String,
      brand: String,
    },
    ip: {
      type: String,
    },
    userAgent: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

hotUpdaterTelemetrySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
hotUpdaterTelemetrySchema.index({ platform: 1, status: 1, createdAt: -1 });
hotUpdaterTelemetrySchema.index({ platform: 1, bundleId: 1, createdAt: -1 });

export const HotUpdaterTelemetryEvent = mongoose.model(
  "HotUpdaterTelemetryEvent",
  hotUpdaterTelemetrySchema
);

export default HotUpdaterTelemetryEvent;
