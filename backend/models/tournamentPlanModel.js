// models/tournamentPlanModel.js
import mongoose from "mongoose";
const { Schema } = mongoose;

/** Một stage trong pipeline định dạng giải */
const stageSchema = new Schema(
  {
    key: { type: String, required: true }, // "groups", "po", "ko16", ...
    type: {
      type: String,
      enum: ["groups", "playin", "knockout", "double_elim", "swiss", "gsl"],
      required: true,
    },

    // Cấu hình tuỳ stage
    config: {
      // groups
      groupCount: Number, // n bảng
      groupSize: Number, // m đội/bảng
      advance: {
        // Luật vào vòng sau
        type: { type: String, enum: ["topN", "custom"], default: "topN" },
        topN: Number, // VD: top 2/bảng
        custom: [
          // (tuỳ chọn) mapping đặc biệt
          {
            group: String, // "A","B",...
            ranks: [Number], // [1,2]
            label: String, // "Top1 A", ...
          },
        ],
      },

      // play-in (PO)
      po: {
        entrants: Number, // số đội vào PO
        roundKey: String, // "R16","QF",...
        cutRounds: Number, // số vòng hiển thị/cắt
        takeLosersFromRound1: { type: Boolean, default: false }, // lấy winner trong 2 đội thua ở round đầu
      },

      // knockout
      ko: {
        roundKey: String, // "R16","QF"...
        drawSize: Number, // 16, 8...
      },
    },

    // Kết quả/đầu ra logic của stage: đặt tên để feed vào seed của stage sau
    outputs: [
      {
        key: { type: String, required: true }, // "A#1", "PO#W3", "KO#L1-S1"...
        type: {
          type: String,
          enum: ["groupRank", "matchWinner", "matchLoser", "bye"],
          required: true,
        },
        ref: { type: Schema.Types.Mixed }, // {group:"A", rank:1} hoặc {matchOrder:3, round:1}
        label: { type: String, default: "" }, // "Top 1 bảng A"
      },
    ],
  },
  { _id: true }
);

/** Edge: nối output của stage này → seed của stage kia */
const edgeSchema = new Schema(
  {
    fromStageId: { type: Schema.Types.ObjectId, required: true },
    outputKey: { type: String, required: true }, // trùng với outputs[].key
    toStageId: { type: Schema.Types.ObjectId, required: true },
    toSeedKey: { type: String, required: true }, // "R16#1A","R16#1B",...
    label: { type: String, default: "" }, // hiện ra FE
  },
  { _id: true }
);

const tournamentPlanSchema = new Schema(
  {
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    stages: [stageSchema],
    edges: [edgeSchema],

    // Lưu lại các phương án AI gợi ý (option 1)
    suggestions: [
      {
        score: Number,
        rationale: String,
        planSnapshot: Schema.Types.Mixed, // stages + edges
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("TournamentPlan", tournamentPlanSchema);
