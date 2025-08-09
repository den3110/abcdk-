import mongoose from "mongoose";

const tournamentSchema = new mongoose.Schema(
  {
    /* Thông tin cơ bản */
    name: { type: String, required: true },
    image: {
      type: String,
      default: null,
      required: true,
    },
    sportType: { type: Number, required: true }, // 1 Pickleball, 2 Tennis …
    groupId: { type: Number, default: 0 },

    /* Cấu hình đăng ký & giới hạn điểm */
    regOpenDate: {
      type: Date,
      required: true,
      default: Date.now, // ✅ mặc định hôm nay
    },
    registrationDeadline: {
      type: Date,
      required: true,
      default: Date.now, // ✅
    },
    startDate: {
      type: Date,
      required: true,
      default: Date.now, // ✅
    },
    endDate: {
      type: Date,
      required: true,
      default: Date.now, // ✅
    },
    eventType: {
      type: String,
      enum: ["single", "double"],
      default: "double",
    },
    scoreCap: { type: Number, required: true, default: 0 }, // Tổng điểm đôi
    scoreGap: { type: Number, required: true, default: 0 }, // Chênh lệch đôi
    singleCap: { type: Number, required: true, default: 0 }, // Điểm tối đa 1 VĐV

    /* Thống kê */
    registered: { type: Number, default: 0 },
    expected: { type: Number, default: 0 },
    matchesCount: { type: Number, default: 0 },

    /* Trạng thái & mô tả */
    status: {
      type: String,
      enum: ["upcoming", "ongoing", "finished"], // ✅ EN values
      default: "upcoming",
    },
    location: { type: String, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    contactHtml: { type: String, default: "" },
    contentHtml: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Tournament", tournamentSchema);
