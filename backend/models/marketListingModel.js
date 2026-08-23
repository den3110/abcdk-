// models/marketListingModel.js
// Chợ PickleTour — tin rao bán / trao đổi / cho tặng đồ pickleball
// (giày, vợt, bóng, quần áo, túi, phụ kiện...). Chỉ user đã KYC được đăng.
import mongoose from "mongoose";

export const MARKET_CATEGORIES = [
  "shoes", // Giày
  "paddle", // Vợt
  "balls", // Bóng
  "apparel", // Quần áo
  "bag", // Túi / Balo
  "accessory", // Phụ kiện (grip, băng, kính...)
  "other", // Khác
];

export const MARKET_CONDITIONS = [
  "new", // Mới 100%
  "like_new", // Như mới (99%)
  "good", // Tốt
  "fair", // Khá
  "used", // Đã qua sử dụng nhiều
];

export const MARKET_TYPES = [
  "sell", // Bán
  "trade", // Trao đổi
  "giveaway", // Cho tặng
];

export const MARKET_STATUSES = [
  "available", // Đang bán
  "reserved", // Đang giữ chỗ / cọc
  "sold", // Đã bán / đã trao
  "hidden", // Ẩn (nháp)
];

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    mime: { type: String, default: "" },
    w: { type: Number, default: 0 },
    h: { type: Number, default: 0 },
  },
  { _id: false }
);

const marketListingSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, default: "", maxlength: 5000 },

    category: {
      type: String,
      enum: MARKET_CATEGORIES,
      default: "other",
      index: true,
    },
    condition: { type: String, enum: MARKET_CONDITIONS, default: "good" },
    type: { type: String, enum: MARKET_TYPES, default: "sell", index: true },

    // Giá VND. Với trao đổi / cho tặng có thể để 0.
    price: { type: Number, default: 0, min: 0, index: true },
    negotiable: { type: Boolean, default: true },
    // Mô tả muốn đổi gì (áp dụng type = trade)
    tradeFor: { type: String, default: "", maxlength: 300 },

    brand: { type: String, default: "", trim: true, maxlength: 60 },
    // size giày / size áo / trọng lượng vợt...
    size: { type: String, default: "", trim: true, maxlength: 40 },
    color: { type: String, default: "", trim: true, maxlength: 40 },

    // Phân loại hàng (như Shopee): 1 sản phẩm nhiều loại, mỗi loại 1 giá.
    // price = giá thấp nhất trong các loại (để lọc/sort/hiển thị "từ X").
    hasVariants: { type: Boolean, default: false },
    variantLabel: { type: String, default: "", trim: true, maxlength: 40 }, // "Size", "Phân loại", "Màu"
    variants: {
      type: [
        new mongoose.Schema(
          {
            name: { type: String, required: true, trim: true, maxlength: 60 }, // "40", "Đen - M"
            price: { type: Number, default: 0, min: 0 },
            stock: { type: Number, default: null }, // null = không quản lý số lượng
            images: { type: [imageSchema], default: [] }, // ảnh riêng của phân loại
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    images: { type: [imageSchema], default: [] },

    location: {
      province: { type: String, default: "", trim: true, maxlength: 80 },
      district: { type: String, default: "", trim: true, maxlength: 80 },
    },

    contact: {
      phone: { type: String, default: "", trim: true, maxlength: 20 },
      zalo: { type: String, default: "", trim: true, maxlength: 40 },
      showPhone: { type: Boolean, default: false },
    },

    status: {
      type: String,
      enum: MARKET_STATUSES,
      default: "available",
      index: true,
    },

    tags: { type: [String], default: [] },

    views: { type: Number, default: 0 },
    savedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    offerCount: { type: Number, default: 0 },

    // Admin có thể ghim tin nổi bật
    featured: { type: Boolean, default: false },
    // Đẩy tin nổi bật có thời hạn (featured = featuredUntil > now)
    featuredUntil: { type: Date, default: null },
    // Thời điểm được "đẩy lên đầu" — dùng để sort mới nhất
    bumpedAt: { type: Date, default: Date.now, index: true },
    lastBoostAt: { type: Date, default: null },

    soldAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Tìm kiếm full-text theo tiêu đề / mô tả / brand / tags
marketListingSchema.index({
  title: "text",
  description: "text",
  brand: "text",
  tags: "text",
});
marketListingSchema.index({ status: 1, createdAt: -1 });
marketListingSchema.index({ category: 1, status: 1, createdAt: -1 });
marketListingSchema.index({ featured: -1, createdAt: -1 });

const MarketListing =
  mongoose.models.MarketListing ||
  mongoose.model("MarketListing", marketListingSchema);

export default MarketListing;
