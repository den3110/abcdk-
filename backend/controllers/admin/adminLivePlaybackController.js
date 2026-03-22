import asyncHandler from "express-async-handler";
import {
  getLiveMultiSourceConfig,
  saveLiveMultiSourceConfig,
} from "../../services/liveMultiSourceConfig.service.js";
import { getRecordingStorageTargets } from "../../services/liveRecordingV2Storage.service.js";
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
  const targets = getRecordingStorageTargets().map((target) => {
    const override = config.targets.find((item) => item.id === target.id) || null;
    const effectivePublicBaseUrl =
      asTrimmed(override?.publicBaseUrl) ||
      asTrimmed(target?.publicBaseUrl) ||
      asTrimmed(config.globalPublicBaseUrl) ||
      "";

    return {
      id: target.id,
      label: target.label,
      bucketName: target.bucketName,
      endpoint: target.endpoint,
      capacityBytes: Number(target.capacityBytes || 0),
      envPublicBaseUrl: target.publicBaseUrl || "",
      overridePublicBaseUrl: override?.publicBaseUrl || "",
      effectivePublicBaseUrl,
      manifestExampleUrl: effectivePublicBaseUrl
        ? `${effectivePublicBaseUrl}/recordings/v2/matches/<matchId>/<recordingId>/${config.manifestName}`
        : "",
    };
  });

  return {
    config,
    targets,
    summary: {
      enabled: Boolean(config.enabled),
      delaySeconds: config.delaySeconds,
      manifestName: config.manifestName,
      globalPublicBaseUrl: config.globalPublicBaseUrl || "",
      targetCount: targets.length,
      targetWithEffectivePublicBaseCount: targets.filter(
        (target) => target.effectivePublicBaseUrl
      ).length,
    },
  };
}

export const getAdminLivePlaybackConfig = asyncHandler(async (req, res) => {
  const payload = await buildResponse();
  res.json(payload);
});

export const updateAdminLivePlaybackConfig = asyncHandler(async (req, res) => {
  await saveLiveMultiSourceConfig(req.body || {});
  await Promise.all([
    clearTournamentPresentationCaches(),
    clearMatchPresentationCaches(),
    clearCourtPresentationCaches(),
  ]);
  const payload = await buildResponse();
  res.json({
    message: "Live playback config updated",
    ...payload,
  });
});
