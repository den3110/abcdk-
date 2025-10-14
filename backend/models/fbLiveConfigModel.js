import mongoose from "mongoose";

const FbLiveConfigSchema = new mongoose.Schema(
  {
    // Single-doc config. If you need multi-tenant later, add tenantId.
    key: { type: String, unique: true, default: "fb_live_config" },

    // Creation-time options (do NOT include title/description/token here)
    status: {
      type: String,
      enum: ["LIVE_NOW", "SCHEDULED_UNPUBLISHED"],
      default: "LIVE_NOW",
    },
    privacyValueOnCreate: {
      type: String, // e.g., "EVERYONE", "FRIENDS", "ALL_FRIENDS", etc. (Page usually only public)
      default: "EVERYONE",
    },
    embeddable: { type: Boolean, default: true },

    // Post-processing after end
    ensurePrivacyAfterEnd: {
      type: String, // e.g., "EVERYONE"
      default: "EVERYONE",
    },
  },
  { timestamps: true }
);

export default mongoose.model("FbLiveConfig", FbLiveConfigSchema);
