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
    // Per-sub-match assignment — override dual-level nếu set. Cho phép 2
    // sub-match cùng dual đấu ở 2 sân khác nhau, trọng tài khác nhau.
    referees: [{ type: Schema.Types.ObjectId, ref: "User" }],
    court: { type: Schema.Types.ObjectId, ref: "Court", default: null },
    courtStation: {
      type: Schema.Types.ObjectId,
      ref: "CourtStation",
      default: null,
    },
    scheduledAt: { type: Date, default: null },
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
      // Rating engine đã cập nhật điểm trình cho VĐV chưa (idempotent).
      ratingApplied: { type: Boolean, default: false },
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

    // Phase phân biệt vòng bảng vs knockout. Backwards-compatible:
    // - phase="group" + poolKey set → dual thuộc vòng bảng của poolKey đó.
    // - phase="knockout" + knockoutRound set → dual thuộc cây knockout.
    //   knockoutRound = 1 (round đầu tiên, VD tứ kết cho 8 team), 2 (bán kết), ...
    // - phase=null (mặc định) → giữ hành vi cũ (round-robin flat).
    phase: {
      type: String,
      enum: ["group", "knockout", null],
      default: null,
      index: true,
    },
    poolKey: { type: String, default: null, index: true },
    knockoutRound: { type: Number, default: null },
    // Vị trí trong cây knockout: giúp auto-advance winner sang slot round tiếp theo.
    // bracketSlot = index 0-based trong round hiện tại.
    // nextMatch = dual doc kế tiếp; nextSlot = "A" | "B" — winner này thay teamA/B slot đó.
    bracketSlot: { type: Number, default: null },
    nextMatch: {
      type: Schema.Types.ObjectId,
      ref: "MlpDualMatch",
      default: null,
    },
    nextSlot: { type: String, enum: ["A", "B", null], default: null },

    // teamA/B nullable để hỗ trợ shell dual (round sau chưa biết winner).
    teamA: { type: Schema.Types.ObjectId, ref: "MlpTeam", default: null },
    teamB: { type: Schema.Types.ObjectId, ref: "MlpTeam", default: null },

    subMatches: { type: [SubMatchSchema], default: [] },
    dreamBreaker: { type: DreamBreakerSchema, default: () => ({}) },

    status: {
      type: String,
      enum: ["scheduled", "live", "tie_break", "finished"],
      default: "scheduled",
      index: true,
    },

    // Runtime metadata: sân + trọng tài + giờ dự kiến. Mỗi dual có thể gán
    // 1 hoặc nhiều trọng tài (chính + phụ). Court: chấp nhận Court cũ hoặc
    // CourtStation mới — lưu id, controller/overlay sẽ dedup.
    court: { type: Schema.Types.ObjectId, ref: "Court", default: null, index: true },
    courtStation: {
      type: Schema.Types.ObjectId,
      ref: "CourtStation",
      default: null,
      index: true,
    },
    referees: [{ type: Schema.Types.ObjectId, ref: "User" }],
    scheduledAt: { type: Date, default: null, index: true },
    note: { type: String, default: "", maxlength: 500 },

    // Check-in trước dual: captain xác nhận đội mình sẵn sàng. Chỉ chấp
    // nhận captain của team A/B (hoặc admin/manager). Blocking: sub-match
    // score đầu tiên yêu cầu cả 2 team đã check-in (soft — cảnh báo, không
    // chặn cứng để BTC có thể force start).
    checkInA: {
      checkedAt: { type: Date, default: null },
      by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    checkInB: {
      checkedAt: { type: Date, default: null },
      by: { type: Schema.Types.ObjectId, ref: "User", default: null },
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
mlpDualMatchSchema.index({ tournament: 1, phase: 1, poolKey: 1, order: 1 });
mlpDualMatchSchema.index({ tournament: 1, phase: 1, knockoutRound: 1, order: 1 });
mlpDualMatchSchema.index({ teamA: 1 });
mlpDualMatchSchema.index({ teamB: 1 });

const MlpDualMatch =
  mongoose.models.MlpDualMatch ||
  mongoose.model("MlpDualMatch", mlpDualMatchSchema);
export default MlpDualMatch;
