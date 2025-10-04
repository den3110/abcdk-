// models/ClubMember.js
import mongoose from "mongoose";

export const MEMBER_ROLE = ["owner", "admin", "member"];
export const MEMBER_STATUS = ["active", "banned"];

const ClubMemberSchema = new mongoose.Schema(
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
    role: { type: String, enum: MEMBER_ROLE, default: "member", index: true },
    status: { type: String, enum: MEMBER_STATUS, default: "active" },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ClubMemberSchema.index({ club: 1, user: 1 }, { unique: true });

const ClubMember = mongoose.model("ClubMember", ClubMemberSchema);
export default ClubMember;
