// controllers/appVersion.controller.js
import AppConfig from "../models/appConfigModel.js";

const LIVE_APP_ANDROID_PLATFORM = "live-android";

function noStore(res) {
  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

function normalizePlatform(value) {
  return String(value || "").trim().toLowerCase();
}

function parseBuild(value) {
  const parsed = Number.parseInt(String(value || "0"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function findVersionConfig(platform) {
  const normalized = normalizePlatform(platform);
  if (normalized) {
    const exact = await AppConfig.findOne({ platform: normalized }).lean();
    if (exact) return exact;
  }
  return null;
}

export async function getVersion(req, res) {
  const platform = normalizePlatform(req.query.platform); // ios|android|live-android
  noStore(res);

  const all = await AppConfig.findOne({ platform: "all" }).lean();
  const ios = await AppConfig.findOne({ platform: "ios" }).lean();
  const android = await AppConfig.findOne({ platform: "android" }).lean();
  const exact = platform ? await findVersionConfig(platform) : null;

  const pick = (p) => (p === "ios" ? ios : p === "android" ? android : null) || all || ios || android;
  const doc = exact || pick(platform);
  if (!doc) return res.status(404).json({ message: "AppConfig not found" });

  return res.json({
    latestVersion: doc.latestVersion,
    latestBuild: doc.latestBuild,
    minSupportedBuild: doc.minSupportedBuild,
    storeUrl: doc.storeUrl || null,
    changelog: doc.changelog || "",
  });
}

export async function getLiveAppVersion(req, res) {
  noStore(res);

  const platform = normalizePlatform(req.query.platform) || LIVE_APP_ANDROID_PLATFORM;
  const currentBuild = parseBuild(req.query.versionCode || req.query.build);
  const currentVersion = String(req.query.versionName || req.query.version || "").trim();
  const doc = await findVersionConfig(platform);

  if (!doc) {
    return res.json({
      ok: true,
      configured: false,
      platform,
      currentBuild,
      currentVersion,
      latestVersion: currentVersion || null,
      latestBuild: currentBuild,
      minSupportedBuild: 0,
      forceUpdate: false,
      updateAvailable: false,
      downloadUrl: null,
      storeUrl: null,
      changelog: "",
      message: "",
    });
  }

  const blockedBuilds = Array.isArray(doc.blockedBuilds) ? doc.blockedBuilds : [];
  const latestBuild = Number(doc.latestBuild || 0);
  const minSupportedBuild = Number(doc.minSupportedBuild || 0);
  const isBlocked = currentBuild > 0 && blockedBuilds.includes(currentBuild);
  const belowMinimum = currentBuild > 0 && minSupportedBuild > 0 && currentBuild < minSupportedBuild;
  const forceUpdate = isBlocked || belowMinimum;
  const updateAvailable = forceUpdate || (currentBuild > 0 && latestBuild > 0 && currentBuild < latestBuild);
  const downloadUrl = doc.storeUrl || null;

  return res.json({
    ok: true,
    configured: true,
    platform,
    currentBuild,
    currentVersion,
    latestVersion: doc.latestVersion || null,
    latestBuild,
    minSupportedBuild,
    forceUpdate,
    updateAvailable,
    blocked: isBlocked,
    downloadUrl,
    storeUrl: downloadUrl,
    changelog: doc.changelog || "",
    message: forceUpdate
      ? "Phiên bản PickleTour Live đang dùng đã cũ. Vui lòng cập nhật APK mới để tiếp tục."
      : "",
  });
}

export async function upsertConfig(req, res) {
  const {
    platform = "all", latestVersion, latestBuild, minSupportedBuild,
    storeUrl, rollout, blockedBuilds, changelog
  } = req.body || {};
  if (
    !latestVersion ||
    typeof latestBuild !== "number" ||
    typeof minSupportedBuild !== "number"
  ) {
    return res.status(400).json({ message: "latestVersion, latestBuild, minSupportedBuild are required" });
  }
  const doc = await AppConfig.findOneAndUpdate(
    { platform },
    {
      $set: {
        latestVersion,
        latestBuild,
        minSupportedBuild,
        ...(storeUrl !== undefined ? { storeUrl } : {}),
        ...(rollout ? { rollout } : {}),
        ...(blockedBuilds ? { blockedBuilds } : {}),
        ...(changelog !== undefined ? { changelog } : {}),
      },
    },
    { new: true, upsert: true }
  ).lean();

  // clear memo
  // eslint-disable-next-line no-undef
  global.setImmediate?.(() => {});
  return res.json({ ok: true, data: doc });
}
