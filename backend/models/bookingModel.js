import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Booking = một lượt đặt sân theo khung giờ.
 * Chống trùng: cùng court, status pending/confirmed, [startAt,endAt) giao nhau.
 */
const bookingSchema = new Schema(
  {
    code: { type: String, index: true },

    venue: {
      type: Schema.Types.ObjectId,
      ref: "Venue",
      required: true,
      index: true,
    },
    court: {
      type: Schema.Types.ObjectId,
      ref: "VenueCourt",
      required: true,
      index: true,
    },

    // Khách hàng (nếu đăng nhập); có thể null khi chủ sân đặt hộ khách vãng lai
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },

    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    durationMin: { type: Number, required: true, min: 0 },

    pricePerHour: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 0, min: 0 },
    depositAmount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "VND" },

    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "completed", "no_show"],
      default: "pending",
      index: true,
    },
    payment: {
      status: { type: String, enum: ["Unpaid", "Paid"], default: "Unpaid" },
      paidAt: { type: Date, default: null },
    },

    note: { type: String, default: "" },
    createdByRole: {
      type: String,
      enum: ["customer", "owner", "admin"],
      default: "customer",
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: "" },
  },
  { timestamps: true },
);

// Truy vấn chống trùng giờ + dựng lưới lịch
bookingSchema.index({ court: 1, startAt: 1, endAt: 1 });
bookingSchema.index({ venue: 1, startAt: 1 });
bookingSchema.index({ user: 1, startAt: -1 });

bookingSchema.pre("save", function genCode(next) {
  if (!this.code) {
    this.code = "BK" + String(this._id).slice(-6).toUpperCase();
  }
  next();
});

export default mongoose.model("Booking", bookingSchema);
