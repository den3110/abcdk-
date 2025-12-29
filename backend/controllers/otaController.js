// controllers/otaController.js
import otaService from "../services/ota.service.js";

const isValidPlatform = (p) => ["ios", "android"].includes(String(p || ""));

export const checkOtaUpdate = async (req, res) => {
  try {
    const { platform, bundleVersion, appVersion } = req.query;
    const { deviceId, model, osVersion, brand } = req.query; // Optional device info

    if (!platform || !bundleVersion || !appVersion) {
      return res.status(400).json({
        error: "Missing required params: platform, bundleVersion, appVersion",
      });
    }

    if (!isValidPlatform(platform)) {
      return res.status(400).json({ error: "Platform must be ios or android" });
    }

    const result = await otaService.checkUpdate({
      platform,
      currentBundleVersion: bundleVersion,
      appVersion,
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
    const { logId, status, errorMessage, errorCode, duration } = req.body;

    if (!logId || !status) {
      return res.status(400).json({
        error: "Missing required: logId, status",
      });
    }

    const validStatuses = ["downloading", "installing", "success", "failed", "skipped"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const result = await otaService.reportUpdateStatus({
      logId,
      status,
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
    // TODO: Add admin authentication middleware
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

    // Get user ID from auth if available
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

    const versions = await otaService.listVersions(platform, parseInt(limit));
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

    const latest = await otaService.getLatestVersion(platform);

    if (!latest) {
      return res.status(404).json({ error: "No version found" });
    }

    const metadata = await otaService.getBundleMetadata(platform, latest.version);
    return res.json(metadata);
  } catch (error) {
    console.error("OTA get latest error:", error);
    return res.status(500).json({ error: "Failed to get latest version" });
  }
};

export const rollbackOta = async (req, res) => {
  try {
    // TODO: Add admin authentication middleware
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
    // TODO: Add admin authentication middleware
    const { platform, version } = req.body;

    if (!platform || !version) {
      return res.status(400).json({ error: "Missing required: platform, version" });
    }

    if (!isValidPlatform(platform)) {
      return res.status(400).json({ error: "Platform must be ios or android" });
    }

    const result = await otaService.deactivateVersion(platform, version);

    return res.json({
      success: true,
      message: `Deactivated ${platform} version ${version}`,
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
    // TODO: Add admin authentication middleware
    const { platform } = req.params;
    const { days = 7 } = req.query;

    if (!isValidPlatform(platform)) {
      return res.status(400).json({ error: "Platform must be ios or android" });
    }

    const analytics = await otaService.getAnalytics(platform, parseInt(days));

    return res.json(analytics);
  } catch (error) {
    console.error("OTA analytics error:", error);
    return res.status(500).json({ error: "Failed to get analytics" });
  }
};