// controllers/venueEventController.js — Sự kiện "xé vé" / đánh social: chủ sân tạo, user đăng ký vé
import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import Venue from "../models/venueModel.js";
import VenueCourt from "../models/venueCourtModel.js";
import VenueEvent from "../models/venueEventModel.js";
import EventRegistration from "../models/eventRegistrationModel.js";
import Ranking from "../models/rankingModel.js";
import { venueCan } from "../utils/venueAuth.js";
import { bookingBankInfo } from "../utils/bankQr.js";
import { pushToUsers, venueStaffIds } from "../services/venueNotify.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

const EVENT_EDITABLE = [
  "title", "description", "coverImage", "capacity", "price",
  "skillType", "skillMin", "skillMax", "genderPolicy", "maleQuota", "femaleQuota",
  "paymentMode", "court",
];
function pickEvent(body = {}) {
  const out = {};
  for (const k of EVENT_EDITABLE) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  return out;
}

async function loadVenuePerm(req, res, perm) {
  const { id } = req.params;
  if (!isId(id)) { res.status(400); throw new Error("ID không hợp lệ"); }
  const venue = await Venue.findById(id);
  if (!venue) { res.status(404); throw new Error("Không tìm thấy cụm sân"); }
  if (!(await venueCan(req.user, venue, perm))) { res.status(403); throw new Error("Không có quyền với thao tác này"); }
  return venue;
}

/** Lọc danh sách sân con thuộc đúng cụm sân (bỏ id lạ). */
async function ownCourts(venueId, arr) {
  const ids = (Array.isArray(arr) ? arr : []).filter(isId);
  if (!ids.length) return [];
  const found = await VenueCourt.find({ _id: { $in: ids }, venue: venueId }).select("_id").lean();
  return found.map((c) => c._id);
}

/** Điểm trình của user theo loại skill (double/single/mix). */
async function userSkill(userId, skillType = "double") {
  const r = await Ranking.findOne({ user: userId }).select("single double mix").lean();
  if (!r) return 0;
  return num(r[skillType] ?? r.double ?? r.single, 0);
}

/** Thống kê 1 sự kiện từ danh sách đăng ký active. */
function eventStats(regs) {
  const active = regs.filter((r) => r.status !== "cancelled");
  const paid = active.filter((r) => r.payment?.status === "Paid");
  const byGender = { male: 0, female: 0, other: 0 };
  for (const r of active) byGender[r.gender === "male" ? "male" : r.gender === "female" ? "female" : "other"] += 1;
  return {
    registered: active.length,
    paidCount: paid.length,
    revenue: paid.reduce((s, r) => s + (num(r.price) || 0), 0),
    checkedIn: active.filter((r) => r.ticket?.checkedInAt).length,
    byGender,
  };
}

/* ============================ CHỦ SÂN ============================ */

/** POST /api/venues/:id/events */
export const createEvent = expressAsyncHandler(async (req, res) => {
  const venue = await loadVenuePerm(req, res, "events.manage");
  const { title, startAt, endAt } = req.body || {};
  if (!String(title || "").trim()) { res.status(400); throw new Error("Cần nhập tên sự kiện"); }
  const s = new Date(startAt), e = new Date(endAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) {
    res.status(400); throw new Error("Thời gian sự kiện không hợp lệ");
  }
  const doc = await VenueEvent.create({
    ...pickEvent(req.body),
    venue: venue._id,
    createdBy: req.user._id,
    startAt: s,
    endAt: e,
    court: isId(req.body?.court) ? req.body.court : null,
    courts: await ownCourts(venue._id, req.body?.courts),
    status: "open",
  });
  res.status(201).json(doc);
});

/** PATCH /api/venues/:id/events/:eventId */
export const updateEvent = expressAsyncHandler(async (req, res) => {
  const venue = await loadVenuePerm(req, res, "events.manage");
  const { eventId } = req.params;
  const ev = await VenueEvent.findOne({ _id: eventId, venue: venue._id });
  if (!ev) { res.status(404); throw new Error("Không tìm thấy sự kiện"); }
  Object.assign(ev, pickEvent(req.body));
  if (req.body?.startAt) ev.startAt = new Date(req.body.startAt);
  if (req.body?.endAt) ev.endAt = new Date(req.body.endAt);
  if (["open", "closed", "cancelled"].includes(req.body?.status)) ev.status = req.body.status;
  if (req.body?.court !== undefined) ev.court = isId(req.body.court) ? req.body.court : null;
  if (Array.isArray(req.body?.courts)) ev.courts = await ownCourts(venue._id, req.body.courts);
  await ev.save();
  res.json(ev);
});

/** DELETE /api/venues/:id/events/:eventId — huỷ sự kiện + báo người đăng ký */
export const cancelEvent = expressAsyncHandler(async (req, res) => {
  const venue = await loadVenuePerm(req, res, "events.manage");
  const { eventId } = req.params;
  const ev = await VenueEvent.findOne({ _id: eventId, venue: venue._id });
  if (!ev) { res.status(404); throw new Error("Không tìm thấy sự kiện"); }
  ev.status = "cancelled";
  await ev.save();
  const regs = await EventRegistration.find({ event: ev._id, status: "registered", user: { $ne: null } }).select("user").lean();
  const uids = [...new Set(regs.map((r) => String(r.user)))];
  if (uids.length) {
    pushToUsers({
      recipients: uids,
      actorId: req.user._id,
      title: "Sự kiện đã bị huỷ",
      body: `"${ev.title}" tại ${venue.name} đã bị huỷ. Vui lòng liên hệ chủ sân nếu đã thanh toán.`,
      url: `/events/${ev._id}`,
      data: { kind: "event_cancelled", eventId: String(ev._id) },
    }).catch(() => {});
  }
  res.json({ ok: true });
});

/** GET /api/venues/:id/events — chủ sân xem tất cả sự kiện + thống kê nhanh */
export const listVenueEvents = expressAsyncHandler(async (req, res) => {
  const venue = await loadVenuePerm(req, res, "events.manage");
  const events = await VenueEvent.find({ venue: venue._id }).sort({ startAt: -1 }).limit(200).populate("courts", "name").lean();
  const ids = events.map((e) => e._id);
  const regs = await EventRegistration.find({ event: { $in: ids } }).select("event status payment price ticket gender").lean();
  const byEvent = new Map(ids.map((id) => [String(id), []]));
  for (const r of regs) byEvent.get(String(r.event))?.push(r);
  res.json(events.map((e) => ({ ...e, stats: eventStats(byEvent.get(String(e._id)) || []) })));
});

/** GET /api/venues/:id/events/:eventId/registrations — danh sách đăng ký + thống kê */
export const listEventRegistrations = expressAsyncHandler(async (req, res) => {
  const venue = await loadVenuePerm(req, res, "events.manage");
  const { eventId } = req.params;
  const ev = await VenueEvent.findOne({ _id: eventId, venue: venue._id }).lean();
  if (!ev) { res.status(404); throw new Error("Không tìm thấy sự kiện"); }
  const regs = await EventRegistration.find({ event: eventId }).sort({ createdAt: 1 }).populate("user", "name nickname phone avatar").lean();
  res.json({ event: ev, registrations: regs, stats: eventStats(regs) });
});

/** PATCH /api/venues/:id/events/:eventId/registrations/:regId — chủ sân: đánh dấu đã thu / huỷ */
export const updateRegistration = expressAsyncHandler(async (req, res) => {
  const venue = await loadVenuePerm(req, res, "events.manage");
  const { eventId, regId } = req.params;
  const reg = await EventRegistration.findOne({ _id: regId, event: eventId, venue: venue._id });
  if (!reg) { res.status(404); throw new Error("Không tìm thấy đăng ký"); }
  if (req.body?.markPaid === true) {
    reg.payment.status = "Paid";
    reg.payment.paidAt = new Date();
    reg.payment.reviewedBy = req.user._id;
    if (!reg.payment.method || reg.payment.method === "bank_qr") reg.payment.method = req.body?.method === "transfer" ? "transfer" : "cash";
  }
  if (req.body?.markPaid === false) { reg.payment.status = "Unpaid"; reg.payment.paidAt = null; }
  if (req.body?.status === "cancelled") reg.status = "cancelled";
  await reg.save();
  const user = await mongoose.model("User").findById(reg.user).select("name nickname phone avatar").lean().catch(() => null);
  res.json({ ...reg.toObject(), user });
});

/** POST /api/events/checkin  { token } — chủ sân/nhân viên quét vé sự kiện */
export const checkInEvent = expressAsyncHandler(async (req, res) => {
  const raw = String(req.body?.token || "").trim().replace(/^ptev:/, "");
  if (!raw) { res.status(400); throw new Error("Thiếu mã vé"); }
  const reg = await EventRegistration.findOne({ "ticket.token": raw }).populate("event", "title venue startAt").lean();
  if (!reg) { res.status(404); throw new Error("Vé không hợp lệ"); }
  if (!(await venueCan(req.user, reg.venue, "events.manage"))) { res.status(403); throw new Error("Vé thuộc sân khác"); }
  if (reg.status === "cancelled") { res.status(400); throw new Error("Vé đã huỷ"); }
  const summary = () => ({ code: reg.code, name: reg.name, phone: reg.phone, gender: reg.gender, skillPoint: reg.skillPoint, price: reg.price, paid: reg.payment?.status === "Paid", eventTitle: reg.event?.title, checkedInAt: reg.ticket?.checkedInAt });
  if (reg.ticket?.checkedInAt) return res.json({ ok: true, already: true, registration: summary() });
  await EventRegistration.updateOne({ _id: reg._id }, { $set: { "ticket.checkedInAt": new Date(), "ticket.checkedInBy": req.user._id } });
  reg.ticket = { ...reg.ticket, checkedInAt: new Date() };
  res.json({ ok: true, already: false, registration: summary() });
});

/* ============================ CÔNG KHAI / NGƯỜI CHƠI ============================ */

/** GET /api/events?province=&from= — duyệt sự kiện sắp diễn ra */
export const listPublicEvents = expressAsyncHandler(async (req, res) => {
  const now = new Date();
  const filter = { status: "open", endAt: { $gte: now } };
  if (isId(req.query.venue)) filter.venue = req.query.venue;
  const events = await VenueEvent.find(filter)
    .sort({ startAt: 1 })
    .limit(100)
    .populate("venue", "name address province images")
    .populate("courts", "name")
    .lean();
  const ids = events.map((e) => e._id);
  const counts = await EventRegistration.aggregate([
    { $match: { event: { $in: ids }, status: "registered" } },
    { $group: { _id: "$event", n: { $sum: 1 } } },
  ]);
  const cmap = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json(events.map((e) => ({ ...e, registered: cmap.get(String(e._id)) || 0 })));
});

/** GET /api/events/:eventId — chi tiết + đăng ký của tôi + QR */
export const getEvent = expressAsyncHandler(async (req, res) => {
  const { eventId } = req.params;
  if (!isId(eventId)) { res.status(400); throw new Error("ID không hợp lệ"); }
  const ev = await VenueEvent.findById(eventId)
    .populate("venue", "name address province images phone bankShortName bankCode bankAccountNumber bankAccountName")
    .populate("courts", "name")
    .lean();
  if (!ev) { res.status(404); throw new Error("Không tìm thấy sự kiện"); }
  const regs = await EventRegistration.find({ event: eventId }).select("user status payment price gender skillPoint ticket code name").lean();
  const stats = eventStats(regs);
  let myReg = null;
  if (req.user) {
    myReg = regs.find((r) => String(r.user) === String(req.user._id)) || null;
    if (myReg) myReg = { ...myReg, bank: ev.venue ? bookingBankInfo(ev.venue, { totalPrice: myReg.price, code: myReg.code }) : null };
  }
  res.json({ ...ev, stats, myRegistration: myReg });
});

/** POST /api/events/:eventId/register */
export const registerEvent = expressAsyncHandler(async (req, res) => {
  const { eventId } = req.params;
  if (!isId(eventId)) { res.status(400); throw new Error("ID không hợp lệ"); }
  const ev = await VenueEvent.findById(eventId);
  if (!ev || ev.status !== "open") { res.status(400); throw new Error("Sự kiện không mở đăng ký"); }
  if (new Date(ev.startAt).getTime() < Date.now()) { res.status(400); throw new Error("Sự kiện đã bắt đầu / kết thúc"); }

  const me = req.user;
  const already = await EventRegistration.findOne({ event: eventId, user: me._id });
  if (already && already.status !== "cancelled") { res.status(409); throw new Error("Bạn đã đăng ký sự kiện này"); }

  const regs = await EventRegistration.find({ event: eventId, status: "registered" }).select("gender").lean();
  if (regs.length >= ev.capacity) { res.status(409); throw new Error("Sự kiện đã đủ suất"); }

  // Giới tính
  const gender = me.gender || "unspecified";
  if (ev.genderPolicy === "male" && gender !== "male") { res.status(400); throw new Error("Sự kiện chỉ dành cho nam"); }
  if (ev.genderPolicy === "female" && gender !== "female") { res.status(400); throw new Error("Sự kiện chỉ dành cho nữ"); }
  if (ev.genderPolicy === "balanced") {
    const cnt = regs.filter((r) => r.gender === gender).length;
    const quota = gender === "male" ? ev.maleQuota : gender === "female" ? ev.femaleQuota : 0;
    if (quota > 0 && cnt >= quota) { res.status(409); throw new Error(`Đã đủ suất cho ${gender === "male" ? "nam" : "nữ"}`); }
  }

  // Điểm trình (chỉ chặn khi user CÓ điểm và nằm ngoài khoảng)
  const skill = await userSkill(me._id, ev.skillType);
  if (skill > 0) {
    if (ev.skillMin > 0 && skill < ev.skillMin) { res.status(400); throw new Error(`Cần điểm trình ≥ ${ev.skillMin}`); }
    if (ev.skillMax > 0 && skill > ev.skillMax) { res.status(400); throw new Error(`Chỉ nhận điểm trình ≤ ${ev.skillMax}`); }
  }

  const free = num(ev.price) <= 0;
  const doc = already || new EventRegistration({});
  doc.event = ev._id;
  doc.venue = ev.venue;
  doc.user = me._id;
  doc.name = String(req.body?.name || me.name || "").slice(0, 120);
  doc.phone = String(req.body?.phone || me.phone || "").slice(0, 30);
  doc.gender = gender;
  doc.skillPoint = skill;
  doc.note = String(req.body?.note || "").slice(0, 300);
  doc.price = num(ev.price);
  doc.status = "registered";
  doc.createdByRole = "customer";
  if (free) { doc.payment.status = "Paid"; doc.payment.method = "free"; doc.payment.paidAt = new Date(); }
  else if (already) { /* đăng ký lại sau khi huỷ: giữ payment cũ nếu đã trả, ngược lại Unpaid */ if (doc.payment.status !== "Paid") doc.payment.status = "Unpaid"; }
  await doc.save();

  // Báo chủ sân / người quản lý sự kiện
  pushToUsers({
    recipients: await venueStaffIds(ev.venue, "events.manage"),
    actorId: me._id,
    title: "🎟️ Có người đăng ký sự kiện",
    body: `${doc.name || "Khách"} đăng ký "${ev.title}"${free ? "" : ` · ${num(ev.price).toLocaleString("vi-VN")}đ`}`,
    url: `/owner/venues/${ev.venue}`,
    data: { kind: "event_register", eventId: String(ev._id), venueId: String(ev.venue) },
  }).catch(() => {});

  const venue = await Venue.findById(ev.venue).lean();
  res.status(201).json({
    ...doc.toObject(),
    bank: !free && ev.paymentMode === "online" && venue ? bookingBankInfo(venue, { totalPrice: doc.price, code: doc.code }) : null,
    paymentMode: ev.paymentMode,
  });
});

/** GET /api/events/mine — vé sự kiện của tôi */
export const listMyEventRegs = expressAsyncHandler(async (req, res) => {
  const regs = await EventRegistration.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate({ path: "event", select: "title startAt endAt venue coverImage status", populate: { path: "venue", select: "name address" } })
    .lean();
  res.json(regs);
});

/** POST /api/events/registrations/:regId/proof  { imageUrl, note } — gửi bill */
export const submitEventProof = expressAsyncHandler(async (req, res) => {
  const { regId } = req.params;
  const reg = await EventRegistration.findOne({ _id: regId, user: req.user._id });
  if (!reg) { res.status(404); throw new Error("Không tìm thấy đăng ký"); }
  const url = String(req.body?.imageUrl || "").trim();
  if (!url) { res.status(400); throw new Error("Thiếu ảnh bill"); }
  reg.payment.proofUrl = url;
  reg.payment.proofAt = new Date();
  if (req.body?.note) reg.note = String(req.body.note).slice(0, 300);
  await reg.save();
  pushToUsers({
    recipients: await venueStaffIds(reg.venue, "events.manage"),
    actorId: req.user._id,
    title: "💸 Bill sự kiện cần duyệt",
    body: `${reg.name || "Khách"} đã gửi bill vé ${reg.code}`,
    url: `/owner/venues/${reg.venue}`,
    data: { kind: "event_proof", eventId: String(reg.event), venueId: String(reg.venue) },
  }).catch(() => {});
  res.json(reg);
});

/** DELETE /api/events/registrations/:regId — tự huỷ đăng ký */
export const cancelMyReg = expressAsyncHandler(async (req, res) => {
  const { regId } = req.params;
  const reg = await EventRegistration.findOne({ _id: regId, user: req.user._id });
  if (!reg) { res.status(404); throw new Error("Không tìm thấy đăng ký"); }
  reg.status = "cancelled";
  await reg.save();
  res.json({ ok: true });
});
