// src/constants/play.js — helper hiển thị cho "Tìm bạn đánh"

export const PLAY_STATUS = {
  open: { label: "Đang mở", color: "#16a34a" },
  full: { label: "Đủ người", color: "#d97706" },
  closed: { label: "Đã đóng", color: "#6b7280" },
  cancelled: { label: "Đã huỷ", color: "#9ca3af" },
  done: { label: "Đã diễn ra", color: "#6b7280" },
};

const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export function formatPlayTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${WD[d.getDay()]} ${hh}:${mm} · ${dd}/${mo}`;
}

export function skillLabel(min, max) {
  const hasMin = min != null && min !== "";
  const hasMax = max != null && max !== "";
  if (!hasMin && !hasMax) return "Mọi trình";
  if (hasMin && hasMax) return `Trình ${min}–${max}`;
  if (hasMin) return `Trình ≥ ${min}`;
  return `Trình ≤ ${max}`;
}

export function isUpcoming(dateStr) {
  const d = new Date(dateStr).getTime();
  return d > Date.now();
}
