import mongoose from "mongoose";
import crypto from "crypto";

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
    subtotal: { type: Number, default: 0, min: 0 }, // trước giảm giá
    discountAmount: { type: Number, default: 0, min: 0 },
    promoCode: { type: String, default: "" },
    totalPrice: { type: Number, default: 0, min: 0 }, // sau giảm giá (số tiền phải trả)
    depositAmount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "VND" },

    // Đặt định kỳ (nhóm các lượt sinh cùng lần)
    recurringGroup: { type: String, default: "", index: true },

    // Thanh toán bằng gói giờ/thẻ tháng (thay vì QR)
    paidWithPackage: { type: Schema.Types.ObjectId, ref: "PackagePurchase", default: null },
    // Hoa hồng nền tảng chốt tại thời điểm thanh toán (đối soát)
    commissionAmount: { type: Number, default: 0, min: 0 },

    // pending: đã đặt, chưa gửi bill · awaiting_approval: đã gửi bill, chờ chủ sân duyệt
    status: {
      type: String,
      enum: ["pending", "awaiting_approval", "confirmed", "cancelled", "completed", "no_show"],
      default: "pending",
      index: true,
    },
    payment: {
      status: { type: String, enum: ["Unpaid", "Paid"], default: "Unpaid" },
      paidAt: { type: Date, default: null },
      method: { type: String, default: "bank_qr" },
      // Bill chuyển khoản khách gửi lên
      proofUrl: { type: String, default: "" },
      proofNote: { type: String, default: "" },
      proofAt: { type: Date, default: null },
      // Chủ sân duyệt / từ chối
      reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      reviewedAt: { type: Date, default: null },
      rejectReason: { type: String, default: "" },
    },

    // Vé điện tử: token in QR, chủ sân quét để check-in
    ticket: {
      token: { type: String, default: "", index: true },
      checkedInAt: { type: Date, default: null },
      checkedInBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    reminderSentAt: { type: Date, default: null },

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
  if (!this.ticket) this.ticket = {};
  if (!this.ticket.token) {
    this.ticket.token = crypto.randomBytes(16).toString("hex");
  }
  next();
});

export default mongoose.model("Booking", bookingSchema);
