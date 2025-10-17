// models/channelModel.js
import mongoose from "mongoose";

const ChannelSchema = new mongoose.Schema({
  provider: { type: String, enum: ["facebook", "youtube", "tiktok"], required: true },
  externalId: { type: String, required: true }, // FB pageId / YT channelId / TikTok handle
  name: String,
  ownerKey: String,
  credentialId: { type: mongoose.Types.ObjectId, ref: "Credential" },
  eligibleLive: { type: Boolean, default: true },
  meta: mongoose.Schema.Types.Mixed, // { pageToken, pageTokenExpiresAt, manualIngest, ... }
  lastCheckedAt: Date,
}, { timestamps: true });

ChannelSchema.index({ provider: 1, externalId: 1 }, { unique: true });
export default mongoose.model("Channel", ChannelSchema);
