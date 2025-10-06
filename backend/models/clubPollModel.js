// models/clubPollModel.js
import mongoose from "mongoose";

const OptionSchema = new mongoose.Schema(
  {
    _id: false,
    id: { type: String, required: true },
    text: { type: String, required: true },
  },
  { _id: false }
);

const ClubPollSchema = new mongoose.Schema(
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
    question: { type: String, required: true, maxlength: 500 },
    options: {
      type: [OptionSchema],
      validate: (v) => v?.length >= 2 && v.length <= 10,
    },
    multiple: { type: Boolean, default: false },
    closesAt: { type: Date }, // optional
    visibility: {
      type: String,
      enum: ["public", "members"],
      default: "members",
    },
  },
  { timestamps: true }
);

export default mongoose.model("ClubPoll", ClubPollSchema);
