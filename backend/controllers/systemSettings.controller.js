import { invalidateSettingsCache } from "../middleware/settings.middleware.js";
import { invalidateMaintenanceCache } from "../middleware/maintainance.js";
import SystemSettings from "../models/systemSettingsModel.js";
import { invalidateLiveRecordingAiCommentaryGatewayHealthCache } from "../services/liveRecordingAiCommentaryGateway.service.js";
import { clearAllMatchLiveOwners } from "../services/matchLiveOwnership.service.js";
import { setObserverRuntimeSettings } from "../services/observerConfig.service.js";
import { restartObserverRuntimePublisher } from "../services/observerSink.service.js";
import { restartPrimaryLogSink } from "../services/primaryLogSink.service.js";
import { restartSmartLogNightlySync } from "../services/smartLogNightlySync.service.js";
import {
  DEFAULT_SYSTEM_SETTINGS,
  ensureSystemSettingsDocument,
  getSystemSettingsRuntime,
  normalizeSystemSettings,
  invalidateSystemSettingsRuntimeCache,
} from "../services/systemSettingsRuntime.service.js";
import {
  sendZaloZnsOtp,
  refreshZaloAccessToken,
} from "../services/zaloZns.service.js";
import OtpLog from "../models/otpLogModel.js";

function buildSystemSettingsSocketPayload(settings) {
  return {
    updatedAt: settings?.updatedAt
      ? new Date(settings.updatedAt).toISOString()
      : new Date().toISOString(),
    changed: ["referee.matchControlLockEnabled"],
    referee: {
      matchControlLockEnabled:
        settings?.referee?.matchControlLockEnabled !== false,
    },
    privacy: {
      hideUserRatings: settings?.privacy?.hideUserRatings === true,
      hideUserRatingsSelf: settings?.privacy?.hideUserRatingsSelf === true,
    },
  };
}

function emitOwnershipReset(io, matchIds = []) {
  if (!io || !Array.isArray(matchIds) || !matchIds.length) return;
  for (const matchId of matchIds) {
    const normalizedMatchId = String(matchId || "").trim();
    if (!normalizedMatchId) continue;
    io.to(`match:${normalizedMatchId}`).emit("match:ownership_changed", {
      matchId: normalizedMatchId,
      owner: null,
    });
  }
}

function parseEnvFlag(value, fallback = false) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function buildSystemSettingsUiFlags() {
  return {
    hideRecordingDriveAdvancedControls: parseEnvFlag(
      process.env.ADMIN_HIDE_RECORDING_DRIVE_ADVANCED_CONTROLS,
      false
    ),
  };
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function maskZaloZns(zaloZns) {
  if (!zaloZns || typeof zaloZns !== "object") return zaloZns;
  const accessTokenSet = Boolean(String(zaloZns.accessToken || "").trim());
  const refreshTokenSet = Boolean(String(zaloZns.refreshToken || "").trim());
  const secretKeySet = Boolean(String(zaloZns.secretKey || "").trim());
  return {
    ...zaloZns,
    accessToken: "",
    refreshToken: "",
    secretKey: "",
    accessTokenSet,
    refreshTokenSet,
    secretKeySet,
  };
}

function attachSystemSettingsUiFlags(settings) {
  return {
    ...settings,
    zaloZns: maskZaloZns(settings?.zaloZns),
    aiGateway: settings?.aiGateway
      ? {
          ...settings.aiGateway,
          endpoints: Array.isArray(settings.aiGateway.endpoints)
            ? settings.aiGateway.endpoints.map((endpoint) => ({
                ...endpoint,
                apiKey: "",
                apiKeySet: Boolean(String(endpoint?.apiKey || "").trim()),
              }))
            : [],
        }
      : settings?.aiGateway,
    uiFlags: {
      ...(settings?.uiFlags && typeof settings.uiFlags === "object"
        ? settings.uiFlags
        : {}),
      ...buildSystemSettingsUiFlags(),
    },
  };
}

function sanitizeSettingsPatch(patch = {}) {
  const next = { ...patch };

  // AI gateway contains secrets and is managed through /admin/ai-gateway.
  if (Object.prototype.hasOwnProperty.call(next, "aiGateway")) {
    delete next.aiGateway;
  }

  if (next.appShell && typeof next.appShell === "object") {
    const mode = String(next.appShell.mode || "native")
      .trim()
      .toLowerCase();
    next.appShell.mode = mode === "webview" ? "webview" : "native";
    next.appShell.webViewUrl = String(next.appShell.webViewUrl || "").trim();
  }

  if (next.frontendUi && typeof next.frontendUi === "object") {
    const version = String(next.frontendUi.version || "v1")
      .trim()
      .toLowerCase();
    next.frontendUi.version = ["v1", "v2", "v3"].includes(version)
      ? version
      : "v1";

    if (!Object.keys(next.frontendUi).length) {
      delete next.frontendUi;
    }
  }

  if (next.pikora && typeof next.pikora === "object") {
    if (Object.prototype.hasOwnProperty.call(next.pikora, "enabled")) {
      next.pikora.enabled = next.pikora.enabled !== false;
    }

    if (!Object.keys(next.pikora).length) {
      delete next.pikora;
    }
  }

  if (next.captcha && typeof next.captcha === "object") {
    if (Object.prototype.hasOwnProperty.call(next.captcha, "enabled")) {
      next.captcha.enabled = next.captcha.enabled !== false;
    }

    if (!Object.keys(next.captcha).length) {
      delete next.captcha;
    }
  }

  if (next.checkpoint && typeof next.checkpoint === "object") {
    if (Object.prototype.hasOwnProperty.call(next.checkpoint, "enabled")) {
      next.checkpoint.enabled = next.checkpoint.enabled !== false;
    }

    if (!Object.keys(next.checkpoint).length) {
      delete next.checkpoint;
    }
  }

  if (next.links && typeof next.links === "object") {
    if (Object.prototype.hasOwnProperty.call(next.links, "guideUrl")) {
      next.links.guideUrl = String(next.links.guideUrl || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(next.links, "liveObserverUrl")) {
      next.links.liveObserverUrl = String(next.links.liveObserverUrl || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(next.links, "docsApiBaseUrl")) {
      next.links.docsApiBaseUrl = String(
        next.links.docsApiBaseUrl || ""
      ).trim();
    }

    if (!Object.keys(next.links).length) {
      delete next.links;
    }
  }

  if (next.ota && typeof next.ota === "object") {
    if (Object.prototype.hasOwnProperty.call(next.ota, "enabled")) {
      next.ota.enabled = next.ota.enabled !== false;
    }

    if (Object.prototype.hasOwnProperty.call(next.ota, "forceUpdateEnabled")) {
      next.ota.forceUpdateEnabled = next.ota.forceUpdateEnabled === true;
    }

    if (Object.prototype.hasOwnProperty.call(next.ota, "minAppVersion")) {
      next.ota.minAppVersion = String(next.ota.minAppVersion || "").trim();
    }

    if (Object.prototype.hasOwnProperty.call(next.ota, "iosMinBundleVersion")) {
      next.ota.iosMinBundleVersion = String(
        next.ota.iosMinBundleVersion || ""
      ).trim();
    }

    if (
      Object.prototype.hasOwnProperty.call(next.ota, "androidMinBundleVersion")
    ) {
      next.ota.androidMinBundleVersion = String(
        next.ota.androidMinBundleVersion || ""
      ).trim();
    }

    if (Object.prototype.hasOwnProperty.call(next.ota, "message")) {
      next.ota.message = String(next.ota.message || "").trim();
    }

    if (Object.prototype.hasOwnProperty.call(next.ota, "iosStoreUrl")) {
      next.ota.iosStoreUrl = String(next.ota.iosStoreUrl || "").trim();
    }

    if (Object.prototype.hasOwnProperty.call(next.ota, "androidStoreUrl")) {
      next.ota.androidStoreUrl = String(next.ota.androidStoreUrl || "").trim();
    }

    if (!Object.keys(next.ota).length) {
      delete next.ota;
    }
  }

  if (next.recordingDrive && typeof next.recordingDrive === "object") {
    if (Object.prototype.hasOwnProperty.call(next.recordingDrive, "enabled")) {
      next.recordingDrive.enabled = next.recordingDrive.enabled !== false;
    }

    if (Object.prototype.hasOwnProperty.call(next.recordingDrive, "mode")) {
      const mode = String(next.recordingDrive.mode || "serviceAccount")
        .trim()
        .toLowerCase();
      next.recordingDrive.mode =
        mode === "oauthuser" ? "oauthUser" : "serviceAccount";
    }

    if (
      Object.prototype.hasOwnProperty.call(
        next.recordingDrive,
        "showAdvancedControls"
      )
    ) {
      next.recordingDrive.showAdvancedControls =
        next.recordingDrive.showAdvancedControls === true;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        next.recordingDrive,
        "useModernPickerFlow"
      )
    ) {
      next.recordingDrive.useModernPickerFlow =
        next.recordingDrive.useModernPickerFlow !== false;
    }

    if (Object.prototype.hasOwnProperty.call(next.recordingDrive, "folderId")) {
      next.recordingDrive.folderId = String(
        next.recordingDrive.folderId || ""
      ).trim();
    }

    if (
      Object.prototype.hasOwnProperty.call(next.recordingDrive, "sharedDriveId")
    ) {
      next.recordingDrive.sharedDriveId = String(
        next.recordingDrive.sharedDriveId || ""
      ).trim();
    }

    if (!Object.keys(next.recordingDrive).length) {
      delete next.recordingDrive;
    }
  }

  if (next.referee && typeof next.referee === "object") {
    if (
      Object.prototype.hasOwnProperty.call(
        next.referee,
        "matchControlLockEnabled"
      )
    ) {
      next.referee.matchControlLockEnabled =
        next.referee.matchControlLockEnabled !== false;
    }

    if (!Object.keys(next.referee).length) {
      delete next.referee;
    }
  }

  if (next.privacy && typeof next.privacy === "object") {
    if (Object.prototype.hasOwnProperty.call(next.privacy, "hideUserRatings")) {
      next.privacy.hideUserRatings = next.privacy.hideUserRatings === true;
    }
    if (Object.prototype.hasOwnProperty.call(next.privacy, "hideUserRatingsSelf")) {
      next.privacy.hideUserRatingsSelf = next.privacy.hideUserRatingsSelf === true;
    }
    if (!Object.keys(next.privacy).length) {
      delete next.privacy;
    }
  }

  if (next.liveRecording && typeof next.liveRecording === "object") {
    const rawMinutes = Number(next.liveRecording.autoExportNoSegmentMinutes);
    if (Number.isFinite(rawMinutes)) {
      next.liveRecording.autoExportNoSegmentMinutes = Math.max(
        60,
        Math.min(1440, Math.round(rawMinutes))
      );
    } else {
      delete next.liveRecording.autoExportNoSegmentMinutes;
    }

    if (!Object.keys(next.liveRecording).length) {
      delete next.liveRecording;
    }
  }

  if (
    next.liveRecording?.aiCommentary &&
    typeof next.liveRecording.aiCommentary === "object"
  ) {
    const ai = { ...next.liveRecording.aiCommentary };
    ai.enabled = ai.enabled === true;
    ai.autoGenerateAfterDriveUpload = ai.autoGenerateAfterDriveUpload !== false;
    ai.keepOriginalAudioBed = ai.keepOriginalAudioBed !== false;

    const lang = String(ai.defaultLanguage || "vi")
      .trim()
      .toLowerCase();
    ai.defaultLanguage = ["vi", "en"].includes(lang) ? lang : "vi";

    const voicePreset = String(ai.defaultVoicePreset || "vi_male_pro")
      .trim()
      .toLowerCase();
    ai.defaultVoicePreset = [
      "vi_male_pro",
      "vi_female_pro",
      "en_male_pro",
      "en_female_pro",
    ].includes(voicePreset)
      ? voicePreset
      : "vi_male_pro";

    ai.scriptBaseUrl = String(ai.scriptBaseUrl || "").trim();
    ai.scriptModel = String(ai.scriptModel || "").trim();
    ai.ttsBaseUrl = String(ai.ttsBaseUrl || "").trim();
    ai.ttsModel = String(ai.ttsModel || "").trim();

    const tonePreset = String(ai.defaultTonePreset || "professional")
      .trim()
      .toLowerCase();
    ai.defaultTonePreset = ["professional", "energetic", "dramatic"].includes(
      tonePreset
    )
      ? tonePreset
      : "professional";

    const rawAudioBedLevelDb = Number(ai.audioBedLevelDb);
    ai.audioBedLevelDb = Number.isFinite(rawAudioBedLevelDb)
      ? Math.max(-40, Math.min(0, Math.round(rawAudioBedLevelDb)))
      : -18;

    const rawDuckAmountDb = Number(ai.duckAmountDb);
    ai.duckAmountDb = Number.isFinite(rawDuckAmountDb)
      ? Math.max(-30, Math.min(0, Math.round(rawDuckAmountDb)))
      : -12;

    next.liveRecording.aiCommentary = ai;
  }

  if (next.azure && typeof next.azure === "object") {
    next.azure.enabled = next.azure.enabled === true;
    if (Array.isArray(next.azure.accounts)) {
      next.azure.accounts = next.azure.accounts
        .filter((acc) => acc && typeof acc === "object" && String(acc.id || "").trim())
        .map((acc) => ({
          id: String(acc.id || "").trim(),
          label: String(acc.label || "").trim(),
          isActive: acc.isActive !== false,
          capabilities: {
            useForVmWorker: acc.capabilities?.useForVmWorker === true,
            useForTts: acc.capabilities?.useForTts === true,
          },
          clientId: String(acc.clientId || "").trim(),
          clientSecret: String(acc.clientSecret || "").trim(),
          tenantId: String(acc.tenantId || "").trim(),
          subscriptionId: String(acc.subscriptionId || "").trim(),
          resourceGroup: String(acc.resourceGroup || "").trim(),
          vmName: String(acc.vmName || "").trim(),
          sshUser: String(acc.sshUser || "azureuser").trim(),
          sshPrivateKey: String(acc.sshPrivateKey || "").trim(),
          ttsRegion: String(acc.ttsRegion || "").trim(),
          ttsApiKey: String(acc.ttsApiKey || "").trim(),
          ttsVoiceName: String(acc.ttsVoiceName || "vi-VN-HoaiMyNeural").trim(),
        }));
    } else {
      delete next.azure.accounts;
    }
  }

  if (next.zaloZns && typeof next.zaloZns === "object") {
    const z = { ...next.zaloZns };
    if (Object.prototype.hasOwnProperty.call(z, "enabled")) {
      z.enabled = z.enabled === true;
    }
    if (Object.prototype.hasOwnProperty.call(z, "forcePhoneVerification")) {
      z.forcePhoneVerification = z.forcePhoneVerification === true;
    }
    // Non-secret: cho phép sửa/xoá tự do
    if (Object.prototype.hasOwnProperty.call(z, "templateId")) {
      z.templateId = String(z.templateId || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(z, "appId")) {
      z.appId = String(z.appId || "").trim();
    }
    // Secret: nếu gửi lên rỗng => KHÔNG ghi đè (giữ giá trị cũ). Muốn xoá thì
    // gửi chuỗi "-" (khoảng trắng) sẽ không xảy ra ở UI mask; đủ cho nhu cầu.
    for (const key of ["accessToken", "refreshToken", "secretKey"]) {
      if (Object.prototype.hasOwnProperty.call(z, key)) {
        const val = String(z[key] || "").trim();
        if (val) z[key] = val;
        else delete z[key];
      }
    }
    // tokenRefreshedAt do hệ thống quản lý — không nhận từ client
    delete z.tokenRefreshedAt;
    next.zaloZns = z;
    if (!Object.keys(next.zaloZns).length) delete next.zaloZns;
  }

  if (next.observerLogging && typeof next.observerLogging === "object") {
    const logging = { ...next.observerLogging };
    logging.enabled = logging.enabled !== false;
    logging.httpAccessEnabled = logging.httpAccessEnabled !== false;
    logging.primaryLogEnabled = logging.primaryLogEnabled !== false;
    logging.runtimePushEnabled = logging.runtimePushEnabled !== false;
    logging.nightlySyncEnabled = logging.nightlySyncEnabled !== false;
    logging.aiAdvisorEnabled = logging.aiAdvisorEnabled !== false;

    const smartMode = String(logging.smartMode || "smart").trim().toLowerCase();
    logging.smartMode = ["smart", "primary", "observer", "hybrid"].includes(
      smartMode
    )
      ? smartMode
      : "smart";

    const minLevel = String(logging.minLevel || "info")
      .trim()
      .toLowerCase();
    logging.minLevel = ["info", "warn", "error"].includes(minLevel)
      ? minLevel
      : "info";

    logging.successSampleRate = clampNumber(
      logging.successSampleRate,
      1,
      0,
      1
    );
    logging.batchSize = Math.round(
      clampNumber(logging.batchSize, 100, 1, 1000)
    );
    logging.flushIntervalMs = Math.round(
      clampNumber(logging.flushIntervalMs, 5000, 500, 60000)
    );
    logging.maxPendingEvents = Math.round(
      clampNumber(logging.maxPendingEvents, 2000, 100, 50000)
    );
    logging.timeoutMs = Math.round(
      clampNumber(logging.timeoutMs, 4000, 500, 30000)
    );
    logging.primaryBatchSize = Math.round(
      clampNumber(logging.primaryBatchSize, 100, 1, 1000)
    );
    logging.primaryFlushIntervalMs = Math.round(
      clampNumber(logging.primaryFlushIntervalMs, 5000, 500, 60000)
    );
    logging.primaryMaxPendingEvents = Math.round(
      clampNumber(logging.primaryMaxPendingEvents, 5000, 100, 100000)
    );
    logging.primaryRetentionDays = Math.round(
      clampNumber(logging.primaryRetentionDays, 14, 1, 365)
    );
    logging.primaryQueueBurstThreshold = Math.round(
      clampNumber(logging.primaryQueueBurstThreshold, 3000, 100, 100000)
    );
    logging.burstReqPerMinuteThreshold = Math.round(
      clampNumber(logging.burstReqPerMinuteThreshold, 1200, 10, 100000)
    );
    logging.burstP95MsThreshold = Math.round(
      clampNumber(logging.burstP95MsThreshold, 1500, 50, 60000)
    );
    logging.burst5xxPerMinuteThreshold = Math.round(
      clampNumber(logging.burst5xxPerMinuteThreshold, 30, 1, 10000)
    );
    logging.burstCooldownMs = Math.round(
      clampNumber(logging.burstCooldownMs, 300000, 10000, 3600000)
    );
    logging.runtimePushIntervalMs = Math.round(
      clampNumber(logging.runtimePushIntervalMs, 15000, 5000, 300000)
    );
    logging.nightlySyncStartHour = Math.round(
      clampNumber(logging.nightlySyncStartHour, 1, 0, 23)
    );
    logging.nightlySyncEndHour = Math.round(
      clampNumber(logging.nightlySyncEndHour, 5, 0, 23)
    );
    logging.nightlySyncIntervalMs = Math.round(
      clampNumber(logging.nightlySyncIntervalMs, 600000, 60000, 86400000)
    );
    logging.nightlySyncLimit = Math.round(
      clampNumber(logging.nightlySyncLimit, 500, 1, 500)
    );
    logging.nightlySyncLookbackHours = Math.round(
      clampNumber(logging.nightlySyncLookbackHours, 24, 1, 168)
    );
    logging.aiAdvisorTimeoutMs = Math.round(
      clampNumber(logging.aiAdvisorTimeoutMs, 8000, 1000, 60000)
    );
    logging.aiAdvisorMinIntervalMs = Math.round(
      clampNumber(logging.aiAdvisorMinIntervalMs, 300000, 60000, 3600000)
    );

    next.observerLogging = logging;
  }

  return next;
}

const pick = (obj, shape) => {
  const out = {};
  for (const key in shape) {
    if (obj?.[key] == null) continue;
    if (
      typeof shape[key] === "object" &&
      shape[key] != null &&
      !Array.isArray(shape[key])
    ) {
      const sub = pick(obj[key], shape[key]);
      if (Object.keys(sub).length) out[key] = sub;
    } else {
      out[key] = obj[key];
    }
  }
  return out;
};

export const getSystemSettings = async (req, res, next) => {
  try {
    const doc = await ensureSystemSettingsDocument();
    const normalized = normalizeSystemSettings(doc);
    setObserverRuntimeSettings(normalized.observerLogging);
    res.json(attachSystemSettingsUiFlags(normalized));
  } catch (err) {
    next(err);
  }
};

export const updateSystemSettings = async (req, res, next) => {
  try {
    const previous = await getSystemSettingsRuntime({
      forceRefresh: true,
      ensureDocument: true,
    });

    const patch = sanitizeSettingsPatch(
      pick(req.body || {}, DEFAULT_SYSTEM_SETTINGS)
    );

    // zaloZns: merge từng field (dot-notation) để KHÔNG xoá secret (accessToken/
    // refreshToken/secretKey) khi UI mask và bỏ trống — chỉ set field được gửi lên.
    if (patch.zaloZns && typeof patch.zaloZns === "object") {
      for (const [k, v] of Object.entries(patch.zaloZns)) {
        patch[`zaloZns.${k}`] = v;
      }
      delete patch.zaloZns;
    }

    patch.updatedAt = new Date();
    if (req.user?._id) patch.updatedBy = req.user._id;

    const updated = await SystemSettings.findByIdAndUpdate(
      "system",
      { $set: patch },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    const normalizedUpdated = normalizeSystemSettings(updated);
    setObserverRuntimeSettings(normalizedUpdated.observerLogging);
    restartObserverRuntimePublisher();
    restartPrimaryLogSink();
    restartSmartLogNightlySync();

    invalidateSettingsCache();
    invalidateMaintenanceCache();
    invalidateSystemSettingsRuntimeCache();
    invalidateLiveRecordingAiCommentaryGatewayHealthCache();

    const previousLockEnabled =
      previous?.referee?.matchControlLockEnabled !== false;
    const nextLockEnabled =
      normalizedUpdated?.referee?.matchControlLockEnabled !== false;

    let purgedOwners = { matchIds: [] };
    if (previousLockEnabled && !nextLockEnabled) {
      purgedOwners = await clearAllMatchLiveOwners();
    }

    const io = req.app?.get?.("io");
    if (io && previousLockEnabled !== nextLockEnabled) {
      io.emit(
        "system-settings:update",
        buildSystemSettingsSocketPayload(normalizedUpdated)
      );
      if (!nextLockEnabled) {
        emitOwnershipReset(io, purgedOwners?.matchIds || []);
      }
    }

    return res.json(attachSystemSettingsUiFlags(normalizedUpdated));
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/zalo-zns/test  { phone }
// Gửi 1 OTP thử tới số điện thoại admin nhập để kiểm tra cấu hình ZNS.
export const testZaloZns = async (req, res, next) => {
  try {
    const phone = String(req.body?.phone || "").trim();
    if (!phone) return res.status(400).json({ message: "Vui lòng nhập SĐT." });
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const result = await sendZaloZnsOtp({ phone, otp });
    return res.json({
      ok: true,
      message: "Đã gửi OTP thử. Vui lòng kiểm tra Zalo.",
      otp, // admin-only: hiển thị để đối chiếu
      tranId: result?.tranId || "",
      msgId: result?.msgId || "",
    });
  } catch (err) {
    return res.status(400).json({ ok: false, message: err?.message || "Gửi thất bại." });
  }
};

// POST /api/admin/zalo-zns/refresh-token
// Buộc làm mới access_token qua OAuth (cần app_id/secret_key/refresh_token).
export const refreshZaloZnsToken = async (req, res, next) => {
  try {
    await refreshZaloAccessToken();
    return res.json({ ok: true, message: "Đã làm mới access_token.", refreshedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(400).json({ ok: false, message: err?.message || "Làm mới thất bại." });
  }
};

// GET /api/admin/zalo-zns/logs?page&limit&phone&status&purpose
export const getZaloZnsLogs = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const q = {};
    const rawPhone = String(req.query.phone || "").replace(/\D/g, "");
    if (rawPhone) {
      const core = rawPhone.replace(/^(84|0)/, "");
      q.phone = { $regex: core };
    }
    if (["success", "failed"].includes(req.query.status)) q.status = req.query.status;
    if (["register", "activate", "login", "test"].includes(req.query.purpose)) {
      q.purpose = req.query.purpose;
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [total, items, sentToday, failedToday] = await Promise.all([
      OtpLog.countDocuments(q),
      OtpLog.find(q)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("user", "_id name nickname phone")
        .lean(),
      OtpLog.countDocuments({ status: "success", createdAt: { $gte: startOfDay } }),
      OtpLog.countDocuments({ status: "failed", createdAt: { $gte: startOfDay } }),
    ]);

    res.json({
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
      stats: { sentToday, failedToday },
    });
  } catch (err) {
    next(err);
  }
};

export const getGuideLink = async (req, res, next) => {
  try {
    const settings = await getSystemSettingsRuntime({ ensureDocument: true });
    res.json({
      guideUrl: settings.links?.guideUrl || "",
      docsApiBaseUrl: settings.links?.docsApiBaseUrl || "",
    });
  } catch (err) {
    next(err);
  }
};

export const getRegistrationSettings = async (req, res, next) => {
  try {
    const settings = await getSystemSettingsRuntime({ ensureDocument: true });
    const registration = settings.registration || DEFAULT_SYSTEM_SETTINGS.registration;

    // Khi bật OTP Zalo ZNS: SĐT bắt buộc, email KHÔNG bắt buộc (bổ sung sau).
    const phoneOtpEnabled = settings?.zaloZns?.enabled === true;

    res.json({
      open:
        typeof registration.open === "boolean"
          ? registration.open
          : DEFAULT_SYSTEM_SETTINGS.registration.open,
      requireOptionalProfileFields:
        typeof registration.requireOptionalProfileFields === "boolean"
          ? registration.requireOptionalProfileFields
          : DEFAULT_SYSTEM_SETTINGS.registration.requireOptionalProfileFields,
      phoneOtpEnabled,
      emailOptional: phoneOtpEnabled,
      forcePhoneVerification:
        phoneOtpEnabled && settings?.zaloZns?.forcePhoneVerification === true,
    });
  } catch (err) {
    next(err);
  }
};

export const getMobileAppShellSettings = async (req, res, next) => {
  try {
    const settings = await getSystemSettingsRuntime({ ensureDocument: true });
    const appShell = settings.appShell || DEFAULT_SYSTEM_SETTINGS.appShell;
    const webViewUrl = String(appShell.webViewUrl || "").trim();
    const hasWebViewUrl = /^https?:\/\//i.test(webViewUrl);

    res.json({
      mode: appShell.mode === "webview" && hasWebViewUrl ? "webview" : "native",
      webViewUrl: hasWebViewUrl ? webViewUrl : "",
    });
  } catch (err) {
    next(err);
  }
};

export const getOtaAllowed = async (req, res, next) => {
  try {
    const settings = await getSystemSettingsRuntime({ ensureDocument: true });
    const ota = settings.ota || DEFAULT_SYSTEM_SETTINGS.ota;

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    return res.json({
      allowed: typeof ota.enabled === "boolean" ? ota.enabled : true,
      forceUpdate: Boolean(ota.forceUpdateEnabled),
    });
  } catch (err) {
    next(err);
  }
};
