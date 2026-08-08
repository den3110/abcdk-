// models/nicknameChangeRequestModel.js
// Yêu cầu đổi biệt danh — user gửi, admin duyệt.
// Nếu bị từ chối: user vẫn giữ nickname cũ + cooldown KHÔNG bị consume.
import mongoose from "mongoose";

const { Schema } = mongoose;

const nicknameChangeRequestSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    oldNickname: { type: String, default: "", trim: true },
    newNickname: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
      index: true,
    },
    requestedAt: { type: Date, default: Date.now, index: true },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "", trim: true, maxlength: 500 },
    // Snapshot lúc request để admin thấy context
    snapshot: {
      name: { type: String, default: "" },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
      province: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

// Một user chỉ có 1 request pending tại 1 thời điểm.
nicknameChangeRequestSchema.index(
  { user: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  }
);
nicknameChangeRequestSchema.index({ status: 1, createdAt: -1 });

const NicknameChangeRequest =
  mongoose.models.NicknameChangeRequest ||
  mongoose.model("NicknameChangeRequest", nicknameChangeRequestSchema);

export default NicknameChangeRequest;
