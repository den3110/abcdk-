import mongoose from "mongoose";

// Mã ngắn (6 số) ánh xạ tới 1 phiên bình luận — cho link gọn /c/<code> thay vì full JWT.
// TTL tự xoá khi hết hạn.
const commentaryCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    machineId: { type: String, required: true },
    sid: { type: String, required: true },
    courtName: { type: String, default: "" },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

export default mongoose.model("CommentaryCode", commentaryCodeSchema);
