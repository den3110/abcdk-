// models/schemas/drawSettingsSchema.js
import mongoose from "mongoose";

const DrawSettingsSchema = new mongoose.Schema(
  {
    seed: { type: Number, default: 0 }, // 0 = Date.now()

    planner: {
      groupSize: { type: Number, default: 0 }, // 0 = auto
      groupCount: { type: Number, default: 0 }, // 0 = auto
      autoFit: { type: Boolean, default: true },
      allowUneven: { type: Boolean, default: true },
      byePolicy: { type: String, enum: ["none", "pad"], default: "none" },
      overflowPolicy: {
        type: String,
        enum: ["grow", "extraGroup"],
        default: "grow",
      },
      underflowPolicy: {
        type: String,
        enum: ["shrink", "byes"],
        default: "shrink",
      },
      minSize: { type: Number, default: 3 },
      maxSize: { type: Number, default: 16 },
    },

    scorer: {
      randomness: { type: Number, default: 0.02 },
      lookahead: {
        enabled: { type: Boolean, default: true },
        width: { type: Number, default: 5 },
      },
      constraints: {
        balanceSkillAcrossGroups: { type: Boolean, default: true },
        targetGroupAvgSkill: { type: Number, default: 0.5 },

        usePots: { type: Boolean, default: false },
        potBy: { type: String, default: "skill" },
        potCount: { type: Number, default: 4 },

        protectTopSeeds: { type: Number, default: 0 },
        avoidRematchWithinDays: { type: Number, default: 120 },

        balanceSkillInPair: { type: Boolean, default: true },
        pairTargetSkillDiff: { type: Number, default: 0.12 },
        maxRoundsSeedSeparation: { type: Number, default: 1 },
      },
      weights: {
        skillAvgVariance: { type: Number, default: 1.0 },
        skillStd: { type: Number, default: 0.6 },
        potClash: { type: Number, default: 0.7 },
        seedClash: { type: Number, default: 1.2 },
        rematch: { type: Number, default: 1.0 },
        koSkillDiff: { type: Number, default: 0.9 },
      },
      recent: { days: { type: Number, default: 120 } },
    },
  },
  { _id: false }
);

export default DrawSettingsSchema;
