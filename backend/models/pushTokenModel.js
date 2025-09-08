// src/models/pushTokenModel.js
import mongoose from "mongoose";
const { Schema } = mongoose;

const pushTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", index: true },
    token: { type: String, required: true, unique: true }, // ExponentPushToken[...]
    platform: {
      type: String,
      enum: ["ios", "android", "web"],
      default: "ios",
      index: true,
    },
    deviceId: { type: String, index: true }, // 👈 khóa nhận diện thiết bị
    appVersion: { type: String, default: null },
    enabled: { type: Boolean, default: true, index: true },
    lastError: { type: String, default: null },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Mỗi user + deviceId chỉ có 1 dòng → nếu token rotate, ta update vào dòng này
pushTokenSchema.index({ user: 1, deviceId: 1 }, { unique: true, sparse: true });

export default mongoose.models.PushToken ||
  mongoose.model("PushToken", pushTokenSchema);
