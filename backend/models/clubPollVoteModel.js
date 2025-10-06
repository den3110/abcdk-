// models/clubPollVoteModel.js
import mongoose from "mongoose";

const ClubPollVoteSchema = new mongoose.Schema(
  {
    poll: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClubPoll",
      index: true,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: true,
    },
    optionIds: { type: [String], default: [] }, // 1 hoặc nhiều tuỳ multiple
  },
  { timestamps: true }
);

ClubPollVoteSchema.index({ poll: 1, user: 1 }, { unique: true });

export default mongoose.model("ClubPollVote", ClubPollVoteSchema);
