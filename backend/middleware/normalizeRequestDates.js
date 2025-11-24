// src/middleware/normalizeRequestDates.js
import { localToUtcDate } from "../utils/time.js";

// Tùy bạn thêm/bớt key ở đây, dùng chung cho toàn project
const DATE_KEYS = [
  "startTime",
  "endTime",
  "date",
  "deadline",
  "scheduledAt",
  "from",
  "to",
  "createdAt",
  "updatedAt",
  "endAt",
  "endDate",
  "regOpenDate",
  "registrationDeadline",
  "startAt",
  "startDate",
  
];

function isPlainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function normalizeObjectDates(obj, timezone) {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    obj.forEach((item) => normalizeObjectDates(item, timezone));
    return;
  }

  for (const [key, value] of Object.entries(obj)) {
    if (!value) continue;

    if (DATE_KEYS.includes(key)) {
      // Nếu FE gửi string → convert sang Date UTC
      if (typeof value === "string") {
        const d = localToUtcDate(value, timezone);
        if (d) obj[key] = d;
      }
      // Nếu FE gửi timestamp số (ms) → parse & chuẩn UTC luôn
      else if (typeof value === "number") {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) obj[key] = d;
      }
      // nếu đã là Date thì thôi
    } else if (isPlainObject(value) || Array.isArray(value)) {
      normalizeObjectDates(value, timezone);
    }
  }
}

/**
 * Middleware:
 * - Chỉ xử lý với method có khả năng ghi dữ liệu: POST / PUT / PATCH
 * - Dò mọi field trong req.body, nếu key nằm trong DATE_KEYS thì convert → Date UTC
 */
export function normalizeRequestDates(req, _res, next) {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return next();

  const tz = req.userTimezone || "UTC";
  normalizeObjectDates(req.body, tz);

  next();
}
