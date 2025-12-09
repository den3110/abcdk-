// backend/models/radarIntentModel.js
import mongoose from "mongoose";

const radarIntentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    kind: {
      type: String,
      enum: ["practice", "tournament", "friendly", "coffee_chat"],
      default: "practice",
    },

    note: { type: String, maxlength: 200 },

    minRating: Number,
    maxRating: Number,

    maxDistanceKm: { type: Number, default: 10 },

    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

const RadarIntent = mongoose.model("RadarIntent", radarIntentSchema);
export default RadarIntent;
