// models/assessmentModel.js
import mongoose from "mongoose";

const assessmentItemSchema = new mongoose.Schema(
  {
    skillId: { type: Number, required: true },
    single: { type: Number, required: true, min: 1.6, max: 8 },
    double: { type: Number, required: true, min: 1.6, max: 8 },
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
    scorer: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // ai chấm

    // ❗ Items KHÔNG còn bắt buộc
    items: { type: [assessmentItemSchema], required: false, default: [] },

    // Snapshot kết quả tại thời điểm chấm
    // singleScore/doubleScore: thang RAW 0..10 (đã quy đổi từ DUPR)
    // singleLevel/doubleLevel: thang DUPR 2.000..8.000
    singleScore: Number,
    doubleScore: Number,
    singleLevel: Number,
    doubleLevel: Number,

    // yếu tố phụ (không ảnh hưởng level)
    meta: {
      freq: { type: Number, default: 0 }, // 0..5
      competed: { type: Boolean, default: false },
      external: { type: Number, default: 0 }, // 0..10
      selfScored: { type: Boolean, default: false },
      scoreBy: {
        type: String,
        enum: ["admin", "mod", "moderator", "self"],
        lowercase: true,
      },
    },

    note: { type: String, default: "" },
    scoredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

assessmentSchema.index({ user: 1, scoredAt: -1 });
assessmentSchema.index({ "meta.scoreBy": 1 });

export default mongoose.model("Assessment", assessmentSchema);
