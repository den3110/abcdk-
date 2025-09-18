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

    // Phiên bản app/build
    appVersion: { type: String, default: "0.0.0" },
    buildNumber: { type: Number, default: 0 },

    // Push
    pushToken: { type: String },

    // Thông tin thiết bị (bổ sung)
    deviceName: { type: String, trim: true, maxlength: 120 }, // tên do user đặt
    deviceBrand: { type: String, trim: true, maxlength: 60 }, // Apple / Samsung / Google / ...
    deviceModel: { type: String, trim: true, maxlength: 120 }, // "Apple iPhone 15 Pro Max" / "Samsung SM-S918B"
    deviceModelName: { type: String, trim: true, maxlength: 120 }, // "iPhone 15 Pro Max" / "SM-S918B"
    deviceModelId: { type: String, trim: true, maxlength: 60 }, // iOS: "iPhone16,2" (nếu có)

    // Dấu thời gian
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

schema.index({ deviceId: 1, platform: 1 }, { unique: true });
schema.index({ platform: 1, buildNumber: -1 });
schema.index({ user: 1, lastSeenAt: -1 });

export default mongoose.model("DeviceInstallation", schema);
