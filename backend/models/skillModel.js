// models/skillModel.js
import mongoose from "mongoose";

const skillSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      default: "",
    },
    examples: {
      type: [String],
      default: [],
    },
    input_schema: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    action: {
      type: {
        type: String,
        enum: ["mongo", "aggregate", "internal", "http"], // ✅ THÊM "aggregate"
        required: true,
      },
      config: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
      },
    },
    response_template: {
      type: String,
      default: "",
    },
    embedding: {
      type: [Number],
      default: null,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

skillSchema.index({ name: 1 });
skillSchema.index({ enabled: 1 });
skillSchema.index({ usageCount: -1 });

const Skill = mongoose.model("Skill", skillSchema);

export default Skill;