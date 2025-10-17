// models/liveSessionModel.js
import mongoose from "mongoose";

const LiveSessionSchema = new mongoose.Schema({
  provider: { type: String, enum: ["facebook", "youtube", "tiktok"], required: true },
  channelId: { type: mongoose.Types.ObjectId, ref: "Channel", required: true },
  platformLiveId: String,
  status: { type: String, enum: ["CREATED", "LIVE", "ENDED", "ERROR", "CANCELED"], default: "CREATED" },
  serverUrl: String,
  streamKey: String,
  secureStreamUrl: String,
  permalinkUrl: String,
  matchId: { type: mongoose.Types.ObjectId, ref: "Match" },
  startedAt: Date,
  endedAt: Date,
  note: String,
  logs: [String],
}, { timestamps: true });

LiveSessionSchema.index({ provider: 1, channelId: 1, status: 1 });
export default mongoose.model("LiveSession", LiveSessionSchema);
