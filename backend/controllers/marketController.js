// controllers/marketController.js
// Chợ PickleTour — CRUD tin rao, đổi trạng thái, lưu tin, trả giá (offer), báo cáo.
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import MarketListing, {
  MARKET_CATEGORIES,
  MARKET_CONDITIONS,
  MARKET_TYPES,
  MARKET_STATUSES,
} from "../models/marketListingModel.js";
import MarketOffer from "../models/marketOfferModel.js";
import User from "../models/userModel.js";
import { postDirectMessage } from "./chatController.js";

const vnd = (n) => {
  try {
    return new Intl.NumberFormat("vi-VN").format(Number(n) || 0);
  } catch {
    return String(n || 0);
  }
};

const SELLER_FIELDS = "_id name nickname avatar role cccdStatus verified province";

const isVerifiedKyc = (u) =>
  !!u && (u.cccdStatus === "verified" || u.verified === "verified");

const oid = (v) => {
  try {
    return new mongoose.Types.ObjectId(String(v));
  } catch {
    return null;
  }
};

/* ───────────────────────── DTO ───────────────────────── */
function toSellerDTO(u) {
  if (!u) return null;
  const obj = u.toObject ? u.toObject() : u;
  return {
    _id: obj._id,
    name: obj.name || "",
    nickname: obj.nickname || "",
    avatar: obj.avatar || "",
    province: obj.province || "",
    verified: isVerifiedKyc(obj),
  };
}

function toListingDTO(doc, meUserId) {
  const obj = doc.toObject ? doc.toObject() : doc;
  const meId = meUserId ? String(meUserId) : "";
  const savedBy = (obj.savedBy || []).map((x) => String(x));
  const sellerId =
    obj.seller && obj.seller._id ? String(obj.seller._id) : String(obj.seller);
  return {
    _id: obj._id,
    title: obj.title,
    description: obj.description || "",
    category: obj.category,
    condition: obj.condition,
    type: obj.type,
    price: obj.price || 0,
    negotiable: !!obj.negotiable,
    tradeFor: obj.tradeFor || "",
    brand: obj.brand || "",
    size: obj.size || "",
    color: obj.color || "",
    images: obj.images || [],
    location: obj.location || { province: "", district: "" },
    contact: obj.contact || { phone: "", zalo: "", showPhone: false },
    status: obj.status,
    tags: obj.tags || [],
    views: obj.views || 0,
    savedCount: savedBy.length,
    offerCount: obj.offerCount || 0,
    featured: !!obj.featured,
    saved: meId ? savedBy.includes(meId) : false,
    isOwner: meId ? sellerId === meId : false,
    seller: toSellerDTO(obj.seller),
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    soldAt: obj.soldAt || null,
  };
}

/* ─────────────────── LIST (public) ─────────────────── */
// GET /api/market
export const listListings = asyncHandler(async (req, res) => {
  const {
    q,
    category,
    condition,
    type,
    minPrice,
    maxPrice,
    province,
    seller,
    sort = "newest",
    page = 1,
    limit = 20,
  } = req.query;

  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 48);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const meId = req.user?._id;

  const filter = {};
  // Mặc định chỉ hiển thị tin đang bán/giữ chỗ (không hiện hidden của người khác)
  if (seller) {
    const sid = oid(seller);
    if (sid) filter.seller = sid;
    // Xem tin của chính mình -> cho xem cả hidden/sold
    if (!meId || String(meId) !== String(seller)) {
      filter.status = { $in: ["available", "reserved", "sold"] };
    }
  } else {
    filter.status = { $in: ["available", "reserved"] };
  }

  if (category && MARKET_CATEGORIES.includes(category)) filter.category = category;
  if (condition && MARKET_CONDITIONS.includes(condition))
    filter.condition = condition;
  if (type && MARKET_TYPES.includes(type)) filter.type = type;
  if (province) filter["location.province"] = new RegExp(String(province).trim(), "i");

  const min = Number(minPrice);
  const max = Number(maxPrice);
  if (!Number.isNaN(min) && minPrice !== "" && minPrice != null)
    filter.price = { ...(filter.price || {}), $gte: min };
  if (!Number.isNaN(max) && maxPrice !== "" && maxPrice != null)
    filter.price = { ...(filter.price || {}), $lte: max };

  if (q && String(q).trim()) {
    const rx = new RegExp(
      String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i"
    );
    filter.$or = [{ title: rx }, { description: rx }, { brand: rx }, { tags: rx }];
  }

  let sortSpec;
  switch (sort) {
    case "price_asc":
      sortSpec = { featured: -1, price: 1, createdAt: -1 };
      break;
    case "price_desc":
      sortSpec = { featured: -1, price: -1, createdAt: -1 };
      break;
    case "popular":
      sortSpec = { featured: -1, views: -1, createdAt: -1 };
      break;
    case "newest":
    default:
      sortSpec = { featured: -1, createdAt: -1 };
      break;
  }

  const [items, total] = await Promise.all([
    MarketListing.find(filter)
      .sort(sortSpec)
      .skip((pg - 1) * lim)
      .limit(lim)
      .populate("seller", SELLER_FIELDS)
      .lean({ virtuals: false }),
    MarketListing.countDocuments(filter),
  ]);

  res.json({
    items: items.map((it) => toListingDTO(it, meId)),
    page: pg,
    limit: lim,
    total,
    hasMore: pg * lim < total,
  });
});

/* ─────────────────── DETAIL (public) ─────────────────── */
// GET /api/market/:id
export const getListing = asyncHandler(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "ID không hợp lệ" });

  const doc = await MarketListing.findById(id).populate("seller", SELLER_FIELDS);
  if (!doc) return res.status(404).json({ message: "Không tìm thấy tin đăng" });

  const meId = req.user?._id;
  const isOwner = meId && String(doc.seller?._id || doc.seller) === String(meId);

  // Tin ẩn chỉ chủ tin xem được
  if (doc.status === "hidden" && !isOwner) {
    return res.status(404).json({ message: "Không tìm thấy tin đăng" });
  }

  // Tăng lượt xem (không tính chủ tin)
  if (!isOwner) {
    MarketListing.updateOne({ _id: id }, { $inc: { views: 1 } }).catch(() => {});
    doc.views = (doc.views || 0) + 1;
  }

  res.json(toListingDTO(doc, meId));
});

/* ─────────────────── CREATE (KYC) ─────────────────── */
// POST /api/market
export const createListing = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    category,
    condition,
    type,
    price,
    negotiable,
    tradeFor,
    brand,
    size,
    color,
    images,
    location,
    contact,
    tags,
    status,
  } = req.body || {};

  if (!title || !String(title).trim()) {
    return res.status(400).json({ message: "Vui lòng nhập tiêu đề" });
  }
  const imgs = Array.isArray(images)
    ? images
        .map((im) =>
          typeof im === "string"
            ? { url: im }
            : im && im.url
            ? { url: im.url, mime: im.mime || "", w: im.w || 0, h: im.h || 0 }
            : null
        )
        .filter(Boolean)
        .slice(0, 12)
    : [];
  if (!imgs.length) {
    return res.status(400).json({ message: "Vui lòng thêm ít nhất 1 ảnh sản phẩm" });
  }

  const doc = await MarketListing.create({
    seller: req.user._id,
    title: String(title).trim().slice(0, 140),
    description: String(description || "").slice(0, 5000),
    category: MARKET_CATEGORIES.includes(category) ? category : "other",
    condition: MARKET_CONDITIONS.includes(condition) ? condition : "good",
    type: MARKET_TYPES.includes(type) ? type : "sell",
    price: Math.max(0, Number(price) || 0),
    negotiable: negotiable == null ? true : !!negotiable,
    tradeFor: String(tradeFor || "").slice(0, 300),
    brand: String(brand || "").slice(0, 60),
    size: String(size || "").slice(0, 40),
    color: String(color || "").slice(0, 40),
    images: imgs,
    location: {
      province: String(location?.province || "").slice(0, 80),
      district: String(location?.district || "").slice(0, 80),
    },
    contact: {
      phone: String(contact?.phone || "").slice(0, 20),
      zalo: String(contact?.zalo || "").slice(0, 40),
      showPhone: !!contact?.showPhone,
    },
    tags: Array.isArray(tags)
      ? tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 12)
      : [],
    status: status === "hidden" ? "hidden" : "available",
  });

  const populated = await doc.populate("seller", SELLER_FIELDS);
  res.status(201).json(toListingDTO(populated, req.user._id));
});

/* ─────────────────── UPDATE (owner) ─────────────────── */
// PUT /api/market/:id
export const updateListing = asyncHandler(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "ID không hợp lệ" });
  const doc = await MarketListing.findById(id);
  if (!doc) return res.status(404).json({ message: "Không tìm thấy tin đăng" });
  if (String(doc.seller) !== String(req.user._id)) {
    return res.status(403).json({ message: "Bạn không có quyền sửa tin này" });
  }

  const b = req.body || {};
  const set = (k, v) => {
    if (v !== undefined) doc[k] = v;
  };
  if (b.title !== undefined) doc.title = String(b.title).trim().slice(0, 140);
  if (b.description !== undefined)
    doc.description = String(b.description).slice(0, 5000);
  if (b.category !== undefined && MARKET_CATEGORIES.includes(b.category))
    doc.category = b.category;
  if (b.condition !== undefined && MARKET_CONDITIONS.includes(b.condition))
    doc.condition = b.condition;
  if (b.type !== undefined && MARKET_TYPES.includes(b.type)) doc.type = b.type;
  if (b.price !== undefined) doc.price = Math.max(0, Number(b.price) || 0);
  if (b.negotiable !== undefined) doc.negotiable = !!b.negotiable;
  if (b.tradeFor !== undefined) doc.tradeFor = String(b.tradeFor).slice(0, 300);
  if (b.brand !== undefined) doc.brand = String(b.brand).slice(0, 60);
  if (b.size !== undefined) doc.size = String(b.size).slice(0, 40);
  if (b.color !== undefined) doc.color = String(b.color).slice(0, 40);
  if (Array.isArray(b.images)) {
    doc.images = b.images
      .map((im) =>
        typeof im === "string"
          ? { url: im }
          : im && im.url
          ? { url: im.url, mime: im.mime || "", w: im.w || 0, h: im.h || 0 }
          : null
      )
      .filter(Boolean)
      .slice(0, 12);
  }
  if (b.location !== undefined) {
    doc.location = {
      province: String(b.location?.province || "").slice(0, 80),
      district: String(b.location?.district || "").slice(0, 80),
    };
  }
  if (b.contact !== undefined) {
    doc.contact = {
      phone: String(b.contact?.phone || "").slice(0, 20),
      zalo: String(b.contact?.zalo || "").slice(0, 40),
      showPhone: !!b.contact?.showPhone,
    };
  }
  if (Array.isArray(b.tags)) {
    doc.tags = b.tags
      .map((t) => String(t).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12);
  }
  set("", undefined);

  await doc.save();
  const populated = await doc.populate("seller", SELLER_FIELDS);
  res.json(toListingDTO(populated, req.user._id));
});

/* ─────────────────── UPDATE STATUS (owner) ─────────────────── */
// PATCH /api/market/:id/status  { status }
export const updateStatus = asyncHandler(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "ID không hợp lệ" });
  const { status } = req.body || {};
  if (!MARKET_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Trạng thái không hợp lệ" });
  }
  const doc = await MarketListing.findById(id);
  if (!doc) return res.status(404).json({ message: "Không tìm thấy tin đăng" });
  if (String(doc.seller) !== String(req.user._id)) {
    return res.status(403).json({ message: "Bạn không có quyền cập nhật tin này" });
  }
  doc.status = status;
  doc.soldAt = status === "sold" ? new Date() : null;
  await doc.save();
  const populated = await doc.populate("seller", SELLER_FIELDS);
  res.json(toListingDTO(populated, req.user._id));
});

/* ─────────────────── DELETE (owner/admin) ─────────────────── */
// DELETE /api/market/:id
export const deleteListing = asyncHandler(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "ID không hợp lệ" });
  const doc = await MarketListing.findById(id);
  if (!doc) return res.status(404).json({ message: "Không tìm thấy tin đăng" });
  const isAdmin = req.user?.role === "admin" || req.user?.isAdmin;
  if (String(doc.seller) !== String(req.user._id) && !isAdmin) {
    return res.status(403).json({ message: "Bạn không có quyền xoá tin này" });
  }
  await MarketOffer.deleteMany({ listing: id }).catch(() => {});
  await doc.deleteOne();
  res.json({ ok: true });
});

/* ─────────────────── SAVE / UNSAVE ─────────────────── */
// POST /api/market/:id/save  -> toggle
export const toggleSave = asyncHandler(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "ID không hợp lệ" });
  const doc = await MarketListing.findById(id).select("savedBy");
  if (!doc) return res.status(404).json({ message: "Không tìm thấy tin đăng" });
  const meId = String(req.user._id);
  const has = (doc.savedBy || []).some((x) => String(x) === meId);
  if (has) {
    doc.savedBy = doc.savedBy.filter((x) => String(x) !== meId);
  } else {
    doc.savedBy.push(req.user._id);
  }
  await doc.save();
  res.json({ saved: !has, savedCount: doc.savedBy.length });
});

// GET /api/market/saved
export const listSaved = asyncHandler(async (req, res) => {
  const meId = req.user._id;
  const pg = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 48);
  const filter = { savedBy: meId };
  const [items, total] = await Promise.all([
    MarketListing.find(filter)
      .sort({ createdAt: -1 })
      .skip((pg - 1) * lim)
      .limit(lim)
      .populate("seller", SELLER_FIELDS),
    MarketListing.countDocuments(filter),
  ]);
  res.json({
    items: items.map((it) => toListingDTO(it, meId)),
    page: pg,
    total,
    hasMore: pg * lim < total,
  });
});

// GET /api/market/mine
export const myListings = asyncHandler(async (req, res) => {
  const meId = req.user._id;
  const status = req.query.status;
  const filter = { seller: meId };
  if (status && MARKET_STATUSES.includes(status)) filter.status = status;
  const items = await MarketListing.find(filter)
    .sort({ createdAt: -1 })
    .populate("seller", SELLER_FIELDS);
  res.json({ items: items.map((it) => toListingDTO(it, meId)) });
});

/* ─────────────────── OFFERS ─────────────────── */
function toOfferDTO(o) {
  const obj = o.toObject ? o.toObject() : o;
  return {
    _id: obj._id,
    listing: obj.listing?._id
      ? {
          _id: obj.listing._id,
          title: obj.listing.title,
          price: obj.listing.price,
          images: obj.listing.images || [],
          status: obj.listing.status,
        }
      : obj.listing,
    buyer: obj.buyer?._id ? toSellerDTO(obj.buyer) : obj.buyer,
    seller: obj.seller?._id ? toSellerDTO(obj.seller) : obj.seller,
    amount: obj.amount || 0,
    message: obj.message || "",
    status: obj.status,
    createdAt: obj.createdAt,
  };
}

// POST /api/market/:id/offers  { amount, message }
export const createOffer = asyncHandler(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "ID không hợp lệ" });
  const listing = await MarketListing.findById(id).select(
    "seller status offerCount type title price images"
  );
  if (!listing) return res.status(404).json({ message: "Không tìm thấy tin đăng" });
  if (String(listing.seller) === String(req.user._id)) {
    return res.status(400).json({ message: "Bạn không thể trả giá tin của chính mình" });
  }
  if (!["available", "reserved"].includes(listing.status)) {
    return res.status(400).json({ message: "Tin này đã kết thúc, không thể trả giá" });
  }
  const amount = Math.max(0, Number(req.body?.amount) || 0);
  const message = String(req.body?.message || "").slice(0, 500);

  const offer = await MarketOffer.create({
    listing: id,
    buyer: req.user._id,
    seller: listing.seller,
    amount,
    message,
  });
  await MarketListing.updateOne({ _id: id }, { $inc: { offerCount: 1 } });

  // Gửi thẳng thông tin trả giá + sản phẩm vào tin nhắn cho người bán
  try {
    const buyerName = req.user.nickname || req.user.name || "Người mua";
    const lines = [
      "💰 ĐỀ NGHỊ MUA SẢN PHẨM",
      `🏓 ${listing.title || "Sản phẩm"}`,
      `Giá đăng: ${vnd(listing.price)} đ`,
      amount > 0
        ? `Giá đề nghị: ${vnd(amount)} đ`
        : "Giá đề nghị: (thương lượng)",
      message ? `Lời nhắn: "${message}"` : "",
      `🔗 https://pickletour.vn/marketplace/${String(id)}`,
    ].filter(Boolean);
    await postDirectMessage({
      fromUserId: req.user._id,
      toUserId: listing.seller,
      content: lines.join("\n"),
    });
  } catch (e) {
    // Không chặn luồng trả giá nếu gửi tin nhắn lỗi
  }

  const populated = await offer.populate([
    { path: "buyer", select: SELLER_FIELDS },
  ]);
  res.status(201).json(toOfferDTO(populated));
});

// GET /api/market/:id/offers   (chủ tin xem tất cả; người khác xem offer của mình)
export const listListingOffers = asyncHandler(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "ID không hợp lệ" });
  const listing = await MarketListing.findById(id).select("seller");
  if (!listing) return res.status(404).json({ message: "Không tìm thấy tin đăng" });
  const meId = String(req.user._id);
  const isOwner = String(listing.seller) === meId;
  const filter = { listing: id };
  if (!isOwner) filter.buyer = req.user._id;
  const offers = await MarketOffer.find(filter)
    .sort({ createdAt: -1 })
    .populate("buyer", SELLER_FIELDS);
  res.json({ items: offers.map(toOfferDTO), isOwner });
});

// GET /api/market/offers/mine  (offer tôi đã gửi)
export const myOffers = asyncHandler(async (req, res) => {
  const offers = await MarketOffer.find({ buyer: req.user._id })
    .sort({ createdAt: -1 })
    .populate("listing", "title price images status")
    .populate("seller", SELLER_FIELDS);
  res.json({ items: offers.map(toOfferDTO) });
});

// PATCH /api/market/offers/:offerId  { action: accept|reject }  (chủ tin)
export const respondOffer = asyncHandler(async (req, res) => {
  const oidv = oid(req.params.offerId);
  if (!oidv) return res.status(400).json({ message: "ID không hợp lệ" });
  const { action } = req.body || {};
  const offer = await MarketOffer.findById(oidv);
  if (!offer) return res.status(404).json({ message: "Không tìm thấy đề nghị" });
  if (String(offer.seller) !== String(req.user._id)) {
    return res.status(403).json({ message: "Bạn không có quyền xử lý đề nghị này" });
  }
  if (offer.status !== "pending") {
    return res.status(400).json({ message: "Đề nghị đã được xử lý" });
  }
  if (action === "accept") {
    offer.status = "accepted";
    // Giữ chỗ tin khi chấp nhận
    await MarketListing.updateOne(
      { _id: offer.listing, status: "available" },
      { status: "reserved" }
    ).catch(() => {});
  } else if (action === "reject") {
    offer.status = "rejected";
  } else {
    return res.status(400).json({ message: "Hành động không hợp lệ" });
  }
  await offer.save();
  const populated = await offer.populate("buyer", SELLER_FIELDS);
  res.json(toOfferDTO(populated));
});

// DELETE /api/market/offers/:offerId  (người gửi tự huỷ)
export const cancelOffer = asyncHandler(async (req, res) => {
  const oidv = oid(req.params.offerId);
  if (!oidv) return res.status(400).json({ message: "ID không hợp lệ" });
  const offer = await MarketOffer.findById(oidv);
  if (!offer) return res.status(404).json({ message: "Không tìm thấy đề nghị" });
  if (String(offer.buyer) !== String(req.user._id)) {
    return res.status(403).json({ message: "Bạn không có quyền huỷ đề nghị này" });
  }
  offer.status = "cancelled";
  await offer.save();
  res.json({ ok: true });
});

/* ─────────────────── STATS / KYC probe ─────────────────── */
// GET /api/market/me/can-post  -> { canPost, reason }
export const canPost = asyncHandler(async (req, res) => {
  const verified = isVerifiedKyc(req.user);
  res.json({
    canPost: verified,
    verified,
    reason: verified
      ? ""
      : "Bạn cần xác minh danh tính (CCCD/KYC) trước khi đăng tin mua bán.",
  });
});
