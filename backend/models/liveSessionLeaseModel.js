import mongoose from "mongoose";

const { Schema } = mongoose;

const liveSessionLeaseSchema = new Schema(
  {
    matchKind: {
      type: String,
      enum: ["match", "userMatch"],
      required: true,
      index: true,
    },
    matchId: {
      type: Schema.Types.ObjectId,
      ref: "Match",
      default: null,
      index: true,
    },
    userMatchId: {
      type: Schema.Types.ObjectId,
      ref: "UserMatch",
      default: null,
      index: true,
    },
    platform: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    clientSessionId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "ended", "expired"],
      default: "active",
      index: true,
    },
    startedAt: { type: Date, required: true },
    lastHeartbeatAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    endedAt: { type: Date, default: null },
    pageId: { type: String, default: null, trim: true },
    liveVideoId: { type: String, default: null, trim: true },
    expireReason: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

liveSessionLeaseSchema.index({ status: 1, expiresAt: 1, platform: 1 });

liveSessionLeaseSchema.index(
  {
    matchKind: 1,
    matchId: 1,
    platform: 1,
    clientSessionId: 1,
    status: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      matchKind: "match",
      matchId: { $type: "objectId" },
      status: "active",
    },
  }
);

liveSessionLeaseSchema.index(
  {
    matchKind: 1,
    userMatchId: 1,
    platform: 1,
    clientSessionId: 1,
    status: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      matchKind: "userMatch",
      userMatchId: { $type: "objectId" },
      status: "active",
    },
  }
);

export default mongoose.models.LiveSessionLease ||
  mongoose.model("LiveSessionLease", liveSessionLeaseSchema);
