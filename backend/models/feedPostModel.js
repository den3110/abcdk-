// models/feedPostModel.js
// Bảng tin — post do user tạo (text + ảnh + video), reactions embedded,
// counts denormalized, soft-delete.
import mongoose from "mongoose";

const { Schema } = mongoose;

const REACTION_TYPES = ["like", "love", "haha", "wow", "sad", "angry"];

const reactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: REACTION_TYPES,
      default: "like",
    },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const mediaSchema = new Schema(
  {
    type: { type: String, enum: ["image", "video"], required: true },
    url: { type: String, required: true, trim: true },
    thumbnailUrl: { type: String, trim: true }, // cho video
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    durationMs: { type: Number, min: 0 }, // video
    sizeBytes: { type: Number, min: 0 },
    mime: { type: String, trim: true },
  },
  { _id: false }
);

const feedPostSchema = new Schema(
  {
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    content: { type: String, default: "", maxlength: 5000 },
    media: { type: [mediaSchema], default: [] },
    // hashtag chuẩn hoá lowercase, không có dấu #
    tags: { type: [{ type: String, lowercase: true, trim: true, maxlength: 64 }], default: [] },
    mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],
    linkedTournament: { type: Schema.Types.ObjectId, ref: "Tournament", default: null },
    visibility: {
      type: String,
      enum: ["public", "followers"],
      default: "public",
    },
    reactions: { type: [reactionSchema], default: [] },
    // Lưu bài (bookmark) — danh sách user đã lưu post này
    savedBy: [{ type: Schema.Types.ObjectId, ref: "User", index: true }],
    // Bài bình chọn (poll). null = post thường.
    poll: {
      type: new Schema(
        {
          question: { type: String, trim: true, maxlength: 300 },
          multi: { type: Boolean, default: false },
          closesAt: { type: Date, default: null },
          options: {
            type: [
              new Schema(
                {
                  id: { type: String, required: true },
                  text: { type: String, required: true, trim: true, maxlength: 120 },
                  votes: [{ type: Schema.Types.ObjectId, ref: "User" }],
                },
                { _id: false }
              ),
            ],
            default: [],
          },
        },
        { _id: false }
      ),
      default: null,
    },
    // Snapshot trận đấu được chia sẻ (share match result). null = không.
    sharedMatch: {
      type: new Schema(
        {
          matchId: { type: Schema.Types.ObjectId, ref: "Match", default: null },
          tournamentId: { type: Schema.Types.ObjectId, ref: "Tournament", default: null },
          tournamentName: { type: String, trim: true },
          code: { type: String, trim: true },
          teamA: { type: String, trim: true },
          teamB: { type: String, trim: true },
          scoreA: { type: Number, default: 0 },
          scoreB: { type: Number, default: 0 },
          setsA: { type: Number, default: 0 },
          setsB: { type: Number, default: 0 },
          winner: { type: String, trim: true }, // "A" | "B" | ""
          status: { type: String, trim: true },
        },
        { _id: false }
      ),
      default: null,
    },
    // Chia sẻ sản phẩm từ Chợ sang Bảng tin (snapshot để hiển thị nhanh)
    sharedListing: {
      type: new Schema(
        {
          listingId: {
            type: Schema.Types.ObjectId,
            ref: "MarketListing",
            default: null,
          },
          title: { type: String, trim: true },
          price: { type: Number, default: 0 },
          type: { type: String, trim: true }, // sell | trade | giveaway
          condition: { type: String, trim: true },
          category: { type: String, trim: true },
          image: { type: String, trim: true },
          sellerName: { type: String, trim: true },
          status: { type: String, trim: true },
          province: { type: String, trim: true },
        },
        { _id: false }
      ),
      default: null,
    },
    // denormalized counters — cập nhật atomic khi comment/reaction mutation
    reactionCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
    shareCount: { type: Number, default: 0, min: 0 },
    reportCount: { type: Number, default: 0, min: 0 },
    // admin flags
    isPinned: { type: Boolean, default: false, index: true },
    pinnedUntil: { type: Date, default: null },
    isHidden: { type: Boolean, default: false, index: true }, // ẩn khỏi feed public
    isNsfw: { type: Boolean, default: false }, // mobile blur
    // soft-delete: !=null ⇒ ẩn khỏi mọi query trừ admin restore
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// index cho feed listing (newest, không deleted, không hidden)
feedPostSchema.index({ deletedAt: 1, isHidden: 1, createdAt: -1 });
feedPostSchema.index({ author: 1, deletedAt: 1, createdAt: -1 });
feedPostSchema.index({ tags: 1, createdAt: -1 });
feedPostSchema.index({ linkedTournament: 1, createdAt: -1 });
feedPostSchema.index({ "reactions.user": 1 });

// helpers
feedPostSchema.methods.setReaction = function (userId, type) {
  const uid = String(userId);
  const idx = this.reactions.findIndex((r) => String(r.user) === uid);
  if (idx >= 0) {
    if (this.reactions[idx].type === type) {
      // toggle off (giữ Facebook-style: nhấn cùng loại = bỏ)
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

feedPostSchema.methods.myReaction = function (userId) {
  if (!userId) return null;
  const uid = String(userId);
  const r = this.reactions.find((x) => String(x.user) === uid);
  return r ? r.type : null;
};

// static REACTION_TYPES export cho controller/validator
feedPostSchema.statics.REACTION_TYPES = REACTION_TYPES;

const FeedPost =
  mongoose.models.FeedPost || mongoose.model("FeedPost", feedPostSchema);

export default FeedPost;
export { REACTION_TYPES };
