import mongoose from "mongoose";

const { Schema } = mongoose;

/* Giờ mở cửa theo ngày (override cấp sân; rỗng = kế thừa venue) */
const DayHoursSchema = new Schema(
  {
    closed: { type: Boolean, default: false },
    open: { type: String, default: "06:00" },
    close: { type: String, default: "22:00" },
  },
  { _id: false },
);

/**
 * Luật giá theo giờ/ngày.
 * - daysOfWeek: các thứ áp dụng (0=CN..6=T7); rỗng = mọi ngày
 * - start/end: khung giờ trong ngày "HH:MM" ([start, end))
 * - pricePerHour: giá theo giờ trong khung này
 */
const PriceRuleSchema = new Schema(
  {
    label: { type: String, default: "" },
    daysOfWeek: { type: [Number], default: [] },
    start: { type: String, default: "00:00" },
    end: { type: String, default: "24:00" },
    pricePerHour: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

/**
 * VenueCourt = một sân cụ thể trong Venue (cụm sân).
 */
const venueCourtSchema = new Schema(
  {
    venue: {
      type: Schema.Types.ObjectId,
      ref: "Venue",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    sport: { type: String, default: "pickleball" },

    // Bảng giá: ưu tiên priceRules khớp, không khớp thì defaultPricePerHour
    defaultPricePerHour: { type: Number, default: 0, min: 0 },
    priceRules: { type: [PriceRuleSchema], default: [] },

    // Giờ mở riêng cho sân; rỗng = kế thừa giờ của venue
    openHours: { type: [DayHoursSchema], default: [] },

    status: {
      type: String,
      enum: ["active", "maintenance"],
      default: "active",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

venueCourtSchema.index({ venue: 1, order: 1, createdAt: 1 });
venueCourtSchema.index({ venue: 1, isActive: 1 });

export default mongoose.model("VenueCourt", venueCourtSchema);
