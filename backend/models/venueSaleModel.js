import mongoose from "mongoose";

const { Schema } = mongoose;

const saleItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "VenueProduct", default: null },
    name: { type: String, default: "" },
    price: { type: Number, default: 0, min: 0 },
    qty: { type: Number, default: 1, min: 1 },
    lineTotal: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

/** Đơn bán hàng tại quầy (có thể gắn vào 1 booking). */
const venueSaleSchema = new Schema(
  {
    venue: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    booking: { type: Schema.Types.ObjectId, ref: "Booking", default: null, index: true },
    items: { type: [saleItemSchema], default: [] },
    total: { type: Number, default: 0, min: 0 },
    paymentMethod: { type: String, enum: ["cash", "transfer"], default: "cash" },
    customerName: { type: String, default: "" },
    note: { type: String, default: "", maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

venueSaleSchema.index({ venue: 1, createdAt: -1 });

export default mongoose.model("VenueSale", venueSaleSchema);
