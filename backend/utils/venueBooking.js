/**
 * Helpers cho đặt sân theo lưới giờ (alobo-style).
 * Giờ trong ngày lưu dạng "HH:MM"; ngày dạng "YYYY-MM-DD" (giờ địa phương VN, UTC+7).
 */

const VN_OFFSET = "+07:00";

/** "HH:MM" -> số phút từ 00:00. "24:00" -> 1440. */
export function parseHHMM(value) {
  const m = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59) return NaN;
  return h * 60 + min;
}

/** Số phút -> "HH:MM" */
export function minutesToHHMM(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" hợp lệ? */
export function isValidDateStr(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

/** Thứ trong tuần (0=CN..6=T7) từ "YYYY-MM-DD", an toàn TZ (dùng trưa UTC). */
export function weekdayOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? NaN : d.getUTCDay();
}

/** Dựng mốc thời gian tuyệt đối từ ngày + "HH:MM" theo giờ VN. */
export function buildInstant(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00${VN_OFFSET}`);
}

/** Giờ mở của (venue|court) cho 1 thứ; court override nếu có đủ 7 ngày. */
export function getDayHours(venue, court, weekday) {
  const fromCourt =
    Array.isArray(court?.openHours) && court.openHours.length === 7
      ? court.openHours[weekday]
      : null;
  const fromVenue =
    Array.isArray(venue?.openHours) && venue.openHours.length === 7
      ? venue.openHours[weekday]
      : null;
  const h = fromCourt || fromVenue || {};
  return {
    closed: Boolean(h.closed),
    open: h.open || "06:00",
    close: h.close || "22:00",
  };
}

/** Giá/giờ áp dụng cho 1 block bắt đầu lúc `minute` (thứ `weekday`). */
function pricePerHourAt(venue, court, weekday, minute) {
  const rules = Array.isArray(court?.priceRules) ? court.priceRules : [];
  for (const r of rules) {
    const days = Array.isArray(r.daysOfWeek) ? r.daysOfWeek : [];
    if (days.length && !days.includes(weekday)) continue;
    const s = parseHHMM(r.start);
    const e = parseHHMM(r.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (minute >= s && minute < e) return Number(r.pricePerHour) || 0;
  }
  return Number(court?.defaultPricePerHour || venue?.defaultPricePerHour || 0);
}

/**
 * Tính tổng tiền cho [startMin, endMin) (theo bước 15') + giá/giờ trung bình.
 */
export function computeBookingPrice(venue, court, weekday, startMin, endMin) {
  const STEP = 15;
  let total = 0;
  for (let m = startMin; m < endMin; m += STEP) {
    const blockLen = Math.min(STEP, endMin - m);
    const pph = pricePerHourAt(venue, court, weekday, m);
    total += (pph * blockLen) / 60;
  }
  total = Math.round(total);
  const hours = (endMin - startMin) / 60;
  const pricePerHour = hours > 0 ? Math.round(total / hours) : 0;
  return { totalPrice: total, pricePerHour };
}
