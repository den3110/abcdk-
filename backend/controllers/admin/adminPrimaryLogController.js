import asyncHandler from "express-async-handler";
import PrimaryLogEvent from "../../models/primaryLogEventModel.js";

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

function toDateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeLevel(value) {
  const normalized = asTrimmed(value).toLowerCase();
  return ["info", "warn", "error"].includes(normalized) ? normalized : "";
}

function normalizeBoolFilter(value) {
  const normalized = asTrimmed(value).toLowerCase();
  if (!normalized || normalized === "all") return null;
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  return null;
}

export const listPrimaryLogEvents = asyncHandler(async (req, res) => {
  const page = toPositiveInt(req.query?.page, 1, { min: 1, max: 10000 });
  const limit = toPositiveInt(req.query?.limit, 100, { min: 1, max: 300 });
  const source = asTrimmed(req.query?.source);
  const category = asTrimmed(req.query?.category);
  const type = asTrimmed(req.query?.type);
  const level = normalizeLevel(req.query?.level);
  const method = asTrimmed(req.query?.method).toUpperCase();
  const routingMode = asTrimmed(req.query?.routingMode);
  const q = asTrimmed(req.query?.q);
  const archivedFromObserver = normalizeBoolFilter(req.query?.archivedFromObserver);
  const since = toDateOrNull(req.query?.since);
  const until = toDateOrNull(req.query?.until);
  const occurredAt = {};
  if (since) occurredAt.$gte = since;
  if (until) occurredAt.$lte = until;

  const query = {
    ...(source ? { source } : {}),
    ...(category ? { category } : {}),
    ...(type ? { type } : {}),
    ...(level ? { level } : {}),
    ...(method ? { method } : {}),
    ...(routingMode ? { routingMode } : {}),
    ...(archivedFromObserver !== null ? { archivedFromObserver } : {}),
    ...(Object.keys(occurredAt).length ? { occurredAt } : {}),
  };

  if (q) {
    const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [
      { path: pattern },
      { url: pattern },
      { requestId: pattern },
      { "payload.smartLogReason": pattern },
      { "payload.smartLogMode": pattern },
    ];
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    PrimaryLogEvent.find(query)
      .sort({ occurredAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PrimaryLogEvent.countDocuments(query),
  ]);

  res.json({
    ok: true,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    items: items.map((item) => ({
      id: String(item._id),
      source: item.source,
      category: item.category,
      type: item.type,
      level: item.level,
      requestId: item.requestId,
      method: item.method,
      path: item.path,
      url: item.url,
      statusCode: item.statusCode,
      durationMs: item.durationMs,
      ip: item.ip,
      tags: item.tags || [],
      occurredAt: item.occurredAt,
      receivedAt: item.receivedAt,
      archivedFromObserver: item.archivedFromObserver === true,
      observerEventId: item.observerEventId || "",
      routingMode: item.routingMode || "",
      payload: item.payload || {},
    })),
  });
});
