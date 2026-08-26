// models/clubPostModel.js
// Bài đăng tường thảo luận của CLB (thành viên đăng, thả tim, bình luận)
import mongoose from "mongoose";

const ReactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, default: "like" }, // like/love/... (mvp: like)
  },
  { _id: false }
);

const ClubPostSchema = new mongoose.Schema(
  {
    club: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      index: true,
      required: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    content: { type: String, default: "", maxlength: 5000 },
    imageUrl: { type: String, default: "" },
    reactions: { type: [ReactionSchema], default: [] },
    commentCount: { type: Number, default: 0 },
    pinned: { type: Boolean, default: false },
    // 'public' ai cũng xem (trừ CLB hidden), 'members' chỉ thành viên
    visibility: {
      type: String,
      enum: ["public", "members"],
      default: "members",
      index: true,
    },
  },
  { timestamps: true }
);

ClubPostSchema.index({ club: 1, pinned: -1, createdAt: -1 });

export default mongoose.model("ClubPost", ClubPostSchema);
