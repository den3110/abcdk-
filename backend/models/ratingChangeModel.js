import mongoose from "mongoose";

const ratingChangeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: true,
    },
    match: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      index: true,
      required: true,
    },
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      index: true,
      required: true,
    },

    // "singles" | "doubles"
    kind: { type: String, enum: ["singles", "doubles"], required: true },

    before: { type: Number, required: true }, // DUPR trước (2.0..8.0)
    after: { type: Number, required: true }, // DUPR sau
    delta: { type: Number, required: true }, // after - before

    expected: { type: Number, required: true }, // P(win) của team người chơi
    score: { type: Number, required: true }, // 1=thắng, 0=thua

    // Reliability trước/sau để debug K
    reliabilityBefore: { type: Number, default: 0 },
    reliabilityAfter: { type: Number, default: 0 },

    // Optional: margin info (từ gameScores)
    marginBonus: { type: Number, default: 0 },

    // Các lần dàn điểm thủ công theo điểm mục tiêu ở hồ sơ công khai.
    // Lưu theo owner để lần bấm sau tự hoàn tác phần cũ rồi áp phần mới,
    // tránh cộng dồn sai delta.
    targetAdjustments: [
      {
        _id: false,
        owner: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          index: true,
          required: true,
        },
        delta: { type: Number, required: true },
        adjustedAt: { type: Date, default: Date.now },
        adjustedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],

    // ===== Thu hồi điểm theo bracket (super admin) =====
    // Khi thu hồi: delta -> 0, after -> before (lịch sử vẫn còn nhưng là 0 điểm);
    // giá trị gốc giữ ở origDelta/origAfter để trace/khôi phục ngược khi cần.
    revoked: { type: Boolean, default: false },
    revokedAt: { type: Date },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    origDelta: { type: Number },
    origAfter: { type: Number },
    // Chuỗi ScoreHistory đã được dịch xuống theo delta của log này chưa.
    // Tách khỏi `revoked` để có thể "sửa bù" lịch sử cho các lần thu hồi cũ
    // (trước khi vá schema sourceMatch) mà không trừ Ranking lần hai.
    histShifted: { type: Boolean, default: false },
  },
  { timestamps: true, strict: true }
);

// idempotent: 1 user chỉ được log 1 lần cho 1 match/kind
ratingChangeSchema.index({ user: 1, match: 1, kind: 1 }, { unique: true });
ratingChangeSchema.index({ "targetAdjustments.owner": 1, kind: 1 });

export default mongoose.model("RatingChange", ratingChangeSchema);
