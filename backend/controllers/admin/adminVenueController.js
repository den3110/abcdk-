import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import Venue from "../../models/venueModel.js";
import VenueCourt from "../../models/venueCourtModel.js";
import Booking from "../../models/bookingModel.js";
import { isValidDateStr, buildInstant } from "../../utils/venueBooking.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const DAY_MS = 24 * 60 * 60 * 1000;

/** GET /api/admin/venues?page=&limit=&keyword=&province=&status= */
export const adminListVenues = expressAsyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const keyword = String(req.query.keyword || "").trim();
  const province = String(req.query.province || "").trim();
  const status = String(req.query.status || "").trim();

  const filter = {};
  if (province) filter.province = province;
  if (status) filter.status = status;
  if (keyword) {
    filter.$or = [
      { name: { $regex: keyword, $options: "i" } },
      { address: { $regex: keyword, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    Venue.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("owner", "name email phone")
      .lean(),
    Venue.countDocuments(filter),
  ]);

  const ids = items.map((v) => v._id);
  const counts = ids.length
    ? await VenueCourt.aggregate([
        { $match: { venue: { $in: ids } } },
        { $group: { _id: "$venue", count: { $sum: 1 } } },
      ])
    : [];
  const cmap = new Map(counts.map((c) => [String(c._id), c.count]));

  res.json({
    items: items.map((v) => ({ ...v, courtCount: cmap.get(String(v._id)) || 0 })),
    total,
    page,
    limit,
  });
});

/** GET /api/admin/venues/:id  (chi tiết + sân + booking gần đây + tổng) */
export const adminGetVenue = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const venue = await Venue.findById(id).populate("owner", "name email phone").lean();
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy cụm sân");
  }
  const oid = new mongoose.Types.ObjectId(id);

  const [courts, recentBookings, statusAgg, paidAgg] = await Promise.all([
    VenueCourt.find({ venue: id }).sort({ order: 1, createdAt: 1 }).lean(),
    Booking.find({ venue: id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("court", "name")
      .populate("user", "name phone")
      .lean(),
    Booking.aggregate([
      { $match: { venue: oid } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: { venue: oid, "payment.status": "Paid" } },
      { $group: { _id: null, revenue: { $sum: "$totalPrice" }, count: { $sum: 1 } } },
    ]),
  ]);

  res.json({
    venue,
    courts,
    recentBookings,
    statusCounts: Object.fromEntries(statusAgg.map((a) => [a._id, a.count])),
    paidRevenue: paidAgg[0]?.revenue || 0,
    paidCount: paidAgg[0]?.count || 0,
  });
});

/** PATCH /api/admin/venues/:id/status  { status, isActive } */
export const adminSetVenueStatus = expressAsyncHandler(async (req, res) => {
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
  const { status, isActive } = req.body || {};
  if (["active", "pending", "suspended"].includes(status)) venue.status = status;
  if (typeof isActive === "boolean") venue.isActive = isActive;
  await venue.save();
  res.json(venue);
});

/** GET /api/admin/bookings?page=&limit=&status=&payment=&venueId=&from=&to= */
export const adminListBookings = expressAsyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  const filter = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.payment) filter["payment.status"] = String(req.query.payment);
  if (isId(req.query.venueId)) filter.venue = req.query.venueId;

  if (isValidDateStr(req.query.from) || isValidDateStr(req.query.to)) {
    const from = isValidDateStr(req.query.from) ? req.query.from : req.query.to;
    const to = isValidDateStr(req.query.to) ? req.query.to : req.query.from;
    const fromInstant = buildInstant(from, "00:00");
    const toInstant = new Date(buildInstant(to, "00:00").getTime() + DAY_MS);
    filter.startAt = { $gte: fromInstant, $lt: toInstant };
  }

  const [items, total] = await Promise.all([
    Booking.find(filter)
      .sort({ startAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("venue", "name province")
      .populate("court", "name")
      .populate("user", "name phone")
      .lean(),
    Booking.countDocuments(filter),
  ]);

  res.json({ items, total, page, limit });
});
