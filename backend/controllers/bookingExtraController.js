// controllers/bookingExtraController.js
// Các tính năng phát triển thêm cho đặt sân:
//  - Sân yêu thích (favorite venues)
//  - Thời tiết sân (open-meteo, keyless) cho sân ngoài trời
//  - Xuất lịch .ics cho 1 lượt đặt
//  - Sân mở ghép (open play): join/leave/list
//  - Báo cáo no-show theo khách cho chủ sân
import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import User from "../models/userModel.js";
import Venue from "../models/venueModel.js";
import VenueCourt from "../models/venueCourtModel.js";
import Booking from "../models/bookingModel.js";
import Ranking from "../models/rankingModel.js";
import { venueCan } from "../utils/venueAuth.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/* ========================= SÂN YÊU THÍCH ========================= */

/** POST /api/venues/:id/favorite  → bật/tắt yêu thích, trả { favorited } */
export const toggleFavoriteVenue = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const venue = await Venue.findById(id).select("_id").lean();
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy cụm sân");
  }
  const user = await User.findById(req.user._id).select("favoriteVenues");
  const list = user.favoriteVenues || [];
  const idx = list.findIndex((v) => String(v) === String(id));
  let favorited;
  if (idx >= 0) {
    list.splice(idx, 1);
    favorited = false;
  } else {
    list.unshift(id);
    favorited = true;
  }
  user.favoriteVenues = list;
  await user.save();
  res.json({ ok: true, favorited });
});

/** GET /api/venues/favorites/mine  → danh sách cụm sân đã thích */
export const listFavoriteVenues = expressAsyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .select("favoriteVenues")
    .populate({
      path: "favoriteVenues",
      match: { isActive: true },
      select:
        "name slug address province images amenities sport defaultPricePerHour locationGeo status",
    })
    .lean();
  const items = (user?.favoriteVenues || []).filter(Boolean);
  res.json(items);
});

/* ========================= THỜI TIẾT SÂN ========================= */

const _weatherCache = new Map(); // venueId -> { at, data }

/** GET /api/venues/:id/weather  → thời tiết hiện tại + vài giờ tới (open-meteo) */
export const getVenueWeather = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const venue = await Venue.findById(id).select("locationGeo name").lean();
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy cụm sân");
  }
  const lat = num(venue.locationGeo?.lat, null);
  const lon = num(venue.locationGeo?.lon, null);
  if (lat === null || lon === null || (lat === 0 && lon === 0)) {
    return res.json({ ok: true, available: false, message: "Cụm sân chưa có toạ độ." });
  }

  const cached = _weatherCache.get(id);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) {
    return res.json(cached.data);
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,precipitation,wind_speed_10m` +
      `&hourly=temperature_2m,precipitation_probability,weather_code` +
      `&timezone=Asia%2FHo_Chi_Minh&forecast_days=2`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("weather upstream " + r.status);
    const j = await r.json();
    const nowIso = new Date().toISOString().slice(0, 13); // yyyy-mm-ddTHH
    const times = j.hourly?.time || [];
    let startIdx = times.findIndex((t) => t.slice(0, 13) >= nowIso);
    if (startIdx < 0) startIdx = 0;
    const hours = [];
    for (let i = startIdx; i < Math.min(startIdx + 8, times.length); i++) {
      hours.push({
        time: times[i],
        temp: j.hourly.temperature_2m?.[i],
        rainProb: j.hourly.precipitation_probability?.[i],
        code: j.hourly.weather_code?.[i],
      });
    }
    const data = {
      ok: true,
      available: true,
      current: {
        temp: j.current?.temperature_2m,
        code: j.current?.weather_code,
        precipitation: j.current?.precipitation,
        wind: j.current?.wind_speed_10m,
      },
      hours,
    };
    _weatherCache.set(id, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.json({ ok: true, available: false, message: "Không lấy được thời tiết." });
  }
});

/* ========================= XUẤT LỊCH .ICS ========================= */

function icsEscape(s = "") {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function icsDate(d) {
  return new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** GET /api/bookings/:id/ics  → file lịch cho lượt đặt (thêm vào Google/Apple Calendar) */
export const getBookingIcs = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const b = await Booking.findById(id)
    .populate("venue", "name address")
    .populate("court", "name")
    .lean();
  if (!b) {
    res.status(404);
    throw new Error("Không tìm thấy lượt đặt");
  }
  const isOwner = b.user && String(b.user) === String(req.user._id);
  const canManage = await venueCan(req.user, b.venue?._id || b.venue, "bookings.view");
  if (!isOwner && !canManage) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const title = `Đặt sân ${b.venue?.name || ""}${b.court?.name ? ` - ${b.court.name}` : ""}`.trim();
  const loc = [b.venue?.name, b.venue?.address].filter(Boolean).join(", ");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PickleTour//Booking//VI",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:booking-${b._id}@pickletour.vn`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(b.startAt)}`,
    `DTEND:${icsDate(b.endAt)}`,
    `SUMMARY:${icsEscape(title)}`,
    `LOCATION:${icsEscape(loc)}`,
    `DESCRIPTION:${icsEscape(`Mã đặt ${b.code || ""}. Mở app PickleTour để xem chi tiết.`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT60M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Sắp đến giờ chơi pickleball",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="booking-${b.code || b._id}.ics"`);
  res.send(lines.join("\r\n"));
});

/* ========================= SÂN MỞ GHÉP (OPEN PLAY) ========================= */

async function userSkillDouble(userId) {
  const r = await Ranking.findOne({ user: userId }).select("single double mix").lean();
  if (!r) return null;
  const v = r.double ?? r.single ?? r.mix;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function goingCount(b) {
  const players = (b.openPlay?.players || []).filter((p) => p.status === "going").length;
  // +1 cho chủ lượt (người đặt sân)
  return players + 1;
}

/** GET /api/bookings/open-play  → danh sách lượt mở ghép sắp tới (public cho user đăng nhập) */
export const listOpenPlay = expressAsyncHandler(async (req, res) => {
  const province = String(req.query.province || "").trim();
  const now = new Date();
  const q = {
    "openPlay.enabled": true,
    status: { $in: ["pending", "confirmed"] },
    startAt: { $gt: now },
  };
  let venueIds = null;
  if (province) {
    const vs = await Venue.find({ province }).select("_id").lean();
    venueIds = vs.map((v) => v._id);
    q.venue = { $in: venueIds };
  }
  const items = await Booking.find(q)
    .sort({ startAt: 1 })
    .limit(200)
    .populate("venue", "name address province images")
    .populate("court", "name")
    .populate("user", "name nickname avatar")
    .lean();

  const out = items.map((b) => {
    const going = goingCount(b);
    const cap = b.openPlay?.capacity || 0;
    return {
      _id: b._id,
      startAt: b.startAt,
      endAt: b.endAt,
      venueId: b.venue?._id,
      venueName: b.venue?.name,
      address: b.venue?.address,
      province: b.venue?.province,
      coverImage: b.venue?.images?.[0] || "",
      courtName: b.court?.name,
      hostName: b.user?.nickname || b.user?.name || b.customerName || "Chủ kèo",
      capacity: cap,
      going,
      slotsLeft: Math.max(0, cap - going),
      pricePerPerson: b.openPlay?.pricePerPerson || 0,
      skillMin: b.openPlay?.skillMin || 0,
      skillMax: b.openPlay?.skillMax || 0,
      genderPolicy: b.openPlay?.genderPolicy || "any",
      note: b.openPlay?.note || "",
    };
  });
  res.json(out);
});

/** POST /api/bookings/:id/open-play/join */
export const joinOpenPlay = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const b = await Booking.findById(id);
  if (!b || !b.openPlay?.enabled) {
    res.status(404);
    throw new Error("Lượt mở ghép không tồn tại");
  }
  if (!["pending", "confirmed"].includes(b.status) || new Date(b.startAt) <= new Date()) {
    res.status(400);
    throw new Error("Lượt này đã diễn ra hoặc đã đóng.");
  }
  if (b.user && String(b.user) === String(req.user._id)) {
    res.status(400);
    throw new Error("Bạn là chủ kèo rồi.");
  }
  const already = (b.openPlay.players || []).find(
    (p) => p.user && String(p.user) === String(req.user._id) && p.status === "going",
  );
  if (already) {
    res.status(400);
    throw new Error("Bạn đã tham gia lượt này.");
  }
  if (goingCount(b) >= (b.openPlay.capacity || 0)) {
    res.status(409);
    throw new Error("Đã đủ người.");
  }

  const me = await User.findById(req.user._id).select("name nickname phone gender").lean();
  const skill = await userSkillDouble(req.user._id);
  // Kiểm điểm trình
  const sMin = b.openPlay.skillMin || 0;
  const sMax = b.openPlay.skillMax || 0;
  if (skill != null && ((sMin && skill < sMin) || (sMax && skill > sMax))) {
    res.status(400);
    throw new Error(`Lượt này yêu cầu trình ${sMin || 0}–${sMax || "∞"}.`);
  }
  // Kiểm giới tính
  const gp = b.openPlay.genderPolicy || "any";
  if (gp === "male" && me?.gender !== "male") {
    res.status(400);
    throw new Error("Lượt này chỉ dành cho nam.");
  }
  if (gp === "female" && me?.gender !== "female") {
    res.status(400);
    throw new Error("Lượt này chỉ dành cho nữ.");
  }

  // Nếu đã từng rời thì bật lại status
  const prev = (b.openPlay.players || []).find(
    (p) => p.user && String(p.user) === String(req.user._id),
  );
  if (prev) {
    prev.status = "going";
    prev.joinedAt = new Date();
  } else {
    b.openPlay.players.push({
      user: req.user._id,
      name: me?.nickname || me?.name || "",
      phone: me?.phone || "",
      skillPoint: skill,
      gender: me?.gender || "",
      status: "going",
      paid: false,
      joinedAt: new Date(),
    });
  }
  await b.save();
  res.json({ ok: true, going: goingCount(b), slotsLeft: Math.max(0, (b.openPlay.capacity || 0) - goingCount(b)) });
});

/** POST /api/bookings/:id/open-play/leave */
export const leaveOpenPlay = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const b = await Booking.findById(id);
  if (!b || !b.openPlay?.enabled) {
    res.status(404);
    throw new Error("Lượt mở ghép không tồn tại");
  }
  const p = (b.openPlay.players || []).find(
    (x) => x.user && String(x.user) === String(req.user._id) && x.status === "going",
  );
  if (!p) {
    res.status(400);
    throw new Error("Bạn chưa tham gia lượt này.");
  }
  p.status = "left";
  await b.save();
  res.json({ ok: true, going: goingCount(b) });
});

/* ========================= BÁO CÁO NO-SHOW ========================= */

/** GET /api/venues/:id/no-show-report?from=&to=  → khách hay bỏ hẹn (chủ sân) */
export const getVenueNoShowReport = expressAsyncHandler(async (req, res) => {
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
  if (!(await venueCan(req.user, venue, "analytics.view"))) {
    res.status(403);
    throw new Error("Không có quyền xem báo cáo");
  }
  const q = { venue: id, status: "no_show" };
  if (req.query.from) q.startAt = { ...(q.startAt || {}), $gte: new Date(req.query.from) };
  if (req.query.to) q.startAt = { ...(q.startAt || {}), $lte: new Date(req.query.to) };

  const rows = await Booking.find(q)
    .select("user customerName customerPhone startAt totalPrice depositAmount")
    .lean();

  const map = new Map();
  for (const b of rows) {
    const key = b.user ? String(b.user) : `guest:${b.customerPhone || b.customerName || "?"}`;
    const cur = map.get(key) || {
      key,
      userId: b.user ? String(b.user) : null,
      name: b.customerName || "",
      phone: b.customerPhone || "",
      count: 0,
      lostRevenue: 0,
      lastAt: null,
    };
    cur.count += 1;
    cur.lostRevenue += Number(b.totalPrice) || 0;
    if (!cur.lastAt || new Date(b.startAt) > new Date(cur.lastAt)) cur.lastAt = b.startAt;
    map.set(key, cur);
  }
  const list = [...map.values()].sort((a, b) => b.count - a.count);
  res.json({
    total: rows.length,
    uniqueCustomers: list.length,
    customers: list.slice(0, 100),
  });
});
