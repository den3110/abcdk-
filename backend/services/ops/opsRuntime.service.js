// services/ops/opsRuntime.service.js
// Bắt lỗi runtime của API (5xx, exception chưa bắt) → đếm + bắn cảnh báo Telegram (đã throttle).
import crypto from "crypto";
import { reportOpsIncident, sendOpsAlert } from "./opsAlert.service.js";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_SAMPLES = 500;

// Bộ đếm trong RAM của process này (PM2 cluster → mỗi instance một bộ; đủ để phát hiện bão lỗi).
const samples = [];

function prune(now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  while (samples.length && samples[0].ts < cutoff) samples.shift();
  while (samples.length > MAX_SAMPLES) samples.shift();
}

function fingerprint(parts) {
  return crypto
    .createHash("sha1")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 10);
}

/** Bỏ id/uuid khỏi path để gộp cùng một route: /api/tournaments/<id>/matches */
export function normalizeRoutePath(path = "") {
  return String(path || "/")
    .split("?")[0]
    .replace(/\/[0-9a-fA-F]{24}(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-fA-F-]{32,36}(?=\/|$)/g, "/:uuid")
    .replace(/\/\d+(?=\/|$)/g, "/:n")
    .slice(0, 200);
}

/** Thống kê lỗi trong cửa sổ gần đây (dùng cho health check + digest). */
export function getRecentErrorStats(windowMs = WINDOW_MS) {
  const now = Date.now();
  prune(now);
  const cutoff = now - Math.min(windowMs, WINDOW_MS);
  const recent = samples.filter((s) => s.ts >= cutoff);
  const byRoute = new Map();
  for (const sample of recent) {
    const key = `${sample.method} ${sample.route}`;
    byRoute.set(key, (byRoute.get(key) || 0) + 1);
  }
  const top = [...byRoute.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([route, count]) => ({ route, count }));
  return {
    windowMinutes: Math.round(Math.min(windowMs, WINDOW_MS) / 60000),
    total: recent.length,
    top,
    lastAt: recent.length ? new Date(recent[recent.length - 1].ts) : null,
  };
}

const SPIKE_THRESHOLD = Math.max(
  3,
  Number(process.env.OPS_ALERT_5XX_SPIKE || 15)
);
const SPIKE_WINDOW_MS = 5 * 60 * 1000;

async function maybeAlertSpike() {
  const now = Date.now();
  const recent = samples.filter((s) => s.ts >= now - SPIKE_WINDOW_MS);
  if (recent.length < SPIKE_THRESHOLD) return;
  const stats = getRecentErrorStats(SPIKE_WINDOW_MS);
  await sendOpsAlert({
    key: "incident:5xx-spike",
    kind: "incident",
    severity: "critical",
    title: "Bão lỗi 5xx trên API",
    lines: [
      { label: "Số lỗi", value: `${recent.length} lỗi / ${Math.round(SPIKE_WINDOW_MS / 60000)} phút` },
      ...stats.top.map((t) => ({ label: t.route, value: `${t.count} lần` })),
    ],
    cooldownMs: 15 * 60 * 1000,
  });
}

/**
 * Ghi nhận 1 lỗi server. Gọi từ errorMiddleware (có Error) và httpLogger (chỉ có status).
 * Luôn nuốt lỗi nội bộ — không được ảnh hưởng response đang trả cho user.
 */
export function recordServerError({
  method = "GET",
  path = "",
  statusCode = 500,
  message = "",
  error = null,
  requestId = "",
  userId = "",
} = {}) {
  try {
    const route = normalizeRoutePath(path);
    samples.push({ ts: Date.now(), method: String(method).toUpperCase(), route });
    prune();

    const text = String(message || error?.message || "Lỗi không xác định").slice(0, 300);
    const key = `incident:http5xx:${fingerprint([method, route, text])}`;

    reportOpsIncident({
      key,
      severity: statusCode >= 500 ? "error" : "warn",
      title: `Lỗi ${statusCode} — ${String(method).toUpperCase()} ${route}`,
      lines: [
        { label: "Endpoint", value: `${String(method).toUpperCase()} ${route}` },
        { label: "HTTP", value: statusCode },
        requestId ? { label: "Request", value: requestId } : null,
        userId ? { label: "User", value: userId } : null,
      ].filter(Boolean),
      error: error || new Error(text),
      cooldownMs: Number(process.env.OPS_ALERT_5XX_COOLDOWN_MS || 30 * 60 * 1000),
    }).catch(() => {});

    maybeAlertSpike().catch(() => {});
  } catch (_) {
    // best-effort
  }
}

/** Cảnh báo lỗi cấp process (uncaughtException / unhandledRejection). */
let processHooksInstalled = false;

export function installOpsProcessHooks() {
  if (processHooksInstalled) return;
  processHooksInstalled = true;

  process.on("uncaughtException", (error) => {
    reportOpsIncident({
      key: `incident:uncaught:${fingerprint([error?.message])}`,
      severity: "critical",
      title: "Uncaught exception ở backend",
      error,
      cooldownMs: 10 * 60 * 1000,
    }).catch(() => {});
  });

  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    reportOpsIncident({
      key: `incident:unhandled:${fingerprint([error?.message])}`,
      severity: "error",
      title: "Unhandled promise rejection ở backend",
      error,
      cooldownMs: 30 * 60 * 1000,
    }).catch(() => {});
  });
}
