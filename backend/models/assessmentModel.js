// models/assessmentModel.js
import mongoose from "mongoose";

const assessmentItemSchema = new mongoose.Schema(
  {
    skillId: { type: Number, required: true },
    single: { type: Number, required: true, min: 0, max: 10 },
    double: { type: Number, required: true, min: 0, max: 10 },
  },
  { _id: false }
);

const assessmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    scorer: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // ai chấm (có thể là chính user)
    items: { type: [assessmentItemSchema], required: true },

    // Kết quả snapshot lúc chấm
    singleScore: Number,
    doubleScore: Number,
    singleLevel: Number,
    doubleLevel: Number,

    // yếu tố phụ (tách riêng để query nhanh)
    meta: {
      freq: { type: Number, default: 0 }, // 0..5
      competed: { type: Boolean, default: false },
      external: { type: Number, default: 0 }, // 0..10
    },

    note: { type: String, default: "" },
    scoredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

assessmentSchema.index({ user: 1, scoredAt: -1 });

export default mongoose.model("Assessment", assessmentSchema);
