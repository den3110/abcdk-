// models/bracketModel.js
import mongoose from "mongoose";
import DrawSettingsSchema from "./drawSettingsSchema.js";

const { Schema } = mongoose;

/**
 * Nhóm/pool dùng cho round-robin & GSL (group-of-4).
 * - regIds: danh sách Registration tham dự nhóm này
 */
const groupSchema = new Schema(
  {
    name: { type: String, required: true }, // ví dụ: "A", "B", "C"...
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
     * GIỮ NGUYÊN: "knockout" | "group"
     * MỞ RỘNG: "double_elim" | "round_robin" | "swiss" | "gsl"
     */
    type: {
      type: String,
      enum: [
        "knockout",
        "group", // dùng chung cho bảng thuần túy
        "double_elim",
        "round_robin",
        "swiss",
        "gsl",
      ],
      default: "knockout",
      index: true,
    },

    stage: { type: Number, default: 1 }, // GIỮ NGUYÊN
    order: { type: Number, default: 0 }, // GIỮ NGUYÊN

    /**
     * Cấu hình theo thể thức (đều có default, không bắt buộc truyền)
     */
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
        hasGrandFinalReset: { type: Boolean, default: true }, // true-double
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
          // dành cho thuật toán nâng cao
          model: { type: String, default: "hungarian" }, // hoặc "bp" nếu bạn implement branch & bound
        },
      },

      // GSL (group-of-4: winners/losers/decider)
      gsl: {
        groupSize: { type: Number, default: 4 }, // ~ luôn là 4
      },
    },

    /**
     * Dùng cho "round_robin" và "gsl" (nhóm/pool)
     */
    groups: [groupSchema],

    // Đếm nhanh
    matchesCount: { type: Number, default: 0 },
    teamsCount: { type: Number, default: 0 },
    // === NEW: override theo từng giải ===
    drawSettings: { type: DrawSettingsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

bracketSchema.index({ tournament: 1, order: 1 });
bracketSchema.index({ tournament: 1, type: 1 });

export default mongoose.model("Bracket", bracketSchema);
