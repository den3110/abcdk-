// models/clubSessionAttendanceModel.js
// Điểm danh 1 thành viên cho 1 buổi tập
import mongoose from "mongoose";

const ClubSessionAttendanceSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClubSession",
      index: true,
      required: true,
    },
    club: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      index: true,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: true,
    },
    checkedInAt: { type: Date, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

ClubSessionAttendanceSchema.index({ session: 1, user: 1 }, { unique: true });

export default mongoose.model(
  "ClubSessionAttendance",
  ClubSessionAttendanceSchema
);
