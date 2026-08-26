// models/clubDuesPaymentModel.js
// Ghi nhận 1 thành viên đã đóng phí cho 1 kỳ (periodKey: "2026-08" | "2026-Q3" | "2026")
import mongoose from "mongoose";

const ClubDuesPaymentSchema = new mongoose.Schema(
  {
    club: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      required: true,
      index: true,
    },
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    periodKey: { type: String, required: true, index: true },
    amount: { type: Number, default: 0, min: 0 },
    method: { type: String, default: "cash" },
    paidAt: { type: Date, default: Date.now },
    // Giao dịch thu tương ứng trong sổ quỹ (nếu có)
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: "ClubTransaction" },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Mỗi thành viên chỉ 1 bản ghi / kỳ
ClubDuesPaymentSchema.index({ club: 1, member: 1, periodKey: 1 }, { unique: true });

export default mongoose.model("ClubDuesPayment", ClubDuesPaymentSchema);
