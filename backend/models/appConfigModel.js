// models/AppConfig.js
import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ["all", "ios", "android"],
      default: "all",
      unique: true,
    },
    latestVersion: { type: String, required: true }, // v.d "2.3.1" (hiển thị)
    latestBuild: { type: Number, required: true }, // v.d 20301 (khuyến nghị)
    minSupportedBuild: { type: Number, required: true }, // < => FORCE update
    storeUrl: { type: String }, // deep link App/Play Store
    rollout: {
      percentage: { type: Number, default: 100 }, // 0..100
      cohortKey: {
        type: String,
        enum: ["userId", "deviceId"],
        default: "deviceId",
      },
    },
    blockedBuilds: { type: [Number], default: [] }, // kill-switch build lỗi
    changelog: { type: String, default: "" }, // (tuỳ chọn) markdown/text
  },
  { timestamps: true }
);

export default mongoose.model("AppConfig", schema);
