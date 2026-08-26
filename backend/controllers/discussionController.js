// controllers/discussionController.js
// Tường thảo luận CLB: bài đăng của thành viên + thả tim + bình luận
import ClubPost from "../models/clubPostModel.js";
import ClubPostComment from "../models/clubPostCommentModel.js";
import ClubMember from "../models/clubMemberModel.js";
import { canReadClubContent } from "../utils/clubVisibility.js";

const AUTHOR_FIELDS = "fullName nickname avatar";

// isMember robust: owner | membership middleware | fallback exists()
async function resolveIsMember(req) {
  const meId = req.user?._id ? String(req.user._id) : null;
  if (!meId) return false;
  if (String(req.club.owner) === meId) return true;
  if (req.clubMembership?.status === "active") return true;
  const exists = await ClubMember.exists({
    club: req.club._id,
    user: meId,
    status: "active",
  });
  return !!exists;
}
function isAdminReq(req) {
  const isOwner =
    req.user?._id && String(req.club.owner) === String(req.user._id);
  return isOwner || req.clubMembership?.role === "admin";
}

/** GET /clubs/:id/posts — danh sách bài đăng */
export const listPosts = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const meId = req.user?._id ? String(req.user._id) : null;
    const isMember = await resolveIsMember(req);

    if (!canReadClubContent(req.club, meId, isMember)) {
      return res.status(403).json({ message: "Không có quyền xem thảo luận." });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));

    const filter = { club: req.club._id };
    if (!isMember) filter.visibility = "public";

    const [rows, total] = await Promise.all([
      ClubPost.find(filter)
        .sort({ pinned: -1, createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate("author", AUTHOR_FIELDS)
        .lean(),
      ClubPost.countDocuments(filter),
    ]);

    const items = rows.map((p) => {
      const reactions = p.reactions || [];
      const mine = meId
        ? reactions.some((r) => String(r.user) === meId)
        : false;
      const { reactions: _omit, ...rest } = p;
      return {
        ...rest,
        reactionCount: reactions.length,
        myReaction: mine,
      };
    });

    return res.json({ items, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error("listPosts error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** POST /clubs/:id/posts — đăng bài (thành viên) */
export const createPost = async (req, res) => {
  try {
    const isMember = await resolveIsMember(req);
    if (!isMember) {
      return res
        .status(403)
        .json({ message: "Chỉ thành viên mới được đăng bài." });
    }
    const content = String(req.body?.content || "").trim();
    const imageUrl = String(req.body?.imageUrl || "").trim();
    if (!content && !imageUrl) {
      return res
        .status(400)
        .json({ message: "Nhập nội dung hoặc thêm ảnh." });
    }
    let visibility = req.body?.visibility;
    if (!["public", "members"].includes(visibility)) visibility = "members";

    const doc = await ClubPost.create({
      club: req.club._id,
      author: req.user._id,
      content: content.slice(0, 5000),
      imageUrl,
      visibility,
    });
    const populated = await ClubPost.findById(doc._id)
      .populate("author", AUTHOR_FIELDS)
      .lean();
    return res.status(201).json({
      ...populated,
      reactions: undefined,
      reactionCount: 0,
      myReaction: false,
    });
  } catch (err) {
    console.error("createPost error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** PATCH /clubs/:id/posts/:postId — sửa (tác giả hoặc admin; pin chỉ admin) */
export const updatePost = async (req, res) => {
  try {
    const post = await ClubPost.findOne({
      _id: req.params.postId,
      club: req.club._id,
    });
    if (!post) return res.status(404).json({ message: "Không tìm thấy bài." });

    const isAuthor = String(post.author) === String(req.user._id);
    const admin = isAdminReq(req);
    if (!isAuthor && !admin) {
      return res.status(403).json({ message: "Không có quyền sửa bài này." });
    }

    if ("content" in req.body)
      post.content = String(req.body.content || "").slice(0, 5000);
    if ("imageUrl" in req.body)
      post.imageUrl = String(req.body.imageUrl || "");
    if ("visibility" in req.body &&
      ["public", "members"].includes(req.body.visibility))
      post.visibility = req.body.visibility;
    // pin chỉ admin
    if ("pinned" in req.body && admin) post.pinned = !!req.body.pinned;

    await post.save();
    const populated = await ClubPost.findById(post._id)
      .populate("author", AUTHOR_FIELDS)
      .lean();
    const reactions = populated.reactions || [];
    return res.json({
      ...populated,
      reactions: undefined,
      reactionCount: reactions.length,
      myReaction: reactions.some(
        (r) => String(r.user) === String(req.user._id)
      ),
    });
  } catch (err) {
    console.error("updatePost error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** DELETE /clubs/:id/posts/:postId — xoá (tác giả hoặc admin) */
export const deletePost = async (req, res) => {
  try {
    const post = await ClubPost.findOne({
      _id: req.params.postId,
      club: req.club._id,
    });
    if (!post) return res.status(404).json({ message: "Không tìm thấy bài." });
    const isAuthor = String(post.author) === String(req.user._id);
    if (!isAuthor && !isAdminReq(req)) {
      return res.status(403).json({ message: "Không có quyền xoá bài này." });
    }
    await ClubPost.deleteOne({ _id: post._id });
    await ClubPostComment.deleteMany({ post: post._id });
    return res.json({ ok: true });
  } catch (err) {
    console.error("deletePost error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** POST /clubs/:id/posts/:postId/react — bật/tắt thả tim (thành viên) */
export const reactPost = async (req, res) => {
  try {
    const isMember = await resolveIsMember(req);
    if (!isMember) {
      return res.status(403).json({ message: "Chỉ thành viên được thả tim." });
    }
    const post = await ClubPost.findOne({
      _id: req.params.postId,
      club: req.club._id,
    });
    if (!post) return res.status(404).json({ message: "Không tìm thấy bài." });

    const meId = String(req.user._id);
    const idx = (post.reactions || []).findIndex(
      (r) => String(r.user) === meId
    );
    let reacted;
    if (idx >= 0) {
      post.reactions.splice(idx, 1);
      reacted = false;
    } else {
      post.reactions.push({ user: req.user._id, type: "like" });
      reacted = true;
    }
    await post.save();
    return res.json({
      ok: true,
      reacted,
      reactionCount: post.reactions.length,
    });
  } catch (err) {
    console.error("reactPost error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** GET /clubs/:id/posts/:postId/comments — danh sách bình luận */
export const listComments = async (req, res) => {
  try {
    const meId = req.user?._id ? String(req.user._id) : null;
    const isMember = await resolveIsMember(req);
    if (!canReadClubContent(req.club, meId, isMember)) {
      return res.status(403).json({ message: "Không có quyền xem." });
    }
    const post = await ClubPost.findOne({
      _id: req.params.postId,
      club: req.club._id,
    }).lean();
    if (!post) return res.status(404).json({ message: "Không tìm thấy bài." });
    if (post.visibility === "members" && !isMember) {
      return res.status(403).json({ message: "Chỉ thành viên được xem." });
    }

    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const [items, total] = await Promise.all([
      ClubPostComment.find({ post: post._id })
        .sort({ createdAt: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate("author", AUTHOR_FIELDS)
        .lean(),
      ClubPostComment.countDocuments({ post: post._id }),
    ]);
    return res.json({ items, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error("listComments error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** POST /clubs/:id/posts/:postId/comments — bình luận (thành viên) */
export const createComment = async (req, res) => {
  try {
    const isMember = await resolveIsMember(req);
    if (!isMember) {
      return res
        .status(403)
        .json({ message: "Chỉ thành viên mới được bình luận." });
    }
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ message: "Nhập nội dung." });

    const post = await ClubPost.findOne({
      _id: req.params.postId,
      club: req.club._id,
    });
    if (!post) return res.status(404).json({ message: "Không tìm thấy bài." });

    const doc = await ClubPostComment.create({
      post: post._id,
      club: req.club._id,
      author: req.user._id,
      content: content.slice(0, 2000),
    });
    await ClubPost.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } });
    const populated = await ClubPostComment.findById(doc._id)
      .populate("author", AUTHOR_FIELDS)
      .lean();
    return res.status(201).json(populated);
  } catch (err) {
    console.error("createComment error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** DELETE /clubs/:id/posts/:postId/comments/:commentId — xoá (tác giả hoặc admin) */
export const deleteComment = async (req, res) => {
  try {
    const comment = await ClubPostComment.findOne({
      _id: req.params.commentId,
      club: req.club._id,
    });
    if (!comment)
      return res.status(404).json({ message: "Không tìm thấy bình luận." });
    const isAuthor = String(comment.author) === String(req.user._id);
    if (!isAuthor && !isAdminReq(req)) {
      return res.status(403).json({ message: "Không có quyền xoá." });
    }
    await ClubPostComment.deleteOne({ _id: comment._id });
    await ClubPost.updateOne(
      { _id: comment.post },
      { $inc: { commentCount: -1 } }
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("deleteComment error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};
