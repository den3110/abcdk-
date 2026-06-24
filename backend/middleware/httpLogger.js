import { logger } from "../services/logger.js";
import { recordRequestMetric } from "../services/requestMetrics.service.js";
import {
  isObserverInternalPath,
} from "../services/observerConfig.service.js";
import { publishObserverEvent } from "../services/observerSink.service.js";
import {
  getPrimaryLogSinkStats,
  publishPrimaryLogEvent,
} from "../services/primaryLogSink.service.js";
import {
  decideSmartLogRoute,
  maybeAskSmartLogAiAdvisor,
} from "../services/smartLogPolicy.service.js";

const HOT_PATH_SLOW_MS = Math.max(
  100,
  Number(process.env.HTTP_ACCESS_HOT_PATH_SLOW_MS || 750)
);

const truthyEnv = (value) =>
  ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

const LOG_HOT_PATHS = truthyEnv(process.env.HTTP_ACCESS_LOG_HOT_PATHS);

function isHotLivePath(method, rawUrl = "") {
  const normalizedMethod = String(method || "GET").toUpperCase();
  let pathname = String(rawUrl || "/");
  try {
    pathname = new URL(pathname, "http://pickletour.local").pathname;
  } catch (_) {
    pathname = pathname.split("?")[0] || "/";
  }

  if (pathname === "/socket.io/") return true;
  if (normalizedMethod === "GET" && pathname === "/api/live/matches") return true;
  if (normalizedMethod === "GET" && pathname === "/api/live-app/bootstrap") return true;
  if (normalizedMethod === "GET" && pathname === "/api/live-app/clusters") return true;
  if (
    normalizedMethod === "GET" &&
    /^\/api\/live-app\/clusters\/[^/]+\/courts$/i.test(pathname)
  ) {
    return true;
  }
  if (
    normalizedMethod === "GET" &&
    /^\/api\/live-app\/tournaments\/[^/]+\/courts$/i.test(pathname)
  ) {
    return true;
  }
  if (
    normalizedMethod === "GET" &&
    /^\/api\/live-app\/courts\/[^/]+\/runtime$/i.test(pathname)
  ) {
    return true;
  }
  if (
    normalizedMethod === "GET" &&
    /^\/api\/live-app\/matches\/[^/]+\/runtime$/i.test(pathname)
  ) {
    return true;
  }
  if (
    normalizedMethod === "GET" &&
    /^\/api\/live-app\/court-stations\/[^/]+\/current-match$/i.test(pathname)
  ) {
    return true;
  }
  return (
    normalizedMethod === "POST" &&
    /^\/api\/live-app\/courts\/[^/]+\/presence\/(?:start|heartbeat|end|extend-preview)$/i.test(
      pathname
    )
  );
}

function shouldSkipDetailedHttpLog({ method, url, statusCode, durationMs }) {
  if (LOG_HOT_PATHS) return false;
  if (Number(statusCode) >= 400) return false;
  if (Number(durationMs) >= HOT_PATH_SLOW_MS) return false;
  return isHotLivePath(method, url);
}

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

    if (
      shouldSkipDetailedHttpLog({
        method: req.method,
        url,
        statusCode: res.statusCode,
        durationMs: duration,
      })
    ) {
      return;
    }

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

    const skipObserverForward =
      isObserverInternalPath(url) ||
      String(req.headers["x-pkt-observer-forwarded"] || "").trim() === "1";

    const logEvent = {
      category: "http_access",
      type: "http_access",
      level:
        res.statusCode >= 500
          ? "error"
          : res.statusCode >= 400
          ? "warn"
          : "info",
      requestId,
      method: req.method,
      path: req.path || req.baseUrl || "",
      url,
      statusCode: res.statusCode,
      durationMs: duration,
      ip:
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.ip ||
        req.connection?.remoteAddress ||
        "",
      payload: {
        userId: userId ? String(userId) : null,
        userAgent: req.headers["user-agent"] || "",
      },
    };

    const routeDecision = decideSmartLogRoute(logEvent, {
      primaryPending: getPrimaryLogSinkStats().pending,
    });
    const routedEvent = {
      ...logEvent,
      routingMode: routeDecision.mode,
      payload: {
        ...logEvent.payload,
        smartLogMode: routeDecision.mode,
        smartLogReason: routeDecision.reason,
      },
    };

    if (routeDecision.primary) {
      publishPrimaryLogEvent(routedEvent, { routingMode: routeDecision.mode });
    }

    if (!skipObserverForward && routeDecision.observer) {
      publishObserverEvent(routedEvent);
      maybeAskSmartLogAiAdvisor(routeDecision);
    }
  });

  next();
}
