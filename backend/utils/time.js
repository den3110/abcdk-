// src/utils/time.js
import { DateTime } from "luxon";

/**
 * Convert chuỗi local time (theo timezone user) → Date UTC để lưu DB
 * @param {string} localISO      vd: "2025-11-24T09:00"
 * @param {string} timezone      vd: "Asia/Ho_Chi_Minh"
 */
export function localToUtcDate(localISO, timezone = "UTC") {
  if (!localISO) return null;

  // Nếu client đã gửi ISO có "Z" hoặc offset "+07:00" thì auto parse UTC luôn
  const hasZoneInfo =
    /z$/i.test(localISO) || /[+-]\d{2}:\d{2}$/.test(localISO);

  if (hasZoneInfo) {
    const dt = DateTime.fromISO(localISO);
    if (!dt.isValid) return null;
    return dt.toUTC().toJSDate();
  }

  // Không có timezone → coi là giờ local của user
  const dt = DateTime.fromISO(localISO, { zone: timezone });
  if (!dt.isValid) return null;
  return dt.toUTC().toJSDate();
}

/**
 * Convert Date UTC (từ DB) → ISO string theo timezone user
 */
export function utcDateToLocalISO(utcDate, timezone = "UTC") {
  if (!utcDate) return null;
  const dt = DateTime.fromJSDate(utcDate, { zone: "utc" }).setZone(timezone);
  if (!dt.isValid) return null;
  return dt.toISO(); // "2025-11-24T09:00:00.000+07:00"
}
