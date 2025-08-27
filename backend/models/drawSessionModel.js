// models/drawSessionModel.js
import mongoose from "mongoose";

const GroupBoardSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // 'A','B',...
    size: { type: Number, required: true },
    slots: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Registration",
        default: null,
      },
    ],
  },
  { _id: false }
);

const KnockoutPairSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    a: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      default: null,
    },
    b: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      default: null,
    },
  },
  { _id: false }
);

const DrawSessionSchema = new mongoose.Schema(
  {
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    bracket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bracket",
      required: true,
    },

    mode: { type: String, enum: ["group", "knockout", "po"], required: true },
    targetRound: {
      type: String,
      enum: ["R256", "R128", "R64", "R32", "R16", "QF", "SF", "F", null],
      default: null,
    },

    status: {
      type: String,
      enum: ["pending", "active", "committed", "canceled"],
      default: "active",
      index: true,
    },

    pool: [{ type: mongoose.Schema.Types.ObjectId, ref: "Registration" }],
    taken: [{ type: mongoose.Schema.Types.ObjectId, ref: "Registration" }],

    // >>> BOARD (khai báo đầy đủ cả 2 mode)
    board: {
      type: {
        type: String,
        enum: ["group", "knockout", "roundElim"],
        required: true,
      },
      roundKey: { type: String, default: null },

      // group mode
      groups: {
        type: [GroupBoardSchema],
        default: undefined, // chỉ có khi type='group'
      },

      // knockout mode
      pairs: {
        type: [KnockoutPairSchema],
        default: undefined, // chỉ có khi type='knockout'
      },
    },

    cursor: {
      gIndex: { type: Number, default: 0 }, // group mode
      slotIndex: { type: Number, default: 0 }, // group mode
      pairIndex: { type: Number, default: 0 }, // ko mode
      side: { type: String, enum: ["A", "B", null], default: "A" }, // ko mode
    },

    settings: {
      seed: { type: Number, default: Date.now },
      method: {
        type: String,
        enum: ["greedy", "hungarian"],
        default: "greedy",
      },
      randomness: { type: Number, default: 0.02 },
      lookahead: {
        enabled: { type: Boolean, default: true },
        width: { type: Number, default: 5 },
      },
      constraints: {
        avoidSameProvinceInGroup: { type: Boolean, default: false },
        capProvincePerGroup: { type: Number, default: 99 },
        hardCapProvincePerGroup: { type: Boolean, default: false },

        balanceSkillAcrossGroups: { type: Boolean, default: true },
        targetGroupAvgSkill: { type: Number, default: 0.5 },

        usePots: { type: Boolean, default: false },
        potBy: { type: String, default: "skill" },
        potCount: { type: Number, default: 4 },

        protectTopSeeds: { type: Number, default: 0 },
        avoidRematchWithinDays: { type: Number, default: 90 },

        balanceSkillInPair: { type: Boolean, default: true },
        pairTargetSkillDiff: { type: Number, default: 0.12 },
        maxRoundsSeedSeparation: { type: Number, default: 1 },
      },
      weights: {
        skillAvgVariance: { type: Number, default: 1.0 },
        skillStd: { type: Number, default: 0.6 },
        sameProvince: { type: Number, default: 0.25 },
        overProvinceCap: { type: Number, default: 0.8 },
        potClash: { type: Number, default: 0.7 },
        seedClash: { type: Number, default: 1.2 },
        rematch: { type: Number, default: 1.0 },
        koSkillDiff: { type: Number, default: 0.9 },
      },
    },

    // Audit / scoring (optional)
    score: { type: Number, default: 0 },
    metrics: {
      groupFairness: { type: Number, default: 0 },
      pairFairnessR1: { type: Number, default: 0 },
      deepMeeting: { type: Number, default: 0 },
    },

    history: [
      {
        at: { type: Date, default: Date.now },
        action: {
          type: String,
          enum: ["start", "pick", "commit", "cancel"],
          required: true,
        },
        payload: { type: mongoose.Schema.Types.Mixed },
        by: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
      },
    ],

    // Meta để rebuild khi cần
    computedMeta: {
      ko: {
        entrants: Number,
        bracketSize: Number,
        rounds: Number,
        labels: [String],
        startKey: String,
        byes: Number,
      },
      group: {
        sizes: [Number],
        count: Number,
        byes: Number,
      },
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    startedAt: { type: Date, default: Date.now },
    committedAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

DrawSessionSchema.index({ bracket: 1, status: 1 });

export default mongoose.model("DrawSession", DrawSessionSchema);
