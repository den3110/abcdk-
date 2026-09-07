import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import Venue from "../models/venueModel.js";
import VenueProduct from "../models/venueProductModel.js";
import VenueSale from "../models/venueSaleModel.js";
import Booking from "../models/bookingModel.js";
import { canManageVenue } from "../utils/venueAuth.js";
import { isValidDateStr, buildInstant } from "../utils/venueBooking.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const DAY_MS = 24 * 60 * 60 * 1000;

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

/* ============================ SẢN PHẨM ============================ */

/** GET /api/venues/:id/products?all=1 */
export const listProducts = expressAsyncHandler(async (req, res) => {
  await requireManage(req, res);
  const filter = { venue: req.params.id };
  if (req.query.all !== "1") filter.active = true;
  const items = await VenueProduct.find(filter).sort({ order: 1, createdAt: 1 }).lean();
  res.json(items);
});

/** POST /api/venues/:id/products */
export const createProduct = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res);
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400);
    throw new Error("Cần nhập tên sản phẩm");
  }
  const doc = await VenueProduct.create({
    venue: venue._id,
    name,
    category: String(req.body?.category || "khác").trim(),
    price: Math.max(0, Number(req.body?.price) || 0),
    unit: String(req.body?.unit || "cái").slice(0, 20),
    trackStock: req.body?.trackStock !== false,
    stock: Math.max(0, Number(req.body?.stock) || 0),
    lowStockThreshold: Math.max(0, Number(req.body?.lowStockThreshold) || 5),
    imageUrl: String(req.body?.imageUrl || ""),
    order: Number(req.body?.order) || 0,
  });
  res.status(201).json(doc);
});

/** PATCH /api/venues/:id/products/:productId  (sửa / nhập thêm kho qua stockDelta) */
export const updateProduct = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res);
  const { productId } = req.params;
  if (!isId(productId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const p = await VenueProduct.findOne({ _id: productId, venue: venue._id });
  if (!p) {
    res.status(404);
    throw new Error("Không tìm thấy sản phẩm");
  }
  const b = req.body || {};
  if (b.name !== undefined) p.name = String(b.name).trim();
  if (b.category !== undefined) p.category = String(b.category).trim();
  if (b.price !== undefined) p.price = Math.max(0, Number(b.price) || 0);
  if (b.unit !== undefined) p.unit = String(b.unit).slice(0, 20);
  if (typeof b.trackStock === "boolean") p.trackStock = b.trackStock;
  if (b.stock !== undefined) p.stock = Math.max(0, Number(b.stock) || 0);
  if (b.stockDelta !== undefined) p.stock = Math.max(0, p.stock + (Number(b.stockDelta) || 0));
  if (b.lowStockThreshold !== undefined) p.lowStockThreshold = Math.max(0, Number(b.lowStockThreshold) || 0);
  if (b.imageUrl !== undefined) p.imageUrl = String(b.imageUrl);
  if (typeof b.active === "boolean") p.active = b.active;
  await p.save();
  res.json(p);
});

/** DELETE /api/venues/:id/products/:productId */
export const deleteProduct = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res);
  const { productId } = req.params;
  if (!isId(productId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  await VenueProduct.updateOne({ _id: productId, venue: venue._id }, { $set: { active: false } });
  res.json({ ok: true });
});

/* ============================ BÁN HÀNG ============================ */

/** POST /api/venues/:id/sales  { items:[{productId, qty}], paymentMethod, bookingId?, customerName, note } */
export const createSale = expressAsyncHandler(async (req, res) => {
  const venue = await requireManage(req, res);
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rawItems.length) {
    res.status(400);
    throw new Error("Chưa chọn sản phẩm");
  }

  const decremented = [];
  const items = [];
  let total = 0;
  try {
    for (const it of rawItems) {
      const qty = Math.max(1, Number(it.qty) || 1);
      if (!isId(it.productId)) throw Object.assign(new Error("Sản phẩm không hợp lệ"), { status: 400 });
      const product = await VenueProduct.findOne({ _id: it.productId, venue: venue._id });
      if (!product || !product.active) throw Object.assign(new Error("Sản phẩm không khả dụng"), { status: 400 });

      if (product.trackStock) {
        const upd = await VenueProduct.findOneAndUpdate(
          { _id: product._id, stock: { $gte: qty } },
          { $inc: { stock: -qty } },
          { new: true },
        );
        if (!upd) throw Object.assign(new Error(`"${product.name}" không đủ tồn kho`), { status: 409 });
        decremented.push({ id: product._id, qty });
      }
      const lineTotal = product.price * qty;
      total += lineTotal;
      items.push({ product: product._id, name: product.name, price: product.price, qty, lineTotal });
    }

    const sale = await VenueSale.create({
      venue: venue._id,
      booking: isId(req.body?.bookingId) ? req.body.bookingId : null,
      items,
      total,
      paymentMethod: req.body?.paymentMethod === "transfer" ? "transfer" : "cash",
      customerName: String(req.body?.customerName || "").slice(0, 120),
      note: String(req.body?.note || "").slice(0, 300),
      createdBy: req.user._id,
    });
    res.status(201).json(sale);
  } catch (e) {
    // hoàn tồn kho nếu lỗi giữa chừng
    for (const d of decremented) {
      await VenueProduct.updateOne({ _id: d.id }, { $inc: { stock: d.qty } }).catch(() => {});
    }
    res.status(e.status || 500);
    throw e;
  }
});

/** GET /api/venues/:id/sales?date=  (danh sách bán hàng) */
export const listSales = expressAsyncHandler(async (req, res) => {
  await requireManage(req, res);
  const filter = { venue: req.params.id };
  if (isValidDateStr(req.query.date)) {
    const s = buildInstant(req.query.date, "00:00");
    filter.createdAt = { $gte: s, $lt: new Date(s.getTime() + DAY_MS) };
  }
  const items = await VenueSale.find(filter).sort({ createdAt: -1 }).limit(300).lean();
  const total = items.reduce((s, x) => s + (Number(x.total) || 0), 0);
  res.json({ items, total, count: items.length });
});
