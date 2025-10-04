// models/Club.js
import mongoose from "mongoose";

export const CLUB_VISIBILITY = ["public", "private", "hidden"];
export const CLUB_JOIN_POLICY = ["open", "approval", "invite_only"]; // mở / duyệt / chỉ mời

const ClubSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxLength: 120 },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    shortCode: { type: String, trim: true, maxLength: 12 },
    description: { type: String, default: "", maxLength: 4000 },

    sportTypes: { type: [String], default: ["pickleball"] },

    visibility: {
      type: String,
      enum: CLUB_VISIBILITY,
      default: "public",
      index: true,
    },
    joinPolicy: { type: String, enum: CLUB_JOIN_POLICY, default: "approval" },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    admins: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    ],

    logoUrl: { type: String, default: "" },
    coverUrl: { type: String, default: "" },
    website: { type: String, default: "" },
    facebook: { type: String, default: "" },
    zalo: { type: String, default: "" },

    country: { type: String, default: "VN" },
    province: { type: String, default: "" },
    city: { type: String, default: "" },

    stats: {
      memberCount: { type: Number, default: 1 }, // bắt đầu = 1 (owner)
      tournamentWins: { type: Number, default: 0 },
    },

    tags: [{ type: String }],
    isVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Helper: tạo slug
ClubSchema.statics.slugify = function (name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
};

const Club = mongoose.model("Club", ClubSchema);
export default Club;
