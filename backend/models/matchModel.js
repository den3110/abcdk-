// models/matchModel.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const matchSchema = new Schema(
  {
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    bracket: {
      type: Schema.Types.ObjectId,
      ref: "Bracket",
      required: true,
      index: true,
    },

    // ======= MỚI: thông tin phụ thuộc thể thức =======
    // Copy từ bracket.type để dễ query; không bắt buộc, sẽ auto fill nếu thiếu
    format: {
      type: String,
      enum: ["knockout", "group", "double_elim", "round_robin", "swiss", "gsl"],
      default: "knockout",
      index: true,
    },

    // Double Elimination: nhánh
    branch: {
      type: String,
      enum: ["main", "wb", "lb", "gf", "consol"],
      default: "main", // "wb"=winners, "lb"=losers, "gf"=grand final
      index: true,
    },

    // Round-robin/GSL: thuộc pool/nhóm nào
    pool: {
      id: { type: Schema.Types.ObjectId, default: null }, // trỏ tới groups[i]._id trong Bracket
      name: { type: String, default: "" }, // ví dụ "A","B"
    },

    // GSL phase tagging (để FE hiển thị)
    phase: {
      type: String,
      enum: ["group", "winners", "losers", "decider", "grand_final", null],
      default: null,
      index: true,
    },

    // Swiss/round-robin ordinal
    swissRound: { type: Number, default: null, index: true },
    rrRound: { type: Number, default: null, index: true },

    // ======= CŨ: thứ tự logic/hiển thị =======
    round: { type: Number, default: 1, index: true },
    order: { type: Number, default: 0 },

    // Optional code cho UI
    code: { type: String, default: "" },

    // Nguồn đội
    pairA: { type: Schema.Types.ObjectId, ref: "Registration", default: null },
    pairB: { type: Schema.Types.ObjectId, ref: "Registration", default: null },

    // Winner feed-in từ trận trước (knockout/double_elim/GSL)
    previousA: { type: Schema.Types.ObjectId, ref: "Match", default: null },
    previousB: { type: Schema.Types.ObjectId, ref: "Match", default: null },

    // Luật thi đấu
    rules: {
      bestOf: { type: Number, enum: [1, 3, 5], default: 3 },
      pointsToWin: { type: Number, enum: [11, 15, 21], default: 11 },
      winByTwo: { type: Boolean, default: true },
    },

    // Điểm từng ván
    gameScores: [
      { a: { type: Number, default: 0 }, b: { type: Number, default: 0 } },
    ],

    // Trạng thái & kết quả
    status: {
      type: String,
      enum: ["scheduled", "live", "finished"],
      default: "scheduled",
      index: true,
    },
    winner: { type: String, enum: ["A", "B", ""], default: "" },

    // Điều phối
    referee: { type: Schema.Types.ObjectId, ref: "User" },
    note: { type: String, default: "" },

    // Liên kết sang trận tiếp theo (knockout/double_elim/GSL)
    nextMatch: { type: Schema.Types.ObjectId, ref: "Match", default: null },
    nextSlot: { type: String, enum: ["A", "B", null], default: null },

    // Lịch & sân
    scheduledAt: { type: Date, default: null },
    court: { type: Schema.Types.ObjectId, ref: "Court", default: null },
    courtLabel: { type: String, default: "" },

    // LIVE
    currentGame: { type: Number, default: 0 },
    serve: {
      side: { type: String, enum: ["A", "B"], default: "A" },
      server: { type: Number, enum: [1, 2], default: 2 },
    },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    liveBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    liveVersion: { type: Number, default: 0 },
    video: { type: String, default: "" },
    liveLog: [
      {
        type: {
          type: String,
          enum: [
            "point",
            "undo",
            "start",
            "finish",
            "forfeit",
            "serve",
            "sideout",
            "rotate",
          ],
          required: true,
        },
        by: { type: Schema.Types.ObjectId, ref: "User" },
        payload: { type: Schema.Types.Mixed },
        at: { type: Date, default: Date.now },
      },
    ],

    // ✅ Rating áp dụng sau khi kết thúc (đã nói trước đó)
    ratingDelta: { type: Number, default: 0.01 },
    ratingApplied: { type: Boolean, default: false },
    ratingAppliedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/* GIỮ LOGIC: Mỗi bên phải có pair hoặc previous */
matchSchema.pre("validate", function (next) {
  const okA = !!this.pairA || !!this.previousA;
  const okB = !!this.pairB || !!this.previousB;
  if (!okA) return next(new Error("Either pairA or previousA is required"));
  if (!okB) return next(new Error("Either pairB or previousB is required"));
  next();
});

/* Auto code nếu thiếu */
matchSchema.pre("save", async function (next) {
  try {
    if (!this.code) {
      const r = this.round ?? "";
      const o = this.order ?? "";
      this.code = `R${r}#${o}`;
    }
    // Nếu chưa set format, lấy theo Bracket.type
    if (!this.format) {
      const Bracket = this.model("Bracket");
      const br = await Bracket.findById(this.bracket).select("type").lean();
      if (br?.type) this.format = br.type;
    }
    next();
  } catch (e) {
    next(e);
  }
});

/* Kết thúc -> feed winner sang nextMatch nếu trống (GIỮ NGUYÊN) */
matchSchema.post("save", async function (doc, next) {
  try {
    if (
      doc.status === "finished" &&
      doc.winner &&
      doc.nextMatch &&
      doc.nextSlot
    ) {
      const winnerRegId = doc.winner === "A" ? doc.pairA : doc.pairB;
      if (winnerRegId) {
        const Next = doc.model("Match");
        const nm = await Next.findById(doc.nextMatch);
        if (nm) {
          const field = doc.nextSlot === "A" ? "pairA" : "pairB";
          if (!nm[field]) {
            nm[field] = winnerRegId;
            await nm.save();
          }
        }
      }
    }
    next();
  } catch (e) {
    next(e);
  }
});

/* Sau update -> propagate winner cho các trận previousA/B (GIỮ NGUYÊN) */
matchSchema.post("findOneAndUpdate", async function (doc) {
  if (!doc) return;
  try {
    if (doc.status === "finished" && doc.winner) {
      const MatchModel = doc.model("Match");
      const winnerReg = doc.winner === "A" ? doc.pairA : doc.pairB;

      await MatchModel.updateMany(
        { previousA: doc._id },
        { $set: { pairA: winnerReg }, $unset: { previousA: "" } }
      );
      await MatchModel.updateMany(
        { previousB: doc._id },
        { $set: { pairB: winnerReg }, $unset: { previousB: "" } }
      );
    }
  } catch (err) {
    console.error("[Match post(findOneAndUpdate)] propagate error:", err);
  }
});

/* ---------- Indexes ---------- */
matchSchema.index({ tournament: 1, bracket: 1, status: 1, createdAt: -1 });
matchSchema.index({ bracket: 1, createdAt: -1 });
matchSchema.index({ tournament: 1, createdAt: -1 });
matchSchema.index({ scheduledAt: 1 });
matchSchema.index({ court: 1 });
matchSchema.index({ status: 1, finishedAt: -1 });
matchSchema.index({ pairA: 1, status: 1 });
matchSchema.index({ pairB: 1, status: 1 });

// NEW for formats
matchSchema.index({ bracket: 1, branch: 1, round: 1, order: 1 }); // double-elim
matchSchema.index({ bracket: 1, "pool.id": 1, rrRound: 1, order: 1 }); // RR/GSL
matchSchema.index({ bracket: 1, swissRound: 1, order: 1 }); // Swiss
matchSchema.index({ format: 1 });

export default mongoose.model("Match", matchSchema);
