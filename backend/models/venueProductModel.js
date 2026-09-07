import mongoose from "mongoose";

const { Schema } = mongoose;

/** Sản phẩm / dịch vụ bán tại cụm sân (nước, bóng, thuê vợt…). */
const venueProductSchema = new Schema(
  {
    venue: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, default: "khác", trim: true, maxlength: 40 }, // nước / bóng / thuê / khác
    price: { type: Number, required: true, min: 0 },
    unit: { type: String, default: "cái", maxlength: 20 },
    // Quản lý tồn kho (tắt cho dịch vụ như thuê vợt)
    trackStock: { type: Boolean, default: true },
    stock: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 5 },
    imageUrl: { type: String, default: "" },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

venueProductSchema.index({ venue: 1, active: 1, order: 1 });

export default mongoose.model("VenueProduct", venueProductSchema);
