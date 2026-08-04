// services/inAppNotify.js
// Helper tạo UserNotification record + emit socket cho các user tương ứng.
// Được gọi song song với push (expoPush) trong feed/chat/friend flows.
import UserNotification from "../models/userNotificationModel.js";
import { getIO } from "../socket/index.js";

/**
 * @param {Object} opts
 * @param {String[]|String} opts.recipients — user ids
 * @param {String} opts.actorId
 * @param {String} opts.type — 1 trong NOTIFICATION_TYPES
 * @param {String} opts.title
 * @param {String} opts.body
 * @param {String} [opts.url]
 * @param {Object} [opts.data]
 */
export async function createInAppNotifications({
  recipients,
  actorId,
  type,
  title,
  body,
  url,
  data,
}) {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  const uniq = Array.from(
    new Set(
      list
        .filter(Boolean)
        .map((x) => String(x))
        .filter((x) => x !== String(actorId || ""))
    )
  );
  if (!uniq.length) return [];

  const docs = await UserNotification.insertMany(
    uniq.map((uid) => ({
      user: uid,
      actor: actorId || null,
      type,
      title: String(title || "").slice(0, 200),
      body: String(body || "").slice(0, 500),
      url: String(url || "").slice(0, 500),
      data: data || {},
    })),
    { ordered: false }
  ).catch((err) => {
    console.error("[inAppNotify] insert error:", err?.message || err);
    return [];
  });

  // Emit socket event tới từng user room để badge unread + list realtime update
  try {
    const io = getIO?.();
    if (io) {
      for (const doc of docs) {
        io.to(`user:${String(doc.user)}`).emit("notification:new", {
          _id: doc._id,
          type: doc.type,
          title: doc.title,
          body: doc.body,
          url: doc.url,
          data: doc.data,
          createdAt: doc.createdAt,
        });
      }
    }
  } catch (err) {
    console.error("[inAppNotify] emit error:", err?.message || err);
  }

  return docs;
}
