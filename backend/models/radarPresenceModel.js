import mongoose from "mongoose";

const radarPresenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
      unique: true, // mỗi user chỉ 1 presence active
    },

    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
      },
    },

    status: {
      type: String,
      enum: ["looking_partner", "in_match", "just_chilling", "busy"],
      default: "looking_partner",
    },

    visibility: {
      type: String,
      enum: ["precise", "venue_only", "fuzzed"],
      default: "venue_only",
    },

    source: {
      type: String,
      enum: ["gps", "venue", "manual"],
      default: "gps",
    },

    preferredRadiusKm: {
      type: Number,
      default: 5,
      min: 1,
      max: 50,
    },

    // TTL: sau 10 phút không cập nhật thì tự xoá
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

// Tạo index địa lý
radarPresenceSchema.index({ location: "2dsphere" });

const RadarPresence = mongoose.model("RadarPresence", radarPresenceSchema);

export default RadarPresence;