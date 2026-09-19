// controllers/imouController.js
// Owner-app endpoints để chủ sân quản lý cam Imou trên PickleTour.
// Session/creds được mã hoá AES-GCM qua encryptToken/decryptToken.

import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Venue from "../models/venueModel.js";
import VenueCourt from "../models/venueCourtModel.js";
import { encryptToken, decryptToken } from "../services/secret.service.js";

function canManageVenue(user, venue) {
  if (!user || !venue) return false;
  if (user.role === "admin" || user.isAdmin) return true;
  const uid = String(user._id || user.id || "");
  if (String(venue.owner) === uid) return true;
  const mgrs = Array.isArray(venue.managers) ? venue.managers : [];
  return mgrs.some((m) => String(m) === uid);
}

async function loadVenue(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Venue.findById(id);
}

/* ═════════════════ IMOU ACCOUNT (metadata) ═════════════════ */

// POST /api/imou/venues/:id/account — chủ sân báo đã login Imou (chỉ metadata SĐT/areaCode).
export const linkImouAccount = asyncHandler(async (req, res) => {
  const venue = await loadVenue(req.params.id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  if (!canManageVenue(req.user, venue)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const phone = String(req.body?.phone || "").trim();
  const areaCode = String(req.body?.areaCode || "84").trim();
  venue.imouAccount = {
    phone,
    areaCode,
    linkedAt: new Date(),
    lastCheckedAt: new Date(),
  };
  await venue.save();
  res.json({ ok: true, imouAccount: venue.imouAccount });
});

// DELETE /api/imou/venues/:id/account — unlink; clear luôn cams + session + creds.
export const unlinkImouAccount = asyncHandler(async (req, res) => {
  const venue = await loadVenue(req.params.id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  if (!canManageVenue(req.user, venue)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  venue.imouAccount = undefined;
  venue.imouSession = undefined;
  venue.imouCreds = undefined;
  await venue.save();
  // Clear cams trên mọi court thuộc venue để không rò cam-đã-unlink
  await VenueCourt.updateMany(
    { venue: venue._id },
    { $set: { imou: undefined, imouCams: [] } },
  );
  res.json({ ok: true });
});

/* ═════════════════ IMOU SESSION (encrypted) ═════════════════ */

// POST /api/imou/venues/:id/session — owner-app upload sau ImouNative.login()
export const uploadImouSession = asyncHandler(async (req, res) => {
  const venue = await loadVenue(req.params.id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  if (!canManageVenue(req.user, venue)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const sess = req.body || {};
  if (!sess.uuidUser || !sess.sessionId) {
    res.status(400);
    throw new Error("Session thiếu uuidUser/sessionId");
  }
  const cipher = encryptToken(JSON.stringify(sess));
  venue.imouSession = { cipher, updatedAt: new Date() };
  await venue.save();
  res.json({ ok: true, updatedAt: venue.imouSession.updatedAt });
});

// DELETE /api/imou/venues/:id/session
export const clearImouSession = asyncHandler(async (req, res) => {
  const venue = await loadVenue(req.params.id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  if (!canManageVenue(req.user, venue)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  venue.imouSession = undefined;
  await venue.save();
  res.json({ ok: true });
});

/* ═════════════════ IMOU CREDS (encrypted, cho auto-relogin) ═════════════════ */

export const uploadImouCreds = asyncHandler(async (req, res) => {
  const venue = await loadVenue(req.params.id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  if (!canManageVenue(req.user, venue)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const body = req.body || {};
  const phone = String(body.phone || "").trim();
  const password = String(body.password || "");
  const areaCode = String(body.areaCode || "84").trim();
  if (!phone || !password) {
    res.status(400);
    throw new Error("Thiếu phone/password");
  }
  const cipher = encryptToken(JSON.stringify({ phone, password, areaCode }));
  venue.imouCreds = { cipher, updatedAt: new Date() };
  await venue.save();
  res.json({ ok: true, updatedAt: venue.imouCreds.updatedAt });
});

// GET /api/imou/venues/:id/session — app lấy session mới nhất (có thể do
// server auto-live relogin) để importSession thay vì login lại.
export const getImouSession = asyncHandler(async (req, res) => {
  const venue = await loadVenue(req.params.id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  if (!canManageVenue(req.user, venue)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const cipher = venue.imouSession?.cipher;
  if (!cipher) {
    res.status(404);
    throw new Error("Chưa có session Imou nào được lưu");
  }
  try {
    const sess = JSON.parse(decryptToken(cipher));
    res.json({
      session: {
        uuidUser: sess.uuidUser || sess.uuid_user,
        uuidKey: sess.uuidKey || sess.uuid_key,
        sessionId: sess.sessionId || sess.session_id,
        regionalHost: sess.regionalHost || sess.regional_host,
      },
      updatedAt: venue.imouSession?.updatedAt,
    });
  } catch (e) {
    res.status(500);
    throw new Error("Không giải mã được session: " + e.message);
  }
});

export const getImouCreds = asyncHandler(async (req, res) => {
  const venue = await loadVenue(req.params.id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  if (!canManageVenue(req.user, venue)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const cipher = venue.imouCreds?.cipher;
  if (!cipher) {
    res.status(404);
    throw new Error("Chưa có creds. Đăng nhập Imou trong app quản lý để lưu.");
  }
  try {
    const plain = decryptToken(cipher);
    const creds = JSON.parse(plain);
    res.json({ creds, updatedAt: venue.imouCreds?.updatedAt });
  } catch (e) {
    res.status(500);
    throw new Error("Không giải mã được creds (key rotate?): " + e.message);
  }
});

export const clearImouCreds = asyncHandler(async (req, res) => {
  const venue = await loadVenue(req.params.id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  if (!canManageVenue(req.user, venue)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  venue.imouCreds = undefined;
  await venue.save();
  res.json({ ok: true });
});

/* ═════════════════ ATTACH CAMS TO COURTS ═════════════════ */

function plainCam(x = {}) {
  return {
    deviceId: String(x.deviceId || "").trim(),
    name: x.name ? String(x.name).slice(0, 60) : undefined,
    productId: x.productId ? String(x.productId).slice(0, 60) : undefined,
    maxZoomX: Number.isFinite(Number(x.maxZoomX)) ? Number(x.maxZoomX) : undefined,
    linkedAt: x.linkedAt || new Date(),
  };
}

function normalizeCamsOnCourt(court) {
  if (!Array.isArray(court.imouCams)) court.imouCams = [];
  if (!court.imouCams.length && court.imou?.deviceId) {
    court.imouCams.push(plainCam(court.imou));
  }
  court.imou = court.imouCams.length ? plainCam(court.imouCams[0]) : undefined;
}

// POST /api/imou/venues/:id/courts/:courtId/cams
export const addImouCam = asyncHandler(async (req, res) => {
  const venue = await loadVenue(req.params.id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  if (!canManageVenue(req.user, venue)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const court = await VenueCourt.findOne({
    _id: req.params.courtId,
    venue: venue._id,
  });
  if (!court) {
    res.status(404);
    throw new Error("Không tìm thấy court");
  }
  const cam = plainCam(req.body || {});
  if (!cam.deviceId) {
    res.status(400);
    throw new Error("Thiếu deviceId");
  }
  if (!Array.isArray(court.imouCams)) court.imouCams = [];
  if (court.imouCams.some((c) => c.deviceId === cam.deviceId)) {
    res.status(409);
    throw new Error("Cam đã gắn vào court này");
  }
  court.imouCams.push(cam);
  normalizeCamsOnCourt(court);
  await court.save();
  res.json({ ok: true, court });
});

// PATCH /api/imou/venues/:id/courts/:courtId/cams/:deviceId — đổi tên (name)
export const renameImouCam = asyncHandler(async (req, res) => {
  const venue = await loadVenue(req.params.id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  if (!canManageVenue(req.user, venue)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const court = await VenueCourt.findOne({
    _id: req.params.courtId,
    venue: venue._id,
  });
  if (!court) {
    res.status(404);
    throw new Error("Không tìm thấy court");
  }
  const cam = (court.imouCams || []).find(
    (c) => c.deviceId === req.params.deviceId,
  );
  if (!cam) {
    res.status(404);
    throw new Error("Không tìm thấy cam");
  }
  cam.name = String(req.body?.name || "").slice(0, 60);
  normalizeCamsOnCourt(court);
  await court.save();
  res.json({ ok: true, court });
});

// DELETE /api/imou/venues/:id/courts/:courtId/cams/:deviceId
export const removeImouCam = asyncHandler(async (req, res) => {
  const venue = await loadVenue(req.params.id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy sân");
  }
  if (!canManageVenue(req.user, venue)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const court = await VenueCourt.findOne({
    _id: req.params.courtId,
    venue: venue._id,
  });
  if (!court) {
    res.status(404);
    throw new Error("Không tìm thấy court");
  }
  court.imouCams = (court.imouCams || []).filter(
    (c) => c.deviceId !== req.params.deviceId,
  );
  normalizeCamsOnCourt(court);
  await court.save();
  res.json({ ok: true, court });
});

/* ═════════════════ THUMBNAIL PROXY (public) ═════════════════ */

// DQT 2-bảng inline cho DHAV headerless JPEG (giống PickleBook).
const DHAV_DQT_HEX =
  "ffdb0043000808080908090b0b0b0b0b0b0d0c0d0d0d0d0d0d0d0d0d0d0d0e0e0e1111110e0e0e0d0d0e0e10101111121312111111111313141414181817171c1c1d222229" +
  "ffdb0043010808080908090b0b0b0b0b0b0d0c0d0d0d0d0d0d0d0d0d0d0d0e0e0e1111110e0e0e0d0d0e0e10101111121312111111111313141414181817171c1c1d222229";
const DHAV_DQT = Buffer.from(DHAV_DQT_HEX, "hex");

// GET /api/imou/thumb?u=<imoulife.com URL đã signed>
export const imouThumbProxy = asyncHandler(async (req, res) => {
  const u = req.query.u;
  if (!u || typeof u !== "string") return res.status(400).end();
  let url;
  try {
    url = new URL(u);
  } catch {
    return res.status(400).end();
  }
  if (url.protocol !== "https:" || !/\.imoulife\.com$/i.test(url.hostname)) {
    return res.status(403).end();
  }
  const upstream = await fetch(u);
  if (!upstream.ok) return res.status(502).end();
  const buf = Buffer.from(await upstream.arrayBuffer());
  let jpeg;
  const soi = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  if (soi >= 0) {
    jpeg = buf.subarray(soi);
  } else {
    const sof = buf.indexOf(Buffer.from([0xff, 0xc0]));
    const eoi = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (sof < 0 || eoi < 0) return res.status(422).end();
    jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      DHAV_DQT,
      buf.subarray(sof, eoi + 2),
    ]);
  }
  res.set("Content-Type", "image/jpeg");
  res.set("Cache-Control", "public, max-age=86400");
  res.send(jpeg);
});
