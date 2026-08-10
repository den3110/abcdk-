// models/feedCommentModel.js
// Comment (parent=null) + reply (parent=commentId) — chỉ 1 tầng nest như Facebook.
import mongoose from "mongoose";
import { REACTION_TYPES } from "./feedPostModel.js";

const { Schema } = mongoose;

const reactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: REACTION_TYPES, default: "like" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const mediaSchema = new Schema(
  {
    type: { type: String, enum: ["image", "video"], required: true },
    url: { type: String, required: true, trim: true },
    mime: { type: String, trim: true },
    sizeBytes: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
  },
  { _id: false }
);

const feedCommentSchema = new Schema(
  {
    post: {
      type: Schema.Types.ObjectId,
      ref: "FeedPost",
      required: true,
      index: true,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // null = top-level, có = reply. Chỉ 1 tầng: reply-of-reply cũng gán parent = top-level cha.
    parent: {
      type: Schema.Types.ObjectId,
      ref: "FeedComment",
      default: null,
    },
    content: { type: String, default: "", trim: true, maxlength: 2000 },
    media: { type: [mediaSchema], default: [] },
    mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],
    reactions: { type: [reactionSchema], default: [] },
    reactionCount: { type: Number, default: 0, min: 0 },
    replyCount: { type: Number, default: 0, min: 0 }, // chỉ dùng cho top-level
    isHidden: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

feedCommentSchema.index({ post: 1, parent: 1, createdAt: -1 });
feedCommentSchema.index({ author: 1, createdAt: -1 });
feedCommentSchema.index({ "reactions.user": 1 });

feedCommentSchema.methods.setReaction = function (userId, type) {
  const uid = String(userId);
  const idx = this.reactions.findIndex((r) => String(r.user) === uid);
  if (idx >= 0) {
    if (this.reactions[idx].type === type) {
      this.reactions.splice(idx, 1);
      this.reactionCount = Math.max(0, this.reactionCount - 1);
      return { removed: true, type };
    }
    this.reactions[idx].type = type;
    this.reactions[idx].at = new Date();
    return { updated: true, type };
  }
  this.reactions.push({ user: userId, type, at: new Date() });
  this.reactionCount = (this.reactionCount || 0) + 1;
  return { added: true, type };
};

feedCommentSchema.methods.myReaction = function (userId) {
  if (!userId) return null;
  const uid = String(userId);
  const r = this.reactions.find((x) => String(x.user) === uid);
  return r ? r.type : null;
};

const FeedComment =
  mongoose.models.FeedComment ||
  mongoose.model("FeedComment", feedCommentSchema);

export default FeedComment;
