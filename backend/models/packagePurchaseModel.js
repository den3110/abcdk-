import mongoose from "mongoose";

const { Schema } = mongoose;

/** Lượt mua gói giờ/thẻ tháng của 1 user tại 1 cụm sân. */
const packagePurchaseSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    venue: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    package: { type: Schema.Types.ObjectId, ref: "VenuePackage", required: true },
    packageName: { type: String, default: "" },
    type: { type: String, enum: ["credits", "period"], default: "credits" },
    // credits: số giờ còn lại (theo phút để chính xác)
    minutesTotal: { type: Number, default: 0 },
    minutesRemaining: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    // chủ sân xác nhận đã nhận tiền
    status: { type: String, enum: ["pending", "active", "expired", "cancelled"], default: "pending", index: true },
    activatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    proofUrl: { type: String, default: "" },
  },
  { timestamps: true },
);

packagePurchaseSchema.index({ user: 1, venue: 1, status: 1 });

export default mongoose.model("PackagePurchase", packagePurchaseSchema);
