import { getObserverApiKey, getObserverReadApiKey } from "../services/observerConfig.service.js";

function extractObserverKey(req) {
  const headerKey =
    req.headers["x-pkt-observer-key"] ||
    req.headers["x-observer-key"] ||
    "";
  if (String(headerKey || "").trim()) return String(headerKey).trim();

  const auth = String(req.headers?.authorization || "").trim();
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1]?.trim() || "";
}

function buildAuthMiddleware(getExpectedKey, label) {
  return (req, res, next) => {
    const expectedKey = getExpectedKey();
    const providedKey = extractObserverKey(req);

    if (!expectedKey) {
      return res.status(503).json({
        ok: false,
        message: `${label} auth is not configured`,
      });
    }

    if (!providedKey || providedKey !== expectedKey) {
      return res.status(401).json({
        ok: false,
        message: `Invalid ${label} key`,
      });
    }

    return next();
  };
}

export const requireObserverApiKey = buildAuthMiddleware(
  getObserverApiKey,
  "observer ingest"
);

export const requireObserverReadKey = buildAuthMiddleware(
  getObserverReadApiKey,
  "observer read"
);
