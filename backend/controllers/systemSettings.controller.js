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
} from "../services/systemSettingsRuntime.service.js";

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

function attachSystemSettingsUiFlags(settings) {
  return {
    ...settings,
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

  if (next.captcha && typeof next.captcha === "object") {
    if (Object.prototype.hasOwnProperty.call(next.captcha, "enabled")) {
      next.captcha.enabled = next.captcha.enabled !== false;
    }

    if (!Object.keys(next.captcha).length) {
      delete next.captcha;
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
        1,
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

    res.json({
      open:
        typeof registration.open === "boolean"
          ? registration.open
          : DEFAULT_SYSTEM_SETTINGS.registration.open,
      requireOptionalProfileFields:
        typeof registration.requireOptionalProfileFields === "boolean"
          ? registration.requireOptionalProfileFields
          : DEFAULT_SYSTEM_SETTINGS.registration.requireOptionalProfileFields,
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
