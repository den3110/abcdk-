// models/mlpDualMatchModel.js
// Dual match = 1 cặp team A vs team B trong giải MLP.
// Chứa N sub-matches (theo mlpConfig.slots), mỗi sub-match link tới 1 Match doc
// (dùng chấm điểm bằng RefereeScorePanel như trận thường).
// Nếu tổng slot thắng hoà → trigger DreamBreaker.
import mongoose from "mongoose";

const { Schema } = mongoose;

const SubMatchSchema = new Schema(
  {
    slotKey: { type: String, required: true, maxlength: 20 },
    order: { type: Number, default: 0 },
    // Lineup: playersA, playersB có thể có 1 (single) hoặc 2 (double) VĐV
    playersA: [{ type: Schema.Types.ObjectId, ref: "User" }],
    playersB: [{ type: Schema.Types.ObjectId, ref: "User" }],
    // Link sang Match doc — chấm điểm dùng engine hiện có (RefereeScorePanel)
    match: { type: Schema.Types.ObjectId, ref: "Match", default: null },
    // Cache kết quả (denorm từ Match) cho query nhanh
    result: {
      status: {
        type: String,
        enum: ["pending", "scheduled", "live", "finished"],
        default: "pending",
      },
      scoreA: { type: Number, default: 0 },
      scoreB: { type: Number, default: 0 },
      winner: { type: String, enum: ["A", "B", null], default: null },
      finishedAt: { type: Date, default: null },
    },
  },
  { _id: true },
);

const DreamBreakerPointSchema = new Schema(
  {
    // Chuỗi các điểm ghi được, dùng để rebuild rotation.
    scoredBy: { type: String, enum: ["A", "B"], required: true },
    // Ai đang cầm cây vợt tại thời điểm ghi (từ lineup)
    playerAId: { type: Schema.Types.ObjectId, ref: "User" },
    playerBId: { type: Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const DreamBreakerSchema = new Schema(
  {
    triggered: { type: Boolean, default: false },
    // Lineup thứ tự VĐV thi đấu (mỗi team). Nếu 1 team có N VĐV, cứ chạm mốc
    // rotationEveryPoints thì đổi sang VĐV kế tiếp (cyclic).
    lineupA: [{ type: Schema.Types.ObjectId, ref: "User" }],
    lineupB: [{ type: Schema.Types.ObjectId, ref: "User" }],
    // Log điểm để có thể rebuild rotation nếu chỉnh sửa.
    points: { type: [DreamBreakerPointSchema], default: [] },
    // Tổng điểm hiện tại
    scoreA: { type: Number, default: 0 },
    scoreB: { type: Number, default: 0 },
    winner: { type: String, enum: ["A", "B", null], default: null },
    finishedAt: { type: Date, default: null },
  },
  { _id: false },
);

const mlpDualMatchSchema = new Schema(
  {
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    bracket: {
      type: Schema.Types.ObjectId,
      ref: "Bracket",
      default: null,
      index: true,
    },
    round: { type: Number, default: 1 },
    order: { type: Number, default: 0 },

    teamA: { type: Schema.Types.ObjectId, ref: "MlpTeam", required: true },
    teamB: { type: Schema.Types.ObjectId, ref: "MlpTeam", required: true },

    subMatches: { type: [SubMatchSchema], default: [] },
    dreamBreaker: { type: DreamBreakerSchema, default: () => ({}) },

    status: {
      type: String,
      enum: ["scheduled", "live", "tie_break", "finished"],
      default: "scheduled",
      index: true,
    },
    // Tổng slot thắng
    slotWinsA: { type: Number, default: 0 },
    slotWinsB: { type: Number, default: 0 },
    winner: { type: String, enum: ["A", "B", null], default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

mlpDualMatchSchema.index({ tournament: 1, status: 1, round: 1, order: 1 });
mlpDualMatchSchema.index({ teamA: 1 });
mlpDualMatchSchema.index({ teamB: 1 });

const MlpDualMatch =
  mongoose.models.MlpDualMatch ||
  mongoose.model("MlpDualMatch", mlpDualMatchSchema);
export default MlpDualMatch;
