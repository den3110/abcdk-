// models/clubAnnouncementModel.js
import mongoose from "mongoose";

const ClubAnnouncementSchema = new mongoose.Schema(
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
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, default: "", maxlength: 10000 },
    pinned: { type: Boolean, default: false },
    // 'public' ai cũng thấy (trừ CLB hidden), 'members' chỉ thành viên
    visibility: {
      type: String,
      enum: ["public", "members"],
      default: "public",
      index: true,
    },
  },
  { timestamps: true }
);

ClubAnnouncementSchema.index({ club: 1, pinned: -1, createdAt: -1 });

export default mongoose.model("ClubAnnouncement", ClubAnnouncementSchema);
