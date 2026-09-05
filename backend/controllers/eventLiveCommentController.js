// controllers/eventLiveCommentController.js
// REST endpoints cho bình luận live event
import asyncHandler from "express-async-handler";
import EventLiveComment from "../models/eventLiveCommentModel.js";

// GET /api/event-live/comments?before=<cursor>&limit=30
export const getEventLiveComments = asyncHandler(async (req, res) => {
  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || 30, 1),
    100,
  );
  const filter = { deletedAt: null };

  // Cursor-based pagination: ?before=<ISO date>
  if (req.query.before) {
    filter.createdAt = { $lt: new Date(req.query.before) };
  }

  const comments = await EventLiveComment.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("user", "name fullName nickname nickName avatar")
    .lean();

  res.json({
    comments: comments.reverse(), // cũ-trước-mới-sau cho UI
    hasMore: comments.length === limit,
    oldestAt: comments.length ? comments[0].createdAt : null,
  });
});

// POST /api/event-live/comments  body: { content, platform? }
export const postEventLiveComment = asyncHandler(async (req, res) => {
  const content = String(req.body.content || "").trim();
  if (!content || content.length > 500) {
    res.status(400);
    throw new Error("Nội dung không hợp lệ (1-500 ký tự)");
  }

  const platform = ["web", "ios", "android"].includes(req.body.platform)
    ? req.body.platform
    : "unknown";

  const comment = await EventLiveComment.create({
    user: req.user._id,
    content,
    platform,
  });

  const populated = await EventLiveComment.findById(comment._id)
    .populate("user", "name fullName nickname nickName avatar")
    .lean();

  // Broadcast via Socket.IO nếu có
  try {
    const { getIO } = await import("../socket/index.js");
    const io = getIO();
    if (io) {
      io.to("event-live:chat").emit("event-live:comment:new", populated);
    }
  } catch {
    /* socket not available */
  }

  res.status(201).json(populated);
});

// DELETE /api/event-live/comments/:id (admin moderation)
export const deleteEventLiveComment = asyncHandler(async (req, res) => {
  const comment = await EventLiveComment.findById(req.params.id);
  if (!comment) {
    res.status(404);
    throw new Error("Không tìm thấy bình luận");
  }
  comment.deletedAt = new Date();
  comment.deletedBy = req.user._id;
  await comment.save();

  // Broadcast removal
  try {
    const { getIO } = await import("../socket/index.js");
    const io = getIO();
    if (io) {
      io.to("event-live:chat").emit("event-live:comment:deleted", {
        _id: comment._id,
        deletedAt: comment.deletedAt,
      });
    }
  } catch {
    /* socket not available */
  }

  res.json({ ok: true });
});

// GET /api/event-live/comments/stats (admin)
export const getEventLiveCommentStats = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const [total, deleted, byDay] = await Promise.all([
    EventLiveComment.countDocuments({ createdAt: { $gte: since } }),
    EventLiveComment.countDocuments({
      createdAt: { $gte: since },
      deletedAt: { $ne: null },
    }),
    EventLiveComment.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
          deleted: {
            $sum: { $cond: [{ $ne: ["$deletedAt", null] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { date: "$_id", _id: 0, count: 1, deleted: 1 } },
    ]),
  ]);

  res.json({ days, total, deleted, active: total - deleted, byDay });
});
