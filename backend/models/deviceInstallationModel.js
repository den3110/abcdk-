// models/DeviceInstallation.js
import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },
    deviceId: { type: String, required: true },
    platform: { type: String, enum: ["ios", "android"], required: true },
    appVersion: { type: String, default: "0.0.0" },
    buildNumber: { type: Number, default: 0 },
    pushToken: { type: String },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

schema.index({ deviceId: 1, platform: 1 }, { unique: true });
schema.index({ platform: 1, buildNumber: -1 });
export default mongoose.model("DeviceInstallation", schema);
