import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import Venue from "../models/venueModel.js";
import VenueCourt from "../models/venueCourtModel.js";
import Booking from "../models/bookingModel.js";
import BookingSlotLock, { slotStartsBetween } from "../models/bookingSlotLockModel.js";
import { canManageVenue } from "../utils/venueAuth.js";
import { bookingBankInfo } from "../utils/bankQr.js";
import { notifyBooking } from "../services/bookingNotify.js";
import { scheduleBookingReminder } from "../jobs/bookingJobs.js";
import {
  parseHHMM,
  minutesToHHMM,
  isValidDateStr,
  weekdayOf,
  buildInstant,
  getDayHours,
  computeBookingPrice,
} from "../utils/venueBooking.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const ACTIVE_STATUSES = ["pending", "awaiting_approval", "confirmed"];
const VENUE_PUBLIC_FIELDS =
  "name address province phone images bankShortName bankAccountNumber bankAccountName depositPercent";
const isDupKey = (e) =>
  e?.code === 11000 ||
  (Array.isArray(e?.writeErrors) && e.writeErrors.some((w) => w?.code === 11000));
const DAY_MS = 24 * 60 * 60 * 1000;

/* ===================== AVAILABILITY (lưới trống) ===================== */

/** GET /api/venues/:id/availability?date=YYYY-MM-DD */
export const getAvailability = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const date = String(req.query.date || "").trim();
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  if (!isValidDateStr(date)) {
    res.status(400);
    throw new Error("Ngày không hợp lệ (YYYY-MM-DD)");
  }

  const venue = await Venue.findById(id).lean();
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy cụm sân");
  }
  const courts = await VenueCourt.find({ venue: id, isActive: true })
    .sort({ order: 1, createdAt: 1 })
    .lean();

  const weekday = weekdayOf(date);
  const slot = Math.max(15, Number(venue.slotMinutes) || 60);
  const dayStart = buildInstant(date, "00:00");
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const now = new Date();

  const courtIds = courts.map((c) => c._id);
  const bookings = courtIds.length
    ? await Booking.find({
        court: { $in: courtIds },
        status: { $in: ACTIVE_STATUSES },
        startAt: { $lt: dayEnd },
        endAt: { $gt: dayStart },
      })
        .select("court startAt endAt status")
        .lean()
    : [];

  const byCourt = new Map();
  for (const b of bookings) {
    const key = String(b.court);
    if (!byCourt.has(key)) byCourt.set(key, []);
    byCourt.get(key).push(b);
  }

  const result = courts.map((court) => {
    const day = getDayHours(venue, court, weekday);
    const existing = byCourt.get(String(court._id)) || [];
    if (day.closed) {
      return { _id: court._id, name: court.name, order: court.order, closed: true, slots: [] };
    }
    const openMin = parseHHMM(day.open);
    const closeMin = parseHHMM(day.close);
    const slots = [];
    if (Number.isFinite(openMin) && Number.isFinite(closeMin)) {
      for (let m = openMin; m + slot <= closeMin; m += slot) {
        const startAt = buildInstant(date, minutesToHHMM(m));
        const endAt = buildInstant(date, minutesToHHMM(m + slot));
        const overlap = existing.some(
          (b) => new Date(b.startAt) < endAt && new Date(b.endAt) > startAt,
        );
        const { totalPrice } = computeBookingPrice(venue, court, weekday, m, m + slot);
        slots.push({
          start: minutesToHHMM(m),
          end: minutesToHHMM(m + slot),
          price: totalPrice,
          booked: overlap,
          past: startAt.getTime() < now.getTime(),
        });
      }
    }
    return { _id: court._id, name: court.name, order: court.order, closed: false, slots };
  });

  res.json({
    venueId: id,
    date,
    slotMinutes: slot,
    depositPercent: venue.depositPercent || 0,
    courts: result,
  });
});

/* ===================== TẠO LƯỢT ĐẶT ===================== */

/** POST /api/bookings  { venueId, courtId, date, start, end, customerName, customerPhone, note } */
export const createBooking = expressAsyncHandler(async (req, res) => {
  const { venueId, courtId, date, start, end, note } = req.body || {};
  if (!isId(venueId) || !isId(courtId)) {
    res.status(400);
    throw new Error("Thiếu hoặc sai cụm sân / sân");
  }
  if (!isValidDateStr(date)) {
    res.status(400);
    throw new Error("Ngày không hợp lệ");
  }

  const venue = await Venue.findById(venueId).lean();
  if (!venue || venue.isActive === false) {
    res.status(404);
    throw new Error("Cụm sân không khả dụng");
  }
  const court = await VenueCourt.findOne({
    _id: courtId,
    venue: venueId,
    isActive: true,
  }).lean();
  if (!court) {
    res.status(404);
    throw new Error("Sân không khả dụng");
  }

  const startMin = parseHHMM(start);
  const endMin = parseHHMM(end);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
    res.status(400);
    throw new Error("Khung giờ không hợp lệ");
  }

  const weekday = weekdayOf(date);
  const day = getDayHours(venue, court, weekday);
  if (day.closed) {
    res.status(400);
    throw new Error("Sân đóng cửa ngày này");
  }
  const openMin = parseHHMM(day.open);
  const closeMin = parseHHMM(day.close);
  const slot = Math.max(15, Number(venue.slotMinutes) || 60);

  if (startMin < openMin || endMin > closeMin) {
    res.status(400);
    throw new Error(`Chỉ đặt được trong giờ mở cửa (${day.open}–${day.close})`);
  }
  if ((startMin - openMin) % slot !== 0 || (endMin - startMin) % slot !== 0) {
    res.status(400);
    throw new Error(`Khung giờ phải theo bước ${slot} phút`);
  }

  const startAt = buildInstant(date, start);
  const endAt = buildInstant(date, end);
  if (startAt.getTime() < Date.now()) {
    res.status(400);
    throw new Error("Không thể đặt khung giờ trong quá khứ");
  }

  // Chống trùng giờ trên cùng 1 sân
  const clash = await Booking.findOne({
    court: courtId,
    status: { $in: ACTIVE_STATUSES },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  }).lean();
  if (clash) {
    res.status(409);
    throw new Error("Khung giờ này đã có người đặt");
  }

  const { totalPrice, pricePerHour } = computeBookingPrice(
    venue,
    court,
    weekday,
    startMin,
    endMin,
  );
  const depositAmount = Math.round((totalPrice * (venue.depositPercent || 0)) / 100);

  const manage = await canManageVenue(req.user, venue);
  const doc = {
    venue: venueId,
    court: courtId,
    startAt,
    endAt,
    durationMin: endMin - startMin,
    pricePerHour,
    totalPrice,
    depositAmount,
    status: "pending",
    note: String(note || "").slice(0, 500),
    createdBy: req.user._id,
  };

  if (manage) {
    // Chủ sân đặt hộ khách vãng lai: xác nhận luôn (thu tiền tại quầy)
    doc.createdByRole = "owner";
    doc.status = "confirmed";
    doc.user = isId(req.body.userId) ? req.body.userId : null;
    doc.customerName = String(req.body.customerName || "").slice(0, 120);
    doc.customerPhone = String(req.body.customerPhone || "").slice(0, 30);
  } else {
    doc.createdByRole = "customer";
    doc.user = req.user._id;
    doc.customerName = String(req.body.customerName || req.user.name || "").slice(0, 120);
    doc.customerPhone = String(req.body.customerPhone || req.user.phone || "").slice(0, 30);
  }

  // Khoá slot atomic (unique court+slotStart) — 2 request đồng thời chỉ 1 thắng
  const booking = new Booking(doc);
  try {
    await BookingSlotLock.insertMany(
      slotStartsBetween(startAt, endAt).map((slotStart) => ({
        court: courtId,
        slotStart,
        booking: booking._id,
      })),
      { ordered: false },
    );
  } catch (e) {
    await BookingSlotLock.deleteMany({ booking: booking._id });
    if (isDupKey(e)) {
      res.status(409);
      throw new Error("Khung giờ này vừa có người đặt trước, vui lòng chọn giờ khác");
    }
    throw e;
  }
  await booking.save();

  if (doc.createdByRole === "customer") {
    notifyBooking("created", booking, {
      actorId: req.user._id,
      venueName: venue.name,
      courtName: court.name,
    }).catch(() => {});
  } else if (booking.user) {
    scheduleBookingReminder(booking).catch(() => {});
  }

  res.status(201).json({ ...booking.toObject(), bank: bookingBankInfo(venue, booking) });
});

/* ===================== DANH SÁCH ===================== */

/** GET /api/bookings/mine?status= */
export const listMyBookings = expressAsyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.status) filter.status = String(req.query.status);
  const items = await Booking.find(filter)
    .sort({ startAt: -1 })
    .limit(200)
    .populate("venue", VENUE_PUBLIC_FIELDS)
    .populate("court", "name")
    .lean();
  res.json(items.map((b) => ({ ...b, bank: bookingBankInfo(b.venue, b) })));
});

/** GET /api/bookings/:id  (khách của đơn hoặc chủ sân) */
export const getBooking = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const b = await Booking.findById(id)
    .populate("venue", `${VENUE_PUBLIC_FIELDS} owner managers`)
    .populate("court", "name")
    .populate("user", "name nickname phone avatar")
    .lean();
  if (!b) {
    res.status(404);
    throw new Error("Không tìm thấy lượt đặt");
  }
  const mine = b.user && String(b.user._id || b.user) === String(req.user._id);
  const manage = await canManageVenue(req.user, b.venue);
  if (!mine && !manage) {
    res.status(403);
    throw new Error("Không có quyền xem lượt đặt này");
  }
  const { owner, managers, ...venue } = b.venue || {};
  res.json({ ...b, venue, bank: bookingBankInfo(b.venue, b), canManage: manage });
});

/** GET /api/venues/:id/bookings?date=&status=  (chủ sân) */
export const listVenueBookings = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const venue = await Venue.findById(id).select("owner managers").lean();
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy cụm sân");
  }
  if (!(await canManageVenue(req.user, venue))) {
    res.status(403);
    throw new Error("Không có quyền xem lượt đặt của cụm sân này");
  }

  const filter = { venue: id };
  if (req.query.status) filter.status = String(req.query.status);
  if (isValidDateStr(req.query.date)) {
    const dayStart = buildInstant(req.query.date, "00:00");
    filter.startAt = { $gte: dayStart, $lt: new Date(dayStart.getTime() + DAY_MS) };
  }

  const items = await Booking.find(filter)
    .sort({ startAt: req.query.date ? 1 : -1 })
    .limit(500)
    .populate("court", "name")
    .populate("user", "name nickname phone")
    .lean();
  res.json(items);
});

/* ===================== CẬP NHẬT ===================== */

/** PATCH /api/bookings/:id/status  { status, cancelReason } */
export const updateBookingStatus = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const next = String(req.body?.status || "");
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  if (!["pending", "awaiting_approval", "confirmed", "cancelled", "completed", "no_show"].includes(next)) {
    res.status(400);
    throw new Error("Trạng thái không hợp lệ");
  }

  const booking = await Booking.findById(id);
  if (!booking) {
    res.status(404);
    throw new Error("Không tìm thấy lượt đặt");
  }

  const manage = await canManageVenue(req.user, booking.venue);
  const isOwnerOfBooking =
    booking.user && String(booking.user) === String(req.user._id);

  if (next === "cancelled") {
    if (!manage && !isOwnerOfBooking) {
      res.status(403);
      throw new Error("Không có quyền huỷ lượt đặt này");
    }
    booking.cancelledAt = new Date();
    booking.cancelReason = String(req.body?.cancelReason || "").slice(0, 300);
  } else if (!manage) {
    // Các trạng thái khác chỉ chủ sân/admin được đổi
    res.status(403);
    throw new Error("Không có quyền cập nhật trạng thái");
  }

  booking.status = next;
  await booking.save();

  // Huỷ / không đến → nhả slot; báo bên còn lại
  if (next === "cancelled" || next === "no_show") {
    await BookingSlotLock.deleteMany({ booking: booking._id });
    if (next === "cancelled") {
      const [v, c] = await Promise.all([
        Venue.findById(booking.venue).select("name").lean(),
        VenueCourt.findById(booking.court).select("name").lean(),
      ]);
      notifyBooking(manage && !isOwnerOfBooking ? "cancelled_by_owner" : "cancelled_by_customer", booking, {
        actorId: req.user._id,
        venueName: v?.name,
        courtName: c?.name,
        reason: booking.cancelReason,
      }).catch(() => {});
    }
  }
  res.json(booking);
});

/** PATCH /api/bookings/:id/payment  { status }  (chủ sân xác nhận) */
export const setBookingPayment = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const status = String(req.body?.status || "");
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  if (!["Paid", "Unpaid"].includes(status)) {
    res.status(400);
    throw new Error("Trạng thái thanh toán không hợp lệ");
  }

  const booking = await Booking.findById(id);
  if (!booking) {
    res.status(404);
    throw new Error("Không tìm thấy lượt đặt");
  }
  if (!(await canManageVenue(req.user, booking.venue))) {
    res.status(403);
    throw new Error("Không có quyền xác nhận thanh toán");
  }

  booking.payment.status = status;
  booking.payment.paidAt = status === "Paid" ? new Date() : null;
  // Xác nhận thanh toán thì tự xác nhận lượt đặt nếu đang chờ
  if (status === "Paid" && ["pending", "awaiting_approval"].includes(booking.status)) {
    booking.status = "confirmed";
    booking.payment.reviewedBy = req.user._id;
    booking.payment.reviewedAt = new Date();
  }
  await booking.save();
  if (status === "Paid" && booking.status === "confirmed") {
    scheduleBookingReminder(booking).catch(() => {});
  }
  res.json(booking);
});

/* ===================== BILL CHUYỂN KHOẢN & DUYỆT ===================== */

async function loadBookingWithNames(id) {
  const b = await Booking.findById(id);
  if (!b) return { booking: null };
  const [v, c] = await Promise.all([
    Venue.findById(b.venue).select("name owner managers").lean(),
    VenueCourt.findById(b.court).select("name").lean(),
  ]);
  return { booking: b, venue: v, court: c };
}

/** POST /api/bookings/:id/payment-proof  { imageUrl, note }  (khách gửi bill) */
export const submitPaymentProof = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const imageUrl = String(req.body?.imageUrl || "").trim();
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  if (!/^(https?:\/\/|\/uploads\/)/i.test(imageUrl)) {
    res.status(400);
    throw new Error("Thiếu ảnh bill chuyển khoản");
  }
  const { booking, venue, court } = await loadBookingWithNames(id);
  if (!booking) {
    res.status(404);
    throw new Error("Không tìm thấy lượt đặt");
  }
  if (!booking.user || String(booking.user) !== String(req.user._id)) {
    res.status(403);
    throw new Error("Không có quyền gửi bill cho lượt đặt này");
  }
  if (!["pending", "awaiting_approval"].includes(booking.status)) {
    res.status(400);
    throw new Error("Lượt đặt không ở trạng thái chờ thanh toán");
  }

  booking.payment.proofUrl = imageUrl.slice(0, 1000);
  booking.payment.proofNote = String(req.body?.note || "").slice(0, 300);
  booking.payment.proofAt = new Date();
  booking.payment.rejectReason = "";
  booking.status = "awaiting_approval";
  await booking.save();

  notifyBooking("proof_submitted", booking, {
    actorId: req.user._id,
    venueName: venue?.name,
    courtName: court?.name,
  }).catch(() => {});
  res.json(booking);
});

/** PATCH /api/bookings/:id/approve  (chủ sân duyệt bill → xác nhận) */
export const approveBooking = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const { booking, venue, court } = await loadBookingWithNames(id);
  if (!booking) {
    res.status(404);
    throw new Error("Không tìm thấy lượt đặt");
  }
  if (!(await canManageVenue(req.user, venue))) {
    res.status(403);
    throw new Error("Không có quyền duyệt lượt đặt này");
  }
  if (!["pending", "awaiting_approval"].includes(booking.status)) {
    res.status(400);
    throw new Error("Lượt đặt không ở trạng thái chờ duyệt");
  }

  booking.payment.status = "Paid";
  booking.payment.paidAt = new Date();
  booking.payment.reviewedBy = req.user._id;
  booking.payment.reviewedAt = new Date();
  booking.payment.rejectReason = "";
  booking.status = "confirmed";
  await booking.save();

  scheduleBookingReminder(booking).catch(() => {});
  notifyBooking("approved", booking, {
    actorId: req.user._id,
    venueName: venue?.name,
    courtName: court?.name,
  }).catch(() => {});
  res.json(booking);
});

/** PATCH /api/bookings/:id/reject  { reason }  (chủ sân từ chối bill → khách gửi lại) */
export const rejectBooking = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const { booking, venue, court } = await loadBookingWithNames(id);
  if (!booking) {
    res.status(404);
    throw new Error("Không tìm thấy lượt đặt");
  }
  if (!(await canManageVenue(req.user, venue))) {
    res.status(403);
    throw new Error("Không có quyền từ chối lượt đặt này");
  }
  if (booking.status !== "awaiting_approval") {
    res.status(400);
    throw new Error("Lượt đặt chưa có bill để từ chối");
  }

  const reason = String(req.body?.reason || "").slice(0, 300);
  booking.payment.status = "Unpaid";
  booking.payment.paidAt = null;
  booking.payment.reviewedBy = req.user._id;
  booking.payment.reviewedAt = new Date();
  booking.payment.rejectReason = reason;
  booking.status = "pending";
  await booking.save();

  notifyBooking("rejected", booking, {
    actorId: req.user._id,
    venueName: venue?.name,
    courtName: court?.name,
    reason,
  }).catch(() => {});
  res.json(booking);
});

/* ===================== CHECK-IN VÉ QR ===================== */

/** POST /api/bookings/checkin  { token }  (chủ sân quét QR trên vé) */
export const checkInBooking = expressAsyncHandler(async (req, res) => {
  const raw = String(req.body?.token || "").trim();
  // Chấp nhận cả nội dung QR đầy đủ "ptbk:<token>"
  const token = raw.replace(/^ptbk:/i, "");
  if (!token) {
    res.status(400);
    throw new Error("Thiếu mã vé");
  }
  const booking = await Booking.findOne({ "ticket.token": token })
    .populate("venue", "name owner managers")
    .populate("court", "name")
    .populate("user", "name nickname phone avatar");
  if (!booking) {
    res.status(404);
    throw new Error("Vé không hợp lệ");
  }
  if (!(await canManageVenue(req.user, booking.venue))) {
    res.status(403);
    throw new Error("Vé này thuộc sân khác");
  }

  const summary = () => ({
    _id: booking._id,
    code: booking.code,
    status: booking.status,
    customerName: booking.customerName || booking.user?.name || "",
    customerPhone: booking.customerPhone || booking.user?.phone || "",
    avatar: booking.user?.avatar || "",
    venueName: booking.venue?.name,
    courtName: booking.court?.name,
    startAt: booking.startAt,
    endAt: booking.endAt,
    totalPrice: booking.totalPrice,
    paymentStatus: booking.payment?.status,
    checkedInAt: booking.ticket?.checkedInAt || null,
  });

  if (booking.ticket?.checkedInAt) {
    return res.json({ ok: true, already: true, booking: summary() });
  }
  if (booking.status !== "confirmed") {
    return res.status(400).json({
      ok: false,
      message:
        booking.status === "cancelled"
          ? "Lượt đặt đã bị huỷ"
          : "Lượt đặt chưa được xác nhận thanh toán",
      booking: summary(),
    });
  }

  booking.ticket.checkedInAt = new Date();
  booking.ticket.checkedInBy = req.user._id;
  await booking.save();

  notifyBooking("checked_in", booking, {
    actorId: req.user._id,
    venueName: booking.venue?.name,
    courtName: booking.court?.name,
  }).catch(() => {});
  res.json({ ok: true, already: false, booking: summary() });
});

/* ===================== DOANH THU / CHỐT SỐ ===================== */

const vnDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/** GET /api/venues/:id/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD  (chủ sân) */
export const getVenueRevenue = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const venue = await Venue.findById(id).select("owner managers name").lean();
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy cụm sân");
  }
  if (!(await canManageVenue(req.user, venue))) {
    res.status(403);
    throw new Error("Không có quyền xem doanh thu");
  }

  const today = vnDay();
  let from = isValidDateStr(req.query.from) ? req.query.from : today;
  let to = isValidDateStr(req.query.to) ? req.query.to : from;
  if (from > to) [from, to] = [to, from];

  const fromInstant = buildInstant(from, "00:00");
  const toInstant = new Date(buildInstant(to, "00:00").getTime() + DAY_MS);

  const bookings = await Booking.find({
    venue: id,
    startAt: { $gte: fromInstant, $lt: toInstant },
  })
    .select("court startAt totalPrice depositAmount status payment")
    .populate("court", "name")
    .lean();

  let paidRevenue = 0;
  let paidCount = 0;
  let expectedRevenue = 0;
  let activeCount = 0;
  let unpaidAmount = 0;
  let unpaidCount = 0;
  let cancelledCount = 0;
  const byCourt = new Map();
  const byDay = new Map();
  const statusCounts = {};

  for (const b of bookings) {
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
    if (b.status === "cancelled") {
      cancelledCount += 1;
      continue;
    }
    const total = Number(b.totalPrice) || 0;
    const isPaid = b.payment?.status === "Paid";
    activeCount += 1;
    expectedRevenue += total;
    if (isPaid) {
      paidRevenue += total;
      paidCount += 1;
    } else {
      unpaidAmount += total;
      unpaidCount += 1;
    }

    const cKey = String(b.court?._id || b.court || "");
    if (!byCourt.has(cKey)) {
      byCourt.set(cKey, {
        courtId: cKey,
        courtName: b.court?.name || "—",
        count: 0,
        paid: 0,
        expected: 0,
      });
    }
    const cc = byCourt.get(cKey);
    cc.count += 1;
    cc.expected += total;
    if (isPaid) cc.paid += total;

    const d = vnDay(new Date(b.startAt));
    if (!byDay.has(d)) byDay.set(d, { date: d, paid: 0, count: 0 });
    const dd = byDay.get(d);
    dd.count += 1;
    if (isPaid) dd.paid += total;
  }

  res.json({
    venueId: id,
    venueName: venue.name,
    from,
    to,
    totals: {
      paidRevenue,
      paidCount,
      expectedRevenue,
      activeCount,
      unpaidAmount,
      unpaidCount,
      cancelledCount,
      totalBookings: bookings.length,
    },
    statusCounts,
    byCourt: Array.from(byCourt.values()).sort((a, b) => b.paid - a.paid),
    byDay: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
  });
});
