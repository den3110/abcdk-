import asyncHandler from "express-async-handler";
import { fetchObserverJson } from "../../services/observerReadProxy.service.js";

function asTrimmed(value) {
  return String(value || "").trim();
}

function toPositiveInt(value, fallback, { min = 1, max = 500 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.floor(numeric);
  if (rounded < min) return fallback;
  return Math.min(rounded, max);
}

function toBoolean(value, fallback = false) {
  const normalized = asTrimmed(value).toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function formatProxyError(res, error) {
  const statusCode = Number(error?.statusCode) || 502;
  return res.status(statusCode).json({
    ok: false,
    message: error?.message || "Không thể đọc dữ liệu Observer VPS.",
    code: error?.code || "observer_proxy_failed",
    upstreamStatus: error?.upstreamStatus || null,
    details:
      error?.upstreamPayload && typeof error.upstreamPayload === "object"
        ? error.upstreamPayload
        : null,
  });
}

export const getAdminObserverOverview = asyncHandler(async (req, res) => {
  const source = asTrimmed(req.query?.source);
  const minutes = toPositiveInt(req.query?.minutes, 60, {
    min: 5,
    max: 24 * 60,
  });
  const deviceLimit = toPositiveInt(req.query?.deviceLimit, 50, {
    min: 1,
    max: 200,
  });
  const deviceEventLimit = toPositiveInt(req.query?.deviceEventLimit, 30, {
    min: 1,
    max: 100,
  });
  const errorLimit = toPositiveInt(req.query?.errorLimit, 20, {
    min: 1,
    max: 100,
  });
  const onlineOnly = toBoolean(req.query?.onlineOnly, false);

  try {
    const [health, summary, liveDevices, deviceEvents, errorEvents] =
      await Promise.all([
        fetchObserverJson("/healthz", { useReadKey: false }),
        fetchObserverJson("/api/observer/read/summary", {
          query: { source, minutes },
        }),
        fetchObserverJson("/api/observer/read/live-devices", {
          query: { source, limit: deviceLimit, onlineOnly },
        }),
        fetchObserverJson("/api/observer/read/events", {
          query: { source, category: "live_device", limit: deviceEventLimit },
        }),
        fetchObserverJson("/api/observer/read/events", {
          query: { source, level: "error", limit: errorLimit },
        }),
      ]);

    return res.json({
      ok: true,
      source: source || null,
      windowMinutes: minutes,
      observerHealth: health,
      summary,
      liveDevices,
      deviceEvents,
      errorEvents,
      proxiedAt: new Date().toISOString(),
    });
  } catch (error) {
    return formatProxyError(res, error);
  }
});
