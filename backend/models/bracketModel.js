// models/bracketModel.js
import mongoose from "mongoose";
import DrawSettingsSchema from "./drawSettingsSchema.js";
import seedSourceSchema from "./seedSourceSchema.js";
import Tournament from "./tournamentModel.js"; // 👈 dùng để auto-clear drawPlan

const { Schema } = mongoose;

/* ====== PO PREPLAN SUB-SCHEMAS ====== */
const PoFixedSchema = new Schema(
  {
    pairIndex: { type: Number, min: 0, required: true }, // 0-based
    side: { type: String, enum: ["A", "B"], default: "A" },
    reg: { type: Schema.Types.ObjectId, ref: "Registration", default: null }, // cố định 1 đội
    label: { type: String, default: "" }, // ví dụ: "Nhất bảng A"
    note: { type: String, default: "" },
    locked: { type: Boolean, default: true },
  },
  { _id: false }
);

const PoPoolSchema = new Schema(
  {
    pairIndex: { type: Number, min: 0, required: true },
    side: { type: String, enum: ["A", "B"], default: "A" },
    // 👇 nhiều đội để random 1 đội
    candidates: [{ type: Schema.Types.ObjectId, ref: "Registration" }],
    note: { type: String, default: "" },
  },
  { _id: false }
);

const PoPreplanSchema = new Schema(
  {
    fixed: { type: [PoFixedSchema], default: [] },
    pools: { type: [PoPoolSchema], default: [] },
    avoidPairs: [
      {
        a: { type: Number, min: 0 },
        b: { type: Number, min: 0 },
      },
    ],
    mustPairs: [
      {
        a: { type: Number, min: 0 },
        b: { type: Number, min: 0 },
      },
    ],
  },
  { _id: false }
);
/* ==================================== */

/** Sub-schema: metadata nhẹ cho UI */
const bracketMetaSchema = new Schema(
  {
    drawSize: { type: Number, default: 0 },
    maxRounds: { type: Number, default: 0 },
    expectedFirstRoundMatches: { type: Number, default: 0 },
  },
  { _id: false }
);

/** ⭐ Dàn xếp slot (pre-assign) cho vòng bảng */
const SlotPlanSchema = new Schema(
  {
    poolKey: { type: String, required: true },
    slotIndex: { type: Number, required: true, min: 1 },
    registration: {
      type: Schema.Types.ObjectId,
      ref: "Registration",
      required: true,
    },
    locked: { type: Boolean, default: true },
    note: { type: String, default: "" },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const groupSchema = new Schema(
  {
    name: { type: String, required: true },
    expectedSize: { type: Number, default: 0 },
    regIds: [{ type: Schema.Types.ObjectId, ref: "Registration" }],
  },
  { _id: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// giữ tương thích FE cũ
groupSchema.virtual("key").get(function () {
  return this.name;
});
groupSchema.virtual("size").get(function () {
  if (Number.isFinite(this.expectedSize) && this.expectedSize > 0)
    return this.expectedSize;
  return Array.isArray(this.regIds) ? this.regIds.length : 0;
});

const bracketSchema = new Schema(
  {
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    noRankDelta: { type: Boolean, default: false },
    name: { type: String, required: true },
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

    config: {
      rules: {
        bestOf: { type: Number, enum: [1, 3, 5], default: 1 },
        pointsToWin: { type: Number, enum: [11, 15, 21], default: 11 },
        winByTwo: { type: Boolean, default: true },
        cap: {
          mode: {
            type: String,
            enum: ["none", "hard", "soft"],
            default: "none",
          },
          points: { type: Number, min: 1, default: null },
        },
      },
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
      doubleElim: {
        hasGrandFinalReset: { type: Boolean, default: true },
      },
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
      gsl: {
        groupSize: { type: Number, default: 4 },
      },
      roundElim: {
        drawSize: { type: Number, default: 0 },
        cutRounds: { type: Number, default: 0 },
      },
    },

    groups: [groupSchema],

    slotPlan: { type: [SlotPlanSchema], default: [] },

    drawStatus: {
      type: String,
      enum: ["planned", "preassigned", "drawn", "in_progress", "done"],
      default: "planned",
      index: true,
    },

    drawConfig: {
      respectPreassignments: { type: Boolean, default: true },
    },

    matchesCount: { type: Number, default: 0 },
    teamsCount: { type: Number, default: 0 },

    drawSettings: { type: DrawSettingsSchema, default: () => ({}) },

    drawRounds: { type: Number, default: 0 },

    meta: { type: bracketMetaSchema, default: () => ({}) },

    prefill: {
      roundKey: { type: String, default: "" },
      seeds: [
        {
          pair: { type: Number, required: true },
          A: { type: seedSourceSchema, default: null },
          B: { type: seedSourceSchema, default: null },
        },
      ],
    },

    // 👇 chính cái này để FE cơ cấu trước, BE bốc ra đúng
    poPreplan: { type: PoPreplanSchema, default: () => ({}) },

    feedPolicy: [
      {
        to: { type: String, required: true },
        from: seedSourceSchema,
      },
    ],
    scheduler: {
      autoAssign: { type: Boolean, default: true },
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ===== Helpers =====
function ceilPow2(n) {
  if (!n || n < 1) return 0;
  return 1 << Math.ceil(Math.log2(n));
}
function isPow2(n) {
  return Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;
}

bracketSchema.pre("save", function (next) {
  this.meta = this.meta || {};

  if (typeof this.meta.drawSize === "number" && this.meta.drawSize > 0) {
    const pow2 = isPow2(this.meta.drawSize)
      ? this.meta.drawSize
      : ceilPow2(this.meta.drawSize);
    this.meta.drawSize = pow2;
    this.meta.maxRounds = Math.round(Math.log2(pow2));
    this.meta.expectedFirstRoundMatches = pow2 / 2;
  }

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

// ===== Auto clear Tournament.drawPlan khi xoá hết brackets =====

// Gom logic chung để đọc tournamentId từ doc hoặc query
async function tryAutoClearDrawPlan(source) {
  try {
    if (!source) return;

    let tournamentId = null;

    // Trường hợp doc (findOneAndDelete, remove, document.deleteOne, ...)
    if (source.tournament) {
      tournamentId = source.tournament;
    }
    // Trường hợp query (deleteOne / deleteMany)
    else if (typeof source.getFilter === "function") {
      const filter = source.getFilter() || {};
      if (filter.tournament) {
        tournamentId = filter.tournament;
      }
    }

    if (!tournamentId) return;

    if (typeof Tournament.clearDrawPlanIfNoBrackets === "function") {
      await Tournament.clearDrawPlanIfNoBrackets(tournamentId);
    }
  } catch (err) {
    console.error("[Bracket] auto clear drawPlan error:", err);
  }
}

// Xoá bằng findOneAndDelete / findByIdAndDelete
bracketSchema.post("findOneAndDelete", async function (doc, next) {
  await tryAutoClearDrawPlan(doc);

  try {
    if (!doc?._id) return;
    const result = await Match.deleteMany({ bracket: doc._id });
    console.log(
      "[Bracket.delete] cascade delete matches:",
      doc._id,
      "=>",
      result.deletedCount
    );
  } catch (e) {
    console.error("[Bracket.delete] cascade error:", e?.message || e);
  }

  next();
});

// Xoá bằng document.deleteOne() (ví dụ trong deleteBracketCascade)
bracketSchema.post(
  "deleteOne",
  { document: true, query: false },
  async function (_res, next) {
    // `this` là document
    await tryAutoClearDrawPlan(this);
    next();
  }
);

// Xoá bằng deleteOne({ tournament: ... }) dạng query
bracketSchema.post(
  "deleteOne",
  { document: false, query: true },
  async function (_res, next) {
    await tryAutoClearDrawPlan(this);
    next();
  }
);

// Xoá bằng deleteMany({ tournament: ... })
bracketSchema.post(
  "deleteMany",
  { document: false, query: true },
  async function (_res, next) {
    await tryAutoClearDrawPlan(this);
    next();
  }
);

// Xoá doc.remove()
bracketSchema.post("remove", async function (doc, next) {
  await tryAutoClearDrawPlan(doc || this);
  next();
});

bracketSchema.index({ tournament: 1, order: 1 });
bracketSchema.index({ tournament: 1, type: 1 });
bracketSchema.index({ tournament: 1, stage: 1, order: 1 });
bracketSchema.index({ "slotPlan.poolKey": 1, "slotPlan.slotIndex": 1 });

export default mongoose.model("Bracket", bracketSchema);
