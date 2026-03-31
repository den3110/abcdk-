import mongoose from "mongoose";

const { Schema } = mongoose;

const matchLiveEventSchema = new Schema(
  {
    matchId: {
      type: Schema.Types.ObjectId,
      ref: "Match",
      required: true,
      index: true,
    },
    tournamentId: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      default: null,
      index: true,
    },
    clientEventId: {
      type: String,
      required: true,
      trim: true,
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ["start", "point", "undo", "finish", "forfeit"],
      required: true,
      index: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
    clientCreatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    clientBaseVersion: {
      type: Number,
      default: 0,
    },
    serverVersion: {
      type: Number,
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ["mobile_sync", "legacy_socket", "legacy_http"],
      default: "mobile_sync",
      index: true,
    },
    acceptedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

matchLiveEventSchema.index(
  { matchId: 1, clientEventId: 1 },
  { unique: true, name: "uniq_match_client_event" }
);

matchLiveEventSchema.index(
  { matchId: 1, serverVersion: 1 },
  { unique: true, name: "uniq_match_server_version" }
);

const MatchLiveEvent = mongoose.model("MatchLiveEvent", matchLiveEventSchema);

export default MatchLiveEvent;
