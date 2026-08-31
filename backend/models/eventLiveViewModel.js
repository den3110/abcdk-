// models/eventLiveViewModel.js
// Thống kê lượt dùng tính năng "Xem live giải đấu" (web + app).
// Gộp 1 doc / (người dùng-hoặc-thiết bị) / ngày / nền tảng để bảng KHÔNG phình:
// - unique user/thiết bị = số doc (distinct identity)
// - tổng lượt mở = sum(count)
import mongoose from "mongoose";

const eventLiveViewSchema = new mongoose.Schema(
  {
    // "u:<userId>" nếu đã đăng nhập, ngược lại "d:<deviceId>"
    identity: { type: String, required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    deviceId: { type: String, default: "", trim: true },
    platform: {
      type: String,
      enum: ["web", "ios", "android", "unknown"],
      default: "unknown",
      index: true,
    },
    dayKey: { type: String, required: true, index: true }, // "YYYY-MM-DD" theo giờ VN
    count: { type: Number, default: 0 }, // tổng lượt mở trong ngày
    lastVideoId: { type: String, default: "", trim: true },
    firstAt: { type: Date, default: Date.now },
    lastAt: { type: Date, default: Date.now, index: true },
    // Tự dọn sau ~180 ngày
    expireAt: {
      type: Date,
      default: () => new Date(Date.now() + 180 * 24 * 3600 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true, minimize: false },
);

eventLiveViewSchema.index(
  { identity: 1, platform: 1, dayKey: 1 },
  { unique: true },
);
eventLiveViewSchema.index({ dayKey: 1, platform: 1 });

const EventLiveView =
  mongoose.models.EventLiveView ||
  mongoose.model("EventLiveView", eventLiveViewSchema);

export default EventLiveView;
