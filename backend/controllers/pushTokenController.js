// src/controllers/pushTokenController.js
import PushToken from "../models/pushTokenModel.js";
import LiveActivityRegistration from "../models/liveActivityRegistrationModel.js";

function normalizeLiveActivity(input = {}) {
  const activityId = String(input?.activityId || "").trim();
  const matchId = String(input?.matchId || "").trim();
  if (!activityId || !matchId) return null;

  const pushToken =
    typeof input?.pushToken === "string" && input.pushToken.trim()
      ? input.pushToken.trim()
      : null;
  const status = String(input?.status || "scheduled")
    .trim()
    .toLowerCase();
  const matchCode =
    typeof input?.matchCode === "string" && input.matchCode.trim()
      ? input.matchCode.trim()
      : "";

  return {
    activityId,
    matchId,
    pushToken,
    status: ["scheduled", "queued", "assigned", "live", "finished"].includes(
      status
    )
      ? status
      : "scheduled",
    matchCode,
  };
}

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

/** POST /api/push/me/live-activities/sync */
export async function syncMyLiveActivities(req, res) {
  const userId = req.user?._id;
  const {
    deviceId,
    platform = "ios",
    appVersion = null,
    activities = [],
  } = req.body || {};

  if (!userId || !deviceId) {
    return res.status(400).json({ message: "userId/deviceId required" });
  }

  if (platform !== "ios") {
    return res.json({
      ok: true,
      activeCount: 0,
      registeredCount: 0,
      disabledCount: 0,
    });
  }

  const normalized = [];
  const seenActivityIds = new Set();
  for (const item of Array.isArray(activities) ? activities : []) {
    const next = normalizeLiveActivity(item);
    if (!next || seenActivityIds.has(next.activityId)) continue;
    seenActivityIds.add(next.activityId);
    normalized.push(next);
  }

  const now = new Date();
  if (normalized.length) {
    for (const item of normalized) {
      const set = {
        user: userId,
        deviceId,
        platform: "ios",
        appVersion,
        matchId: item.matchId,
        matchCode: item.matchCode,
        activityId: item.activityId,
        status: item.status,
        enabled: true,
        lastError: null,
        lastActiveAt: now,
        updatedAt: now,
        ...(item.status === "finished" ? { endedAt: now } : { endedAt: null }),
      };

      if (item.pushToken) {
        set.pushToken = item.pushToken;
      }

      const filter = item.pushToken
        ? {
            $or: [
              { user: userId, deviceId, activityId: item.activityId },
              { pushToken: item.pushToken },
            ],
          }
        : { user: userId, deviceId, activityId: item.activityId };

      await LiveActivityRegistration.findOneAndUpdate(
        filter,
        {
          $set: set,
          $setOnInsert: { createdAt: now },
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
        }
      );
    }
  }

  const disableQuery = {
    user: userId,
    deviceId,
    platform: "ios",
    enabled: true,
    ...(normalized.length
      ? { activityId: { $nin: normalized.map((item) => item.activityId) } }
      : {}),
  };

  const disableResult = await LiveActivityRegistration.updateMany(
    disableQuery,
    {
      $set: {
        enabled: false,
        endedAt: now,
        updatedAt: now,
      },
    }
  );

  return res.json({
    ok: true,
    activeCount: normalized.length,
    registeredCount: normalized.filter((item) => item.pushToken).length,
    disabledCount: disableResult.modifiedCount || 0,
  });
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
  if (deviceId) {
    await LiveActivityRegistration.updateMany(
      { user: userId, deviceId, platform: "ios", enabled: true },
      { $set: { enabled: false, endedAt: new Date() } }
    );
  }
  res.json({ ok: true, matched: r.matchedCount, modified: r.modifiedCount });
}

/** DELETE /api/push/me/push-token/all  → tắt toàn bộ token của user (nếu cần) */
export async function disableAllMyTokens(req, res) {
  const userId = req.user?._id;
  const r = await PushToken.updateMany(
    { user: userId },
    { $set: { enabled: false } }
  );
  await LiveActivityRegistration.updateMany(
    { user: userId, platform: "ios", enabled: true },
    { $set: { enabled: false, endedAt: new Date() } }
  );
  res.json({ ok: true, modified: r.modifiedCount });
}
