import mongoose from "mongoose";

const { Schema } = mongoose;

const overlayTemplateSchema = new Schema(
  {
    name: { type: String, trim: true, required: true, maxlength: 120 },
    description: { type: String, trim: true, default: "", maxlength: 500 },
    engine: {
      type: String,
      enum: ["safe-layers"],
      default: "safe-layers",
      index: true,
    },
    sourceTemplateKey: { type: String, trim: true, default: "" },
    isSystem: { type: Boolean, default: false, index: true },
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      default: null,
      index: true,
    },
    scopeType: {
      type: String,
      enum: ["default", "tournament", "bracket", "match"],
      default: "tournament",
      index: true,
    },
    scopeId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
      index: true,
    },
    version: { type: Number, default: 1, min: 1 },
    canvas: {
      width: { type: Number, default: 1920, min: 320, max: 3840 },
      height: { type: Number, default: 1080, min: 180, max: 2160 },
    },
    document: {
      type: Schema.Types.Mixed,
      default: () => ({ background: "transparent", layers: [] }),
    },
    bindings: { type: [String], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

overlayTemplateSchema.index({
  tournament: 1,
  scopeType: 1,
  scopeId: 1,
  status: 1,
  updatedAt: -1,
});

export default mongoose.model("OverlayTemplate", overlayTemplateSchema);
