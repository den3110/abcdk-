import mongoose from "mongoose";

const drawControlStateSchema = new mongoose.Schema(
  {
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      unique: true,
      index: true,
    },
    activeDrawId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DrawSession",
      default: null,
    },
    activeBracketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bracket",
      default: null,
    },
    holderUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    holderName: {
      type: String,
      default: "",
      trim: true,
    },
    holderRoles: {
      type: [String],
      default: [],
    },
    holderSocketId: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["idle", "locked", "active", "committed", "canceled"],
      default: "idle",
      index: true,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    updatedAt: {
      type: Date,
      default: null,
    },
    heartbeatAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    revision: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

const DrawControlState =
  mongoose.models.DrawControlState ||
  mongoose.model("DrawControlState", drawControlStateSchema);

export default DrawControlState;
