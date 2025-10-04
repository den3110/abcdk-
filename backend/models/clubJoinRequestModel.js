// models/ClubJoinRequest.js
import mongoose from "mongoose";

export const REQUEST_STATUS = ["pending", "accepted", "rejected", "cancelled"];

const ClubJoinRequestSchema = new mongoose.Schema(
  {
    club: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    message: { type: String, default: "", maxLength: 2000 },
    status: {
      type: String,
      enum: REQUEST_STATUS,
      default: "pending",
      index: true,
    },
    decidedAt: { type: Date },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Cho phép 1 pending duy nhất mỗi user/club
ClubJoinRequestSchema.index(
  { club: 1, user: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

const ClubJoinRequest = mongoose.model(
  "ClubJoinRequest",
  ClubJoinRequestSchema
);
export default ClubJoinRequest;
