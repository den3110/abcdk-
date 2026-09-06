import mongoose from "mongoose";

const { Schema } = mongoose;

/** Mã giảm giá theo cụm sân. */
const promoCodeSchema = new Schema(
  {
    venue: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    type: { type: String, enum: ["percent", "amount"], default: "percent" },
    value: { type: Number, required: true, min: 0 }, // percent: 0-100; amount: VND
    maxDiscount: { type: Number, default: 0, min: 0 }, // trần giảm cho type percent (0 = không giới hạn)
    minTotal: { type: Number, default: 0, min: 0 }, // tổng tối thiểu để áp dụng
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    usageLimit: { type: Number, default: 0, min: 0 }, // 0 = không giới hạn
    usedCount: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

promoCodeSchema.index({ venue: 1, code: 1 }, { unique: true });

/** Tính số tiền giảm cho 1 tổng tiền; trả { ok, discount, reason }. */
promoCodeSchema.methods.computeDiscount = function computeDiscount(total) {
  const now = Date.now();
  if (!this.active) return { ok: false, discount: 0, reason: "Mã không còn hiệu lực" };
  if (this.startAt && now < new Date(this.startAt).getTime())
    return { ok: false, discount: 0, reason: "Mã chưa tới ngày áp dụng" };
  if (this.endAt && now > new Date(this.endAt).getTime())
    return { ok: false, discount: 0, reason: "Mã đã hết hạn" };
  if (this.usageLimit > 0 && this.usedCount >= this.usageLimit)
    return { ok: false, discount: 0, reason: "Mã đã hết lượt sử dụng" };
  if (total < (this.minTotal || 0))
    return { ok: false, discount: 0, reason: `Đơn tối thiểu ${this.minTotal.toLocaleString("vi-VN")}đ` };

  let discount =
    this.type === "percent" ? Math.round((total * this.value) / 100) : this.value;
  if (this.type === "percent" && this.maxDiscount > 0) discount = Math.min(discount, this.maxDiscount);
  discount = Math.min(discount, total);
  return { ok: true, discount, reason: "" };
};

export default mongoose.model("PromoCode", promoCodeSchema);
