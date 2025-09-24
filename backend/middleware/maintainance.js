// middlewares/versionGate.js
// Trả về 503 nếu bật bảo trì trong SystemSettings,
// ngoại lệ: những miền (host) được chỉ định trong ENV MAINTENANCE_BYPASS_HOSTS.

let __maintCache = { ts: 0, enabled: false, message: "" };
const TTL_MS = 5000;

// Parse danh sách miền bypass từ ENV (hỗ trợ wildcard, phân tách bằng dấu phẩy)
const BYPASS_PATTERNS = (process.env.MAINTENANCE_BYPASS_HOSTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(process.env.MAINTENANCE_BYPASS_HOSTS)

// Chuyển wildcard pattern (vd: "*.admin.example.com") sang RegExp
function wildcardToRegExp(pattern) {
  const esc = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${esc}$`, "i");
}
const BYPASS_REGEXPS = BYPASS_PATTERNS.map(wildcardToRegExp);

async function loadSettingsModel() {
  const mod = await import("../models/systemSettingsModel.js");
  const SystemSettings = mod.default || mod.SystemSettings || mod;
  if (!SystemSettings?.findById) {
    throw new Error("Không import được SystemSettings model (sai path?).");
  }
  return SystemSettings;
}

async function getMaintenanceState() {
  const now = Date.now();
  if (now - __maintCache.ts < TTL_MS) return __maintCache;

  try {
    const SystemSettings = await loadSettingsModel();
    const doc =
      (await SystemSettings.findById("system").select("maintenance").lean()) ||
      {};
    __maintCache = {
      ts: now,
      enabled: !!doc?.maintenance?.enabled,
      message: doc?.maintenance?.message || "",
    };
  } catch (e) {
    // Lỗi DB -> coi như không bảo trì để tránh khoá hệ thống do sự cố tạm thời
    __maintCache = { ts: now, enabled: false, message: "" };
    console.error("[maintenance] load error:", e?.message);
  }
  return __maintCache;
}

export function invalidateMaintenanceCache() {
  __maintCache.ts = 0;
}

function extractHost(req) {
  // Ưu tiên X-Forwarded-Host (sau reverse proxy), lấy host đầu tiên
  let host = (
    req.headers["x-forwarded-host"] ||
    req.headers["host"] ||
    req.hostname ||
    ""
  )
    .toString()
    .split(",")[0]
    .trim();

  // Bỏ port nếu có (vd: "admin.example.com:443")
  if (host.includes(":")) host = host.split(":")[0];
  return host.toLowerCase();
}

function isBypassedHost(host) {
  if (!host) return false;
  if (BYPASS_REGEXPS.length === 0) return false;
  return BYPASS_REGEXPS.some((rx) => rx.test(host));
}

/**
 * Middleware bảo trì theo miền:
 * - Nếu host của request khớp MAINTENANCE_BYPASS_HOSTS -> next()
 * - Ngược lại: nếu maintenance.enabled = true -> trả 503
 * - Nếu off -> next()
 */
export async function maintainanceTrigger(req, res, next) {
  try {
    const host = extractHost(req);
    console.log(host)
    if (isBypassedHost(host)) return next();

    const { enabled, message } = await getMaintenanceState();
    if (!enabled) return next();

    res.setHeader("Retry-After", "300"); // ví dụ 5 phút
    return res.status(503).json({
      ok: false,
      code: "MAINTENANCE",
      message: message || "Hệ thống đang bảo trì, vui lòng quay lại sau.",
    });
  } catch (e) {
    // Nếu guard lỗi, không chặn request
    console.error("[maintenance] guard error:", e?.message);
    return next();
  }
}
