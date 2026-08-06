// models/coachApplicationModel.js
// Đơn đăng ký làm Huấn luyện viên. User submit → admin duyệt.
// Khi approved: set user.isCoach=true + coachProfile + import proposedAchievements
// thành CoachAchievement (status=approved).
import mongoose from "mongoose";

const { Schema } = mongoose;

const PROPOSED_ACH_SCHEMA = new Schema(
  {
    title: { type: String, required: true, maxlength: 200 },
    year: { type: Number, min: 1900, max: 2100 },
    level: {
      type: String,
      enum: ["national", "regional", "local", "club", "other"],
      default: "other",
    },
    description: { type: String, default: "", maxlength: 1000 },
  },
  { _id: false }
);

const coachApplicationSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
      index: true,
    },
    // Snapshot form fields at submission time
    headline: { type: String, default: "", maxlength: 200 },
    experienceYears: { type: Number, default: 0, min: 0, max: 100 },
    specialties: { type: [String], default: [] },
    hourlyRate: { type: Number, default: 0, min: 0 },
    bio: { type: String, default: "", maxlength: 2000 },
    phone: { type: String, default: "" },
    // Proposed achievements đi kèm đơn
    proposedAchievements: { type: [PROPOSED_ACH_SCHEMA], default: [] },
    // Note của user gửi admin
    note: { type: String, default: "", maxlength: 1000 },
    // Admin review
    adminNote: { type: String, default: "", maxlength: 1000 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// User chỉ có 1 đơn pending tại 1 thời điểm — không dùng unique index (cần cho phép
// nhiều đơn qua thời gian với các status khác nhau). Enforce ở controller.
coachApplicationSchema.index({ status: 1, createdAt: -1 });
coachApplicationSchema.index({ user: 1, status: 1 });

const CoachApplication =
  mongoose.models.CoachApplication ||
  mongoose.model("CoachApplication", coachApplicationSchema);

export default CoachApplication;
