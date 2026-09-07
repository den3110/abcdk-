import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import Venue from "../models/venueModel.js";
import VenueCourt from "../models/venueCourtModel.js";
import Booking from "../models/bookingModel.js";
import VenueSale from "../models/venueSaleModel.js";
import CourtBlock from "../models/courtBlockModel.js";
import { canManageVenue } from "../utils/venueAuth.js";
import { parseHHMM, isValidDateStr, weekdayOf, buildInstant, getDayHours } from "../utils/venueBooking.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const DAY_MS = 24 * 60 * 60 * 1000;

function vnDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function vnHour(d) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", hour12: false }).format(new Date(d)));
}

/** GET /api/venues/:id/analytics?from=&to=  — tỉ lệ lấp đầy + giờ cao điểm + doanh thu gộp */
export const getVenueAnalytics = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const venue = await Venue.findById(id).lean();
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy cụm sân");
  }
  if (!(await canManageVenue(req.user, venue))) {
    res.status(403);
    throw new Error("Không có quyền xem phân tích");
  }

  const today = vnDay();
  let from = isValidDateStr(req.query.from) ? req.query.from : addDaysStr(today, -6);
  let to = isValidDateStr(req.query.to) ? req.query.to : today;
  if (from > to) [from, to] = [to, from];
  // giới hạn 92 ngày
  const dates = [];
  for (let d = from; d <= to && dates.length < 92; d = addDaysStr(d, 1)) dates.push(d);

  const courts = await VenueCourt.find({ venue: id, isActive: true }).lean();
  const fromInstant = buildInstant(from, "00:00");
  const toInstant = new Date(buildInstant(to, "00:00").getTime() + DAY_MS);

  const [bookings, blocks, sales] = await Promise.all([
    Booking.find({ venue: id, startAt: { $gte: fromInstant, $lt: toInstant }, status: { $nin: ["cancelled"] } })
      .select("court startAt durationMin totalPrice status payment")
      .lean(),
    CourtBlock.find({ venue: id, startAt: { $lt: toInstant }, endAt: { $gt: fromInstant } })
      .select("court startAt endAt")
      .lean(),
    VenueSale.find({ venue: id, createdAt: { $gte: fromInstant, $lt: toInstant } }).select("total createdAt").lean(),
  ]);

  // Tổng phút mở cửa (khả dụng) trừ khoá
  let availableMin = 0;
  for (const date of dates) {
    const wd = weekdayOf(date);
    for (const court of courts) {
      const day = getDayHours(venue, court, wd);
      if (day.closed) continue;
      const open = parseHHMM(day.open);
      const close = parseHHMM(day.close);
      if (Number.isFinite(open) && Number.isFinite(close) && close > open) availableMin += close - open;
    }
  }
  // Trừ phút bị khoá (ước lượng trong khung mở cửa)
  let blockedMin = 0;
  for (const b of blocks) {
    const dur = (new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 60000;
    blockedMin += Math.max(0, dur) * (b.court ? 1 : courts.length || 1);
  }
  availableMin = Math.max(0, availableMin - blockedMin);

  // Phút đã đặt + doanh thu + giờ cao điểm
  let bookedMin = 0;
  let courtPaid = 0;
  const byHour = Array.from({ length: 24 }, () => 0);
  const perCourt = new Map(courts.map((c) => [String(c._id), { courtId: String(c._id), courtName: c.name, bookedMin: 0, count: 0 }]));
  for (const bk of bookings) {
    bookedMin += bk.durationMin || 0;
    if (bk.payment?.status === "Paid") courtPaid += Number(bk.totalPrice) || 0;
    byHour[vnHour(bk.startAt)] += 1;
    const pc = perCourt.get(String(bk.court));
    if (pc) { pc.bookedMin += bk.durationMin || 0; pc.count += 1; }
  }
  const salesTotal = sales.reduce((s, x) => s + (Number(x.total) || 0), 0);

  const utilization = availableMin > 0 ? Math.round((bookedMin / availableMin) * 1000) / 10 : 0;
  const peakHour = byHour.reduce((mi, v, i, arr) => (v > arr[mi] ? i : mi), 0);

  res.json({
    from, to, days: dates.length,
    courtsCount: courts.length,
    availableHours: Math.round((availableMin / 60) * 10) / 10,
    bookedHours: Math.round((bookedMin / 60) * 10) / 10,
    utilization, // %
    peakHour,
    byHour,
    byCourt: [...perCourt.values()]
      .map((c) => ({ ...c, bookedHours: Math.round((c.bookedMin / 60) * 10) / 10 }))
      .sort((a, b) => b.bookedMin - a.bookedMin),
    revenue: { courtPaid, salesTotal, total: courtPaid + salesTotal },
  });
});
