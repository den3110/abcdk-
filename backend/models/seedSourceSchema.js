// models/seedSourceSchema.js
import mongoose from "mongoose";

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

      // stageMatch{Winner,Loser}
      stageIndex: { type: Number, default: null }, // V2, V3...
      round: { type: Number, default: null }, // R#
      order: { type: Number, default: null }, // #i (1-based)

      // hard pin
      matchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Match",
        default: null,
      },
      registration: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Registration",
        default: null,
      },
      group: {
        id: { type: mongoose.Schema.Types.ObjectId }, // id trong bracket.groups._id
        name: { type: String }, // "A","B",...
      },
      rank: { type: Number }, // 1,2,3,..
    },
    label: { type: String, default: "" }, // hiển thị nhanh
  },
  { _id: false }
);

export default seedSourceSchema;
