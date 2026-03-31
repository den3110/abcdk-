import mongoose from "mongoose";

const chatBotTelemetrySchema = new mongoose.Schema(
  {
    turnId: {
      type: String,
      index: true,
      required: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatBotMessage",
      index: true,
      default: null,
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatBotMessage",
      default: null,
    },
    pageType: {
      type: String,
      trim: true,
      default: "",
    },
    pageSection: {
      type: String,
      trim: true,
      default: "",
    },
    pageView: {
      type: String,
      trim: true,
      default: "",
    },
    intent: {
      type: String,
      trim: true,
      default: "",
    },
    routeKind: {
      type: String,
      trim: true,
      default: "",
    },
    toolsPlanned: {
      type: [String],
      default: [],
    },
    toolsUsed: {
      type: [String],
      default: [],
    },
    toolLatencyMs: {
      type: [
        {
          _id: false,
          tool: { type: String, default: "" },
          durationMs: { type: Number, default: 0 },
          error: { type: Boolean, default: false },
        },
      ],
      default: [],
    },
    model: {
      type: String,
      trim: true,
      default: "",
    },
    mode: {
      type: String,
      trim: true,
      default: "",
    },
    reasoningUsed: {
      type: Boolean,
      default: false,
    },
    firstTokenLatencyMs: {
      type: Number,
      default: 0,
    },
    processingTimeMs: {
      type: Number,
      default: 0,
    },
    actionCount: {
      type: Number,
      default: 0,
    },
    actionTypes: {
      type: [String],
      default: [],
    },
    actionExecuted: {
      type: [
        {
          _id: false,
          type: { type: String, default: "" },
          label: { type: String, default: "" },
          success: { type: Boolean, default: true },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    cardKinds: {
      type: [String],
      default: [],
    },
    sourceCount: {
      type: Number,
      default: 0,
    },
    outcome: {
      type: String,
      enum: ["success", "aborted", "error", "empty"],
      default: "success",
    },
    feedback: {
      value: {
        type: String,
        enum: ["positive", "negative", ""],
        default: "",
      },
      reason: {
        type: String,
        trim: true,
        default: "",
      },
      note: {
        type: String,
        trim: true,
        default: "",
      },
      at: {
        type: Date,
        default: null,
      },
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: {
        expires: 0,
      },
    },
  },
  {
    timestamps: true,
  },
);

const ChatBotTelemetry =
  mongoose.models.ChatBotTelemetry ||
  mongoose.model("ChatBotTelemetry", chatBotTelemetrySchema);

export default ChatBotTelemetry;
