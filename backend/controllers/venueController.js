import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import Venue from "../models/venueModel.js";
import VenueCourt from "../models/venueCourtModel.js";
import Booking from "../models/bookingModel.js";
import {
  canManageVenue,
  isCourtOwnerLike,
} from "../utils/venueAuth.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);

const toRad = (d) => (d * Math.PI) / 180;
const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

/* ============================ PUBLIC ============================ */

/** GET /api/venues?province=&keyword=&page=&limit=&lat=&lon=&radius= */
export const listVenues = expressAsyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const province = String(req.query.province || "").trim();
  const keyword = String(req.query.keyword || "").trim();
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const radiusKm = Number(req.query.radius) || 0;
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lon);

  const filter = { isActive: true, status: "active" };
  if (province) filter.province = province;
  if (keyword) {
    filter.$or = [
      { name: { $regex: keyword, $options: "i" } },
      { address: { $regex: keyword, $options: "i" } },
    ];
  }

  // Chế độ "gần tôi": lấy các sân có toạ độ, tính khoảng cách (haversine), lọc
  // theo bán kính rồi sắp xếp gần nhất. (Không cần index 2dsphere.)
  if (hasGeo) {
    const geoFilter = {
      ...filter,
      "locationGeo.lat": { $ne: null },
      "locationGeo.lon": { $ne: null },
    };
    const all = await Venue.find(geoFilter).limit(500).lean();
    let withDist = all.map((v) => ({
      ...v,
      distanceMeters: Math.round(
        haversineMeters(lat, lon, v.locationGeo.lat, v.locationGeo.lon),
      ),
    }));
    if (radiusKm > 0) withDist = withDist.filter((v) => v.distanceMeters <= radiusKm * 1000);
    withDist.sort((a, b) => a.distanceMeters - b.distanceMeters);
    const total = withDist.length;
    const paged = withDist.slice((page - 1) * limit, (page - 1) * limit + limit);
    const ids = paged.map((v) => v._id);
    const counts = ids.length
      ? await VenueCourt.aggregate([
          { $match: { venue: { $in: ids }, isActive: true } },
          { $group: { _id: "$venue", count: { $sum: 1 } } },
        ])
      : [];
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
    return res.json({
      items: paged.map((v) => ({ ...v, courtCount: countMap.get(String(v._id)) || 0 })),
      total,
      page,
      limit,
      near: true,
    });
  }

  const [items, total] = await Promise.all([
    Venue.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Venue.countDocuments(filter),
  ]);

  // Đếm số sân theo từng venue (1 query)
  const ids = items.map((v) => v._id);
  const counts = ids.length
    ? await VenueCourt.aggregate([
        { $match: { venue: { $in: ids }, isActive: true } },
        { $group: { _id: "$venue", count: { $sum: 1 } } },
      ])
    : [];
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

  res.json({
    items: items.map((v) => ({ ...v, courtCount: countMap.get(String(v._id)) || 0 })),
    total,
    page,
    limit,
  });
});

/** GET /api/venues/:id  (chi tiết + danh sách sân) */
export const getVenueById = expressAsyncHandler(async (req, res) => {
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
  const courts = await VenueCourt.find({ venue: id, isActive: true })
    .sort({ order: 1, createdAt: 1 })
    .lean();

  res.json({ ...venue, courts });
});

/* ===================== OWNER / ADMIN: VENUE ===================== */

/** GET /api/venues/mine  (các cụm sân của tôi) */
export const listMyVenues = expressAsyncHandler(async (req, res) => {
  const uid = req.user._id;
  const venues = await Venue.find({
    $or: [{ owner: uid }, { managers: uid }],
  })
    .sort({ createdAt: -1 })
    .lean();

  const ids = venues.map((v) => v._id);
  const counts = ids.length
    ? await VenueCourt.aggregate([
        { $match: { venue: { $in: ids } } },
        { $group: { _id: "$venue", count: { $sum: 1 } } },
      ])
    : [];
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

  res.json(
    venues.map((v) => ({ ...v, courtCount: countMap.get(String(v._id)) || 0 })),
  );
});

const VENUE_EDITABLE = [
  "name",
  "description",
  "phone",
  "address",
  "province",
  "locationGeo",
  "images",
  "amenities",
  "sport",
  "openHours",
  "slotMinutes",
  "defaultPricePerHour",
  "bankShortName",
  "bankAccountNumber",
  "bankAccountName",
  "depositPercent",
  "cancelPolicy",
];

function pickVenueFields(body = {}) {
  const out = {};
  for (const k of VENUE_EDITABLE) {
    if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }
  return out;
}

/** POST /api/venues  (chủ sân tạo cụm sân) */
export const createVenue = expressAsyncHandler(async (req, res) => {
  if (!isCourtOwnerLike(req.user)) {
    res.status(403);
    throw new Error("Bạn cần quyền chủ sân để tạo cụm sân");
  }
  const data = pickVenueFields(req.body);
  if (!String(data.name || "").trim()) {
    res.status(400);
    throw new Error("Cần nhập tên cụm sân");
  }
  const venue = await Venue.create({ ...data, owner: req.user._id });
  res.status(201).json(venue);
});

/** PUT /api/venues/:id */
export const updateVenue = expressAsyncHandler(async (req, res) => {
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
  if (!(await canManageVenue(req.user, venue))) {
    res.status(403);
    throw new Error("Không có quyền sửa cụm sân này");
  }
  Object.assign(venue, pickVenueFields(req.body));
  if (typeof req.body.isActive === "boolean") venue.isActive = req.body.isActive;
  await venue.save();
  res.json(venue);
});

/** DELETE /api/venues/:id  (ẩn cụm sân) */
export const deleteVenue = expressAsyncHandler(async (req, res) => {
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
  if (!(await canManageVenue(req.user, venue))) {
    res.status(403);
    throw new Error("Không có quyền xoá cụm sân này");
  }
  venue.isActive = false;
  venue.status = "suspended";
  await venue.save();
  res.json({ ok: true });
});

/* ===================== OWNER / ADMIN: COURTS ===================== */

const COURT_EDITABLE = [
  "name",
  "order",
  "sport",
  "defaultPricePerHour",
  "priceRules",
  "openHours",
  "status",
];

function pickCourtFields(body = {}) {
  const out = {};
  for (const k of COURT_EDITABLE) {
    if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }
  return out;
}

async function loadManageableVenue(req, res) {
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
  if (!(await canManageVenue(req.user, venue))) {
    res.status(403);
    throw new Error("Không có quyền với cụm sân này");
  }
  return venue;
}

/** POST /api/venues/:id/courts */
export const addCourt = expressAsyncHandler(async (req, res) => {
  const venue = await loadManageableVenue(req, res);
  const data = pickCourtFields(req.body);
  if (!String(data.name || "").trim()) {
    res.status(400);
    throw new Error("Cần nhập tên sân");
  }
  const court = await VenueCourt.create({ ...data, venue: venue._id });
  res.status(201).json(court);
});

/** PUT /api/venues/:id/courts/:courtId */
export const updateCourt = expressAsyncHandler(async (req, res) => {
  const venue = await loadManageableVenue(req, res);
  const { courtId } = req.params;
  if (!isId(courtId)) {
    res.status(400);
    throw new Error("ID sân không hợp lệ");
  }
  const court = await VenueCourt.findOne({ _id: courtId, venue: venue._id });
  if (!court) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  Object.assign(court, pickCourtFields(req.body));
  if (typeof req.body.isActive === "boolean") court.isActive = req.body.isActive;
  await court.save();
  res.json(court);
});

/** DELETE /api/venues/:id/courts/:courtId  (ẩn sân) */
export const deleteCourt = expressAsyncHandler(async (req, res) => {
  const venue = await loadManageableVenue(req, res);
  const { courtId } = req.params;
  if (!isId(courtId)) {
    res.status(400);
    throw new Error("ID sân không hợp lệ");
  }
  const court = await VenueCourt.findOne({ _id: courtId, venue: venue._id });
  if (!court) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  court.isActive = false;
  court.status = "maintenance";
  await court.save();
  res.json({ ok: true });
});
