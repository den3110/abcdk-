import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import Venue from "../models/venueModel.js";
import VenueProduct from "../models/venueProductModel.js";
import VenueSale from "../models/venueSaleModel.js";
import Booking from "../models/bookingModel.js";
import { venueCan, venueCanAny } from "../utils/venueAuth.js";
import { isValidDateStr, buildInstant } from "../utils/venueBooking.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Nạp venue + kiểm tra quyền. `perm` = 1 key hoặc mảng key (bất kỳ). */
async function requireAccess(req, res, perm) {
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
  const ok = Array.isArray(perm)
    ? await venueCanAny(req.user, venue, perm)
    : await venueCan(req.user, venue, perm);
  if (!ok) {
    res.status(403);
    throw new Error("Không có quyền với thao tác này");
  }
  return venue;
}

/* ============================ SẢN PHẨM ============================ */

/** GET /api/venues/:id/products?all=1 */
export const listProducts = expressAsyncHandler(async (req, res) => {
  await requireAccess(req, res, ["pos.sell", "pos.products"]);
  const filter = { venue: req.params.id };
  if (req.query.all !== "1") filter.active = true;
  const items = await VenueProduct.find(filter).sort({ order: 1, createdAt: 1 }).lean();
  res.json(items);
});

/** POST /api/venues/:id/products */
export const createProduct = expressAsyncHandler(async (req, res) => {
  const venue = await requireAccess(req, res, "pos.products");
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
  const venue = await requireAccess(req, res, "pos.products");
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
  const venue = await requireAccess(req, res, "pos.products");
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
/** Chuẩn hoá dòng dịch vụ / tiền sân (không trừ kho). */
function buildServiceItems(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  let total = 0;
  for (const s of arr) {
    const amount = Math.max(0, Number(s.amount) || 0);
    const qty = Math.max(1, Number(s.qty) || 1);
    const name = String(s.name || "Dịch vụ").slice(0, 120);
    if (amount <= 0) continue; // bỏ dòng 0đ
    const lineTotal = amount * qty;
    total += lineTotal;
    out.push({ name, amount, qty, lineTotal });
  }
  return { serviceItems: out, serviceTotal: total };
}

export const createSale = expressAsyncHandler(async (req, res) => {
  const venue = await requireAccess(req, res, "pos.sell");
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  const { serviceItems, serviceTotal } = buildServiceItems(req.body?.serviceItems);

  if (!rawItems.length && !serviceItems.length) {
    res.status(400);
    throw new Error("Hoá đơn phải có sản phẩm hoặc dịch vụ");
  }

  const decremented = [];
  const items = [];
  let total = serviceTotal;
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
      serviceItems,
      total,
      paymentMethod: req.body?.paymentMethod === "transfer" ? "transfer" : "cash",
      customerName: String(req.body?.customerName || "").slice(0, 120),
      customerPhone: String(req.body?.customerPhone || "").slice(0, 30),
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
  await requireAccess(req, res, ["pos.sell", "revenue.view"]);
  const filter = { venue: req.params.id };
  if (isValidDateStr(req.query.date)) {
    const s = buildInstant(req.query.date, "00:00");
    filter.createdAt = { $gte: s, $lt: new Date(s.getTime() + DAY_MS) };
  }
  const items = await VenueSale.find(filter).sort({ createdAt: -1 }).limit(300).lean();
  const total = items.reduce((s, x) => s + (Number(x.total) || 0), 0);
  res.json({ items, total, count: items.length });
});

/** Cộng/trừ tồn kho theo map { productId: deltaQty } (delta>0 = cộng lại tồn). */
async function applyStockDeltas(deltaByProduct) {
  const applied = [];
  const entries = Object.entries(deltaByProduct).filter(([, d]) => d !== 0);
  try {
    for (const [pid, delta] of entries) {
      const product = await VenueProduct.findById(pid);
      if (!product || !product.trackStock) continue; // chỉ chỉnh SP có theo dõi tồn
      if (delta < 0) {
        // cần trừ thêm tồn (bán nhiều hơn) → guard đủ tồn
        const need = -delta;
        const upd = await VenueProduct.findOneAndUpdate(
          { _id: product._id, stock: { $gte: need } },
          { $inc: { stock: delta } },
          { new: true },
        );
        if (!upd)
          throw Object.assign(new Error(`"${product.name}" không đủ tồn kho`), { status: 409 });
      } else {
        await VenueProduct.updateOne({ _id: product._id }, { $inc: { stock: delta } });
      }
      applied.push([pid, delta]);
    }
  } catch (e) {
    // rollback những gì đã áp
    for (const [pid, delta] of applied) {
      await VenueProduct.updateOne({ _id: pid }, { $inc: { stock: -delta } }).catch(() => {});
    }
    throw e;
  }
}

/** PATCH /api/venues/:id/sales/:saleId — sửa đơn (items/paymentMethod/note). */
export const updateSale = expressAsyncHandler(async (req, res) => {
  const venue = await requireAccess(req, res, "pos.sell");
  const { saleId } = req.params;
  if (!isId(saleId)) {
    res.status(400);
    throw new Error("Đơn không hợp lệ");
  }
  const sale = await VenueSale.findOne({ _id: saleId, venue: venue._id });
  if (!sale) {
    res.status(404);
    throw new Error("Không tìm thấy đơn");
  }

  // Nếu có gửi items → tính lại items sản phẩm + tồn kho theo chênh lệch.
  if (Array.isArray(req.body?.items)) {
    const rawItems = req.body.items;

    // qty cũ theo product
    const oldQty = {};
    for (const it of sale.items) {
      const pid = String(it.product);
      oldQty[pid] = (oldQty[pid] || 0) + (Number(it.qty) || 0);
    }

    // build items mới + qty mới
    const newQty = {};
    const items = [];
    for (const it of rawItems) {
      const qty = Math.max(1, Number(it.qty) || 1);
      if (!isId(it.productId)) {
        res.status(400);
        throw new Error("Sản phẩm không hợp lệ");
      }
      const product = await VenueProduct.findOne({ _id: it.productId, venue: venue._id });
      if (!product) {
        res.status(400);
        throw new Error("Sản phẩm không khả dụng");
      }
      newQty[String(product._id)] = (newQty[String(product._id)] || 0) + qty;
      const lineTotal = product.price * qty;
      items.push({ product: product._id, name: product.name, price: product.price, qty, lineTotal });
    }

    // delta = oldQty - newQty (dương = trả tồn lại; âm = trừ thêm tồn)
    const delta = {};
    for (const pid of new Set([...Object.keys(oldQty), ...Object.keys(newQty)])) {
      delta[pid] = (oldQty[pid] || 0) - (newQty[pid] || 0);
    }
    await applyStockDeltas(delta); // throw 409 nếu không đủ tồn (đã tự rollback)

    sale.items = items;
  }

  // Dịch vụ / tiền sân (không trừ kho).
  if (Array.isArray(req.body?.serviceItems)) {
    const { serviceItems } = buildServiceItems(req.body.serviceItems);
    sale.serviceItems = serviceItems;
  }

  if (req.body?.paymentMethod !== undefined) {
    sale.paymentMethod = req.body.paymentMethod === "transfer" ? "transfer" : "cash";
  }
  if (req.body?.note !== undefined) {
    sale.note = String(req.body.note || "").slice(0, 300);
  }
  if (req.body?.customerName !== undefined) {
    sale.customerName = String(req.body.customerName || "").slice(0, 120);
  }
  if (req.body?.customerPhone !== undefined) {
    sale.customerPhone = String(req.body.customerPhone || "").slice(0, 30);
  }

  // Tính lại tổng = sản phẩm + dịch vụ; đơn phải còn ≥ 1 dòng.
  const productTotal = (sale.items || []).reduce((s, x) => s + (Number(x.lineTotal) || 0), 0);
  const serviceTotal = (sale.serviceItems || []).reduce((s, x) => s + (Number(x.lineTotal) || 0), 0);
  if (!(sale.items || []).length && !(sale.serviceItems || []).length) {
    res.status(400);
    throw new Error("Đơn phải có ít nhất 1 sản phẩm hoặc dịch vụ");
  }
  sale.total = productTotal + serviceTotal;

  await sale.save();
  res.json(sale);
});

/** DELETE /api/venues/:id/sales/:saleId — xoá đơn + hoàn tồn kho. */
export const deleteSale = expressAsyncHandler(async (req, res) => {
  const venue = await requireAccess(req, res, "pos.sell");
  const { saleId } = req.params;
  if (!isId(saleId)) {
    res.status(400);
    throw new Error("Đơn không hợp lệ");
  }
  const sale = await VenueSale.findOne({ _id: saleId, venue: venue._id });
  if (!sale) {
    res.status(404);
    throw new Error("Không tìm thấy đơn");
  }

  // Hoàn tồn kho cho các sản phẩm có theo dõi tồn.
  for (const it of sale.items) {
    if (!isId(it.product)) continue;
    await VenueProduct.updateOne(
      { _id: it.product, trackStock: true },
      { $inc: { stock: Number(it.qty) || 0 } },
    ).catch(() => {});
  }

  await VenueSale.deleteOne({ _id: sale._id });
  res.json({ ok: true, deletedId: String(sale._id) });
});
