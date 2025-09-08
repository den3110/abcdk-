// src/controllers/pushTokenController.js
import PushToken from "../models/pushTokenModel.js";

/** POST /api/push/me/push-token  { token, platform?, deviceId?, appVersion? } */
export async function registerPushToken(req, res) {
  const userId = req.user?._id;
  const {
    token,
    platform = "ios",
    deviceId = null,
    appVersion = null,
  } = req.body || {};
  if (!userId || !token)
    return res.status(400).json({ message: "Bad request" });

  // Nếu có deviceId → upsert theo (user, deviceId), để giữ 1-bản-ghi/thiết-bị
  // Nếu không có deviceId → fallback upsert theo token (cũ)
  const query = deviceId ? { user: userId, deviceId } : { token };

  await PushToken.updateOne(
    query,
    {
      $set: {
        user: userId,
        token,
        platform,
        deviceId,
        appVersion,
        enabled: true,
        lastError: null,
        lastActiveAt: new Date(),
      },
    },
    { upsert: true }
  );
  res.json({ ok: true });
}

/** DELETE /api/push/me/push-token  { deviceId? , token? }  → disable token của thiết bị hiện tại */
export async function unregisterMyDeviceToken(req, res) {
  const userId = req.user?._id;
  const { deviceId = null, token = null } = req.body || {};
  if (!userId || (!deviceId && !token)) {
    return res.status(400).json({ message: "deviceId or token required" });
  }

  const q = deviceId ? { user: userId, deviceId } : { user: userId, token };
  const r = await PushToken.updateOne(q, { $set: { enabled: false } });
  res.json({ ok: true, matched: r.matchedCount, modified: r.modifiedCount });
}

/** DELETE /api/push/me/push-token/all  → tắt toàn bộ token của user (nếu cần) */
export async function disableAllMyTokens(req, res) {
  const userId = req.user?._id;
  const r = await PushToken.updateMany(
    { user: userId },
    { $set: { enabled: false } }
  );
  res.json({ ok: true, modified: r.modifiedCount });
}
