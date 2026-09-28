import mongoose from "mongoose";

/**
 * Bundle metadata cho hot-updater self-host (thay Cloudflare D1).
 * _id = bundle id (uuidv7) do hot-updater sinh ra.
 * File .zip lưu trên đĩa VPS (xem hotUpdaterController), metadata lưu ở đây.
 * Tách biệt hoàn toàn với hệ OTA cũ (otaBundleModel / /api/ota).
 */
const hotUpdaterBundleSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // bundle id (uuidv7)
    platform: {
      type: String,
      enum: ["ios", "android"],
      required: true,
      index: true,
    },
    channel: { type: String, default: "production", index: true },
    targetAppVersion: { type: String, default: null },
    fingerprintHash: { type: String, default: null, index: true },
    enabled: { type: Boolean, default: true },
    shouldForceUpdate: { type: Boolean, default: false },
    fileHash: { type: String, default: "" },
    gitCommitHash: { type: String, default: null },
    message: { type: String, default: null },
    storageUri: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, versionKey: false },
);

hotUpdaterBundleSchema.index({ platform: 1, channel: 1, _id: -1 });

const HotUpdaterBundle = mongoose.model(
  "HotUpdaterBundle",
  hotUpdaterBundleSchema,
);

export default HotUpdaterBundle;
