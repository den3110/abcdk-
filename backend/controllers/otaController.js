import otaService from "../services/ota.service.js";
import hotUpdaterDashboardService from "../services/hotUpdaterDashboard.service.js";

const isValidPlatform = (p) => ["ios", "android"].includes(String(p || ""));
const hotUpdaterStatuses = new Set([
  "checking",
  "up_to_date",
  "update_available",
  "dismissed",
  "downloading",
  "downloaded",
  "installing",
  "promoted",
  "recovered",
  "failed",
  "success",
  "skipped",
]);

export const checkOtaUpdate = async (req, res) => {
  try {
    const { platform, bundleVersion, bundleId, appVersion, channel } = req.query;
    const { deviceId, model, osVersion, brand } = req.query;

    if (!platform || !appVersion) {
      return res.status(400).json({
        error: "Missing required params: platform, appVersion",
      });
    }

    if (!isValidPlatform(platform)) {
      return res.status(400).json({ error: "Platform must be ios or android" });
    }

    const result = await hotUpdaterDashboardService.checkUpdate({
      platform,
      currentBundleVersion: bundleId || bundleVersion,
      appVersion,
      channel,
      deviceInfo: { deviceId, model, osVersion, brand },
      ip: req.ip || req.headers["x-forwarded-for"],
      userAgent: req.headers["user-agent"],
    });

    return res.json(result);
  } catch (error) {
    console.error("OTA check error:", error);
    return res.status(500).json({ error: "Failed to check for updates" });
  }
};

export const reportUpdateStatus = async (req, res) => {
  try {
    const {
      logId,
      eventId,
      platform,
      bundleId,
      currentBundleId,
      appVersion,
      channel,
      status,
      message,
      errorMessage,
      errorCode,
      duration,
      deviceInfo,
    } = req.body || {};

    const normalizedStatus = String(status || "")
      .trim()
      .toLowerCase();
    const normalizedPlatform = String(platform || "")
      .trim()
      .toLowerCase();
    const isLikelyHotUpdaterTelemetry =
      Boolean(normalizedPlatform) ||
      Boolean(bundleId) ||
      Boolean(currentBundleId) ||
      Boolean(channel) ||
      Boolean(eventId) ||
      !logId ||
      ["up_to_date", "update_available", "downloaded", "promoted", "recovered", "dismissed"].includes(
        normalizedStatus
      );

    if (isLikelyHotUpdaterTelemetry) {
      if (!isValidPlatform(normalizedPlatform)) {
        return res.status(400).json({
          error: "Missing or invalid platform for hot-updater telemetry",
        });
      }

      if (!hotUpdaterStatuses.has(normalizedStatus)) {
        return res.status(400).json({
          error: `Status must be one of: ${Array.from(hotUpdaterStatuses).join(", ")}`,
        });
      }

      const result = await hotUpdaterDashboardService.recordTelemetryEvent({
        eventId,
        platform: normalizedPlatform,
        bundleId,
        currentBundleId,
        appVersion,
        channel,
        status: normalizedStatus,
        message,
        errorMessage,
        errorCode,
        duration,
        deviceInfo: {
          deviceId:
            deviceInfo?.deviceId || req.headers["x-device-id"] || req.headers["x-deviceid"],
          model:
            deviceInfo?.model ||
            req.headers["x-device-model"] ||
            req.headers["x-device-name"] ||
            req.headers["x-device-model-name"],
          osVersion: deviceInfo?.osVersion || req.headers["x-device-os-version"],
          brand: deviceInfo?.brand || req.headers["x-device-brand"],
        },
        ip: req.ip || req.headers["x-forwarded-for"],
        userAgent: req.headers["user-agent"],
      });

      return res.json({ success: true, event: result, source: "hot-updater" });
    }

    if (!logId || !status) {
      return res.status(400).json({
        error: "Missing required: logId, status",
      });
    }

    const validStatuses = ["downloading", "installing", "success", "failed", "skipped"];
    if (!validStatuses.includes(normalizedStatus)) {
      return res.status(400).json({
        error: `Status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const result = await otaService.reportUpdateStatus({
      logId,
      status: normalizedStatus,
      errorMessage,
      errorCode,
      duration,
    });

    return res.json({ success: true, log: result });
  } catch (error) {
    console.error("OTA report status error:", error);
    return res.status(500).json({ error: "Failed to report update status" });
  }
};

export const uploadOtaBundle = async (req, res) => {
  try {
    const { platform, version, mandatory, description, minAppVersion } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "Bundle file is required" });
    }

    if (!platform || !version) {
      return res.status(400).json({ error: "Missing required: platform, version" });
    }

    if (!isValidPlatform(platform)) {
      return res.status(400).json({ error: "Platform must be ios or android" });
    }

    const uploadedBy = req.user?._id || null;

    const result = await otaService.uploadBundle({
      platform,
      version,
      bundleBuffer: req.file.buffer,
      metadata: {
        mandatory: String(mandatory) === "true",
        description: description || "",
        minAppVersion: minAppVersion || "1.0.0",
      },
      uploadedBy,
    });

    return res.json({
      success: true,
      message: `Bundle ${version} uploaded for ${platform}`,
      ...result,
    });
  } catch (error) {
    console.error("OTA upload error:", error);
    return res.status(500).json({ error: "Failed to upload bundle" });
  }
};

export const listOtaVersions = async (req, res) => {
  try {
    const { platform } = req.params;
    const { limit = 50 } = req.query;

    if (!isValidPlatform(platform)) {
      return res.status(400).json({ error: "Platform must be ios or android" });
    }

    const versions = await hotUpdaterDashboardService.listVersions(platform, parseInt(limit, 10));
    return res.json({ versions });
  } catch (error) {
    console.error("OTA list versions error:", error);
    return res.status(500).json({ error: "Failed to list versions" });
  }
};

export const getOtaLatest = async (req, res) => {
  try {
    const { platform } = req.params;

    if (!isValidPlatform(platform)) {
      return res.status(400).json({ error: "Platform must be ios or android" });
    }

    const latest = await hotUpdaterDashboardService.getLatest(platform);

    if (!latest) {
      return res.status(404).json({ error: "No version found" });
    }

    return res.json(latest);
  } catch (error) {
    console.error("OTA get latest error:", error);
    return res.status(500).json({ error: "Failed to get latest version" });
  }
};

export const rollbackOta = async (req, res) => {
  try {
    const { platform, version, reason } = req.body;
    const performedBy = req.user?._id || null;

    if (!platform || !version) {
      return res.status(400).json({ error: "Missing required: platform, version" });
    }

    if (!isValidPlatform(platform)) {
      return res.status(400).json({ error: "Platform must be ios or android" });
    }

    const result = await otaService.rollback(platform, version, {
      reason,
      performedBy,
    });

    return res.json({
      success: true,
      message: `Rolled back ${platform} to version ${version}`,
      ...result,
    });
  } catch (error) {
    console.error("OTA rollback error:", error);
    return res.status(500).json({ error: error.message || "Failed to rollback" });
  }
};

export const deactivateOtaVersion = async (req, res) => {
  try {
    const { platform, version, bundleId } = req.body;
    const targetBundleId = bundleId || version;

    if (!platform || !targetBundleId) {
      return res.status(400).json({ error: "Missing required: platform, bundleId" });
    }

    if (!isValidPlatform(platform)) {
      return res.status(400).json({ error: "Platform must be ios or android" });
    }

    const result = await hotUpdaterDashboardService.deactivateBundle(platform, targetBundleId);

    return res.json({
      success: true,
      message: `Deactivated ${platform} bundle ${targetBundleId}`,
      bundle: result,
    });
  } catch (error) {
    console.error("OTA deactivate error:", error);
    return res.status(500).json({ error: error.message || "Failed to deactivate" });
  }
};

export const downloadOtaBundle = async (req, res) => {
  try {
    const { platform, version } = req.params;

    if (!platform || !version) {
      return res.status(400).json({ error: "Missing required: platform, version" });
    }

    if (!isValidPlatform(platform)) {
      return res.status(400).json({ error: "Platform must be ios or android" });
    }

    const downloadUrl = await otaService.getSignedDownloadUrl(platform, version);
    return res.redirect(downloadUrl);
  } catch (error) {
    console.error("OTA download error:", error);
    return res.status(500).json({ error: "Failed to get download URL" });
  }
};

export const getOtaAnalytics = async (req, res) => {
  try {
    const { platform } = req.params;
    const { days = 7 } = req.query;

    if (!isValidPlatform(platform)) {
      return res.status(400).json({ error: "Platform must be ios or android" });
    }

    const analytics = await hotUpdaterDashboardService.getAnalytics(platform, parseInt(days, 10));

    return res.json(analytics);
  } catch (error) {
    console.error("OTA analytics error:", error);
    return res.status(500).json({ error: "Failed to get analytics" });
  }
};
