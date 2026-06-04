import mongoose from "mongoose";

const { Schema } = mongoose;

/* Toạ độ địa điểm (tái dùng pattern locationGeo của tournament) */
const LocationGeoSchema = new Schema(
  {
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    displayName: { type: String, default: "" },
  },
  { _id: false },
);

/* Giờ mở cửa theo từng ngày trong tuần (0 = Chủ nhật … 6 = Thứ 7) */
const DayHoursSchema = new Schema(
  {
    closed: { type: Boolean, default: false },
    open: { type: String, default: "06:00" }, // "HH:MM"
    close: { type: String, default: "22:00" }, // "HH:MM"
  },
  { _id: false },
);

function defaultWeekHours() {
  return Array.from({ length: 7 }, () => ({
    closed: false,
    open: "06:00",
    close: "22:00",
  }));
}

/**
 * Venue = cụm sân / địa điểm do "chủ sân" (courtOwner) quản lý.
 * Độc lập hoàn toàn với Tournament/Court hiện có.
 */
const venueSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    managers: [{ type: Schema.Types.ObjectId, ref: "User" }],

    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, lowercase: true, index: true },
    description: { type: String, default: "" },
    phone: { type: String, default: "" },

    address: { type: String, default: "" },
    province: { type: String, default: "", index: true },
    locationGeo: { type: LocationGeoSchema, default: () => ({}) },

    images: { type: [String], default: [] },
    amenities: { type: [String], default: [] },
    sport: { type: String, default: "pickleball" },

    // Giờ mở mặc định của cụm; sân con kế thừa nếu không override
    openHours: { type: [DayHoursSchema], default: defaultWeekHours },
    // Bước đặt tối thiểu (phút) cho lưới giờ
    slotMinutes: { type: Number, default: 60, min: 15, max: 240 },

    // Giá mặc định/giờ (fallback nếu sân không có bảng giá riêng)
    defaultPricePerHour: { type: Number, default: 0, min: 0 },

    // Thông tin nhận thanh toán (QR chuyển khoản — giống đăng ký giải)
    bankShortName: { type: String, trim: true, default: "" },
    bankAccountNumber: {
      type: String,
      default: "",
      set: (v) => String(v || "").replace(/\D/g, ""),
    },
    bankAccountName: { type: String, trim: true, default: "", maxlength: 64 },
    // % đặt cọc khi đặt sân (0 = không yêu cầu cọc)
    depositPercent: { type: Number, default: 0, min: 0, max: 100 },

    status: {
      type: String,
      enum: ["active", "pending", "suspended"],
      default: "active",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

venueSchema.index({ province: 1, isActive: 1 });
venueSchema.index({ owner: 1, createdAt: -1 });

venueSchema.pre("save", function normalizeSlug(next) {
  if (!this.slug && this.name) {
    this.slug = String(this.name)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }
  next();
});

export default mongoose.model("Venue", venueSchema);
