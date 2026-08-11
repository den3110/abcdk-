// models/mlpTeamModel.js
// Team đăng ký cho giải MLP. Mỗi team có roster VĐV (min/max theo mlpConfig).
// Team join dual match — sub-matches sẽ pick players từ roster theo slot constraint.
import mongoose from "mongoose";

const { Schema } = mongoose;

const mlpTeamSchema = new Schema(
  {
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    shortName: { type: String, default: "", trim: true, maxlength: 20 },
    logo: { type: String, default: "" },
    color: { type: String, default: "" }, // hex "#RRGGBB"

    captain: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Roster — bất kỳ VĐV nào; giới tính lấy từ user.gender khi cần check slot rule
    players: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Tổng phí đăng ký, phí đã đóng — nếu BTC thu phí theo team
    payment: {
      status: {
        type: String,
        enum: ["unpaid", "partial", "paid"],
        default: "unpaid",
      },
      amount: { type: Number, default: 0 },
      paidAt: { type: Date, default: null },
      note: { type: String, default: "" },
    },

    // Standing (aggregated qua các dual matches — có thể recalculate)
    standing: {
      wins: { type: Number, default: 0 },
      losses: { type: Number, default: 0 },
      slotsFor: { type: Number, default: 0 }, // tổng sub-match thắng
      slotsAgainst: { type: Number, default: 0 }, // tổng sub-match thua
      pointsFor: { type: Number, default: 0 }, // tổng điểm ghi được
      pointsAgainst: { type: Number, default: 0 },
    },

    // Pool assignment cho group stage. Chỉ có ý nghĩa khi tournament.mlpConfig.groupStage.enabled.
    // poolKey: "A".."Z" (đặt theo poolIndex). null = chưa bốc thăm.
    // seed: thứ tự seed trong bảng (1..N) — dùng để hiển thị / tiebreak khi cần.
    poolKey: { type: String, default: null, index: true },
    poolIndex: { type: Number, default: null },
    seed: { type: Number, default: null },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "withdrawn", "waitlisted"],
      default: "pending",
      index: true,
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Đảm bảo tên team unique trong giải (case-insensitive).
mlpTeamSchema.index(
  { tournament: 1, name: 1 },
  { unique: true, collation: { locale: "vi", strength: 2 } },
);
mlpTeamSchema.index({ tournament: 1, status: 1, createdAt: -1 });

const MlpTeam =
  mongoose.models.MlpTeam || mongoose.model("MlpTeam", mlpTeamSchema);
export default MlpTeam;
