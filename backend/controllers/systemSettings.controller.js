// controllers/systemSettings.controller.js
import { invalidateSettingsCache } from "../middleware/settings.middleware.js";
import SystemSettings from "../models/systemSettingsModel.js";

const DEFAULTS = {
  _id: "system",
  maintenance: { enabled: false, message: "" },
  registration: { open: true },
  kyc: { enabled: true, autoApprove: false, faceMatchThreshold: 0.78 },
  security: { enforce2FAForAdmins: false, sessionTTLHours: 72 },
  uploads: {
    maxAvatarSizeMB: 5,
    // 👇 default cùng phía model: đang bật chèn logo
    avatarLogoEnabled: true,
  },
  notifications: { telegramEnabled: false, telegramComplaintChatId: "" },
  // 👇 NEW: links (link hướng dẫn)
  links: {
    guideUrl: "",
  },
};

export const getSystemSettings = async (req, res, next) => {
  try {
    const doc =
      (await SystemSettings.findById("system")) ||
      (await SystemSettings.create(DEFAULTS));
    res.json(doc);
  } catch (err) {
    next(err);
  }
};

const pick = (obj, shape) => {
  // chỉ cho update các field whitelisted trong DEFAULTS
  const out = {};
  for (const k in shape) {
    if (obj?.[k] == null) continue;
    if (
      typeof shape[k] === "object" &&
      shape[k] != null &&
      !Array.isArray(shape[k])
    ) {
      const sub = pick(obj[k], shape[k]);
      if (Object.keys(sub).length) out[k] = sub;
    } else {
      out[k] = obj[k];
    }
  }
  return out;
};

export const updateSystemSettings = async (req, res, next) => {
  try {
    const patch = pick(req.body || {}, DEFAULTS);
    patch.updatedBy = req.user?._id;
    patch.updatedAt = new Date();

    const updated = await SystemSettings.findOneAndUpdate(
      { _id: "system" },
      { $set: patch },
      { upsert: true, new: true }
    );
    invalidateSettingsCache();
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// 👇 NEW: controller lấy riêng link hướng dẫn
export const getGuideLink = async (req, res, next) => {
  try {
    const doc =
      (await SystemSettings.findById("system")) ||
      (await SystemSettings.create(DEFAULTS));

    const guideUrl = doc.links?.guideUrl || "";

    res.json({
      guideUrl,
    });
  } catch (err) {
    next(err);
  }
};
