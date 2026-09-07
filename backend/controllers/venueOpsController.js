import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import crypto from "crypto";

import Venue from "../models/venueModel.js";
import VenueCourt from "../models/venueCourtModel.js";
import Booking from "../models/bookingModel.js";
import BookingSlotLock, { slotStartsBetween } from "../models/bookingSlotLockModel.js";
import CourtBlock from "../models/courtBlockModel.js";
import PromoCode from "../models/promoCodeModel.js";
import VenueStaff from "../models/venueStaffModel.js";
import VenueRecurringPlan from "../models/venueRecurringPlanModel.js";
import { canManageVenue, venueCan } from "../utils/venueAuth.js";
import { pushToUsers, venueStaffIds } from "../services/venueNotify.js";
import {
  parseHHMM,
  isValidDateStr,
  weekdayOf,
  buildInstant,
  getDayHours,
  computeBookingPrice,
} from "../utils/venueBooking.js";
import { scheduleBookingReminder } from "../jobs/bookingJobs.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = ["pending", "awaiting_approval", "confirmed"];

async function requireManage(req, res, perm) {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const venue = await Venue.findById(id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy cụm sân");
  }
  if (!(perm ? await venueCan(req.user, venue, perm) : await canManageVenue(req.user, venue))) {
    res.status(403);
    throw new Error("Không có quyền với cụm sân này");
  }
  return venue;
}

/* ============================ KHOÁ SÂN / BẢO TRÌ ============================ */

/** GET /api/venues/:id/blocks?from=&to=  (chủ sân) */
export const listBlocks = expressAsyncHandler(async (req, res) => {
  await requireManage(req, res, "blocks.manage");
  const filter = { venue: req.params.id };
  if (isValidDateStr(req.query.from)) {
    filter.endAt = { $gt: buildInstant(req.query.from, "00:00") };
  }
  if (isValidDateStr(req.query.to)) {
    filter.startAt = { $lt: new Date(buildInstant(req.query.to, "00:00").getTime() + DAY_MS) };
  }
  const items = await CourtBlock.find(filter)
    .sort({ startAt: 1 })
    .populate("court", "name")
    .lean();
  res.json(items);
});

/** POST /api/venues/:id/blocks  { courtId?, date, start, end, reason }  (chủ sân) */
export const createBlock = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res, "blocks.manage");
  const { courtId, date, start, end, reason } = req.body || {};
  if (!isValidDateStr(date)) {
    res.status(400);
    throw new Error("Ngày không hợp lệ");
  }
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
    res.status(400);
    throw new Error("Khung giờ không hợp lệ");
  }
  let court = null;
  if (courtId) {
    if (!isId(courtId)) {
      res.status(400);
      throw new Error("Sân không hợp lệ");
    }
    const c = await VenueCourt.findOne({ _id: courtId, venue: venue._id }).lean();
    if (!c) {
      res.status(404);
      throw new Error("Không tìm thấy sân");
    }
    court = courtId;
  }
  const doc = await CourtBlock.create({
    venue: venue._id,
    court,
    startAt: buildInstant(date, start),
    endAt: buildInstant(date, end),
    reason: String(reason || "").slice(0, 300),
    createdBy: req.user._id,
  });
  res.status(201).json(doc);
});

/** DELETE /api/venues/:id/blocks/:blockId  (chủ sân) */
export const deleteBlock = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res, "blocks.manage");
  const { blockId } = req.params;
  if (!isId(blockId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  await CourtBlock.deleteOne({ _id: blockId, venue: venue._id });
  res.json({ ok: true });
});

/* ============================ MÃ GIẢM GIÁ ============================ */

/** GET /api/venues/:id/promos  (chủ sân) */
export const listPromos = expressAsyncHandler(async (req, res) => {
  await requireManage(req, res, "promos.manage");
  const items = await PromoCode.find({ venue: req.params.id }).sort({ createdAt: -1 }).lean();
  res.json(items);
});

/** POST /api/venues/:id/promos  (chủ sân) */
export const createPromo = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res, "promos.manage");
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!code) {
    res.status(400);
    throw new Error("Cần nhập mã");
  }
  const type = req.body?.type === "amount" ? "amount" : "percent";
  const value = Math.max(0, Number(req.body?.value) || 0);
  if (!value) {
    res.status(400);
    throw new Error("Giá trị giảm phải > 0");
  }
  try {
    const doc = await PromoCode.create({
      venue: venue._id,
      code,
      type,
      value: type === "percent" ? Math.min(100, value) : value,
      maxDiscount: Math.max(0, Number(req.body?.maxDiscount) || 0),
      minTotal: Math.max(0, Number(req.body?.minTotal) || 0),
      startAt: isValidDateStr(req.body?.startDate) ? buildInstant(req.body.startDate, "00:00") : null,
      endAt: isValidDateStr(req.body?.endDate) ? new Date(buildInstant(req.body.endDate, "00:00").getTime() + DAY_MS) : null,
      usageLimit: Math.max(0, Number(req.body?.usageLimit) || 0),
      active: req.body?.active !== false,
    });
    res.status(201).json(doc);
  } catch (e) {
    if (e?.code === 11000) {
      res.status(409);
      throw new Error("Mã này đã tồn tại ở cụm sân");
    }
    throw e;
  }
});

/** PATCH /api/venues/:id/promos/:promoId  (chủ sân — sửa nhanh active/value…) */
export const updatePromo = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res, "promos.manage");
  const { promoId } = req.params;
  if (!isId(promoId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const promo = await PromoCode.findOne({ _id: promoId, venue: venue._id });
  if (!promo) {
    res.status(404);
    throw new Error("Không tìm thấy mã");
  }
  const b = req.body || {};
  if (typeof b.active === "boolean") promo.active = b.active;
  if (b.value !== undefined) promo.value = Math.max(0, Number(b.value) || 0);
  if (b.maxDiscount !== undefined) promo.maxDiscount = Math.max(0, Number(b.maxDiscount) || 0);
  if (b.minTotal !== undefined) promo.minTotal = Math.max(0, Number(b.minTotal) || 0);
  if (b.usageLimit !== undefined) promo.usageLimit = Math.max(0, Number(b.usageLimit) || 0);
  await promo.save();
  res.json(promo);
});

/** DELETE /api/venues/:id/promos/:promoId */
export const deletePromo = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res, "promos.manage");
  const { promoId } = req.params;
  if (!isId(promoId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  await PromoCode.deleteOne({ _id: promoId, venue: venue._id });
  res.json({ ok: true });
});

/** GET /api/venues/:id/promos/validate?code=&total=  (khách kiểm tra mã) */
export const validatePromo = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const code = String(req.query.code || "").trim().toUpperCase();
  const total = Math.max(0, Number(req.query.total) || 0);
  if (!code) {
    res.status(400);
    throw new Error("Thiếu mã");
  }
  const promo = await PromoCode.findOne({ venue: id, code });
  if (!promo) {
    return res.json({ ok: false, discount: 0, reason: "Mã không tồn tại" });
  }
  const r = promo.computeDiscount(total);
  res.json({ ok: r.ok, discount: r.discount, reason: r.reason, type: promo.type, value: promo.value });
});

/* ============================ ĐẶT ĐỊNH KỲ ============================ */

/** Cộng thêm `n` tháng vào chuỗi "YYYY-MM-DD" (an toàn TZ, dùng UTC). */
function addMonthsStr(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
const todayStrVN = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** POST /api/venues/:id/recurring
 * Lịch cố định cho CLB/khách quen. Chủ sân chọn nhiều thứ/tuần, khoảng thời gian theo
 * tuần/tháng/ngày kết thúc, TỰ SET GIÁ mỗi buổi (hoặc theo bảng giá), và có thể đánh dấu
 * đã thu tiền (tính vào doanh thu ngay).
 * body {
 *   courtId, start, end,
 *   daysOfWeek:[0-6] | weekday(0-6),
 *   dateFrom, weeks? | months? | dateTo?,
 *   priceMode:"auto"|"custom", pricePerSession?,
 *   markPaid?:bool, paymentMethod?:"cash"|"transfer",
 *   customerName, customerPhone, note
 * }
 */
export const createRecurring = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res, "recurring.manage");
  const { courtId, start, end, dateFrom, note } = req.body || {};
  if (!isId(courtId)) {
    res.status(400);
    throw new Error("Thiếu sân");
  }
  const court = await VenueCourt.findOne({ _id: courtId, venue: venue._id, isActive: true }).lean();
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

  // Các thứ trong tuần áp dụng (0=CN..6=T7)
  const rawDays = Array.isArray(req.body?.daysOfWeek) && req.body.daysOfWeek.length
    ? req.body.daysOfWeek
    : [req.body?.weekday];
  const days = [...new Set(rawDays.map(Number).filter((d) => d >= 0 && d <= 6))];
  if (!days.length) {
    res.status(400);
    throw new Error("Chọn ít nhất 1 thứ trong tuần");
  }

  // Khoảng thời gian: ưu tiên dateTo → months → weeks
  const base = isValidDateStr(dateFrom) ? dateFrom : todayStrVN();
  let endDate;
  if (isValidDateStr(req.body?.dateTo)) endDate = req.body.dateTo;
  else if (Number(req.body?.months) > 0) endDate = addMonthsStr(base, Math.min(12, Number(req.body.months)));
  else {
    const weeks = Math.min(52, Math.max(1, Number(req.body?.weeks) || 4));
    endDate = addDaysStr(base, weeks * 7 - 1);
  }

  // Sinh danh sách ngày (cap 200 buổi)
  const dates = [];
  let cur = base;
  for (let guard = 0; guard < 800 && cur <= endDate && dates.length < 200; guard += 1) {
    if (days.includes(weekdayOf(cur))) dates.push(cur);
    cur = addDaysStr(cur, 1);
  }
  if (!dates.length) {
    res.status(400);
    throw new Error("Không có buổi nào trong khoảng đã chọn");
  }

  const cfg = {
    start, end,
    priceMode: ["custom", "total"].includes(req.body?.priceMode) ? req.body.priceMode : "auto",
    pricePerSession: Math.max(0, Math.round(Number(req.body?.pricePerSession) || 0)),
    totalPackagePrice: Math.max(0, Math.round(Number(req.body?.totalPackagePrice) || 0)),
    markPaid: req.body?.markPaid === true,
    paymentMethod: req.body?.paymentMethod === "transfer" ? "transfer" : "cash",
    customerName: String(req.body?.customerName || "").slice(0, 120),
    customerPhone: String(req.body?.customerPhone || "").slice(0, 30),
    note: String(note || "Lịch cố định").slice(0, 300),
  };

  const group = crypto.randomBytes(6).toString("hex");
  const { created, skipped, revenue } = await generateSessions({ venue, court, cfg, dates, group, createdBy: req.user._id });

  // Lưu kế hoạch để hỗ trợ tự động gia hạn + sửa/kết thúc sau này
  await VenueRecurringPlan.create({
    venue: venue._id,
    court: court._id,
    group,
    daysOfWeek: days,
    start, end,
    priceMode: cfg.priceMode,
    pricePerSession: cfg.pricePerSession,
    totalPackagePrice: cfg.totalPackagePrice,
    markPaid: cfg.markPaid,
    paymentMethod: cfg.paymentMethod,
    customerName: cfg.customerName,
    customerPhone: cfg.customerPhone,
    note: cfg.note,
    autoRenew: req.body?.autoRenew === true,
    renewEveryMonths: Math.min(12, Math.max(1, Number(req.body?.renewEveryMonths) || 1)),
    lastGeneratedTo: endDate,
    status: "active",
    createdBy: req.user._id,
  });

  res.status(201).json({
    group, created, skipped,
    createdCount: created.length, skippedCount: skipped.length,
    grossTotal: created.reduce((s, c) => s + c.totalPrice, 0),
    paidRevenue: revenue,
  });
});

/** Sinh các buổi cho 1 loạt ngày với cấu hình cfg (dùng chung cho tạo mới + tự gia hạn). */
async function generateSessions({ venue, court, cfg, dates, group, createdBy }) {
  const startMin = parseHHMM(cfg.start);
  const endMin = parseHHMM(cfg.end);
  const hours = (endMin - startMin) / 60;
  const commissionPct = Number(venue.commissionPercent) || 0;

  // Pha 1: lọc buổi hợp lệ
  const valid = [];
  const skipped = [];
  const nowMs = Date.now();
  for (const date of dates) {
    const wd = weekdayOf(date);
    const day = getDayHours(venue, court, wd);
    if (day.closed) { skipped.push({ date, reason: "đóng cửa" }); continue; }
    const startAt = buildInstant(date, cfg.start);
    const endAt = buildInstant(date, cfg.end);
    // Buổi đã qua (endAt ≤ hiện tại) vẫn được ghi nhận dưới dạng "completed" để tính doanh thu
    // cho hợp đồng CLB bắt đầu trong quá khứ.
    const past = endAt.getTime() <= nowMs;
    // Chống trùng: buổi tương lai xét đơn đang hoạt động; buổi quá khứ xét mọi đơn chưa huỷ.
    const clash = await Booking.findOne({
      court: court._id,
      status: past ? { $ne: "cancelled" } : { $in: ACTIVE_STATUSES },
      startAt: { $lt: endAt }, endAt: { $gt: startAt },
    }).lean();
    if (clash) { skipped.push({ date, reason: "đã có lượt" }); continue; }
    if (!past) {
      const block = await CourtBlock.findOne({
        venue: venue._id, $or: [{ court: court._id }, { court: null }],
        startAt: { $lt: endAt }, endAt: { $gt: startAt },
      }).lean();
      if (block) { skipped.push({ date, reason: "khoá sân" }); continue; }
    }
    valid.push({ date, wd, startAt, endAt, past });
  }

  const n = valid.length;
  const priceAt = (idx) => {
    if (cfg.priceMode === "total") {
      if (!n) return 0;
      const base = Math.floor(cfg.totalPackagePrice / n);
      const rem = cfg.totalPackagePrice - base * n;
      return base + (idx < rem ? 1 : 0);
    }
    if (cfg.priceMode === "custom") return cfg.pricePerSession;
    return computeBookingPrice(venue, court, valid[idx].wd, startMin, endMin).totalPrice;
  };

  const created = [];
  let revenue = 0;
  for (let i = 0; i < valid.length; i += 1) {
    const { date, startAt, endAt, past } = valid[i];
    const totalPrice = priceAt(i);
    const pricePerHour = hours > 0 ? Math.round(totalPrice / hours) : totalPrice;
    const booking = new Booking({
      venue: venue._id, court: court._id, startAt, endAt,
      durationMin: endMin - startMin, pricePerHour, subtotal: totalPrice, totalPrice,
      status: past ? "completed" : "confirmed", createdByRole: "owner", createdBy,
      customerName: cfg.customerName, customerPhone: cfg.customerPhone, note: cfg.note,
      recurringGroup: group,
    });
    if (cfg.markPaid) {
      booking.payment = { status: "Paid", paidAt: new Date(), method: cfg.paymentMethod, reviewedBy: createdBy, reviewedAt: new Date() };
      booking.commissionAmount = commissionPct > 0 ? Math.round((totalPrice * commissionPct) / 100) : 0;
    }
    // Buổi tương lai: khoá slot chống trùng + lên lịch nhắc. Buổi quá khứ: không cần.
    if (!past) {
      try {
        await BookingSlotLock.insertMany(
          slotStartsBetween(startAt, endAt).map((slotStart) => ({ court: court._id, slotStart, booking: booking._id })),
          { ordered: false },
        );
      } catch (e) {
        await BookingSlotLock.deleteMany({ booking: booking._id });
        skipped.push({ date, reason: "trùng slot" });
        continue;
      }
    }
    await booking.save();
    if (!past) scheduleBookingReminder(booking).catch(() => {});
    if (cfg.markPaid) revenue += totalPrice;
    created.push({ date, id: booking._id, code: booking.code, totalPrice });
  }
  return { created, skipped, revenue };
}

/** Job: tự động gia hạn các lịch cố định sắp hết (autoRenew, còn active). */
export async function runRecurringAutoRenew() {
  const LEAD_DAYS = 10; // gia hạn khi còn ≤10 ngày là hết lịch đã tạo
  const today = todayStrVN();
  const threshold = addDaysStr(today, LEAD_DAYS);
  const plans = await VenueRecurringPlan.find({
    status: "active",
    autoRenew: true,
    lastGeneratedTo: { $lte: threshold },
  }).lean();
  let renewed = 0;
  for (const plan of plans) {
    try {
      const venue = await Venue.findById(plan.venue).lean();
      const court = await VenueCourt.findOne({ _id: plan.court, venue: plan.venue, isActive: true }).lean();
      if (!venue || venue.isActive === false || !court) continue;
      const from = addDaysStr(plan.lastGeneratedTo && plan.lastGeneratedTo >= today ? plan.lastGeneratedTo : today, 1);
      const to = addMonthsStr(from, plan.renewEveryMonths || 1);
      const dates = [];
      let cur = from;
      for (let g = 0; g < 800 && cur <= to && dates.length < 200; g += 1) {
        if ((plan.daysOfWeek || []).includes(weekdayOf(cur))) dates.push(cur);
        cur = addDaysStr(cur, 1);
      }
      if (dates.length) {
        await generateSessions({ venue, court, cfg: plan, group: plan.group, createdBy: plan.createdBy });
      }
      await VenueRecurringPlan.updateOne({ _id: plan._id }, { $set: { lastGeneratedTo: to, lastRenewedAt: new Date() } });
      renewed += 1;
      pushToUsers({
        recipients: await venueStaffIds(plan.venue, "recurring.manage"),
        title: "🔁 Đã tự gia hạn lịch cố định",
        body: `Lịch "${plan.customerName || "CLB"}" đã được gia hạn thêm ${plan.renewEveryMonths || 1} tháng (đến ${to.split("-").reverse().join("/")}).`,
        url: `/owner/venues/${plan.venue}`,
        data: { kind: "recurring_renewed", venueId: String(plan.venue), group: plan.group },
      }).catch(() => {});
    } catch (e) {
      console.warn("[autoRenew] fail plan", String(plan._id), e?.message || e);
    }
  }
  return { plans: plans.length, renewed };
}

/** GET /api/venues/:id/recurring — danh sách các lịch cố định (nhóm theo recurringGroup) */
export const listRecurringGroups = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res, "recurring.manage");
  const now = new Date();
  const groups = await Booking.aggregate([
    { $match: { venue: venue._id, recurringGroup: { $nin: [null, ""] } } },
    { $sort: { startAt: 1 } },
    {
      $group: {
        _id: "$recurringGroup",
        customerName: { $first: "$customerName" },
        customerPhone: { $first: "$customerPhone" },
        note: { $first: "$note" },
        court: { $first: "$court" },
        sampleStart: { $first: "$startAt" },
        sampleEnd: { $first: "$endAt" },
        firstStart: { $min: "$startAt" },
        lastStart: { $max: "$startAt" },
        weekdays: { $addToSet: { $dayOfWeek: { date: "$startAt", timezone: "Asia/Ho_Chi_Minh" } } },
        total: { $sum: 1 },
        upcoming: { $sum: { $cond: [{ $and: [{ $gt: ["$startAt", now] }, { $ne: ["$status", "cancelled"] }] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
        grossTotal: { $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, "$totalPrice", 0] } },
        paidRevenue: { $sum: { $cond: [{ $eq: ["$payment.status", "Paid"] }, "$totalPrice", 0] } },
        createdAt: { $first: "$createdAt" },
      },
    },
    { $sort: { lastStart: -1 } },
  ]);

  const courtIds = [...new Set(groups.map((g) => String(g.court)))];
  const courts = await VenueCourt.find({ _id: { $in: courtIds } }).select("name").lean();
  const courtMap = new Map(courts.map((c) => [String(c._id), c.name]));
  const plans = await VenueRecurringPlan.find({ venue: venue._id }).lean();
  const planMap = new Map(plans.map((p) => [p.group, p]));
  // $dayOfWeek: 1=CN..7=T7 → 0..6
  res.json(
    groups.map((g) => {
      const plan = planMap.get(g._id);
      return {
        group: g._id,
        customerName: g.customerName,
        customerPhone: g.customerPhone,
        note: g.note,
        courtName: courtMap.get(String(g.court)) || "",
        sampleStart: g.sampleStart,
        sampleEnd: g.sampleEnd,
        firstStart: g.firstStart,
        lastStart: g.lastStart,
        weekdays: (g.weekdays || []).map((d) => (d - 1)).sort((a, b) => a - b),
        total: g.total,
        upcoming: g.upcoming,
        cancelled: g.cancelled,
        grossTotal: g.grossTotal,
        paidRevenue: g.paidRevenue,
        // Thông tin kế hoạch tự gia hạn
        autoRenew: plan?.autoRenew || false,
        renewEveryMonths: plan?.renewEveryMonths || 1,
        planStatus: plan?.status || null,
        priceMode: plan?.priceMode || null,
      };
    }),
  );
});

/** DELETE /api/venues/:id/recurring/:group?scope=upcoming|all&hard=1
 * scope=upcoming (mặc định): huỷ các buổi sắp tới. scope=all: huỷ toàn bộ.
 * hard=1: XOÁ HẲN booking khỏi DB (dùng khi cài nhầm) — mặc định chỉ huỷ (giữ lịch sử).
 */
export const cancelRecurringGroup = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res, "recurring.manage");
  const group = String(req.params.group || "").trim();
  if (!group) {
    res.status(400);
    throw new Error("Thiếu mã lịch cố định");
  }
  const hard = req.query.hard === "1";

  const filter = { venue: venue._id, recurringGroup: group };
  if (!hard) filter.status = { $in: ACTIVE_STATUSES };
  if (req.query.scope !== "all") filter.startAt = { $gt: new Date() };

  const items = await Booking.find(filter).select("_id").lean();
  const ids = items.map((b) => b._id);
  if (ids.length) {
    await BookingSlotLock.deleteMany({ booking: { $in: ids } });
    if (hard) {
      await Booking.deleteMany({ _id: { $in: ids } });
    } else {
      await Booking.updateMany(
        { _id: { $in: ids } },
        { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: "Huỷ lịch cố định" } },
      );
    }
  }
  // Ngừng tự gia hạn: hard xoá hẳn kế hoạch; ngược lại chuyển sang "ended"
  if (hard) await VenueRecurringPlan.deleteOne({ venue: venue._id, group });
  else await VenueRecurringPlan.updateOne({ venue: venue._id, group }, { $set: { status: "ended", autoRenew: false } });
  res.json({ ok: true, [hard ? "deleted" : "cancelled"]: ids.length });
});

/** PATCH /api/venues/:id/recurring/:group — sửa series & bật/tắt tự gia hạn / kết thúc
 * body { customerName?, customerPhone?, note?, priceMode?, pricePerSession?, totalPackagePrice?,
 *        markPaid?, paymentMethod?, autoRenew?, renewEveryMonths?, endPlan?:bool }
 */
export const updateRecurringGroup = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res, "recurring.manage");
  const group = String(req.params.group || "").trim();
  if (!group) {
    res.status(400);
    throw new Error("Thiếu mã lịch cố định");
  }

  // 1) Cập nhật kế hoạch (tự gia hạn / kết thúc) — làm được kể cả khi không còn buổi sắp tới
  const planPatch = {};
  if (typeof req.body?.autoRenew === "boolean") planPatch.autoRenew = req.body.autoRenew;
  if (req.body?.renewEveryMonths !== undefined) planPatch.renewEveryMonths = Math.min(12, Math.max(1, Number(req.body.renewEveryMonths) || 1));
  if (req.body?.endPlan === true) { planPatch.status = "ended"; planPatch.autoRenew = false; }
  if (req.body?.customerName !== undefined) planPatch.customerName = String(req.body.customerName).slice(0, 120);
  if (req.body?.customerPhone !== undefined) planPatch.customerPhone = String(req.body.customerPhone).slice(0, 30);
  if (req.body?.note !== undefined) planPatch.note = String(req.body.note).slice(0, 300);
  if (["custom", "total", "auto"].includes(req.body?.priceMode)) planPatch.priceMode = req.body.priceMode;
  if (req.body?.pricePerSession !== undefined) planPatch.pricePerSession = Math.max(0, Math.round(Number(req.body.pricePerSession) || 0));
  if (req.body?.totalPackagePrice !== undefined) planPatch.totalPackagePrice = Math.max(0, Math.round(Number(req.body.totalPackagePrice) || 0));
  if (typeof req.body?.markPaid === "boolean") planPatch.markPaid = req.body.markPaid;
  if (Object.keys(planPatch).length) await VenueRecurringPlan.updateOne({ venue: venue._id, group }, { $set: planPatch });

  // 2) Áp thay đổi thông tin/giá cho các buổi SẮP TỚI (nếu có)
  const items = await Booking.find({
    venue: venue._id,
    recurringGroup: group,
    status: { $ne: "cancelled" },
    startAt: { $gt: new Date() },
  }).sort({ startAt: 1 });
  if (!items.length) {
    return res.json({ ok: true, updated: 0, planUpdated: Object.keys(planPatch).length > 0 });
  }

  const commissionPct = Number(venue.commissionPercent) || 0;
  const priceMode = ["custom", "total"].includes(req.body?.priceMode) ? req.body.priceMode : null;
  const markPaid = typeof req.body?.markPaid === "boolean" ? req.body.markPaid : null;
  const payMethod = req.body?.paymentMethod === "transfer" ? "transfer" : "cash";

  // Giá mới cho từng buổi (nếu có yêu cầu đổi giá)
  let prices = null;
  if (priceMode === "custom") {
    const p = Math.max(0, Math.round(Number(req.body?.pricePerSession) || 0));
    prices = items.map(() => p);
  } else if (priceMode === "total") {
    const total = Math.max(0, Math.round(Number(req.body?.totalPackagePrice) || 0));
    const n = items.length;
    const base = Math.floor(total / n);
    const rem = total - base * n;
    prices = items.map((_, i) => base + (i < rem ? 1 : 0));
  }

  for (let i = 0; i < items.length; i += 1) {
    const b = items[i];
    if (req.body?.customerName !== undefined) b.customerName = String(req.body.customerName).slice(0, 120);
    if (req.body?.customerPhone !== undefined) b.customerPhone = String(req.body.customerPhone).slice(0, 30);
    if (req.body?.note !== undefined) b.note = String(req.body.note).slice(0, 300);
    if (prices) {
      const tp = prices[i];
      const hours = (b.durationMin || 0) / 60;
      b.subtotal = tp;
      b.totalPrice = tp;
      b.pricePerHour = hours > 0 ? Math.round(tp / hours) : tp;
    }
    if (markPaid !== null) {
      if (markPaid) {
        b.payment = { ...(b.payment?.toObject?.() || b.payment || {}), status: "Paid", paidAt: b.payment?.paidAt || new Date(), method: payMethod, reviewedBy: req.user._id, reviewedAt: new Date() };
      } else {
        b.payment = { ...(b.payment?.toObject?.() || b.payment || {}), status: "Unpaid", paidAt: null };
      }
    }
    // Chốt lại hoa hồng theo trạng thái/giá hiện tại
    b.commissionAmount = b.payment?.status === "Paid" && commissionPct > 0 ? Math.round((b.totalPrice || 0) * commissionPct / 100) : 0;
    await b.save();
  }

  res.json({ ok: true, updated: items.length, grossTotal: items.reduce((s, b) => s + (b.totalPrice || 0), 0) });
});

/* ============================ TỔNG QUAN CHỦ SÂN ============================ */

/** GET /api/venues/mine/overview  — tổng hợp nhanh toàn bộ cụm sân của tôi */
export const myVenuesOverview = expressAsyncHandler(async (req, res) => {
  const uid = req.user._id;
  // Venue mà user là chủ / quản lý (managers) hoặc là nhân viên được cấp quyền
  const staffVenueIds = await VenueStaff.find({ user: uid, active: true }).distinct("venue");
  const venues = await Venue.find({
    $or: [{ owner: uid }, { managers: uid }, { _id: { $in: staffVenueIds } }],
  })
    .select("name province images isActive status")
    .lean();
  const ids = venues.map((v) => v._id);
  if (!ids.length) return res.json({ venues: [], totals: { awaiting: 0, todayCount: 0, todayRevenue: 0 } });

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const dayStart = buildInstant(todayStr, "00:00");
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);

  const [awaitingAgg, todayBookings] = await Promise.all([
    Booking.aggregate([
      { $match: { venue: { $in: ids }, status: "awaiting_approval" } },
      { $group: { _id: "$venue", count: { $sum: 1 } } },
    ]),
    Booking.find({ venue: { $in: ids }, startAt: { $gte: dayStart, $lt: dayEnd } })
      .select("venue status totalPrice payment")
      .lean(),
  ]);

  const awaitingMap = new Map(awaitingAgg.map((a) => [String(a._id), a.count]));
  const perVenue = new Map(ids.map((id) => [String(id), { todayCount: 0, todayRevenue: 0 }]));
  let awaiting = 0;
  let todayCount = 0;
  let todayRevenue = 0;
  for (const b of todayBookings) {
    if (b.status === "cancelled") continue;
    const k = String(b.venue);
    const pv = perVenue.get(k);
    if (pv) {
      pv.todayCount += 1;
      if (b.payment?.status === "Paid") pv.todayRevenue += Number(b.totalPrice) || 0;
    }
    todayCount += 1;
    if (b.payment?.status === "Paid") todayRevenue += Number(b.totalPrice) || 0;
  }
  for (const c of awaitingMap.values()) awaiting += c;

  res.json({
    venues: venues.map((v) => ({
      ...v,
      awaiting: awaitingMap.get(String(v._id)) || 0,
      todayCount: perVenue.get(String(v._id))?.todayCount || 0,
      todayRevenue: perVenue.get(String(v._id))?.todayRevenue || 0,
    })),
    totals: { awaiting, todayCount, todayRevenue },
  });
});

/* helper cục bộ */
function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
