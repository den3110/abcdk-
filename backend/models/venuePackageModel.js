import mongoose from "mongoose";

const { Schema } = mongoose;

/** Gói giờ / thẻ tháng do chủ sân bán. */
const venuePackageSchema = new Schema(
  {
    venue: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // credits: mua N giờ chơi (trừ theo giờ khi đặt); period: chơi không giới hạn trong X ngày
    type: { type: String, enum: ["credits", "period"], default: "credits" },
    hours: { type: Number, default: 0, min: 0 }, // với credits: tổng số giờ
    validDays: { type: Number, default: 30, min: 1 }, // hạn dùng kể từ khi mua
    price: { type: Number, required: true, min: 0 },
    description: { type: String, default: "", maxlength: 500 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

venuePackageSchema.index({ venue: 1, active: 1 });

export default mongoose.model("VenuePackage", venuePackageSchema);
