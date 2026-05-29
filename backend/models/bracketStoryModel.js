import mongoose from "mongoose";

const { Schema } = mongoose;

const bracketStorySchema = new Schema(
  {
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    generatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    promptVersion: { type: String, default: "bracket-story-v1" },
    model: { type: String, default: "" },
    source: {
      type: String,
      enum: ["ai", "fallback"],
      default: "fallback",
      index: true,
    },
    status: {
      type: String,
      enum: ["ready", "fallback"],
      default: "fallback",
      index: true,
    },
    story: { type: Schema.Types.Mixed, default: {} },
    sourceSummary: { type: Schema.Types.Mixed, default: {} },
    aiError: { type: String, default: "" },
  },
  { timestamps: true }
);

bracketStorySchema.index({ tournament: 1, createdAt: -1 });

export default mongoose.models.BracketStory ||
  mongoose.model("BracketStory", bracketStorySchema);
