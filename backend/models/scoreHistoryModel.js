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
    // Trận sinh ra snapshot này. applyRatingForFinishedMatch vẫn luôn push field này
    // nhưng schema strict trước đây âm thầm vứt bỏ -> khai báo để từ nay được lưu
    // (dùng làm neo chính xác khi thu hồi điểm bracket).
    sourceMatch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      required: false,
    },
  },
  { timestamps: true, strict: true }
);

scoreHistorySchema.index({ user: 1, scoredAt: -1 });

export default mongoose.model("ScoreHistory", scoreHistorySchema);
