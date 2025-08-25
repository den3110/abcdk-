// models/bracketModel.js
import mongoose from "mongoose";
import DrawSettingsSchema from "./drawSettingsSchema.js";
import seedSourceSchema from "./seedSourceSchema.js";

const { Schema } = mongoose;

/** Sub-schema: metadata nhẹ cho UI (không ràng buộc logic business) */
const bracketMetaSchema = new Schema(
  {
    /** Quy mô vẽ khung (2^n đội). Nếu truyền số bất kỳ, sẽ được làm tròn lên 2^k trong pre-save. */
    drawSize: { type: Number, default: 0 },
    /** Số vòng tối đa (n). Nếu có drawSize > 0, sẽ tính = log2(drawSize) trong pre-save. */
    maxRounds: { type: Number, default: 0 },
    /** Số cặp dự kiến ở vòng 1 (drawSize / 2) */
    expectedFirstRoundMatches: { type: Number, default: 0 },
  },
  { _id: false }
);

/** Nhóm/pool dùng cho round-robin & GSL */
const groupSchema = new Schema(
  {
    name: { type: String, required: true }, // ví dụ: "A", "B", "C"...
    expectedSize: { type: Number, default: 0 },
    regIds: [{ type: Schema.Types.ObjectId, ref: "Registration" }],
  },
  { _id: true }
);

const bracketSchema = new Schema(
  {
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    name: { type: String, required: true },

    /**
     * Hỗ trợ:
     * - "group"
     * - "knockout"
     * - "roundElim"
     * (về sau bạn có thể mở rộng double_elim / round_robin / swiss / gsl…)
     */
    type: {
      type: String,
      enum: [
        "knockout",
        "group",
        "double_elim",
        "round_robin",
        "swiss",
        "gsl",
        "roundElim",
      ],
      default: "knockout",
      index: true,
    },

    stage: { type: Number, default: 1 },
    order: { type: Number, default: 0 },

    /** Cấu hình thể thức (mặc định giữ nguyên như bạn đang dùng) */
    config: {
      // Luật trận mặc định cho bracket (match có thể override)
      rules: {
        bestOf: { type: Number, enum: [1, 3, 5], default: 3 },
        pointsToWin: { type: Number, enum: [11, 15, 21], default: 11 },
        winByTwo: { type: Boolean, default: true },
      },

      // Cấu hình seed/bốc thăm
      seeding: {
        method: {
          type: String,
          enum: ["rating", "random", "tiered", "protected"],
          default: "rating",
        },
        ratingKey: {
          type: String,
          enum: ["single", "double"],
          default: "double",
        },
        protectSameClub: { type: Boolean, default: false },
      },

      // Double Elimination
      doubleElim: {
        hasGrandFinalReset: { type: Boolean, default: true },
      },

      // Round Robin
      roundRobin: {
        points: {
          win: { type: Number, default: 1 },
          loss: { type: Number, default: 0 },
        },
        tiebreakers: {
          type: [String],
          default: ["h2h", "setsDiff", "pointsDiff", "pointsFor"],
        },
        groupSize: { type: Number, default: 4 },
      },

      // Swiss
      swiss: {
        rounds: { type: Number, default: 4 },
        points: {
          win: { type: Number, default: 1 },
          loss: { type: Number, default: 0 },
        },
        avoidRematch: { type: Boolean, default: true },
        pairing: {
          model: { type: String, default: "hungarian" },
        },
      },

      // GSL
      gsl: {
        groupSize: { type: Number, default: 4 },
      },

      // (tuỳ bạn mở rộng: config.roundElim nếu muốn)
      roundElim: {
        drawSize: { type: Number, default: 0 }, // nếu bạn muốn lưu riêng cho roundElim
        cutRounds: { type: Number, default: 0 }, // k: n → n/(2^k)
      },
    },

    /** Dùng cho round_robin/gsl nếu cần */
    groups: [groupSchema],

    // Counters
    matchesCount: { type: Number, default: 0 },
    teamsCount: { type: Number, default: 0 },

    // Cấu hình bốc thăm chung
    drawSettings: { type: DrawSettingsSchema, default: () => ({}) },

    /** KO scale theo số vòng: drawRounds = n → drawSize = 2^n (UI dùng meta để hiển thị) */
    drawRounds: { type: Number, default: 0 },

    /** ⭐ META nhẹ cho UI (quy mô hiển thị) */
    meta: { type: bracketMetaSchema, default: () => ({}) },
    prefill: {
      roundKey: { type: String, default: "" }, // "R16"
      seeds: [
        {
          pair: { type: Number, required: true }, // 1..N ở vòng đầu
          A: { type: seedSourceSchema, default: null },
          B: { type: seedSourceSchema, default: null },
        },
      ],
    },

    feedPolicy: [
      {
        to: { type: String, required: true }, // ví dụ "R1#3A" (round 1, match #3, slot A)
        from: seedSourceSchema, // nguồn cố định
      },
    ],
    scheduler: {
      autoAssign: { type: Boolean, default: true }, // true: tự động fill sau mỗi trận kết thúc
    },
  },
  { timestamps: true }
);

// ===== Helpers =====
function ceilPow2(n) {
  if (!n || n < 1) return 0;
  return 1 << Math.ceil(Math.log2(n));
}
function isPow2(n) {
  return Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;
}

// Đồng bộ meta trước khi lưu (an toàn)
bracketSchema.pre("save", function (next) {
  this.meta = this.meta || {};

  // Nếu có meta.drawSize → làm tròn lên 2^k và sync maxRounds/expectedFirstRoundMatches
  if (typeof this.meta.drawSize === "number" && this.meta.drawSize > 0) {
    const pow2 = isPow2(this.meta.drawSize)
      ? this.meta.drawSize
      : ceilPow2(this.meta.drawSize);
    this.meta.drawSize = pow2;
    this.meta.maxRounds = Math.round(Math.log2(pow2));
    this.meta.expectedFirstRoundMatches = pow2 / 2;
  }

  // Nếu type = knockout & có drawRounds mà meta còn thiếu → sync meta từ drawRounds
  if (
    this.type === "knockout" &&
    Number.isInteger(this.drawRounds) &&
    this.drawRounds > 0 &&
    (!this.meta.drawSize || !this.meta.maxRounds)
  ) {
    const pow2 = 1 << this.drawRounds;
    if (!this.meta.drawSize) this.meta.drawSize = pow2;
    if (!this.meta.maxRounds) this.meta.maxRounds = this.drawRounds;
    if (!this.meta.expectedFirstRoundMatches)
      this.meta.expectedFirstRoundMatches = pow2 / 2;
  }

  next();
});

bracketSchema.index({ tournament: 1, order: 1 });
bracketSchema.index({ tournament: 1, type: 1 });

export default mongoose.model("Bracket", bracketSchema);
