import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import Venue from "../models/venueModel.js";
import VenuePackage from "../models/venuePackageModel.js";
import PackagePurchase from "../models/packagePurchaseModel.js";
import { canManageVenue } from "../utils/venueAuth.js";
import { bookingBankInfo } from "../utils/bankQr.js";
import { publishNotification, EVENTS } from "../services/notifications/notificationHub.js";
import { createInAppNotifications } from "../services/inAppNotify.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);

async function requireManage(req, res) {
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

/* ============================ GÓI (chủ sân) ============================ */

/** GET /api/venues/:id/packages?all=1  (public: chỉ active; owner all=1) */
export const listPackages = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const filter = { venue: id };
  const wantAll = req.query.all === "1";
  if (wantAll) {
    const venue = await Venue.findById(id).select("owner managers").lean();
    if (!venue || !(await canManageVenue(req.user, venue))) {
      res.status(403);
      throw new Error("Không có quyền");
    }
  } else {
    filter.active = true;
  }
  const items = await VenuePackage.find(filter).sort({ createdAt: -1 }).lean();
  res.json(items);
});

/** POST /api/venues/:id/packages */
export const createPackage = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res);
  const name = String(req.body?.name || "").trim();
  const price = Math.max(0, Number(req.body?.price) || 0);
  if (!name || !price) {
    res.status(400);
    throw new Error("Cần nhập tên và giá gói");
  }
  const type = req.body?.type === "period" ? "period" : "credits";
  const doc = await VenuePackage.create({
    venue: venue._id,
    name,
    type,
    hours: type === "credits" ? Math.max(0, Number(req.body?.hours) || 0) : 0,
    validDays: Math.max(1, Number(req.body?.validDays) || 30),
    price,
    description: String(req.body?.description || "").slice(0, 500),
    active: req.body?.active !== false,
  });
  res.status(201).json(doc);
});

/** PATCH /api/venues/:id/packages/:packageId */
export const updatePackage = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res);
  const { packageId } = req.params;
  if (!isId(packageId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const p = await VenuePackage.findOne({ _id: packageId, venue: venue._id });
  if (!p) {
    res.status(404);
    throw new Error("Không tìm thấy gói");
  }
  const b = req.body || {};
  if (b.name !== undefined) p.name = String(b.name).trim();
  if (b.price !== undefined) p.price = Math.max(0, Number(b.price) || 0);
  if (b.hours !== undefined) p.hours = Math.max(0, Number(b.hours) || 0);
  if (b.validDays !== undefined) p.validDays = Math.max(1, Number(b.validDays) || 30);
  if (b.description !== undefined) p.description = String(b.description).slice(0, 500);
  if (typeof b.active === "boolean") p.active = b.active;
  await p.save();
  res.json(p);
});

/** DELETE /api/venues/:id/packages/:packageId */
export const deletePackage = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res);
  const { packageId } = req.params;
  if (!isId(packageId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  await VenuePackage.updateOne({ _id: packageId, venue: venue._id }, { $set: { active: false } });
  res.json({ ok: true });
});

/* ============================ MUA GÓI (khách) ============================ */

/** POST /api/venues/:id/packages/:packageId/purchase  (khách mua → chờ chủ sân kích hoạt) */
export const purchasePackage = expressAsyncHandler(async (req, res) => {
  const { id, packageId } = req.params;
  if (!isId(id) || !isId(packageId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const [venue, pkg] = await Promise.all([
    Venue.findById(id).lean(),
    VenuePackage.findOne({ _id: packageId, venue: id, active: true }).lean(),
  ]);
  if (!venue || !pkg) {
    res.status(404);
    throw new Error("Gói không khả dụng");
  }
  const existingPending = await PackagePurchase.findOne({ user: req.user._id, venue: id, package: packageId, status: "pending" });
  if (existingPending) {
    return res.json({ ...existingPending.toObject(), bank: bookingBankInfo(venue, { totalPrice: existingPending.price, code: `GOI${String(existingPending._id).slice(-6).toUpperCase()}` }) });
  }
  const minutes = pkg.type === "credits" ? Math.round((pkg.hours || 0) * 60) : 0;
  const doc = await PackagePurchase.create({
    user: req.user._id,
    venue: id,
    package: packageId,
    packageName: pkg.name,
    type: pkg.type,
    minutesTotal: minutes,
    minutesRemaining: minutes,
    price: pkg.price,
    status: "pending",
  });
  // báo chủ sân
  createInAppNotifications({
    recipients: [venue.owner, ...(venue.managers || [])].filter(Boolean),
    actorId: req.user._id,
    type: "BOOKING",
    title: "🎫 Khách mua gói giờ/thẻ",
    body: `${pkg.name} · ${(pkg.price || 0).toLocaleString("vi-VN")}đ — vào kích hoạt sau khi nhận tiền`,
    url: `/owner/venue/${id}/packages`,
  }).catch(() => {});
  res.status(201).json({ ...doc.toObject(), bank: bookingBankInfo(venue, { totalPrice: pkg.price, code: `GOI${String(doc._id).slice(-6).toUpperCase()}` }) });
});

/** GET /api/me/packages  (gói của tôi — còn hiệu lực) */
export const listMyPackages = expressAsyncHandler(async (req, res) => {
  const items = await PackagePurchase.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .populate("venue", "name")
    .lean();
  res.json(items);
});

/** GET /api/venues/:id/package-purchases?status=  (chủ sân xem lượt mua) */
export const listVenuePurchases = expressAsyncHandler(async (req, res) => {
  await requireManage(req, res);
  const filter = { venue: req.params.id };
  if (["pending", "active", "expired", "cancelled"].includes(req.query.status)) filter.status = req.query.status;
  const items = await PackagePurchase.find(filter)
    .sort({ status: 1, createdAt: -1 })
    .populate("user", "name nickname phone avatar")
    .lean();
  res.json(items);
});

/** PATCH /api/venues/:id/package-purchases/:purchaseId/activate  (chủ sân kích hoạt) */
export const activatePurchase = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res);
  const { purchaseId } = req.params;
  if (!isId(purchaseId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const pur = await PackagePurchase.findOne({ _id: purchaseId, venue: venue._id });
  if (!pur) {
    res.status(404);
    throw new Error("Không tìm thấy lượt mua");
  }
  if (pur.status !== "pending") {
    res.status(400);
    throw new Error("Lượt mua không ở trạng thái chờ");
  }
  pur.status = "active";
  pur.activatedBy = req.user._id;
  const pkg = await VenuePackage.findById(pur.package).select("validDays").lean();
  pur.expiresAt = new Date(Date.now() + (pkg?.validDays || 30) * 24 * 3600 * 1000);
  await pur.save();

  createInAppNotifications({ recipients: pur.user, actorId: req.user._id, type: "BOOKING", title: "✅ Gói đã kích hoạt", body: `${pur.packageName} đã sẵn sàng dùng khi đặt sân.`, url: "/courts/my-bookings" }).catch(() => {});
  publishNotification(EVENTS.USER_DIRECT_BROADCAST, { userId: String(pur.user), title: "✅ Gói đã kích hoạt", body: `${pur.packageName} đã sẵn sàng dùng.`, url: "/courts/my-bookings" }).catch(() => {});
  res.json(pur);
});
