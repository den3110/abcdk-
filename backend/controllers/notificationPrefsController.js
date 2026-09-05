// controllers/notificationPrefsController.js
// User-level notification preferences.
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";

function readPrefs(u) {
  const p = u?.notificationPrefs || {};
  return {
    // Master switch (kill switch chung cho push)
    pushEnabled: u?.isPushNotificationEnabled !== false,
    chatMuteAll: !!p.chatMuteAll,
    feedMuteAll: !!p.feedMuteAll,
    // Tắt push liên quan giải đấu mới hợp trình / gợi ý
    tournamentMuteAll: !!p.tournamentMuteAll,
  };
}

// GET /api/users/notification-prefs
export const getNotificationPrefs = asyncHandler(async (req, res) => {
  const u = await User.findById(req.user._id)
    .select("notificationPrefs isPushNotificationEnabled")
    .lean();
  res.json(readPrefs(u));
});

// PATCH /api/users/notification-prefs { pushEnabled?, chatMuteAll?, feedMuteAll?, tournamentMuteAll? }
export const patchNotificationPrefs = asyncHandler(async (req, res) => {
  const update = {};
  if (typeof req.body?.pushEnabled === "boolean") {
    update["isPushNotificationEnabled"] = req.body.pushEnabled;
  }
  if (typeof req.body?.chatMuteAll === "boolean") {
    update["notificationPrefs.chatMuteAll"] = req.body.chatMuteAll;
  }
  if (typeof req.body?.feedMuteAll === "boolean") {
    update["notificationPrefs.feedMuteAll"] = req.body.feedMuteAll;
  }
  if (typeof req.body?.tournamentMuteAll === "boolean") {
    update["notificationPrefs.tournamentMuteAll"] = req.body.tournamentMuteAll;
  }
  if (Object.keys(update).length) {
    await User.updateOne({ _id: req.user._id }, { $set: update });
  }
  const u = await User.findById(req.user._id)
    .select("notificationPrefs isPushNotificationEnabled")
    .lean();
  res.json(readPrefs(u));
});
