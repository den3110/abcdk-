// controllers/notificationCenterController.js
// Notification center cho user: list + mark read + unread count.
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import UserNotification from "../models/userNotificationModel.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";

const ACTOR_FIELDS = "_id name nickname avatar";

// GET /api/notifications?cursor=&limit=&unread=1
export const listNotifications = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
  const cursor = decodeCursor(req.query.cursor);

  const q = { user: viewer._id };
  if (unreadOnly) q.isRead = false;
  if (cursor?.payload?.lastId && mongoose.isValidObjectId(cursor.payload.lastId)) {
    q._id = { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) };
  }

  const docs = await UserNotification.find(q)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("actor", ACTOR_FIELDS);

  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit);
  const nextCursor = hasMore
    ? encodeCursor({ lastId: String(docs[limit - 1]._id) })
    : null;
  res.json({ items, nextCursor, hasMore });
});

// GET /api/notifications/unread-count
export const unreadCount = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const count = await UserNotification.countDocuments({
    user: viewer._id,
    isRead: false,
  });
  res.json({ count });
});

// POST /api/notifications/:id/read
export const markRead = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const doc = await UserNotification.findOneAndUpdate(
    { _id: req.params.id, user: viewer._id, isRead: false },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  );
  res.json({ success: true, notification: doc });
});

// POST /api/notifications/read-all
export const markAllRead = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const r = await UserNotification.updateMany(
    { user: viewer._id, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
  res.json({ success: true, modified: r?.modifiedCount || 0 });
});

// DELETE /api/notifications/:id
export const deleteNotification = asyncHandler(async (req, res) => {
  const viewer = req.user;
  await UserNotification.deleteOne({
    _id: req.params.id,
    user: viewer._id,
  });
  res.json({ success: true });
});

// DELETE /api/notifications/clear-all
export const clearAll = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const r = await UserNotification.deleteMany({ user: viewer._id });
  res.json({ success: true, deleted: r?.deletedCount || 0 });
});
