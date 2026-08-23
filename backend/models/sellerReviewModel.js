// models/sellerReviewModel.js — đánh giá uy tín người bán trên Chợ
import mongoose from "mongoose";
const { Schema } = mongoose;

const sellerReviewSchema = new Schema(
  {
    seller: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reviewer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    listing: {
      type: Schema.Types.ObjectId,
      ref: "MarketListing",
      default: null,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "", maxlength: 1000 },
  },
  { timestamps: true }
);

// Mỗi người chỉ đánh giá 1 người bán 1 lần (cập nhật được)
sellerReviewSchema.index({ seller: 1, reviewer: 1 }, { unique: true });

const SellerReview =
  mongoose.models.SellerReview ||
  mongoose.model("SellerReview", sellerReviewSchema);

export default SellerReview;
