// models/eventLiveCommentModel.js
// Bình luận realtime khi xem live giải đấu. 1 doc = 1 tin nhắn.
import mongoose from "mongoose";

const { Schema } = mongoose;

const eventLiveCommentSchema = new Schema(
  {
    // Người gửi (bắt buộc đăng nhập)
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Nội dung text thuần (không media — giữ đơn giản như live chat)
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    // Platform gửi
    platform: {
      type: String,
      enum: ["web", "ios", "android", "unknown"],
      default: "unknown",
    },
    // Soft-delete (admin moderate)
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    // Tự dọn sau 90 ngày
    expireAt: {
      type: Date,
      default: () => new Date(Date.now() + 90 * 24 * 3600 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true, minimize: false },
);

// Truy vấn chưa xoá, mới nhất trước (cursor pagination)
eventLiveCommentSchema.index({ deletedAt: 1, createdAt: -1 });

const EventLiveComment =
  mongoose.models.EventLiveComment ||
  mongoose.model("EventLiveComment", eventLiveCommentSchema);

export default EventLiveComment;
