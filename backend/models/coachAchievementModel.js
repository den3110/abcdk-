// models/coachAchievementModel.js
// Thành tích của HLV. Mỗi record là 1 thành tích riêng biệt.
// Status:
//  - pending: HLV tự bổ sung, chờ admin duyệt
//  - approved: đã duyệt, hiển thị công khai trên profile
//  - rejected: bị từ chối
// Nguồn:
//  - createdBy = user's own id → tự bổ sung
//  - createdBy = admin's id → admin thêm trực tiếp (auto-approved)
import mongoose from "mongoose";

const { Schema } = mongoose;

const coachAchievementSchema = new Schema(
  {
    coach: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, maxlength: 200 },
    year: { type: Number, min: 1900, max: 2100 },
    level: {
      type: String,
      enum: ["national", "regional", "local", "club", "other"],
      default: "other",
      index: true,
    },
    description: { type: String, default: "", maxlength: 1000 },
    // Link tham chiếu (optional)
    tournamentRef: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      default: null,
    },
    imageUrl: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    // Nguồn gốc bổ sung
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Từ application nào (nếu do approve app tạo ra)
    sourceApplication: {
      type: Schema.Types.ObjectId,
      ref: "CoachApplication",
      default: null,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    adminNote: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

coachAchievementSchema.index({ coach: 1, status: 1, year: -1 });
coachAchievementSchema.index({ status: 1, createdAt: -1 });

const CoachAchievement =
  mongoose.models.CoachAchievement ||
  mongoose.model("CoachAchievement", coachAchievementSchema);

export default CoachAchievement;
