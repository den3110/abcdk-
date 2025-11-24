// src/middleware/convertResponseDates.js
import { utcDateToLocalISO } from "../utils/time.js";

// Chỉ coi là "plain object" nếu prototype là Object.prototype hoặc null
function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepConvertDates(value, timezone, seen = new WeakSet()) {
  // 1) Nếu là Date → convert sang string theo timezone user
  if (value instanceof Date) {
    return utcDateToLocalISO(value, timezone) || value.toISOString();
  }

  // 2) Các kiểu primitive thì trả về luôn
  if (value === null || typeof value !== "object") {
    return value;
  }

  // 3) Chống vòng lặp
  if (seen.has(value)) {
    // gặp lại object đã xử lý → trả nguyên, không đi sâu nữa
    return value;
  }
  seen.add(value);

  // 4) Mảng
  if (Array.isArray(value)) {
    return value.map((item) => deepConvertDates(item, timezone, seen));
  }

  // 5) Plain object (JSON style)
  if (isPlainObject(value)) {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = deepConvertDates(v, timezone, seen);
    }
    return result;
  }

  // 6) Các object "xịn" (Mongoose document, class instance, ...) có toJSON
  if (typeof value.toJSON === "function") {
    try {
      const json = value.toJSON();
      return deepConvertDates(json, timezone, seen);
    } catch (e) {
      console.error("convertResponseDates.toJSON error:", e);
      return value;
    }
  }

  // 7) Còn lại (Stream, Buffer, DateTime, ...) → để nguyên, không đụng
  return value;
}

export function convertResponseDates(req, res, next) {
  const tz = req.userTimezone || "UTC";
  const originalJson = res.json.bind(res);

  res.json = (data) => {
    try {
      const converted = deepConvertDates(data, tz);
      return originalJson(converted);
    } catch (err) {
      console.error("convertResponseDates error:", err);
      // fallback: nếu convert lỗi thì gửi dữ liệu gốc, tránh crash
      return originalJson(data);
    }
  };

  next();
}
