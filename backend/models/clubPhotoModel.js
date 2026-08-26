// models/clubPhotoModel.js
// Ảnh trong thư viện (album) của CLB — thành viên tải lên
import mongoose from "mongoose";

const ClubPhotoSchema = new mongoose.Schema(
  {
    club: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      index: true,
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    url: { type: String, required: true },
    caption: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

ClubPhotoSchema.index({ club: 1, createdAt: -1 });

export default mongoose.model("ClubPhoto", ClubPhotoSchema);
