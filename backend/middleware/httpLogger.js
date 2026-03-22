import { logger } from "../services/logger.js";
import { recordRequestMetric } from "../services/requestMetrics.service.js";

export function httpLogger(req, res, next) {
  const start = Date.now();
  const requestId = req.headers["x-request-id"] || req.id || null;

  res.on("finish", () => {
    const duration = Date.now() - start;
    const userId = req.user?._id || req.user?.id || null;
    const url = req.originalUrl || req.url;

    recordRequestMetric({
      method: req.method,
      url,
      statusCode: res.statusCode,
      durationMs: duration,
    });

    logger.info("HTTP access", {
      type: "http_access",
      requestId,
      userId: userId ? String(userId) : null,
      method: req.method,
      url,
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
