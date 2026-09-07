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
    // Liên kết đặt sân cho buổi tập (tuỳ chọn)
    venue: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", default: null },
    court: { type: mongoose.Schema.Types.ObjectId, ref: "VenueCourt", default: null },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null },
    note: { type: String, default: "", maxlength: 2000 },
    attendeeCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

ClubSessionSchema.index({ club: 1, startAt: -1 });

export default mongoose.model("ClubSession", ClubSessionSchema);
