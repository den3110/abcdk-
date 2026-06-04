import { BASE_URL } from "../../slices/apiSlice";

/** Dựng URL ảnh: tuyệt đối giữ nguyên, tương đối thì prefix BASE_URL. */
export function imgSrc(path) {
  const p = String(path || "").trim();
  if (!p) return "";
  if (/^https?:\/\//i.test(p) || p.startsWith("data:")) return p;
  const base = String(BASE_URL || "").replace(/\/+$/, "");
  return `${base}${p.startsWith("/") ? "" : "/"}${p}`;
}

/** Định dạng tiền VND. */
export function fmtVND(n) {
  const v = Number(n) || 0;
  return `${v.toLocaleString("vi-VN")}đ`;
}

/** Bỏ dấu tiếng Việt (cho nội dung chuyển khoản). */
export function normalizeNoAccent(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const WEEKDAYS_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
export const WEEKDAYS_LONG = [
  "Chủ nhật",
  "Thứ 2",
  "Thứ 3",
  "Thứ 4",
  "Thứ 5",
  "Thứ 6",
  "Thứ 7",
];

export const BOOKING_STATUS = {
  pending: { label: "Chờ duyệt", color: "warning" },
  confirmed: { label: "Đã xác nhận", color: "success" },
  cancelled: { label: "Đã huỷ", color: "default" },
  completed: { label: "Hoàn tất", color: "info" },
  no_show: { label: "Không đến", color: "error" },
};

export const PAYMENT_STATUS = {
  Unpaid: { label: "Chưa thanh toán", color: "warning" },
  Paid: { label: "Đã thanh toán", color: "success" },
};

/** Định dạng giờ "HH:MM" → "HH:MM" (giữ nguyên, helper cho rõ nghĩa). */
export function fmtTime(hhmm) {
  return String(hhmm || "");
}

/** YYYY-MM-DD theo giờ VN cho 1 Date (mặc định hôm nay). */
export function toDateInput(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

/** Cộng n ngày vào "YYYY-MM-DD". */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Ngày đầu tháng của "YYYY-MM-DD". */
export function monthStart(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

/** Thứ trong tuần (0=CN..6=T7) từ "YYYY-MM-DD". */
export function weekdayOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? 0 : d.getUTCDay();
}

/** Hiển thị ngày dạng "Thứ 2, 09/06". */
export function fmtDateLabel(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${WEEKDAYS_LONG[weekdayOf(dateStr)]}, ${d}/${m}/${y}`;
}

/**
 * URL ảnh QR sepay cho 1 lượt đặt sân.
 * venue cần có bankShortName + bankAccountNumber.
 */
export function bookingQrUrl(venue, booking) {
  const bank = venue?.bankShortName || venue?.qrBank || "";
  const acc = venue?.bankAccountNumber || venue?.qrAccount || "";
  if (!bank || !acc) return "";
  const amount =
    Number(booking?.depositAmount) > 0
      ? Number(booking.depositAmount)
      : Number(booking?.totalPrice) || 0;
  const des = normalizeNoAccent(
    `Dat san ${venue?.name || ""} Ma ${booking?.code || ""}`,
  );
  const params = new URLSearchParams({ bank, acc, des, template: "compact" });
  if (amount > 0) params.set("amount", String(amount));
  return `https://qr.sepay.vn/img?${params.toString()}`;
}
