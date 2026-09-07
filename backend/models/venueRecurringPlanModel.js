import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Kế hoạch lịch cố định (1 series = nhiều Booking chung recurringGroup).
 * Lưu cấu hình để TỰ ĐỘNG GIA HẠN theo chu kỳ tháng cho tới khi chủ sân "kết thúc".
 */
const venueRecurringPlanSchema = new Schema(
  {
    venue: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    court: { type: Schema.Types.ObjectId, ref: "VenueCourt", required: true },
    group: { type: String, required: true, unique: true, index: true }, // = recurringGroup của các booking

    daysOfWeek: { type: [Number], default: [] }, // 0=CN..6=T7
    start: { type: String, default: "17:00" },
    end: { type: String, default: "19:00" },

    priceMode: { type: String, enum: ["auto", "custom", "total"], default: "auto" },
    pricePerSession: { type: Number, default: 0 },
    totalPackagePrice: { type: Number, default: 0 }, // trọn gói cho MỖI chu kỳ gia hạn
    markPaid: { type: Boolean, default: false },
    paymentMethod: { type: String, default: "cash" },

    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    note: { type: String, default: "" },

    autoRenew: { type: Boolean, default: false },
    renewEveryMonths: { type: Number, default: 1, min: 1, max: 12 },
    lastGeneratedTo: { type: String, default: "" }, // "YYYY-MM-DD" — đã tạo buổi tới ngày này
    lastRenewedAt: { type: Date, default: null },

    status: { type: String, enum: ["active", "ended"], default: "active", index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export default mongoose.model("VenueRecurringPlan", venueRecurringPlanSchema);
