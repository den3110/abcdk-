// models/clubSessionModel.js
// Buổi tập / sinh hoạt của CLB
import mongoose from "mongoose";

const ClubSessionSchema = new mongoose.Schema(
  {
    club: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      index: true,
      required: true,
    },
    title: { type: String, default: "Buổi tập", maxlength: 200 },
    startAt: { type: Date, required: true, index: true },
    location: { type: String, default: "", maxlength: 300 },
    note: { type: String, default: "", maxlength: 2000 },
    attendeeCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

ClubSessionSchema.index({ club: 1, startAt: -1 });

export default mongoose.model("ClubSession", ClubSessionSchema);
