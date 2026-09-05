// models/eventLivePresenceModel.js
// Phiên xem live — ghi nhận thời gian bắt đầu/kết thúc để tính duration.
// Mỗi lần user mở trang live = 1 doc. Heartbeat cập nhật lastActiveAt.
import mongoose from "mongoose";

const { Schema } = mongoose;

const eventLivePresenceSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    socketId: { type: String, required: true, index: true },
    platform: {
      type: String,
      enum: ["web", "ios", "android", "unknown"],
      default: "unknown",
    },
    // Khi nào bắt đầu xem
    joinedAt: { type: Date, default: Date.now, index: true },
    // Heartbeat cuối cùng — dùng để tính duration nếu disconnect mất tín hiệu
    lastActiveAt: { type: Date, default: Date.now },
    // Khi nào rời đi (null = đang xem)
    leftAt: { type: Date, default: null, index: true },
    // Tính sẵn duration (giây) khi kết thúc phiên
    durationSec: { type: Number, default: 0, min: 0 },
    // Tự dọn sau 180 ngày
    expireAt: {
      type: Date,
      default: () => new Date(Date.now() + 180 * 24 * 3600 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true, minimize: false },
);

// Đang xem (chưa rời đi)
eventLivePresenceSchema.index({ leftAt: 1, user: 1 });

const EventLivePresence =
  mongoose.models.EventLivePresence ||
  mongoose.model("EventLivePresence", eventLivePresenceSchema);

export default EventLivePresence;
