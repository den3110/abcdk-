import mongoose from "mongoose";

const { Schema } = mongoose;

const liveActivityRegistrationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", index: true },
    deviceId: { type: String, required: true, index: true },
    platform: { type: String, enum: ["ios"], default: "ios", index: true },
    appVersion: { type: String, default: null },

    matchId: { type: String, required: true, index: true },
    matchCode: { type: String, default: "" },
    activityId: { type: String, required: true, index: true },
    pushToken: { type: String },

    status: {
      type: String,
      enum: ["scheduled", "queued", "assigned", "live", "finished"],
      default: "scheduled",
      index: true,
    },

    enabled: { type: Boolean, default: true, index: true },
    lastError: { type: String, default: null },
    lastActiveAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

liveActivityRegistrationSchema.index(
  { user: 1, deviceId: 1, activityId: 1 },
  { unique: true }
);
liveActivityRegistrationSchema.index(
  { pushToken: 1 },
  { unique: true, sparse: true }
);
liveActivityRegistrationSchema.index({ matchId: 1, enabled: 1, platform: 1 });

export default mongoose.models.LiveActivityRegistration ||
  mongoose.model("LiveActivityRegistration", liveActivityRegistrationSchema);
