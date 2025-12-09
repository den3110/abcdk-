// models/userRadarModel.js
import mongoose from "mongoose";

const userRadarSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // Mỗi user chỉ có 1 hồ sơ Radar
    },

    radarSettings: {
      enabled: { type: Boolean, default: false },
      radiusKm: { type: Number, default: 5, min: 1, max: 50 },
      preferredPlayType: {
        type: String,
        enum: ["single", "double", "mixed", "any"],
        default: "any",
      },
      preferredGender: {
        type: String,
        enum: ["any", "male", "female"],
        default: "any",
      },
    },

    radarProfile: {
      playYears: { type: Number, default: 0 },
      playingFrequency: {
        type: String,
        enum: ["rarely", "weekly", "2-3_per_week", "daily"],
        default: "weekly",
      },
      typicalDays: { type: [String], default: [] },
      typicalTimeSlots: { type: [String], default: [] },
      preferredVenues: { type: [String], default: [] },
      playStyle: {
        type: String,
        enum: ["aggressive", "defensive", "balanced", "unknown"],
        default: "unknown",
      },
      handedness: {
        type: String,
        enum: ["right", "left", "both", "unknown"],
        default: "unknown",
      },
    },

    lastKnownLocation: {
      type: {
        type: String,
        enum: ["Point"],
        // Không default: "Point" để tránh rác
      },
      coordinates: {
        type: [Number], // [lng, lat]
        default: undefined,
      },
      updatedAt: Date,
    },
  },
  { timestamps: true }
);

// 👇 Index quan trọng nhất nằm ở đây
userRadarSchema.index({ lastKnownLocation: "2dsphere" });

export default mongoose.model("UserRadar", userRadarSchema);