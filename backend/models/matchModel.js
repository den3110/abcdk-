// models/matchModel.js
import mongoose from "mongoose";
import seedSourceSchema from "./seedSourceSchema.js";
import Bracket from "./bracketModel.js";

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

    // Hỗ trợ PO dạng round elimination
    format: {
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
    branch: {
      type: String,
      enum: ["main", "wb", "lb", "gf", "consol"],
      default: "main",
      index: true,
    },

    pool: {
      id: { type: Schema.Types.ObjectId, default: null },
      name: { type: String, default: "" },
    },
    phase: {
      type: String,
      enum: ["group", "winners", "losers", "decider", "grand_final", null],
      default: null,
      index: true,
    },
    swissRound: { type: Number, default: null, index: true },
    rrRound: { type: Number, default: null, index: true },

    round: { type: Number, default: 1, index: true }, // 1-based
    order: { type: Number, default: 0 }, // 0-based trong round
    code: { type: String, default: "" }, // ví dụ: R1#0

    /* ========= Nguồn seed cho 2 slot ========= */
    seedA: { type: seedSourceSchema, default: null },
    seedB: { type: seedSourceSchema, default: null },

    /* Sau khi resolve seed → giữ như trước */
    pairA: { type: Schema.Types.ObjectId, ref: "Registration", default: null },
    pairB: { type: Schema.Types.ObjectId, ref: "Registration", default: null },
    previousA: { type: Schema.Types.ObjectId, ref: "Match", default: null },
    previousB: { type: Schema.Types.ObjectId, ref: "Match", default: null },

    rules: {
      bestOf: { type: Number, enum: [1, 3, 5], default: 3 },
      pointsToWin: { type: Number, enum: [11, 15, 21], default: 11 },
      winByTwo: { type: Boolean, default: true },
    },
    gameScores: [
      { a: { type: Number, default: 0 }, b: { type: Number, default: 0 } },
    ],

    status: {
      type: String,
      enum: ["scheduled", "live", "finished"],
      default: "scheduled",
      index: true,
    },
    winner: { type: String, enum: ["A", "B", ""], default: "" },

    referee: { type: Schema.Types.ObjectId, ref: "User" },
    note: { type: String, default: "" },

    nextMatch: { type: Schema.Types.ObjectId, ref: "Match", default: null },
    nextSlot: { type: String, enum: ["A", "B", null], default: null },

    scheduledAt: { type: Date, default: null },
    court: { type: Schema.Types.ObjectId, ref: "Court", default: null },
    courtLabel: { type: String, default: "" },

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

    ratingDelta: { type: Number, default: 0.01 },
    ratingApplied: { type: Boolean, default: false },
    ratingAppliedAt: { type: Date, default: null },

    // V1, V2, ...
    stageIndex: { type: Number, default: 1, index: true },
    // Ví dụ: V2#R1#3
    labelKey: { type: String, default: "" },
  },
  { timestamps: true }
);

/* ======================= VALIDATE ======================= */
/** Cho phép seed thay cho pair/previous */
matchSchema.pre("validate", function (next) {
  const hasResolvedA = !!this.pairA || !!this.previousA;
  const hasResolvedB = !!this.pairB || !!this.previousB;
  const hasSeedA = !!this.seedA && !!this.seedA.type;
  const hasSeedB = !!this.seedB && !!this.seedB.type;

  if (!hasResolvedA && !hasSeedA)
    return next(new Error("Either pairA/previousA or seedA is required"));
  if (!hasResolvedB && !hasSeedB)
    return next(new Error("Either pairB/previousB or seedB is required"));
  next();
});

/* ======================= Helpers ======================= */
async function resolveSeedToSlots(doc, side /* "A" | "B" */) {
  const seed = side === "A" ? doc.seedA : doc.seedB;
  if (!seed || !seed.type) return;

  // Nếu đã có resolved value thì thôi
  if (
    (side === "A" && (doc.pairA || doc.previousA)) ||
    (side === "B" && (doc.pairB || doc.previousB))
  ) {
    return;
  }

  const setPair = (regId) => {
    if (side === "A") doc.pairA = regId;
    else doc.pairB = regId;
  };
  const setPrev = (matchId) => {
    if (side === "A") doc.previousA = matchId;
    else doc.previousB = matchId;
  };

  switch (seed.type) {
    case "registration": {
      // hỗ trợ ref.registration, ref.reg hoặc hard id
      const regId =
        (seed.ref && (seed.ref.registration || seed.ref.reg)) ||
        (mongoose.isValidObjectId(seed.ref) ? seed.ref : null);
      if (regId && mongoose.isValidObjectId(regId)) setPair(regId);
      break;
    }

    case "matchWinner": {
      // Winner (trong cùng bracket)
      const Match = doc.model("Match");
      const branch = seed.ref?.branch || doc.branch || "main";
      if (
        Number.isInteger(seed.ref?.round) &&
        Number.isInteger(seed.ref?.order)
      ) {
        const prev = await Match.findOne({
          bracket: doc.bracket,
          round: seed.ref.round,
          order: seed.ref.order,
          branch,
        }).select("_id");
        if (prev?._id) setPrev(prev._id);
      }
      break;
    }

    case "matchLoser":
      // Không set previous* (previous đại diện winner). Loser sẽ propagate ở hook sau.
      break;

    case "stageMatchWinner": {
      // Winner từ bracket khác theo stageIndex
      const st = seed.ref?.stageIndex ?? seed.ref?.stage;
      if (
        Number.isInteger(st) &&
        Number.isInteger(seed.ref?.round) &&
        Number.isInteger(seed.ref?.order)
      ) {
        const br = await Bracket.findOne({
          tournament: doc.tournament,
          stage: st,
        }).select("_id");
        if (br?._id) {
          const Match = doc.model("Match");
          const prev = await Match.findOne({
            bracket: br._id,
            round: seed.ref.round,
            order: seed.ref.order,
          }).select("_id");
          if (prev?._id) setPrev(prev._id);
        }
      }
      break;
    }

    case "stageMatchLoser":
      // Không set previous* (chỉ propagate loser ở hook sau).
      break;

    case "groupRank":
    case "bye":
    default:
      // Không resolve ngay được; giữ seed để UI hiển thị placeholder
      break;
  }
}

/** Propagate winner/loser sau khi trận đã finished */
async function propagateFromFinishedMatch(doc) {
  const MatchModel = doc.model("Match");

  // stageIndex fallback từ bracket nếu chưa có
  let st = doc.stageIndex;
  if (!st) {
    const br = await Bracket.findById(doc.bracket).select("stage").lean();
    if (br?.stage) st = br.stage;
  }

  const winnerReg = doc.winner === "A" ? doc.pairA : doc.pairB;
  const loserReg = doc.winner === "A" ? doc.pairB : doc.pairA;

  // 1) Winner → previousA/B (giữ logic KO cũ)
  if (doc.nextMatch && doc.nextSlot && winnerReg) {
    const nm = await MatchModel.findById(doc.nextMatch);
    if (nm) {
      const field = doc.nextSlot === "A" ? "pairA" : "pairB";
      if (!nm[field]) {
        nm[field] = winnerReg;
        await nm.save();
      }
    }
  }
  await MatchModel.updateMany(
    { tournament: doc.tournament, previousA: doc._id },
    { $set: { pairA: winnerReg }, $unset: { previousA: "" } }
  );
  await MatchModel.updateMany(
    { tournament: doc.tournament, previousB: doc._id },
    { $set: { pairB: winnerReg }, $unset: { previousB: "" } }
  );

  // 2) Winner → seedA/B = stageMatchWinner (cross-bracket)
  await MatchModel.updateMany(
    {
      tournament: doc.tournament,
      "seedA.type": "stageMatchWinner",
      "seedA.ref.round": doc.round,
      "seedA.ref.order": doc.order,
      $or: [
        { "seedA.ref.stageIndex": st },
        { "seedA.ref.stage": st },
        // fallback nếu FE gửi string
        { "seedA.ref.stageIndex": String(st) },
        { "seedA.ref.stage": String(st) },
      ],
    },
    { $set: { pairA: winnerReg }, $unset: { seedA: "" } }
  );
  await MatchModel.updateMany(
    {
      tournament: doc.tournament,
      "seedB.type": "stageMatchWinner",
      "seedB.ref.round": doc.round,
      "seedB.ref.order": doc.order,
      $or: [
        { "seedB.ref.stageIndex": st },
        { "seedB.ref.stage": st },
        { "seedB.ref.stageIndex": String(st) },
        { "seedB.ref.stage": String(st) },
      ],
    },
    { $set: { pairB: winnerReg }, $unset: { seedB: "" } }
  );

  // 3) Loser → seedA/B = stageMatchLoser (cross-bracket)
  await MatchModel.updateMany(
    {
      tournament: doc.tournament,
      "seedA.type": "stageMatchLoser",
      "seedA.ref.round": doc.round,
      "seedA.ref.order": doc.order,
      $or: [
        { "seedA.ref.stageIndex": st },
        { "seedA.ref.stage": st },
        { "seedA.ref.stageIndex": String(st) },
        { "seedA.ref.stage": String(st) },
      ],
    },
    { $set: { pairA: loserReg }, $unset: { seedA: "" } }
  );
  await MatchModel.updateMany(
    {
      tournament: doc.tournament,
      "seedB.type": "stageMatchLoser",
      "seedB.ref.round": doc.round,
      "seedB.ref.order": doc.order,
      $or: [
        { "seedB.ref.stageIndex": st },
        { "seedB.ref.stage": st },
        { "seedB.ref.stageIndex": String(st) },
        { "seedB.ref.stage": String(st) },
      ],
    },
    { $set: { pairB: loserReg }, $unset: { seedB: "" } }
  );

  // 4) Loser → seedA/B = matchLoser (trong-bracket)
  await MatchModel.updateMany(
    {
      tournament: doc.tournament,
      bracket: doc.bracket,
      "seedA.type": "matchLoser",
      "seedA.ref.round": doc.round,
      "seedA.ref.order": doc.order,
    },
    { $set: { pairA: loserReg }, $unset: { seedA: "" } }
  );
  await MatchModel.updateMany(
    {
      tournament: doc.tournament,
      bracket: doc.bracket,
      "seedB.type": "matchLoser",
      "seedB.ref.round": doc.round,
      "seedB.ref.order": doc.order,
    },
    { $set: { pairB: loserReg }, $unset: { seedB: "" } }
  );
}

/* ======================= PRE-SAVE ======================= */
matchSchema.pre("save", async function (next) {
  try {
    // code: R{round}#{order}
    if (!this.code) {
      const r = this.round ?? "";
      const o = this.order ?? "";
      this.code = `R${r}#${o}`;
    }

    // stageIndex + format từ bracket
    if (!this.stageIndex || !this.format) {
      const br = await Bracket.findById(this.bracket)
        .select("stage type")
        .lean();
      if (!this.stageIndex && br?.stage) this.stageIndex = br.stage;
      if (!this.format && br?.type) this.format = br.type;
    }

    // labelKey: V{stage}#R{round}#{order+1}
    if (!this.labelKey) {
      const r = this.round ?? 1;
      const o = (this.order ?? 0) + 1;
      const v = this.stageIndex || 1;
      this.labelKey = `V${v}#R${r}#${o}`;
    }

    // Thử resolve seed → pair/previous (nếu có thể)
    await resolveSeedToSlots(this, "A");
    await resolveSeedToSlots(this, "B");

    next();
  } catch (e) {
    next(e);
  }
});

/* ======================= POST-SAVE ======================= */
matchSchema.post("save", async function (doc, next) {
  try {
    // Logic push nextMatch (KO cũ)
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

    // Propagate cross/in-bracket theo seed
    if (
      doc.status === "finished" &&
      (doc.winner === "A" || doc.winner === "B")
    ) {
      await propagateFromFinishedMatch(doc);
    }

    next();
  } catch (e) {
    next(e);
  }
});

/* =================== POST findOneAndUpdate =================== */
/** Luôn load lại doc "sau update" để không phụ thuộc new:true */
matchSchema.post("findOneAndUpdate", async function (res) {
  try {
    const q = this.getQuery?.() || {};
    const id = res?._id || q._id || q.id;
    if (!id) return;

    const fresh = await this.model.findById(id);
    if (!fresh) return;

    if (
      fresh.status === "finished" &&
      (fresh.winner === "A" || fresh.winner === "B")
    ) {
      await propagateFromFinishedMatch(fresh);
    }
  } catch (err) {
    console.error("[Match post(findOneAndUpdate)] propagate error:", err);
  }
});

/* ========== tiện ích: compile seeds cho cả bracket sau khi tạo khung ========== */
matchSchema.statics.compileSeedsForBracket = async function (bracketId) {
  const list = await this.find({
    bracket: bracketId,
    $or: [
      { "seedA.type": { $exists: true } },
      { "seedB.type": { $exists: true } },
    ],
  });

  for (const m of list) {
    const before = {
      pairA: m.pairA,
      pairB: m.pairB,
      previousA: m.previousA,
      previousB: m.previousB,
    };
    await resolveSeedToSlots(m, "A");
    await resolveSeedToSlots(m, "B");

    const changed =
      String(before.pairA || "") !== String(m.pairA || "") ||
      String(before.pairB || "") !== String(m.pairB || "") ||
      String(before.previousA || "") !== String(m.previousA || "") ||
      String(before.previousB || "") !== String(m.previousB || "");

    if (changed) {
      await m.save();
    }
  }
};

/* ======================= Indexes ======================= */
matchSchema.index({ bracket: 1, branch: 1, round: 1, order: 1 });
matchSchema.index({ bracket: 1, "pool.id": 1, rrRound: 1, order: 1 });
matchSchema.index({ bracket: 1, swissRound: 1, order: 1 });
matchSchema.index({ format: 1 });
matchSchema.index({ stageIndex: 1 });
matchSchema.index({ labelKey: 1 });
// giúp truy seed/propagate nhanh
matchSchema.index({ bracket: 1, "seedA.type": 1 });
matchSchema.index({ bracket: 1, "seedB.type": 1 });
// tùy chọn: hỗ trợ truy theo stage/round/order khi propagate cross-bracket
matchSchema.index({
  tournament: 1,
  "seedA.ref.stageIndex": 1,
  "seedA.ref.round": 1,
  "seedA.ref.order": 1,
});
matchSchema.index({
  tournament: 1,
  "seedB.ref.stageIndex": 1,
  "seedB.ref.round": 1,
  "seedB.ref.order": 1,
});

export default mongoose.model("Match", matchSchema);
