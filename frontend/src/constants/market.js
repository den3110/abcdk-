// src/constants/market.js — nhãn / icon dùng chung cho Chợ PickleTour

export const CATEGORIES = [
  { key: "shoes", label: "Giày", emoji: "👟" },
  { key: "paddle", label: "Vợt", emoji: "🏓" },
  { key: "balls", label: "Bóng", emoji: "🎾" },
  { key: "apparel", label: "Quần áo", emoji: "👕" },
  { key: "bag", label: "Túi / Balo", emoji: "🎒" },
  { key: "accessory", label: "Phụ kiện", emoji: "🧢" },
  { key: "other", label: "Khác", emoji: "📦" },
];

export const CONDITIONS = [
  { key: "new", label: "Mới 100%", color: "#16a34a" },
  { key: "like_new", label: "Như mới", color: "#0ea5e9" },
  { key: "good", label: "Tốt", color: "#2563eb" },
  { key: "fair", label: "Khá", color: "#d97706" },
  { key: "used", label: "Đã dùng nhiều", color: "#6b7280" },
];

export const TYPES = [
  { key: "sell", label: "Bán", emoji: "💰", color: "#2563eb" },
  { key: "trade", label: "Trao đổi", emoji: "🔄", color: "#7c3aed" },
  { key: "giveaway", label: "Cho tặng", emoji: "🎁", color: "#db2777" },
];

export const STATUSES = [
  { key: "available", label: "Đang bán", color: "#16a34a" },
  { key: "reserved", label: "Giữ chỗ", color: "#d97706" },
  { key: "sold", label: "Đã bán", color: "#6b7280" },
  { key: "hidden", label: "Đã ẩn", color: "#9ca3af" },
];

export const SORTS = [
  { key: "newest", label: "Mới nhất" },
  { key: "price_asc", label: "Giá thấp → cao" },
  { key: "price_desc", label: "Giá cao → thấp" },
  { key: "popular", label: "Xem nhiều" },
];

const byKey = (arr) => Object.fromEntries(arr.map((x) => [x.key, x]));
export const CATEGORY_MAP = byKey(CATEGORIES);
export const CONDITION_MAP = byKey(CONDITIONS);
export const TYPE_MAP = byKey(TYPES);
export const STATUS_MAP = byKey(STATUSES);

export function formatPrice(v, type) {
  if (type === "giveaway") return "Miễn phí";
  if (type === "trade" && (!v || v <= 0)) return "Trao đổi";
  if (!v || v <= 0) return "Thương lượng";
  try {
    return new Intl.NumberFormat("vi-VN").format(v) + " ₫";
  } catch {
    return v + " ₫";
  }
}

export function timeAgo(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "vừa xong";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day} ngày trước`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} tháng trước`;
  return `${Math.floor(mo / 12)} năm trước`;
}
