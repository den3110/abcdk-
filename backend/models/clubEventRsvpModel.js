// models/clubEventRsvpModel.js
import mongoose from "mongoose";

const ClubEventRsvpSchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClubEvent",
      index: true,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: true,
    },
    status: { type: String, enum: ["going", "not_going"], default: "going" },
  },
  { timestamps: true }
);

ClubEventRsvpSchema.index({ event: 1, user: 1 }, { unique: true });

export default mongoose.model("ClubEventRsvp", ClubEventRsvpSchema);
