// models/reviewModel.js — Đánh giá giải đấu / sân chơi (chung)
import mongoose from "mongoose";
const { Schema } = mongoose;

const reviewSchema = new Schema(
  {
    // Loại đối tượng được đánh giá
    targetType: {
      type: String,
      enum: ["tournament", "venue"],
      required: true,
      index: true,
    },
    // ID đối tượng: tournament._id, hoặc chuỗi định danh sân (venue key)
    targetId: { type: String, required: true, index: true },

    reviewer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Điểm tổng thể 1-5
    rating: { type: Number, required: true, min: 1, max: 5 },

    // Điểm theo tiêu chí (tuỳ chọn) — chỉ dùng cho giải đấu
    aspects: {
      organization: { type: Number, min: 1, max: 5, default: null }, // Tổ chức
      venue: { type: Number, min: 1, max: 5, default: null }, // Sân bãi
      value: { type: Number, min: 1, max: 5, default: null }, // Xứng đáng
    },

    comment: { type: String, default: "", maxlength: 1000 },

    // VĐV có thực sự tham gia giải (đăng ký hợp lệ) → gắn nhãn "Đã tham gia"
    verified: { type: Boolean, default: false },

    // Ẩn bởi admin (kiểm duyệt)
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Mỗi người chỉ đánh giá 1 đối tượng 1 lần (cập nhật được)
reviewSchema.index(
  { targetType: 1, targetId: 1, reviewer: 1 },
  { unique: true }
);
reviewSchema.index({ targetType: 1, targetId: 1, hidden: 1, createdAt: -1 });

const Review =
  mongoose.models.Review || mongoose.model("Review", reviewSchema);

export default Review;
