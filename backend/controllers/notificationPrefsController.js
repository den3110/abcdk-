// controllers/notificationPrefsController.js
// User-level notification preferences. Không ảnh hưởng isPushNotificationEnabled
// (kill switch chung cho việc đăng ký device token expo).
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";

const DEFAULTS = { chatMuteAll: false, feedMuteAll: false };

function readPrefs(u) {
  const p = u?.notificationPrefs || {};
  return {
    chatMuteAll: !!p.chatMuteAll,
    feedMuteAll: !!p.feedMuteAll,
  };
}

// GET /api/users/notification-prefs
export const getNotificationPrefs = asyncHandler(async (req, res) => {
  const u = await User.findById(req.user._id).select("notificationPrefs").lean();
  res.json(readPrefs(u));
});

// PATCH /api/users/notification-prefs  { chatMuteAll?, feedMuteAll? }
export const patchNotificationPrefs = asyncHandler(async (req, res) => {
  const update = {};
  if (typeof req.body?.chatMuteAll === "boolean") {
    update["notificationPrefs.chatMuteAll"] = req.body.chatMuteAll;
  }
  if (typeof req.body?.feedMuteAll === "boolean") {
    update["notificationPrefs.feedMuteAll"] = req.body.feedMuteAll;
  }
  if (Object.keys(update).length) {
    await User.updateOne({ _id: req.user._id }, { $set: update });
  }
  const u = await User.findById(req.user._id).select("notificationPrefs").lean();
  res.json(readPrefs(u));
});
