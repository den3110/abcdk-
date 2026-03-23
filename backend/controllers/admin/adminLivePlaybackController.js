import asyncHandler from "express-async-handler";
import {
  getLiveMultiSourceConfig,
  saveLiveMultiSourceConfig,
} from "../../services/liveMultiSourceConfig.service.js";
import {
  getLiveRecordingStorageTargetsConfig,
  saveLiveRecordingStorageTargetsConfig,
} from "../../services/liveRecordingStorageTargetsConfig.service.js";
import {
  getRecordingStorageTargets,
  invalidateRecordingStorageUsageCache,
} from "../../services/liveRecordingV2Storage.service.js";
import {
  clearCourtPresentationCaches,
  clearMatchPresentationCaches,
  clearTournamentPresentationCaches,
} from "../../services/cacheInvalidation.service.js";

function asTrimmed(value) {
  return String(value || "").trim();
}

async function buildResponse() {
  const config = await getLiveMultiSourceConfig();
  const storageConfig = await getLiveRecordingStorageTargetsConfig();
  const runtimeTargets = getRecordingStorageTargets();
  const runtimeTargetById = new Map(runtimeTargets.map((target) => [target.id, target]));
  const playbackOverrideById = new Map(
    (Array.isArray(config.targets) ? config.targets : []).map((target) => [
      target.id,
      target,
    ])
  );

  const targets = storageConfig.targets.map((target) => {
    const override = playbackOverrideById.get(target.id) || null;
    const runtimeTarget = runtimeTargetById.get(target.id) || null;
    const effectivePublicBaseUrl =
      asTrimmed(override?.publicBaseUrl) ||
      asTrimmed(target?.publicBaseUrl) ||
      asTrimmed(config.globalPublicBaseUrl) ||
      "";

    return {
      id: target.id,
      label: target.label,
      enabled: target.enabled !== false,
      endpoint: target.endpoint,
      accessKeyId: target.accessKeyId || "",
      secretAccessKey: target.secretAccessKey || "",
      bucketName: target.bucketName || "",
      capacityBytes: Number(target.capacityBytes || 0),
      configuredPublicBaseUrl: target.publicBaseUrl || "",
      overridePublicBaseUrl: override?.publicBaseUrl || "",
      effectivePublicBaseUrl,
      runtimeUsable: Boolean(runtimeTarget),
      manifestExampleUrl: effectivePublicBaseUrl
        ? `${effectivePublicBaseUrl}/recordings/v2/matches/<matchId>/<recordingId>/${config.manifestName}`
        : "",
    };
  });

  return {
    config,
    targets,
    storageTargets: targets,
    summary: {
      enabled: Boolean(config.enabled),
      delaySeconds: config.delaySeconds,
      manifestName: config.manifestName,
      globalPublicBaseUrl: config.globalPublicBaseUrl || "",
      targetCount: targets.length,
      runtimeTargetCount: runtimeTargets.length,
      targetWithEffectivePublicBaseCount: targets.filter(
        (target) => target.effectivePublicBaseUrl
      ).length,
      storageTargetsSource: storageConfig.source,
    },
  };
}

export const getAdminLivePlaybackConfig = asyncHandler(async (req, res) => {
  const payload = await buildResponse();
  res.json(payload);
});

export const updateAdminLivePlaybackConfig = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const storageTargets = Array.isArray(body.storageTargets)
    ? body.storageTargets
    : null;

  if (storageTargets) {
    await saveLiveRecordingStorageTargetsConfig({
      targets: storageTargets,
    });
    invalidateRecordingStorageUsageCache();
  }

  await saveLiveMultiSourceConfig({
    ...body,
    targets: storageTargets
      ? storageTargets.map((target) => ({
          id: asTrimmed(target?.id),
          publicBaseUrl: asTrimmed(target?.publicBaseUrl),
        }))
      : body.targets,
  });
  await Promise.all([
    clearTournamentPresentationCaches(),
    clearMatchPresentationCaches(),
    clearCourtPresentationCaches(),
  ]);
  const payload = await buildResponse();
  res.json({
    message: "Live playback / recording storage config updated",
    ...payload,
  });
});
