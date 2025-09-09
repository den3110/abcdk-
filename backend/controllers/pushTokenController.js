// src/controllers/pushTokenController.js
import PushToken from "../models/pushTokenModel.js";

/** POST /api/push/me/push-token  { token, platform?, deviceId?, appVersion? } */
export async function registerPushToken(req, res) {
  const userId = req.user?._id;
  const {
    token,
    platform = "ios",
    deviceId,
    appVersion = null,
  } = req.body || {};
  if (!userId || !token || !deviceId) {
    return res.status(400).json({ message: "userId/token/deviceId required" });
  }

  const now = new Date();
  const filter = { $or: [{ user: userId, deviceId }, { token }] };
  const update = {
    $set: {
      user: userId,
      token,
      platform,
      deviceId,
      appVersion,
      enabled: true,
      lastError: null,
      lastActiveAt: now,
      updatedAt: now,
    },
    $setOnInsert: { createdAt: now },
  };

  try {
    // Gộp (merge) nếu đã tồn tại theo deviceId hoặc theo token
    const doc = await PushToken.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      runValidators: true,
    });

    // Phòng khi đã tồn tại “bản ghi cũ” còn sót khác _id mà trùng token (hiếm do unique)
    await PushToken.deleteMany({ token, _id: { $ne: doc._id } });

    return res.json({ ok: true, id: doc._id });
  } catch (err) {
    // Nếu race-condition gây E11000 (unique token hoặc (user,deviceId))
    if (err?.code === 11000) {
      // Lấy lại doc rồi cập nhật lần nữa một cách an toàn
      const existing = await PushToken.findOne(filter).select("_id");
      if (existing) {
        await PushToken.updateOne(
          { _id: existing._id },
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
          }
        );
        return res.json({ ok: true, id: existing._id, deduped: true });
      }
    }
    return res.status(500).json({ message: err.message });
  }
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
