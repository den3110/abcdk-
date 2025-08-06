import mongoose from "mongoose";

const scoreHistorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // VĐV
    scorer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    }, // người chấm (admin / referee)
    single: { type: Number, required: true },
    double: { type: Number, required: true },
    note: { type: String, default: "" },
    scoredAt: { type: Date, default: Date.now }, // ngày chấm (hiển thị)
  },
  { timestamps: true, strict: true }
);

export default mongoose.model("ScoreHistory", scoreHistorySchema);
