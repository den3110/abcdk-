// models/playerCourtPositionModel.js
// Vị trí SỞ TRƯỜNG (ô 1 / ô 2) của VĐV trong đánh đôi — kết quả đã GOM SẴN để tra
// nhanh (bảng xếp hạng/hồ sơ/overlay). Tính từ base MỞ MÀN (điểm 0-0-2 ván 1) của
// các trận. Cập nhật bằng rebuildAllPlayerCourtPositions (quét toàn bộ) hoặc job định kỳ.
import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    slot1: { type: Number, default: 0 }, // số trận mở màn ở ô 1
    slot2: { type: Number, default: 0 }, // số trận mở màn ở ô 2
    total: { type: Number, default: 0 },
    preferred: { type: Number, enum: [1, 2, null], default: null }, // ô sở trường
    preferredPct: { type: Number, default: 0 }, // % trận ở ô sở trường
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

const PlayerCourtPosition =
  mongoose.models.PlayerCourtPosition ||
  mongoose.model("PlayerCourtPosition", schema, "playercourtpositions");

export default PlayerCourtPosition;
