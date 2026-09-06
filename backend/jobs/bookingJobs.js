// jobs/bookingJobs.js — nhắc trước giờ chơi + tự huỷ đơn chưa thanh toán
import { agenda } from "./agenda.js";
import Booking from "../models/bookingModel.js";
import BookingSlotLock from "../models/bookingSlotLockModel.js";
import { notifyBooking } from "../services/bookingNotify.js";

export const BOOKING_REMIND_JOB = "booking.remind";
export const BOOKING_EXPIRE_JOB = "booking.expire-pending";
export const BOOKING_SETTLE_JOB = "booking.settle-past";
export const REMIND_BEFORE_MIN = 60;
export const PENDING_TTL_MIN = 30;
export const NO_SHOW_GRACE_MIN = 30;

/** Nhắc khách trước giờ chơi (lên lịch khi đơn được duyệt). */
agenda.define(BOOKING_REMIND_JOB, async (job, done) => {
  try {
    const { bookingId } = job.attrs.data || {};
    if (!bookingId) return done();
    const b = await Booking.findById(bookingId)
      .populate("venue", "name")
      .populate("court", "name")
      .lean();
    if (!b || b.status !== "confirmed" || b.reminderSentAt) return done();
    await notifyBooking("reminder", b, {
      venueName: b.venue?.name,
      courtName: b.court?.name,
    });
    await Booking.updateOne({ _id: bookingId }, { $set: { reminderSentAt: new Date() } });
    done();
  } catch (e) {
    done(e);
  }
});

/** Lên lịch nhắc cho 1 booking (idempotent theo bookingId). */
export async function scheduleBookingReminder(booking) {
  const at = new Date(new Date(booking.startAt).getTime() - REMIND_BEFORE_MIN * 60 * 1000);
  if (at.getTime() <= Date.now()) return;
  await agenda.cancel({ name: BOOKING_REMIND_JOB, "data.bookingId": String(booking._id) });
  await agenda.schedule(at, BOOKING_REMIND_JOB, { bookingId: String(booking._id) });
}

/** Huỷ đơn "pending" quá 30' chưa gửi bill → nhả slot cho người khác. */
agenda.define(BOOKING_EXPIRE_JOB, async (_job, done) => {
  try {
    const cutoff = new Date(Date.now() - PENDING_TTL_MIN * 60 * 1000);
    // Tính từ lần cập nhật cuối (bị từ chối bill thì có thêm 30' để gửi lại)
    const stale = await Booking.find({
      status: "pending",
      createdByRole: "customer",
      updatedAt: { $lt: cutoff },
    })
      .select("_id user code startAt venue court customerName totalPrice")
      .lean();
    for (const b of stale) {
      await Booking.updateOne(
        { _id: b._id, status: "pending" },
        { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: "Quá hạn thanh toán" } },
      );
      await BookingSlotLock.deleteMany({ booking: b._id });
      notifyBooking("expired", b).catch(() => {});
    }
    done();
  } catch (e) {
    done(e);
  }
});

/** Chốt các lượt đã qua giờ: check-in rồi → completed; không đến → no_show. */
agenda.define(BOOKING_SETTLE_JOB, async (_job, done) => {
  try {
    const cutoff = new Date(Date.now() - NO_SHOW_GRACE_MIN * 60 * 1000);
    const past = await Booking.find({
      status: "confirmed",
      endAt: { $lt: cutoff },
    })
      .select("_id ticket")
      .lean();
    for (const b of past) {
      const next = b.ticket?.checkedInAt ? "completed" : "no_show";
      await Booking.updateOne({ _id: b._id, status: "confirmed" }, { $set: { status: next } });
      await BookingSlotLock.deleteMany({ booking: b._id });
    }
    done();
  } catch (e) {
    done(e);
  }
});
