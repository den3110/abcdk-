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

    // Hỗ trợ nhiều định dạng bracket
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

    // Luật tính điểm
    rules: {
      bestOf: { type: Number, enum: [1, 3, 5], default: 1 },
      pointsToWin: { type: Number, enum: [11, 15, 21], default: 11 },
      winByTwo: { type: Boolean, default: true },
      /* NEW: cấu hình cap (chạm điểm) */
      cap: {
        mode: {
          type: String,
          enum: ["none", "hard", "soft"], // hard = chạm là thắng; soft = tới cap rồi vẫn cần chênh 1 nếu đang hòa, không kéo vô tận
          default: "none",
        },
        points: {
          type: Number,
          // cho phép bất kỳ số nguyên dương hợp lệ; nếu muốn gò chặt có thể thay bằng enum
          min: 1,
          default: null, // ví dụ 15 => chạm 15 là thắng (nếu mode="hard")
        },
      },
    },
    gameScores: [
      {
        a: { type: Number, default: 0 },
        b: { type: Number, default: 0 },
        /* NEW: ván này kết thúc do cap (để hiển thị / audit) */
        capped: { type: Boolean, default: false },
      },
    ],

    status: {
      type: String,
      enum: ["scheduled", "queued", "assigned", "live", "finished"],
      default: "scheduled",
      index: true,
    },
    winner: {
      type: String,
      enum: ["A", "B", ""],
      default: "",
      set: (v) => (v == null ? "" : v),
    },

    referee: { type: Schema.Types.ObjectId, ref: "User" },
    note: { type: String, default: "" },

    // KO chaining (tùy chọn)
    nextMatch: { type: Schema.Types.ObjectId, ref: "Match", default: null },
    nextSlot: { type: String, enum: ["A", "B", null], default: null },

    scheduledAt: { type: Date, default: null },
    court: { type: Schema.Types.ObjectId, ref: "Court", default: null },
    courtLabel: { type: String, default: "" },
    courtCluster: { type: String, default: "Main", index: true }, // cụm sân
    queueOrder: { type: Number, default: null, index: true }, // thứ tự trong hàng đợi
    assignedAt: { type: Date, default: null }, // thời điểm gán sân
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    ], // VĐV tham gia trận (denormalize để lọc eligibility nhanh)
    // Live state
    currentGame: { type: Number, default: 0 },
    serve: {
      side: { type: String, enum: ["A", "B"], default: "A" },
      server: { type: Number, enum: [1, 2], default: 2 },
    },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    liveBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    liveVersion: { type: Number, default: 0 },
    video: {
      type: String,
      default: "",
      trim: true,
      set: (v) => (v == null ? "" : String(v).trim()),
    },
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

    // Rating meta (DUPr-like)
    ratingDelta: { type: Number, default: 0 },
    ratingApplied: { type: Boolean, default: false },
    ratingAppliedAt: { type: Date, default: null },

    // Stage & label
    stageIndex: { type: Number, default: 1, index: true }, // V1, V2, ...
    labelKey: { type: String, default: "" }, // ví dụ: V2#R1#3
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
  if (this.winner == null) this.winner = "";

  // if (!hasResolvedA)
  //   return next(new Error("Either pairA/previousA or seedA is required"));
  // if (!hasResolvedB )
  //   return next(new Error("Either pairB/previousB or seedB is required"));
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

async function triggerAutoFeedGroupRank(doc, { log = false } = {}) {
  try {
    // chỉ chạy cho định dạng bảng
    if (!["group", "round_robin", "gsl"].includes(doc.format)) return;

    // stageIndex fallback từ bracket nếu chưa có
    let st = doc.stageIndex;
    if (!st) {
      const br = await Bracket.findById(doc.bracket).select("stage").lean();
      if (br?.stage) st = br.stage;
    }

    const { autoFeedGroupRank } = await import(
      "../services/autoFeedGroupRank.js"
    );
    await autoFeedGroupRank({
      tournamentId: doc.tournament,
      bracketId: doc.bracket,
      stageIndex: st,
      provisional: true, // lock sớm: dùng BXH hiện tại, vẫn cập nhật nếu BXH đổi
      log,
    });
  } catch (e) {
    console.error("[feed] autoFeedGroupRank failed:", e?.message || e);
  }
}

// Lấy danh sách userIds của 2 đôi để tránh trùng trận
matchSchema.methods.computeParticipants = async function () {
  if (!this.pairA && !this.pairB) return;
  const Registration = this.model("Registration");
  const regs = await Registration.find({
    _id: { $in: [this.pairA, this.pairB].filter(Boolean) },
  })
    .select("player1.user player2.user")
    .lean();

  const ids = new Set();
  for (const r of regs) {
    if (r?.player1?.user) ids.add(String(r.player1.user));
    if (r?.player2?.user) ids.add(String(r.player2.user));
  }
  this.participants = [...ids];
};

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
    try {
      const willMatter = ["queued", "assigned", "live"].includes(this.status);
      if (willMatter && typeof this.computeParticipants === "function") {
        await this.computeParticipants();
      }
    } catch (e) {
      // an toàn, không chặn save nếu lỗi phụ
    }
    next();
  } catch (e) {
    next(e);
  }
});

/* ======================= POST-SAVE ======================= */
matchSchema.post("save", async function (doc, next) {
  try {
    // Propagate winner/loser & KO chaining
    if (
      doc.status === "finished" &&
      (doc.winner === "A" || doc.winner === "B")
    ) {
      // Logic push nextMatch (KO cũ)
      if (doc.nextMatch && doc.nextSlot) {
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
      await propagateFromFinishedMatch(doc);
    }

    // === AUTO APPLY LOCAL RATING (DUPr-like) ===
    try {
      if (
        doc.status === "finished" &&
        (doc.winner === "A" || doc.winner === "B") &&
        doc.pairA &&
        doc.pairB && // tránh BYE/missing pair
        !doc.ratingApplied // idempotent
      ) {
        // chạy async tách tick để không block hook
        setImmediate(async () => {
          try {
            const { applyRatingForMatch } = await import(
              "../services/ratingEngine.js"
            );
            // await applyRatingForMatch(doc._id);
          } catch (err) {
            console.error("[rating] apply after save failed:", err?.message);
          }
        });
      }
    } catch (e) {
      console.error("[rating] schedule error:", e?.message);
    }

    try {
      // nếu trận thuộc bracket type = group → auto-feed groupRank
      if (doc.status === "finished") {
        // Lấy stage/type nhanh
        const br = await Bracket.findById(doc.bracket)
          .select("type stage")
          .lean();
        if (br?.type === "group") {
          // chạy async không block
          setImmediate(async () => {
            try {
              const { autoFeedGroupRank } = await import(
                "../services/autoFeedGroupRank.js"
              );
              await autoFeedGroupRank({
                tournamentId: doc.tournament,
                bracketId: doc.bracket,
                stageIndex: br.stage,
                provisional: true,
                finalizeOnComplete: true,
                log: false,
              });
            } catch (e) {
              console.error(
                "[autoFeedGroupRank] post-save failed:",
                e?.message
              );
            }
          });
        }
      }
    } catch (e) {
      console.error(
        "[autoFeedGroupRank] schedule post-save error:",
        e?.message
      );
    }

    // 🔔 Nếu là trận vòng bảng → auto-feed BXH sang các seed groupRank
    if (
      doc.status === "finished" &&
      ["group", "round_robin", "gsl"].includes(doc.format)
    ) {
      // chạy async không block hook
      // setImmediate(() => triggerAutoFeedGroupRank(doc, { log: false }));
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

    // === AUTO APPLY LOCAL RATING (DUPr-like) ===
    try {
      if (
        fresh.status === "finished" &&
        (fresh.winner === "A" || fresh.winner === "B") &&
        fresh.pairA &&
        fresh.pairB &&
        !fresh.ratingApplied
      ) {
        setImmediate(async () => {
          try {
            const { applyRatingForMatch } = await import(
              "../services/ratingEngine.js"
            );
            // await applyRatingForMatch(fresh._id);
          } catch (err) {
            console.error("[rating] apply after update failed:", err?.message);
          }
        });
      }
    } catch (e) {
      console.error("[rating] schedule(update) error:", e?.message);
    }

    try {
      if (fresh.status === "finished") {
        const br = await Bracket.findById(fresh.bracket)
          .select("type stage")
          .lean();
        if (br?.type === "group") {
          setImmediate(async () => {
            try {
              const { autoFeedGroupRank } = await import(
                "../services/autoFeedGroupRank.js"
              );
              await autoFeedGroupRank({
                tournamentId: fresh.tournament,
                bracketId: fresh.bracket,
                stageIndex: br.stage,
                provisional: true,
                finalizeOnComplete: true,
                log: false,
              });
            } catch (e) {
              console.error(
                "[autoFeedGroupRank] post-update failed:",
                e?.message
              );
            }
          });
        }
      }
    } catch (e) {
      console.error(
        "[autoFeedGroupRank] schedule post-update error:",
        e?.message
      );
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
// hỗ trợ propagate cross-bracket theo stage/round/order
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
matchSchema.index({ tournament: 1, createdAt: -1 });
matchSchema.index({ bracket: 1, createdAt: -1 });
matchSchema.index({ tournament: 1, bracket: 1, status: 1, createdAt: -1 });
matchSchema.index({ status: 1, queueOrder: 1, courtCluster: 1 });
matchSchema.index({ participants: 1 });

export default mongoose.model("Match", matchSchema);
