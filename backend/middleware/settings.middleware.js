// middleware/settings.middleware.js
import SystemSettings from "../models/systemSettingsModel.js";

const DEFAULTS = {
  _id: "system",
  maintenance: { enabled: false, message: "" },
  registration: { open: true },
  kyc: { enabled: true, autoApprove: false, faceMatchThreshold: 0.78 },
  security: { enforce2FAForAdmins: false, sessionTTLHours: 72 },
  uploads: { maxAvatarSizeMB: 5 },
  notifications: { telegramEnabled: false, telegramComplaintChatId: "" },
};

let cache = { doc: null, ts: 0 };
const TTL_MS = 10_000; // 10s

export async function loadSettings(req, _res, next) {
  try {
    const now = Date.now();
    if (!cache.doc || now - cache.ts > TTL_MS) {
      const doc = (await SystemSettings.findById("system").lean()) || DEFAULTS;
      cache = { doc, ts: now };
    }
    req.settings = cache.doc || DEFAULTS;
    next();
  } catch (e) {
    // fallback an toàn
    req.settings = DEFAULTS;
    next();
  }
}

export function invalidateSettingsCache() {
  cache.ts = 0;
}

export function maintenanceGuard(req, res, next) {
  const m = req.settings?.maintenance;
  const isAdmin = !!req.user?.roles?.includes("admin");
  // Cho phép admin và health check đi qua
  if (m?.enabled && !isAdmin && !req.path.startsWith("/api/health")) {
    return res
      .status(503)
      .json({
        message: m.message || "Hệ thống đang bảo trì, vui lòng quay lại sau.",
      });
  }
  next();
}
