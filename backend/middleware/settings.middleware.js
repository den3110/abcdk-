// middleware/settings.middleware.js
import {
  DEFAULT_SYSTEM_SETTINGS,
  getSystemSettingsRuntime,
  invalidateSystemSettingsRuntimeCache,
} from "../services/systemSettingsRuntime.service.js";

export async function loadSettings(req, _res, next) {
  try {
    req.settings = await getSystemSettingsRuntime();
    next();
  } catch (e) {
    req.settings = DEFAULT_SYSTEM_SETTINGS;
    next();
  }
}

export function invalidateSettingsCache() {
  invalidateSystemSettingsRuntimeCache();
}

export function maintenanceGuard(req, res, next) {
  const m = req.settings?.maintenance;
  const isAdmin = !!req.user?.roles?.includes("admin");
  if (m?.enabled && !isAdmin && !req.path.startsWith("/api/health")) {
    return res
      .status(503)
      .json({
        message: m.message || "Hệ thống đang bảo trì, vui lòng quay lại sau.",
      });
  }
  next();
}
