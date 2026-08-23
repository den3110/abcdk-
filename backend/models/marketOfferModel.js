// models/marketOfferModel.js
// Đề nghị mua / trả giá cho một tin trên Chợ PickleTour.
import mongoose from "mongoose";

export const OFFER_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
];

const marketOfferSchema = new mongoose.Schema(
  {
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MarketListing",
      required: true,
      index: true,
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Giá đề nghị (VND). Với trao đổi có thể 0 kèm message mô tả.
    amount: { type: Number, default: 0, min: 0 },
    // Phân loại người mua chọn (nếu sản phẩm có nhiều loại)
    variantName: { type: String, default: "", trim: true, maxlength: 60 },
    message: { type: String, default: "", maxlength: 500 },
    status: { type: String, enum: OFFER_STATUSES, default: "pending", index: true },
  },
  { timestamps: true }
);

marketOfferSchema.index({ listing: 1, status: 1, createdAt: -1 });
marketOfferSchema.index({ buyer: 1, createdAt: -1 });

const MarketOffer =
  mongoose.models.MarketOffer ||
  mongoose.model("MarketOffer", marketOfferSchema);

export default MarketOffer;
