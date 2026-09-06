import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Khoá slot 15' cho từng lượt đặt sân — unique (court, slotStart) đảm bảo
 * 2 request đồng thời không thể đặt trùng giờ (không cần transaction).
 * Xoá khi booking bị huỷ / không đến / hết hạn.
 */
const bookingSlotLockSchema = new Schema(
  {
    court: { type: Schema.Types.ObjectId, ref: "VenueCourt", required: true },
    slotStart: { type: Date, required: true },
    booking: { type: Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
  },
  { timestamps: false },
);

bookingSlotLockSchema.index({ court: 1, slotStart: 1 }, { unique: true });

export const LOCK_STEP_MIN = 15;

/** Các mốc slotStart (bước 15') trong [startAt, endAt). */
export function slotStartsBetween(startAt, endAt) {
  const out = [];
  const step = LOCK_STEP_MIN * 60 * 1000;
  for (let t = new Date(startAt).getTime(); t < new Date(endAt).getTime(); t += step) {
    out.push(new Date(t));
  }
  return out;
}

export default mongoose.model("BookingSlotLock", bookingSlotLockSchema);
