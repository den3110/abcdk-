import FbLiveConfig from "../models/fbLiveConfigModel.js";

export async function getConfig(req, res) {
  const cfg =
    (await FbLiveConfig.findOne({ key: "fb_live_config" }).lean()) ||
    (await FbLiveConfig.create({})).toObject();
  res.json(cfg);
}

export async function updateConfig(req, res) {
  const body = req.body || {};
  // Only allow these fields:
  const patch = {};
  if (body.status) patch.status = body.status;
  if (body.privacyValueOnCreate)
    patch.privacyValueOnCreate = body.privacyValueOnCreate;
  if (typeof body.embeddable === "boolean") patch.embeddable = body.embeddable;
  if (body.ensurePrivacyAfterEnd)
    patch.ensurePrivacyAfterEnd = body.ensurePrivacyAfterEnd;

  const cfg = await FbLiveConfig.findOneAndUpdate(
    { key: "fb_live_config" },
    { $set: patch },
    { upsert: true, new: true }
  ).lean();
  res.json(cfg);
}
