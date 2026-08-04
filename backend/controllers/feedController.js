// controllers/feedController.js
// Handlers cho Bảng tin: post, comment, reaction, report.
// Feed listing dùng cursor base64 sort createdAt desc.
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import FeedPost, { REACTION_TYPES } from "../models/feedPostModel.js";
import FeedComment from "../models/feedCommentModel.js";
import FeedReport, { REPORT_REASONS } from "../models/feedReportModel.js";
import User from "../models/userModel.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";
import { getIO } from "../socket/index.js";
import {
  notifyFeedComment,
  notifyFeedMention,
} from "../services/feedNotifier.js";

/* ─────────────────────── helpers ─────────────────────── */

const AUTHOR_FIELDS = "_id name nickname avatar role";

// Parse "#hashtag" và "@nickname" trong content
function extractTags(content = "") {
  const set = new Set();
  const re = /(?:^|\s)#([a-z0-9_\p{L}]{1,64})/giu;
  let m;
  while ((m = re.exec(content))) set.add(String(m[1]).toLowerCase());
  return Array.from(set).slice(0, 10);
}
function extractMentionsRaw(content = "") {
  const set = new Set();
  const re = /(?:^|\s)@([a-z0-9_.\-\p{L}]{2,32})/giu;
  let m;
  while ((m = re.exec(content))) set.add(m[1]);
  return Array.from(set).slice(0, 20);
}
async function resolveMentionUserIds(nicknames) {
  if (!nicknames?.length) return [];
  const users = await User.find({
    $or: [
      { nickname: { $in: nicknames } },
      { name: { $in: nicknames } },
    ],
  })
    .select("_id")
    .limit(50)
    .lean();
  return users.map((u) => u._id);
}

function isAdmin(user) {
  return user?.role === "admin" || user?.role === "superAdmin";
}

function toPostDTO(post, viewerId) {
  const p =
    typeof post.toObject === "function" ? post.toObject() : { ...post };
  const my = post?.myReaction ? post.myReaction(viewerId) : null;
  return {
    _id: p._id,
    author: p.author,
    content: p.content,
    media: p.media || [],
    tags: p.tags || [],
    mentions: p.mentions || [],
    linkedTournament: p.linkedTournament,
    visibility: p.visibility,
    reactionCount: p.reactionCount || 0,
    commentCount: p.commentCount || 0,
    shareCount: p.shareCount || 0,
    reportCount: p.reportCount || 0,
    isPinned: !!p.isPinned,
    pinnedUntil: p.pinnedUntil,
    isHidden: !!p.isHidden,
    isNsfw: !!p.isNsfw,
    myReaction: my,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
function toCommentDTO(comment, viewerId) {
  const c =
    typeof comment.toObject === "function"
      ? comment.toObject()
      : { ...comment };
  const my = comment?.myReaction ? comment.myReaction(viewerId) : null;
  return {
    _id: c._id,
    post: c.post,
    parent: c.parent,
    author: c.author,
    content: c.content,
    mentions: c.mentions || [],
    reactionCount: c.reactionCount || 0,
    replyCount: c.replyCount || 0,
    myReaction: my,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function emit(event, payload) {
  try {
    const io = getIO?.();
    if (io) io.emit(event, payload);
  } catch (err) {
    console.error("[feed] socket emit error:", err?.message || err);
  }
}
function emitToPost(postId, event, payload) {
  try {
    const io = getIO?.();
    if (io) io.to(`feed:post:${postId}`).emit(event, payload);
  } catch (err) {
    console.error("[feed] socket emitToPost error:", err?.message || err);
  }
}

/* ─────────────────────── POSTS ─────────────────────── */

// GET /api/feed  ?cursor=&limit=&tag=&author=&tournament=&pinned=1
export const listFeed = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const tag = String(req.query.tag || "").toLowerCase().trim();
  const author = req.query.author;
  const tournament = req.query.tournament;
  const pinned = req.query.pinned === "1" || req.query.pinned === "true";
  const cursor = decodeCursor(req.query.cursor);

  const q = { deletedAt: null };
  if (!isAdmin(viewer)) q.isHidden = false;
  if (tag) q.tags = tag;
  if (author && mongoose.isValidObjectId(author)) q.author = author;
  if (tournament && mongoose.isValidObjectId(tournament))
    q.linkedTournament = tournament;
  if (pinned) q.isPinned = true;

  if (cursor?.payload?.lastId && mongoose.isValidObjectId(cursor.payload.lastId)) {
    q._id = { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) };
  }

  const docs = await FeedPost.find(q)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("author", AUTHOR_FIELDS)
    .populate("linkedTournament", "_id name image")
    .populate("mentions", AUTHOR_FIELDS);

  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit).map((d) => toPostDTO(d, viewer?._id));
  const nextCursor = hasMore
    ? encodeCursor({ lastId: String(docs[limit - 1]._id) })
    : null;

  res.json({ items, nextCursor, hasMore });
});

// GET /api/feed/:id
export const getPost = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const post = await FeedPost.findById(req.params.id)
    .populate("author", AUTHOR_FIELDS)
    .populate("linkedTournament", "_id name image")
    .populate("mentions", AUTHOR_FIELDS);
  if (!post || post.deletedAt) {
    res.status(404);
    throw new Error("Không tìm thấy bài viết");
  }
  if (post.isHidden && !isAdmin(viewer)) {
    res.status(404);
    throw new Error("Không tìm thấy bài viết");
  }
  res.json(toPostDTO(post, viewer?._id));
});

// POST /api/feed  { content, media?, linkedTournament?, visibility? }
export const createPost = asyncHandler(async (req, res) => {
  const author = req.user._id;
  const content = String(req.body?.content || "").slice(0, 5000);
  const media = Array.isArray(req.body?.media) ? req.body.media.slice(0, 10) : [];
  const linkedTournament =
    req.body?.linkedTournament &&
    mongoose.isValidObjectId(req.body.linkedTournament)
      ? req.body.linkedTournament
      : null;
  const visibility =
    req.body?.visibility === "followers" ? "followers" : "public";

  if (!content.trim() && !media.length) {
    res.status(400);
    throw new Error("Bài viết cần có nội dung hoặc media");
  }

  const tags = extractTags(content);
  const mentionNicks = extractMentionsRaw(content);
  const mentions = await resolveMentionUserIds(mentionNicks);

  const post = await FeedPost.create({
    author,
    content,
    media,
    tags,
    mentions,
    linkedTournament,
    visibility,
  });
  const populated = await FeedPost.findById(post._id)
    .populate("author", AUTHOR_FIELDS)
    .populate("linkedTournament", "_id name image")
    .populate("mentions", AUTHOR_FIELDS);

  const dto = toPostDTO(populated, author);
  emit("feed:post:new", dto);

  // Notify mentions (fire-and-forget)
  if (mentions.length) {
    notifyFeedMention({
      postId: post._id,
      actorId: author,
      targets: mentions,
    });
  }

  res.status(201).json(dto);
});

// PATCH /api/feed/:id  { content?, media?, linkedTournament? }
export const updatePost = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const post = await FeedPost.findById(req.params.id);
  if (!post || post.deletedAt) {
    res.status(404);
    throw new Error("Không tìm thấy bài viết");
  }
  if (String(post.author) !== String(viewer._id) && !isAdmin(viewer)) {
    res.status(403);
    throw new Error("Không có quyền chỉnh sửa");
  }

  if (typeof req.body?.content === "string") {
    post.content = req.body.content.slice(0, 5000);
    post.tags = extractTags(post.content);
    const mentionNicks = extractMentionsRaw(post.content);
    post.mentions = await resolveMentionUserIds(mentionNicks);
  }
  if (Array.isArray(req.body?.media)) {
    post.media = req.body.media.slice(0, 10);
  }
  if (
    req.body?.linkedTournament === null ||
    mongoose.isValidObjectId(req.body?.linkedTournament)
  ) {
    post.linkedTournament = req.body.linkedTournament || null;
  }
  await post.save();

  const populated = await FeedPost.findById(post._id)
    .populate("author", AUTHOR_FIELDS)
    .populate("linkedTournament", "_id name image")
    .populate("mentions", AUTHOR_FIELDS);

  const dto = toPostDTO(populated, viewer._id);
  emitToPost(post._id, "feed:post:updated", dto);
  res.json(dto);
});

// DELETE /api/feed/:id  — author hoặc admin (soft-delete)
export const deletePost = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const post = await FeedPost.findById(req.params.id);
  if (!post || post.deletedAt) {
    res.status(404);
    throw new Error("Không tìm thấy bài viết");
  }
  if (String(post.author) !== String(viewer._id) && !isAdmin(viewer)) {
    res.status(403);
    throw new Error("Không có quyền xoá");
  }
  post.deletedAt = new Date();
  post.deletedBy = viewer._id;
  await post.save();
  emitToPost(post._id, "feed:post:deleted", { postId: post._id });
  emit("feed:post:deleted", { postId: post._id });
  res.json({ success: true });
});

/* ─────────────────────── REACTIONS ─────────────────────── */

// POST /api/feed/:id/reactions  { type }
export const reactPost = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const type = String(req.body?.type || "like");
  if (!REACTION_TYPES.includes(type)) {
    res.status(400);
    throw new Error("Loại reaction không hợp lệ");
  }
  const post = await FeedPost.findById(req.params.id);
  if (!post || post.deletedAt || post.isHidden) {
    res.status(404);
    throw new Error("Không tìm thấy bài viết");
  }
  const result = post.setReaction(viewer._id, type);
  await post.save();
  emitToPost(post._id, "feed:reaction:updated", {
    postId: post._id,
    reactionCount: post.reactionCount,
  });
  res.json({
    postId: post._id,
    reactionCount: post.reactionCount,
    myReaction: result.removed ? null : type,
  });
});

// POST /api/feed/comments/:cid/reactions  { type }
export const reactComment = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const type = String(req.body?.type || "like");
  if (!REACTION_TYPES.includes(type)) {
    res.status(400);
    throw new Error("Loại reaction không hợp lệ");
  }
  const c = await FeedComment.findById(req.params.cid);
  if (!c || c.deletedAt) {
    res.status(404);
    throw new Error("Không tìm thấy bình luận");
  }
  const result = c.setReaction(viewer._id, type);
  await c.save();
  emitToPost(c.post, "feed:comment:reaction:updated", {
    commentId: c._id,
    postId: c.post,
    reactionCount: c.reactionCount,
  });
  res.json({
    commentId: c._id,
    reactionCount: c.reactionCount,
    myReaction: result.removed ? null : type,
  });
});

/* ─────────────────────── COMMENTS ─────────────────────── */

// GET /api/feed/:id/comments  ?cursor=&limit=&parent=
// parent=null → top-level; parent=<cid> → replies của comment đó.
export const listComments = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const postId = req.params.id;
  if (!mongoose.isValidObjectId(postId)) {
    res.status(400);
    throw new Error("postId không hợp lệ");
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const parent =
    req.query.parent && mongoose.isValidObjectId(req.query.parent)
      ? req.query.parent
      : null;

  const cursor = decodeCursor(req.query.cursor);
  const q = { post: postId, parent, deletedAt: null, isHidden: false };
  if (cursor?.payload?.lastId && mongoose.isValidObjectId(cursor.payload.lastId)) {
    q._id = { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) };
  }
  const docs = await FeedComment.find(q)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("author", AUTHOR_FIELDS);
  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit).map((d) => toCommentDTO(d, viewer?._id));
  const nextCursor = hasMore
    ? encodeCursor({ lastId: String(docs[limit - 1]._id) })
    : null;
  res.json({ items, nextCursor, hasMore });
});

// POST /api/feed/:id/comments  { content, parent? }
export const createComment = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const postId = req.params.id;
  if (!mongoose.isValidObjectId(postId)) {
    res.status(400);
    throw new Error("postId không hợp lệ");
  }
  const content = String(req.body?.content || "").trim();
  if (!content) {
    res.status(400);
    throw new Error("Nội dung bình luận không được trống");
  }
  const post = await FeedPost.findById(postId);
  if (!post || post.deletedAt || post.isHidden) {
    res.status(404);
    throw new Error("Không tìm thấy bài viết");
  }
  // Reply gắn về top-level: nếu client gửi parent = reply, promote lên parent gốc
  let parent = null;
  if (req.body?.parent && mongoose.isValidObjectId(req.body.parent)) {
    const parentDoc = await FeedComment.findById(req.body.parent).select(
      "_id parent post"
    );
    if (parentDoc && String(parentDoc.post) === String(postId)) {
      parent = parentDoc.parent || parentDoc._id;
    }
  }

  const mentionNicks = extractMentionsRaw(content);
  const mentions = await resolveMentionUserIds(mentionNicks);

  const c = await FeedComment.create({
    post: postId,
    author: viewer._id,
    content,
    parent,
    mentions,
  });

  // Denormalize counters
  await FeedPost.updateOne({ _id: postId }, { $inc: { commentCount: 1 } });
  if (parent) {
    await FeedComment.updateOne({ _id: parent }, { $inc: { replyCount: 1 } });
  }

  const populated = await FeedComment.findById(c._id).populate(
    "author",
    AUTHOR_FIELDS
  );
  const dto = toCommentDTO(populated, viewer._id);

  emitToPost(postId, "feed:comment:new", dto);

  // Notify (fire-and-forget)
  let parentAuthorId = null;
  if (parent) {
    const pa = await FeedComment.findById(parent).select("author").lean();
    parentAuthorId = pa?.author || null;
  }
  notifyFeedComment({
    postId,
    postAuthorId: post.author,
    actorId: viewer._id,
    commentPreview: content,
    parentAuthorId,
    mentions,
  });

  res.status(201).json(dto);
});

// DELETE /api/feed/comments/:cid — author hoặc admin (soft)
export const deleteComment = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const c = await FeedComment.findById(req.params.cid);
  if (!c || c.deletedAt) {
    res.status(404);
    throw new Error("Không tìm thấy bình luận");
  }
  if (String(c.author) !== String(viewer._id) && !isAdmin(viewer)) {
    res.status(403);
    throw new Error("Không có quyền xoá");
  }
  c.deletedAt = new Date();
  c.deletedBy = viewer._id;
  await c.save();
  await FeedPost.updateOne({ _id: c.post }, { $inc: { commentCount: -1 } });
  if (c.parent)
    await FeedComment.updateOne({ _id: c.parent }, { $inc: { replyCount: -1 } });
  emitToPost(c.post, "feed:comment:deleted", {
    commentId: c._id,
    postId: c.post,
  });
  res.json({ success: true });
});

/* ─────────────────────── REPORTS ─────────────────────── */

// POST /api/feed/:id/reports  { reason, note? }
// POST /api/feed/comments/:cid/reports  { reason, note? }
export const reportTarget = (targetType) =>
  asyncHandler(async (req, res) => {
    const viewer = req.user;
    const reason = String(req.body?.reason || "").toLowerCase();
    if (!REPORT_REASONS.includes(reason)) {
      res.status(400);
      throw new Error("Lý do report không hợp lệ");
    }
    const targetId = targetType === "post" ? req.params.id : req.params.cid;
    if (!mongoose.isValidObjectId(targetId)) {
      res.status(400);
      throw new Error("Target không hợp lệ");
    }
    let postId;
    if (targetType === "post") {
      const p = await FeedPost.findById(targetId).select("_id deletedAt");
      if (!p || p.deletedAt) {
        res.status(404);
        throw new Error("Không tìm thấy bài viết");
      }
      postId = p._id;
    } else {
      const c = await FeedComment.findById(targetId).select("post deletedAt");
      if (!c || c.deletedAt) {
        res.status(404);
        throw new Error("Không tìm thấy bình luận");
      }
      postId = c.post;
    }

    try {
      await FeedReport.create({
        reporter: viewer._id,
        targetType,
        targetId,
        postId,
        reason,
        note: String(req.body?.note || "").slice(0, 500),
      });
    } catch (err) {
      // duplicate — user đã report trước đó, coi như OK idempotent
      if (err?.code === 11000) {
        return res.json({ success: true, duplicate: true });
      }
      throw err;
    }

    // tăng counter cho post (giúp admin filter nhanh)
    await FeedPost.updateOne({ _id: postId }, { $inc: { reportCount: 1 } });

    res.status(201).json({ success: true });
  });

/* ─────────────────────── ADMIN ─────────────────────── */

// GET /api/admin/feed/posts  ?cursor=&limit=&filter=hidden|reported|deleted|all
export const adminListPosts = asyncHandler(async (req, res) => {
  const filter = String(req.query.filter || "all");
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const cursor = decodeCursor(req.query.cursor);
  const q = {};
  if (filter === "hidden") q.isHidden = true;
  if (filter === "reported") q.reportCount = { $gt: 0 };
  if (filter === "deleted") q.deletedAt = { $ne: null };
  if (filter === "all") {
    // mặc định vẫn ẩn deleted
    q.deletedAt = null;
  }
  if (cursor?.payload?.lastId && mongoose.isValidObjectId(cursor.payload.lastId)) {
    q._id = { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) };
  }
  const docs = await FeedPost.find(q)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("author", AUTHOR_FIELDS);
  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit).map((d) => toPostDTO(d, req.user?._id));
  const nextCursor = hasMore
    ? encodeCursor({ lastId: String(docs[limit - 1]._id) })
    : null;
  res.json({ items, nextCursor, hasMore });
});

// PATCH /api/admin/feed/posts/:id  { isHidden?, isPinned?, isNsfw?, pinnedUntil? }
export const adminPatchPost = asyncHandler(async (req, res) => {
  const post = await FeedPost.findById(req.params.id);
  if (!post) {
    res.status(404);
    throw new Error("Không tìm thấy bài viết");
  }
  if (typeof req.body?.isHidden === "boolean") post.isHidden = req.body.isHidden;
  if (typeof req.body?.isPinned === "boolean") post.isPinned = req.body.isPinned;
  if (typeof req.body?.isNsfw === "boolean") post.isNsfw = req.body.isNsfw;
  if (req.body?.pinnedUntil !== undefined)
    post.pinnedUntil = req.body.pinnedUntil ? new Date(req.body.pinnedUntil) : null;
  await post.save();
  emitToPost(post._id, "feed:post:updated", toPostDTO(post, req.user._id));
  res.json(toPostDTO(post, req.user._id));
});

// DELETE /api/admin/feed/posts/:id  — hard delete (kèm comments)
export const adminDeletePost = asyncHandler(async (req, res) => {
  const post = await FeedPost.findById(req.params.id);
  if (!post) {
    res.status(404);
    throw new Error("Không tìm thấy bài viết");
  }
  await FeedComment.deleteMany({ post: post._id });
  await FeedReport.deleteMany({ postId: post._id });
  await post.deleteOne();
  emit("feed:post:deleted", { postId: post._id });
  res.json({ success: true });
});

// GET /api/admin/feed/reports  ?status=pending&cursor=&limit=
export const adminListReports = asyncHandler(async (req, res) => {
  const status = req.query.status || "pending";
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const cursor = decodeCursor(req.query.cursor);
  const q = { status };
  if (cursor?.payload?.lastId && mongoose.isValidObjectId(cursor.payload.lastId)) {
    q._id = { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) };
  }
  const docs = await FeedReport.find(q)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("reporter", AUTHOR_FIELDS)
    .populate("postId", "_id content author isHidden deletedAt")
    .lean();
  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit);
  const nextCursor = hasMore
    ? encodeCursor({ lastId: String(docs[limit - 1]._id) })
    : null;
  res.json({ items, nextCursor, hasMore });
});

// PATCH /api/admin/feed/reports/:rid  { action: "dismiss" | "hide" | "delete", note? }
export const adminResolveReport = asyncHandler(async (req, res) => {
  const admin = req.user;
  const action = String(req.body?.action || "dismiss");
  if (!["dismiss", "hide", "delete"].includes(action)) {
    res.status(400);
    throw new Error("action không hợp lệ");
  }
  const report = await FeedReport.findById(req.params.rid);
  if (!report) {
    res.status(404);
    throw new Error("Không tìm thấy report");
  }
  if (report.status !== "pending") {
    res.status(400);
    throw new Error("Report đã được xử lý");
  }

  if (action === "hide" || action === "delete") {
    if (report.targetType === "post") {
      const post = await FeedPost.findById(report.targetId);
      if (post) {
        if (action === "hide") {
          post.isHidden = true;
          await post.save();
        } else {
          post.deletedAt = new Date();
          post.deletedBy = admin._id;
          await post.save();
        }
        emitToPost(post._id, "feed:post:updated", toPostDTO(post, admin._id));
      }
    } else {
      const c = await FeedComment.findById(report.targetId);
      if (c) {
        if (action === "hide") {
          c.isHidden = true;
          await c.save();
        } else {
          c.deletedAt = new Date();
          c.deletedBy = admin._id;
          await c.save();
          await FeedPost.updateOne(
            { _id: c.post },
            { $inc: { commentCount: -1 } }
          );
        }
      }
    }
    report.action = action === "hide" ? "hidden" : "deleted";
    report.status = "actioned";
  } else {
    report.status = "dismissed";
  }
  report.resolvedBy = admin._id;
  report.resolvedAt = new Date();
  report.resolvedNote = String(req.body?.note || "").slice(0, 500);
  await report.save();
  res.json({ success: true, report });
});
