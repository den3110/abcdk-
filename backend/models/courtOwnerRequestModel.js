import mongoose from "mongoose";

const { Schema } = mongoose;

/** Yêu cầu trở thành chủ sân (user → admin duyệt → role courtOwner). */
const courtOwnerRequestSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    businessName: { type: String, default: "", trim: true, maxlength: 160 },
    phone: { type: String, default: "", trim: true, maxlength: 30 },
    address: { type: String, default: "", trim: true, maxlength: 300 },
    note: { type: String, default: "", maxlength: 500 },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectReason: { type: String, default: "", maxlength: 300 },
  },
  { timestamps: true },
);

courtOwnerRequestSchema.index({ user: 1, status: 1 });

export default mongoose.model("CourtOwnerRequest", courtOwnerRequestSchema);
