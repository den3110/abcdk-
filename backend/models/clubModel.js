// models/clubModel.js
import mongoose from "mongoose";

export const CLUB_VISIBILITY = ["public", "private", "hidden"];
export const CLUB_JOIN_POLICY = ["open", "approval", "invite_only"];

const LocationGeoSchema = new mongoose.Schema(
  {
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },

    countryCode: { type: String, default: null },
    countryName: { type: String, default: null },
    locality: { type: String, default: null },
    admin1: { type: String, default: null },
    admin2: { type: String, default: null },

    displayName: { type: String, default: null }, // formatted
    accuracy: { type: String, enum: ["low", "medium", "high"], default: "low" },
    confidence: { type: Number, default: 0 },
    provider: { type: String, default: "openai-geocode" },
    raw: { type: String, default: null },

    updatedAt: { type: Date, default: null },
  },
  { _id: false }
);

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
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],

    logoUrl: { type: String, default: "" },
    coverUrl: { type: String, default: "" },
    website: { type: String, default: "" },
    facebook: { type: String, default: "" },
    zalo: { type: String, default: "" },

    country: { type: String, default: "VN" },
    province: { type: String, default: "" },
    city: { type: String, default: "" },

    // ✅ NEW: địa chỉ / text để geocode
    address: { type: String, default: "", maxLength: 300 },
    locationText: { type: String, default: "", maxLength: 400 }, // chuỗi dùng geocode (ưu tiên address)

    // ✅ NEW: geo point để $geoNear
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      // [lon, lat]
      coordinates: {
        type: [Number],
        default: undefined, // để field "missing" nếu chưa có
      },
    },

    // ✅ NEW: metadata geocode
    locationGeo: { type: LocationGeoSchema, default: undefined },

    stats: {
      memberCount: { type: Number, default: 1 },
      tournamentWins: { type: Number, default: 0 },
    },

    tags: [{ type: String }],
    isVerified: { type: Boolean, default: false },
    memberVisibility: {
      type: String,
      enum: ["admins", "members", "public"],
      default: "admins",
    },
    showRolesToMembers: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ✅ index geo
ClubSchema.index({ location: "2dsphere" });

// 👉 Text index cho search với $text
ClubSchema.index(
  {
    name: "text",
    description: "text",
    tags: "text",
    shortCode: "text",
    province: "text",
    city: "text",
    address: "text",
    locationText: "text",
  },
  {
    name: "ClubTextIndex",
    weights: {
      name: 10,
      tags: 5,
      shortCode: 5,
      description: 2,
      province: 1,
      city: 1,
      address: 2,
      locationText: 2,
    },
    default_language: "none",
  }
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
