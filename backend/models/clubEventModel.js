// models/clubEventModel.js
import mongoose from "mongoose";

const ClubEventSchema = new mongoose.Schema(
  {
    club: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      index: true,
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, default: "", maxlength: 8000 },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    location: { type: String, default: "" },
    visibility: {
      type: String,
      enum: ["public", "members"],
      default: "public",
      index: true,
    },
    rsvp: { type: String, enum: ["open", "limit"], default: "open" },
    capacity: { type: Number, default: 0 }, // dùng khi rsvp='limit'
    attendeesCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ClubEventSchema.index({ club: 1, startAt: 1 });

export default mongoose.model("ClubEvent", ClubEventSchema);
