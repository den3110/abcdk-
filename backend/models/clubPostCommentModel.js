// models/clubPostCommentModel.js
// Bình luận (phẳng) cho bài đăng tường thảo luận CLB
import mongoose from "mongoose";

const ClubPostCommentSchema = new mongoose.Schema(
  {
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClubPost",
      index: true,
      required: true,
    },
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
    content: { type: String, required: true, maxlength: 2000 },
  },
  { timestamps: true }
);

ClubPostCommentSchema.index({ post: 1, createdAt: 1 });

export default mongoose.model("ClubPostComment", ClubPostCommentSchema);
