// models/seedSourceSchema.js
import mongoose from "mongoose";

const normalizeObjectIdInput = (value) => {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return mongoose.isValidObjectId(trimmed) ? trimmed : null;
  }

  if (mongoose.isValidObjectId(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const nested =
      value._id ?? value.id ?? value.registration ?? value.reg ?? value.matchId ?? null;
    if (nested && nested !== value) {
      return normalizeObjectIdInput(nested);
    }
  }

  return null;
};

const seedSourceSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "groupRank", // topV1#A#1
        "stageMatchWinner", // winnerV2#R1#3
        "stageMatchLoser", // loserV2#R1#3 (tuỳ chọn)
        "bye",
        "registration",
        // "matchWinner",
        // "matchLoser",
      ],
      required: true,
    },
    ref: {
      // groupRank
      stage: { type: Number, default: 1 }, // V1 (thường là group)
      groupCode: { type: String, default: "" },
      rank: { type: Number, default: null },
      wildcardOrder: { type: Number, default: null },

      // stageMatch{Winner,Loser}
      stageIndex: { type: Number, default: null }, // V2, V3...
      round: { type: Number, default: null }, // R#
      order: { type: Number, default: null }, // #i (1-based)

      // hard pin
      matchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Match",
        default: null,
        set: normalizeObjectIdInput,
      },
      registration: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Registration",
        default: null,
        set: normalizeObjectIdInput,
      },
      group: {
        id: {
          type: mongoose.Schema.Types.ObjectId,
          set: normalizeObjectIdInput,
        }, // id trong bracket.groups._id
        name: { type: String }, // "A","B",...
      },
      rank: { type: Number }, // 1,2,3,..
    },
    label: { type: String, default: "" }, // hiển thị nhanh
  },
  { _id: false }
);

export default seedSourceSchema;
