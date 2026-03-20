// controllers/systemSettings.controller.js
import { invalidateSettingsCache } from "../middleware/settings.middleware.js";
import SystemSettings from "../models/systemSettingsModel.js";

const DEFAULTS = {
  _id: "system",
  maintenance: { enabled: false, message: "" },
  registration: {
    open: true,
    // 👇 NEW: flag cho state requireOptional ở client register
    requireOptionalProfileFields: true,
  },
  kyc: { enabled: true, autoApprove: false, faceMatchThreshold: 0.78 },
  security: { enforce2FAForAdmins: false, sessionTTLHours: 72 },
  uploads: {
    maxAvatarSizeMB: 5,
    // 👇 default cùng phía model: đang bật chèn logo
    avatarLogoEnabled: true,
  },
  notifications: { telegramEnabled: false, telegramComplaintChatId: "", systemPushEnabled: true },
  // 👇 NEW: links (link hướng dẫn)
  links: {
    guideUrl: "",
  },
  // 👇 NEW: OTA force update policy
  ota: {
    forceUpdateEnabled: false,
    minAppVersion: "0.0.0", // semver, ví dụ "1.2.3"
    iosMinBundleVersion: "0", // build/bundle number, ví dụ "34"
    androidMinBundleVersion: "0",
    message: "Vui lòng cập nhật phiên bản mới để tiếp tục sử dụng.",
    iosStoreUrl: "",
    androidStoreUrl: "",
  },
  recordingDrive: {
    enabled: true,
    mode: "serviceAccount",
    folderId: "",
    sharedDriveId: "",
  },
  liveRecording: {
    autoExportNoSegmentMinutes: 15,
  },
};

function normalizeSystemSettings(doc = {}) {
  const source =
    doc && typeof doc.toObject === "function" ? doc.toObject() : { ...doc };

  return {
    ...DEFAULTS,
    ...source,
    maintenance: {
      ...DEFAULTS.maintenance,
      ...(source.maintenance || {}),
    },
    registration: {
      ...DEFAULTS.registration,
      ...(source.registration || {}),
    },
    kyc: {
      ...DEFAULTS.kyc,
      ...(source.kyc || {}),
    },
    security: {
      ...DEFAULTS.security,
      ...(source.security || {}),
    },
    uploads: {
      ...DEFAULTS.uploads,
      ...(source.uploads || {}),
    },
    notifications: {
      ...DEFAULTS.notifications,
      ...(source.notifications || {}),
    },
    links: {
      ...DEFAULTS.links,
      ...(source.links || {}),
    },
    ota: {
      ...DEFAULTS.ota,
      ...(source.ota || {}),
    },
    recordingDrive: {
      ...DEFAULTS.recordingDrive,
      ...(source.recordingDrive || {}),
    },
    liveRecording: {
      ...DEFAULTS.liveRecording,
      ...(source.liveRecording || {}),
    },
  };
}

function sanitizeSettingsPatch(patch = {}) {
  const next = { ...patch };

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

  return next;
}

export const getSystemSettings = async (req, res, next) => {
  try {
    const doc =
      (await SystemSettings.findById("system")) ||
      (await SystemSettings.create(DEFAULTS));
    res.json(normalizeSystemSettings(doc));
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
    // ✅ đảm bảo đã có doc "system" với defaults
    const existed = await SystemSettings.findById("system");
    if (!existed) {
      await SystemSettings.create(DEFAULTS);
    }

    const patch = sanitizeSettingsPatch(pick(req.body || {}, DEFAULTS));

    // meta
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

    invalidateSettingsCache();
    return res.json(normalizeSystemSettings(updated));
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

// 👇 NEW: controller cho phần đăng ký (dùng cho mobile / public API)
// => đọc được state requireOptional để map vào RegisterScreen
export const getRegistrationSettings = async (req, res, next) => {
  try {
    const doc =
      (await SystemSettings.findById("system")) ||
      (await SystemSettings.create(DEFAULTS));

    const registration = doc.registration || DEFAULTS.registration;

    res.json({
      open:
        typeof registration.open === "boolean"
          ? registration.open
          : DEFAULTS.registration.open,
      requireOptionalProfileFields:
        typeof registration.requireOptionalProfileFields === "boolean"
          ? registration.requireOptionalProfileFields
          : DEFAULTS.registration.requireOptionalProfileFields,
    });
  } catch (err) {
    next(err);
  }
};

export const getOtaAllowed = async (req, res, next) => {
  try {
    const doc =
      (await SystemSettings.findById("system")) ||
      (await SystemSettings.create(DEFAULTS));

    const ota = doc.ota || DEFAULTS.ota;

    // ✅ đúng chiều theo bạn: bật force update => allowed = true
    const allowed = Boolean(ota.forceUpdateEnabled);

    return res.json({ allowed });
  } catch (err) {
    next(err);
  }
};
