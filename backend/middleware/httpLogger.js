// src/middleware/httpLogger.js
import { logger } from "../services/logger.js";

export function httpLogger(req, res, next) {
  const start = Date.now();

  // lấy userId nếu bạn gắn vào req rồi
      const userId = req.user?._id || req.user?.id || null;
  const requestId =
    req.headers["x-request-id"] ||
    req.id ||
    null;

  res.on("finish", () => {
    const duration = Date.now() - start;

    // không await, cho chạy nền
    logger.info("HTTP access", {
      type: "http_access",
      requestId,
      userId: userId ? String(userId) : null,
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs: duration,
      ip:
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.ip ||
        req.connection?.remoteAddress ||
        null,
      meta: {
        userAgent: req.headers["user-agent"],
      },
    });
  });

  next();
}
