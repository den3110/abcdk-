// controllers/appVersion.controller.js
import AppConfig from "../models/appConfigModel.js";

export async function getVersion(req, res) {
  const platform = String(req.query.platform || "").toLowerCase(); // ios|android
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache"); res.set("Expires", "0");

  const all = await AppConfig.findOne({ platform: "all" }).lean();
  const ios = await AppConfig.findOne({ platform: "ios" }).lean();
  const android = await AppConfig.findOne({ platform: "android" }).lean();

  const pick = (p) => (p === "ios" ? ios : p === "android" ? android : null) || all || ios || android;
  const doc = pick(platform);
  if (!doc) return res.status(404).json({ message: "AppConfig not found" });

  return res.json({
    latestVersion: doc.latestVersion,
    latestBuild: doc.latestBuild,
    minSupportedBuild: doc.minSupportedBuild,
    storeUrl: doc.storeUrl || null,
    changelog: doc.changelog || "",
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
