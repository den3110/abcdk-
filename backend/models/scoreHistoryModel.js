import mongoose from "mongoose";

const scoreHistorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // VĐV
    scorer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    }, // người chấm (admin / referee)
    single: { type: Number, required: false },
    double: { type: Number, required: false },
    note: { type: String, default: "" },
    scoredAt: { type: Date, default: Date.now }, // ngày chấm (hiển thị)
  },
  { timestamps: true, strict: true }
);

export default mongoose.model("ScoreHistory", scoreHistorySchema);
