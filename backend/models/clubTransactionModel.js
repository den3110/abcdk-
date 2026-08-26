// models/clubTransactionModel.js
// Giao dịch thu/chi của quỹ CLB
import mongoose from "mongoose";

export const TX_TYPES = ["income", "expense"]; // thu / chi
export const TX_METHODS = ["cash", "bank", "transfer", "momo", "other"];

const ClubTransactionSchema = new mongoose.Schema(
  {
    club: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      index: true,
      required: true,
    },
    type: { type: String, enum: TX_TYPES, required: true, index: true },
    // Số tiền (VND) — luôn dương; dấu do type quyết định
    amount: { type: Number, required: true, min: 0 },
    category: { type: String, default: "", trim: true, maxlength: 100 },
    description: { type: String, default: "", maxlength: 1000 },
    // Thời điểm phát sinh giao dịch (khác createdAt)
    occurredAt: { type: Date, required: true, index: true },
    method: { type: String, enum: TX_METHODS, default: "cash" },
    // Thành viên liên quan (VD: người đóng phí / người nhận) — tuỳ chọn
    member: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Ảnh chứng từ (tuỳ chọn)
    attachmentUrl: { type: String, default: "" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

ClubTransactionSchema.index({ club: 1, occurredAt: -1, _id: -1 });

export default mongoose.model("ClubTransaction", ClubTransactionSchema);
