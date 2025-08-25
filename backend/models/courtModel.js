// models/courtModel.js
import mongoose from "mongoose";
const { Schema, Types } = mongoose;

const courtSchema = new Schema(
  {
    tournament: {
      type: Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    name: { type: String, required: true },

    // vẫn giữ cluster nếu bạn cần label/nhãn, nhưng không còn là khóa chính để nhóm
    cluster: { type: String, default: "Main", index: true },

    // 🔴 BẮT BUỘC bracket
    bracket: {
      type: Types.ObjectId,
      ref: "Bracket",
      required: true,
      index: true,
    },

    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["idle", "assigned", "live", "maintenance"],
      default: "idle",
    },
    currentMatch: { type: Types.ObjectId, ref: "Match", default: null },
  },
  { timestamps: true }
);

// Mỗi bracket trong 1 tournament không được trùng tên sân
courtSchema.index({ tournament: 1, bracket: 1, name: 1 }, { unique: true });

export default mongoose.model("Court", courtSchema);
