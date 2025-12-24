// models/matchModel.js
import mongoose from "mongoose";
import seedSourceSchema from "./seedSourceSchemaModel.js";
import Bracket from "./bracketModel.js";
import Court from "./courtModel.js";
import Tournament from "./tournamentModel.js";
import {
  markFacebookPageFreeByMatch,
  markFacebookPageFreeByPage,
} from "../services/facebookPagePool.service.js";
const { Schema } = mongoose;

/* =========================================
 * BREAK helpers (để chơi được cả dữ liệu cũ isBreak: false)
 * ========================================= */
const BREAK_DEFAULT = {
  active: false,
  afterGame: null,
  note: "",
  startedAt: null,
  expectedResumeAt: null,
};

function normalizeBreak(val) {
  // case cũ: false / null / undefined / string linh tinh
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return { ...BREAK_DEFAULT };
  }
  return {
    active: !!val.active,
    afterGame:
      typeof val.afterGame === "number"
        ? val.afterGame
        : BREAK_DEFAULT.afterGame,
    note: typeof val.note === "string" ? val.note : BREAK_DEFAULT.note,
    startedAt: val.startedAt
      ? new Date(val.startedAt)
      : BREAK_DEFAULT.startedAt,
    expectedResumeAt: val.expectedResumeAt
      ? new Date(val.expectedResumeAt)
      : BREAK_DEFAULT.expectedResumeAt,
  };
}

// dùng cho các update kiểu $set: { isBreak } hoặc $set: { "isBreak.active": ... }
function normalizeBreakInUpdate(ctx, next) {
  const update = ctx.getUpdate() || {};
  const $set = update.$set || {};
  let changed = false;

  // 1) set thẳng isBreak
  if (Object.prototype.hasOwnProperty.call($set, "isBreak")) {
    $set.isBreak = normalizeBreak($set.isBreak);
    changed = true;
  }

  // 2) set từng field: "isBreak.active", "isBreak.note", ...
  const dotKeys = Object.keys($set).filter((k) => k.startsWith("isBreak."));
  if (dotKeys.length) {
    const nextBreak = { ...BREAK_DEFAULT };
    for (const k of dotKeys) {
      const field = k.slice("isBreak.".length);
      nextBreak[field] = $set[k];
      delete $set[k];
    }
    $set.isBreak = normalizeBreak(nextBreak);
    changed = true;
  }

  if (changed) {
    update.$set = $set;
    ctx.setUpdate(update);
  }
  next();
}

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
          enum: ["none", "hard", "soft"],
          default: "none",
        },
        points: {
          type: Number,
          min: 1,
          default: null,
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
    
    // 👉 BỔ SUNG: Timeout & Medical (Root level)
    timeoutPerGame: { type: Number, default: 2 },      // Số lần timeout mỗi đội/game
    timeoutMinutes: { type: Number, default: 1 },      // Số phút mỗi lần timeout
    medicalTimeouts: { type: Number, default: 1 },     // Số lần nghỉ y tế toàn trận

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

    referee: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    note: { type: String, default: "" },

    // KO chaining (tùy chọn)
    nextMatch: { type: Schema.Types.ObjectId, ref: "Match", default: null },
    nextSlot: { type: String, enum: ["A", "B", null], default: null },

    scheduledAt: { type: Date, default: null },
    court: { type: Schema.Types.ObjectId, ref: "Court", default: null },
    courtLabel: { type: String, default: "" },
    courtCluster: { type: String, default: "Main", index: true }, // cụm sân
    queueOrder: { type: Number, default: null, index: true },
    assignedAt: { type: Date, default: null },
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    ],

    // 🆕 Người tạo trận (trận user tự tạo)
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },

    // Live state
    currentGame: { type: Number, default: 0 },
    serve: {
      side: { type: String, enum: ["A", "B"], default: "A" },
      server: { type: Number, enum: [1, 2], default: 2 },
      serverId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },

    // 👇 QUAN TRỌNG: Mixed để nhận cả dữ liệu cũ (boolean) lẫn mới (object)
    isBreak: {
      type: Schema.Types.Mixed,
      default: () => ({ ...BREAK_DEFAULT }),
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
            "rules",
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
    stageIndex: { type: Number, default: 1, index: true },
    labelKey: { type: String, default: "" },
    meta: { type: Schema.Types.Mixed, default: {} },

    facebookLive: {
      id: { type: String, trim: true },
      videoId: { type: String, trim: true },
      pageId: { type: String, trim: true },
      permalink_url: { type: String, trim: true },
      raw_permalink_url: { type: String, trim: true },
      video_permalink_url: { type: String, trim: true },
      watch_url: { type: String, trim: true },
      embed_html: { type: String },
      embed_url: { type: String, trim: true },
      secure_stream_url: { type: String, trim: true },
      server_url: { type: String, trim: true },
      stream_key: { type: String, trim: true },
      status: { type: String, default: "CREATED" },
      createdAt: Date,
      pageAccessToken: {type: String, trim: true}
    },

    facebookLiveConfig: {
      mode: {
        type: String,
        enum: ["SYSTEM_POOL", "USER_PAGE"],
        default: "SYSTEM_POOL",
      },
      pageConnection: {
        type: Schema.Types.ObjectId,
        ref: "FacebookPageConnection",
      },
      pageId: { type: String }, // PAGE_ID đã dùng để live
    },

    isThirdPlace: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* ======================= VALIDATE ======================= */
/** Cho phép seed thay cho pair/previous */
matchSchema.pre("validate", function (next) {
  // ép isBreak về object chuẩn để tránh lỗi "cannot create field active..."
  this.isBreak = normalizeBreak(this.isBreak);

  const hasResolvedA = !!this.pairA || !!this.previousA;
  const hasResolvedB = !!this.pairB || !!this.previousB;
  const hasSeedA = !!this.seedA && !!this.seedA.type;
  const hasSeedB = !!this.seedB && !!this.seedB.type;
  if (this.winner == null) this.winner = "";

  if (this.referee && !Array.isArray(this.referee)) {
    this.referee = [this.referee];
  }
  // giữ nguyên comment cũ
  // if (!hasResolvedA) return next(new Error("Either pairA/previousA or seedA is required"));
  // if (!hasResolvedB) return next(new Error("Either pairB/previousB or seedB is required"));
  next();
});

/* ======================= Helpers ======================= */

async function emitMatchRefereeSnapshot(matchIds = []) {
  try {
    if (!Array.isArray(matchIds) || matchIds.length === 0) return;

    // unique + stringify id
    const ids = [
      ...new Set(
        matchIds
          .map((id) => {
            try {
              return String(id);
            } catch {
              return "";
            }
          })
          .filter(Boolean)
      ),
    ];
    if (!ids.length) return;

    // dynamic import để tránh circular giữa socket <-> model
    const [{ getIO }, { toDTO }] = await Promise.all([
      import("../socket/index.js"),
      import("../socket/liveHandlers.js"),
    ]);

    const io = getIO?.();
    if (!io) return;

    const Match = mongoose.model("Match");

    const updatedMatches = await Match.find({ _id: { $in: ids } })
      .populate({
        path: "pairA",
        select: "player1 player2 seed label teamName",
        populate: [
          {
            path: "player1",
            select: "fullName name shortName nickname nickName user",
            populate: { path: "user", select: "nickname nickName" },
          },
          {
            path: "player2",
            select: "fullName name shortName nickname nickName user",
            populate: { path: "user", select: "nickname nickName" },
          },
        ],
      })
      .populate({
        path: "pairB",
        select: "player1 player2 seed label teamName",
        populate: [
          {
            path: "player1",
            select: "fullName name shortName nickname nickName user",
            populate: { path: "user", select: "nickname nickName" },
          },
          {
            path: "player2",
            select: "fullName name shortName nickname nickName user",
            populate: { path: "user", select: "nickname nickName" },
          },
        ],
      })
      .populate({
        path: "referee",
        select: "name fullName nickname nickName",
      })
      .populate({ path: "previousA", select: "round order" })
      .populate({ path: "previousB", select: "round order" })
      .populate({ path: "nextMatch", select: "_id" })
      .populate({
        path: "tournament",
        select: "name image eventType overlay",
      })
      .populate({
        path: "bracket",
        select: [
          "noRankDelta",
          "name",
          "type",
          "stage",
          "order",
          "drawRounds",
          "drawStatus",
          "scheduler",
          "drawSettings",
          "meta.drawSize",
          "meta.maxRounds",
          "meta.expectedFirstRoundMatches",
          "groups._id",
          "groups.name",
          "groups.expectedSize",
          "config.rules",
          "config.doubleElim",
          "config.roundRobin",
          "config.swiss",
          "config.gsl",
          "config.roundElim",
          "overlay",
        ].join(" "),
      })
      .populate({
        path: "court",
        select: "name number code label zone area venue building floor",
      })
      .populate({
        path: "liveBy",
        select: "name fullName nickname nickName",
      })
      .select(
        "label managers court courtLabel courtCluster " +
          "scheduledAt startAt startedAt finishedAt status " +
          "tournament bracket rules currentGame gameScores " +
          "round order code roundCode roundName " +
          "seedA seedB previousA previousB nextMatch winner serve overlay " +
          "video videoUrl stream streams meta " +
          "format rrRound pool " +
          "liveBy liveVersion"
      )
      .lean();

    const pick = (v) => (v && String(v).trim()) || "";
    const fillNick = (p) => {
      if (!p) return p;
      const primary = pick(p.nickname) || pick(p.nickName);
      const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
      const n = primary || fromUser || "";
      if (n) {
        p.nickname = n;
        p.nickName = n;
      }
      return p;
    };

    for (const m of updatedMatches) {
      if (!m) continue;

      if (m.pairA) {
        m.pairA.player1 = fillNick(m.pairA.player1);
        m.pairA.player2 = fillNick(m.pairA.player2);
      }
      if (m.pairB) {
        m.pairB.player1 = fillNick(m.pairB.player1);
        m.pairB.player2 = fillNick(m.pairB.player2);
      }

      if (!m.streams && m.meta?.streams) {
        m.streams = m.meta.streams;
      }

      // 1) báo status đơn giản
      io.to(String(m._id)).emit("status:updated", {
        matchId: m._id,
        status: m.status,
      });

      // 2) báo snapshot đầy đủ để FE refresh
      io.to(`match:${String(m._id)}`).emit("match:snapshot", toDTO(m));
    }
  } catch (e) {
    console.error("[match] emitMatchRefereeSnapshot error:", e?.message || e);
  }
}

// Tự động nhận + MERGE trọng tài mặc định từ sân
async function applyDefaultRefereesFromCourt(doc) {
  try {
    if (!doc?.court || !doc?.tournament) return false;

    if (!Array.isArray(doc.referee)) {
      doc.referee = doc.referee ? [doc.referee] : [];
    }

    const court = await Court.findOne({
      _id: doc.court,
      tournament: doc.tournament,
    }).select("defaultReferees");

    if (
      !court ||
      !Array.isArray(court.defaultReferees) ||
      court.defaultReferees.length === 0
    ) {
      return false;
    }

    const existingIds = doc.referee.map((id) => String(id));
    const merged = [...doc.referee];
    let changed = false;

    for (const refId of court.defaultReferees) {
      const idStr = String(refId);
      if (!existingIds.includes(idStr)) {
        merged.push(refId);
        existingIds.push(idStr);
        changed = true;
      }
    }

    if (changed) {
      doc.referee = merged;
      return true;
    }
    return false;
  } catch (e) {
    console.error(
      "[match] applyDefaultRefereesFromCourt error:",
      e?.message || e
    );
    return false;
  }
}

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
      const regId =
        (seed.ref && (seed.ref.registration || seed.ref.reg)) ||
        (mongoose.isValidObjectId(seed.ref) ? seed.ref : null);
      if (regId && mongoose.isValidObjectId(regId)) setPair(regId);
      break;
    }

    case "matchWinner": {
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
      // loser propagate sau
      break;

    case "stageMatchWinner": {
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
      // propagate sau
      break;

    case "groupRank":
    case "bye":
    default:
      break;
  }
}

/** Propagate winner/loser sau khi trận đã finished */
async function propagateFromFinishedMatch(doc) {
  const MatchModel = doc.model("Match");

  // stageIndex fallback
  let st = doc.stageIndex;
  if (!st) {
    const br = await Bracket.findById(doc.bracket).select("stage").lean();
    if (br?.stage) st = br.stage;
  }

  const winnerReg = doc.winner === "A" ? doc.pairA : doc.pairB;
  const loserReg = doc.winner === "A" ? doc.pairB : doc.pairA;

  // 1) KO chaining
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

  // 2) stageMatchWinner
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

  // 3) stageMatchLoser
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

  // 4) matchLoser trong cùng bracket
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
    if (!["group", "round_robin", "gsl"].includes(doc.format)) return;

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
      provisional: true,
      log,
    });
  } catch (e) {
    console.error("[feed] autoFeedGroupRank failed:", e?.message || e);
  }
}

async function releaseCourtFromFinishedMatch(doc) {
  try {
    if (!doc?.court) return;
    await Court.updateOne(
      { _id: doc.court, currentMatch: doc._id },
      { $set: { status: "idle" }, $unset: { currentMatch: "" } }
    );
  } catch (e) {
    console.error("[court] release on finish failed:", e?.message || e);
  }
}

// ============= NOTIFY: knockout final standings =============
async function scheduleKnockoutFinalNotifications(matchDoc) {
  try {
    const brId = matchDoc.bracket || matchDoc.bracketId;
    if (!brId) return;

    const br = await Bracket.findById(brId).select("type tournament").lean();
    if (!br || br.type !== "knockout") return;

    // Chỉ quan tâm trận đã finished
    if (matchDoc.status !== "finished") return;

    const { notifyKnockoutFinalStandings } = await import(
      "../services/notifications/knockoutFinalNotification.js"
    );

    await notifyKnockoutFinalStandings({
      tournamentId: br.tournament,
      bracketId: brId,
    });
  } catch (err) {
    console.error(
      "[notifyKO][scheduleKnockoutFinalNotifications] error:",
      err?.message || err
    );
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
    // đảm bảo isBreak chuẩn trước khi save
    this.isBreak = normalizeBreak(this.isBreak);

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
    // ✅ Auto set scheduledAt = startDate/startAt của tournament (chỉ khi mới tạo)
    if (this.isNew && !this.scheduledAt && this.tournament) {
      try {
        const t = await Tournament.findById(this.tournament)
          .select("startDate startAt")
          .lean();

        if (t) {
          // ưu tiên startAt (UTC chuẩn theo timezone của giải), fallback startDate
          this.scheduledAt = t.startAt || t.startDate || this.scheduledAt;
        }
      } catch (err) {
        console.error(
          "[match] pre-save scheduledAt from tournament failed:",
          err?.message || err
        );
      }
    }

    // resolve seed
    await resolveSeedToSlots(this, "A");
    await resolveSeedToSlots(this, "B");

    try {
      if (
        typeof this.computeParticipants === "function" &&
        (this.isNew || this.isModified("pairA") || this.isModified("pairB"))
      ) {
        await this.computeParticipants();
      }
    } catch (e) {
      console.error("[match] computeParticipants error:", e?.message || e);
    }

    // ✅ Auto merge trọng tài mặc định từ sân:
    // chỉ cần khi:
    // - match mới tạo, hoặc
    // - court thay đổi
    // (nếu đã có referee thì merge thêm, KHÔNG xoá)
    try {
      if (this.isNew || this.isModified("court")) {
        const merged = await applyDefaultRefereesFromCourt(this);
        if (merged) {
          this.__autoRefereeMergedFromCourt = true; // flag nội bộ
        }
      }
    } catch (e) {
      console.error("[match] pre-save auto referees error:", e?.message || e);
    }

    next();
  } catch (e) {
    next(e);
  }
});

// Auto set scheduledAt cho insertMany (tạo khung hàng loạt)
matchSchema.pre("insertMany", async function (next, docs) {
  try {
    if (!Array.isArray(docs) || docs.length === 0) return next();

    const ids = [
      ...new Set(
        docs
          .filter((d) => !d.scheduledAt && d.tournament)
          .map((d) => String(d.tournament))
      ),
    ];

    if (!ids.length) return next();

    const tournaments = await Tournament.find({ _id: { $in: ids } })
      .select("startDate startAt")
      .lean();

    const map = new Map();
    for (const t of tournaments) {
      map.set(String(t._id), t.startAt || t.startDate || null);
    }

    for (const doc of docs) {
      if (!doc.scheduledAt && doc.tournament) {
        const key = String(doc.tournament);
        const base = map.get(key);
        if (base) {
          doc.scheduledAt = base;
        }
      }
    }

    next();
  } catch (e) {
    console.error(
      "[match] pre-insertMany scheduledAt from tournament error:",
      e?.message || e
    );
    next(e);
  }
});

/* ======================= PRE-UPDATE (fix isBreak cũ) ======================= */
matchSchema.pre("updateOne", function (next) {
  normalizeBreakInUpdate(this, next);
});
matchSchema.pre("findOneAndUpdate", function (next) {
  normalizeBreakInUpdate(this, next);
});
matchSchema.pre("updateMany", function (next) {
  normalizeBreakInUpdate(this, next);
});

/* ======================= POST-SAVE ======================= */
matchSchema.post("save", async function (doc, next) {
  try {
    // 👉 chỉ bắn khi auto gán trọng tài mặc định
    if (doc.__autoRefereeMergedFromCourt) {
      await emitMatchRefereeSnapshot([doc._id]);
    }

    if (
      doc.status === "finished" &&
      (doc.winner === "A" || doc.winner === "B")
    ) {
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

    // auto rating
    try {
      if (
        doc.status === "finished" &&
        (doc.winner === "A" || doc.winner === "B") &&
        doc.pairA &&
        doc.pairB &&
        !doc.ratingApplied
      ) {
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

    // auto-feed group
    try {
      if (doc.status === "finished") {
        const br = await Bracket.findById(doc.bracket)
          .select("type stage")
          .lean();
        if (br?.type === "group") {
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

              // 🆕 Sau khi feed seed xong, thử gửi notif kết quả vòng bảng
              try {
                const { notifyGroupStageResults, notifyGroupNextOpponents } =
                  await import(
                    "../services/notifications/groupStageNotification.js"
                  );
                await notifyGroupStageResults({
                  tournamentId: doc.tournament,
                  bracketId: doc.bracket,
                  groupId: doc.pool?.id,
                });

                await notifyGroupNextOpponents({
                  tournamentId: doc.tournament,
                  bracketId: doc.bracket,
                });
              } catch (e2) {
                console.error(
                  "[notifyGroupStageResults] error:",
                  e2?.message || e2
                );
              }
            } catch (e) {
              console.error(
                "[autoFeedGroupRank] post-save failed:",
                e?.message
              );
            }
          });
        }
        // ✅ Knockout: khi tất cả match trong bracket xong → gửi kết quả chung cuộc
        if (br?.type === "knockout") {
          setImmediate(() => {
            scheduleKnockoutFinalNotifications(doc);
          });
        }
      }
      if (doc.status === "finished") {
        try {
          await releaseCourtFromFinishedMatch(doc);
        } catch (error) {
          console.log(error);
        }
      }
    } catch (e) {
      console.error(
        "[autoFeedGroupRank] schedule post-save error:",
        e?.message
      );
    }

    // auto free FB page
    if (doc.status === "finished") {
      try {
        const fbPageId = doc.facebookLive?.pageId;
        if (fbPageId) {
          await markFacebookPageFreeByPage(fbPageId);
        } else {
          await markFacebookPageFreeByMatch(doc._id);
        }
      } catch (e) {
        console.error("[fb] auto-free page (post-save) failed:", e?.message);
      }
    }

    // 🏁 Thử gửi notif tổng kết KO (nếu đây là trận cuối cùng của bracket)
    try {
      if (doc.status === "finished") {
        setImmediate(async () => {
          try {
            const { notifyKnockoutFinalStandings } = await import(
              "../services/notifications/knockoutFinalNotification.js"
            );
            await notifyKnockoutFinalStandings({
              tournamentId: doc.tournament,
              bracketId: doc.bracket,
            });
          } catch (err) {
            console.error(
              "[notifyKnockoutFinalStandings][post-save] error:",
              err?.message || err
            );
          }
        });
      }
    } catch (e) {
      console.error(
        "[notifyKnockoutFinalStandings] schedule(post-save) error:",
        e?.message || e
      );
    }

    next();
  } catch (e) {
    next(e);
  }
});

/* =================== POST findOneAndUpdate =================== */
matchSchema.post("findOneAndUpdate", async function (res) {
  try {
    const q = this.getQuery?.() || {};
    const id = res?._id || q._id || q.id;
    if (!id) return;

    const fresh = await this.model.findById(id);
    if (!fresh) return;

    // auto merge defaultReferees khi update qua findOneAndUpdate
    if (fresh.court) {
      const merged = await applyDefaultRefereesFromCourt(fresh);
      if (merged) {
        await fresh.save();
        await emitMatchRefereeSnapshot([fresh._id]);
      }
    }

    if (
      fresh.status === "finished" &&
      (fresh.winner === "A" || fresh.winner === "B")
    ) {
      await propagateFromFinishedMatch(fresh);
    }

    // auto rating (giữ nguyên)
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

    // auto-feed group (giữ nguyên)
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

              // 🆕 Sau khi feed seed xong, thử gửi notif kết quả vòng bảng
              try {
                const { notifyGroupStageResults, notifyGroupNextOpponents } =
                  await import(
                    "../services/notifications/groupStageNotification.js"
                  );
                await notifyGroupStageResults({
                  tournamentId: fresh.tournament,
                  bracketId: fresh.bracket,
                  groupId: fresh.pool?.id,
                });

                await notifyGroupNextOpponents({
                  tournamentId: fresh.tournament,
                  bracketId: fresh.bracket,
                });
              } catch (e2) {
                console.error(
                  "[notifyGroupStageResults] error:",
                  e2?.message || e2
                );
              }
            } catch (e) {
              console.error(
                "[autoFeedGroupRank] post-save failed:",
                e?.message
              );
            }
          });
        }
        // ✅ Knockout: notify kết quả chung cuộc
        if (br?.type === "knockout") {
          setImmediate(() => {
            scheduleKnockoutFinalNotifications(fresh);
          });
        }
      }
    } catch (e) {
      console.error(
        "[autoFeedGroupRank] schedule post-update error:",
        e?.message
      );
    }

    try {
      if (fresh.status === "finished") {
        await releaseCourtFromFinishedMatch(fresh);
      }
    } catch (error) {
      console.log(error);
    }

    // auto free FB page (giữ nguyên)
    if (fresh.status === "finished") {
      try {
        const fbPageId = fresh.facebookLive?.pageId;
        if (fbPageId) {
          await markFacebookPageFreeByPage(fbPageId);
        } else {
          await markFacebookPageFreeByMatch(fresh._id);
        }
      } catch (e) {
        console.error(
          "[fb] auto-free page (post-findOneAndUpdate) failed:",
          e?.message
        );
      }
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

/**
 * Tự đảm bảo có trận tranh hạng 3/4 cho 1 bracket knockout.
 * - Dựa vào tournament.knockoutThirdPlace (hoặc options.enabled)
 * - Không ảnh hưởng đến bracket tree chính vì dùng branch "consol"
 * - Seed bằng loser 2 trận bán kết (matchLoser)
 */
matchSchema.statics.ensureThirdPlaceMatchForBracket = async function (
  bracketId,
  options = {}
) {
  const Match = this;
  if (!bracketId) return null;

  try {
    // Lấy thông tin bracket
    const br = await Bracket.findById(bracketId)
      .select("tournament type stage meta drawRounds")
      .lean();

    if (!br) return null;

    // Chỉ áp dụng cho knockout
    if (br.type !== "knockout") return null;

    // Lấy tournament để đọc option global
    const t = await Tournament.findById(br.tournament)
      .select("knockoutThirdPlace name")
      .lean();

    const enabledFromTournament = !!(t && t.knockoutThirdPlace);
    const enabledFromOptions = options.enabled === true;

    if (!enabledFromTournament && !enabledFromOptions) {
      // Giải này không muốn có trận tranh hạng 3/4
      return null;
    }

    // Nếu đã có trận thirdPlace rồi thì thôi
    const existing = await Match.findOne({
      bracket: bracketId,
      "meta.thirdPlace": true,
    }).lean();

    if (existing) {
      return existing;
    }

    // Lấy toàn bộ match branch "main" để tính vòng
    const baseMatches = await Match.find({
      bracket: bracketId,
      branch: "main",
    })
      .sort({ round: 1, order: 1 })
      .lean();

    if (!baseMatches.length) return null;

    // maxRound = vòng cuối (chung kết)
    const maxRound = baseMatches.reduce((acc, m) => {
      const r = typeof m.round === "number" ? m.round : 1;
      return r > acc ? r : acc;
    }, 1);

    // Nếu chỉ có 1 round (2 đội) thì cũng không có khái niệm hạng 3
    if (maxRound <= 1) return null;

    const semiRound = maxRound - 1;

    // Lọc ra 2 trận bán kết
    const semis = baseMatches
      .filter((m) => m.round === semiRound)
      .sort((a, b) => {
        const oa = typeof a.order === "number" ? a.order : 0;
        const ob = typeof b.order === "number" ? b.order : 0;
        return oa - ob;
      });

    // Phải có ít nhất 2 trận bán kết
    if (semis.length < 2) return null;

    const semi1 = semis[0];
    const semi2 = semis[1];

    // Dùng rules của 1 trận bất kỳ làm default
    const baseRules = (baseMatches[0] && baseMatches[0].rules) || {
      bestOf: 1,
      pointsToWin: 11,
      winByTwo: true,
      cap: { mode: "none", points: null },
    };

    // Tạo match tranh hạng 3–4
    const doc = await Match.create({
      tournament: br.tournament,
      bracket: bracketId,
      format: br.type || "knockout",
      branch: "consol", // tránh ảnh hưởng cây chính
      round: maxRound, // cùng vòng với chung kết (để sort/UI dễ)
      order: 1, // chung kết thường order 0, third-place đứng cạnh
      phase: "decider",

      seedA: {
        type: "matchLoser",
        ref: {
          round: semiRound,
          order:
            typeof semi1.order === "number" && semi1.order >= 0
              ? semi1.order
              : 0,
        },
      },
      seedB: {
        type: "matchLoser",
        ref: {
          round: semiRound,
          order:
            typeof semi2.order === "number" && semi2.order >= 0
              ? semi2.order
              : 1,
        },
      },

      rules: baseRules,
      gameScores: [],

      status: "scheduled",

      meta: {
        ...(baseMatches[0]?.meta || {}),
        thirdPlace: true,
        stageLabel: "Tranh hạng 3/4",
      },
    });

    return doc;
  } catch (e) {
    console.error(
      "[Match.ensureThirdPlaceMatchForBracket] error:",
      e?.message || e
    );
    return null;
  }
};

/**
 * Xoá các match mồ côi:
 *  - bracket không tồn tại (đã xoá bracket)
 *  - bracket = null / không có field bracket
 */
matchSchema.statics.cleanupOrphanMatches = async function () {
  const Match = this;

  // Tìm các match không còn bracket hợp lệ
  const orphans = await Match.aggregate([
    {
      $lookup: {
        from: "brackets",
        localField: "bracket",
        foreignField: "_id",
        as: "br",
      },
    },
    {
      $match: {
        $or: [
          { bracket: { $exists: false } },
          { bracket: null },
          { br: { $size: 0 } }, // bracket ref nhưng doc đã bị xoá
        ],
      },
    },
    { $project: { _id: 1 } },
  ]);

  const ids = orphans.map((o) => o._id);
  if (!ids.length) {
    console.log("[Match.cleanupOrphanMatches] No orphan matches found");
    return { deletedCount: 0 };
  }

  const result = await Match.deleteMany({ _id: { $in: ids } });

  console.log(
    "[Match.cleanupOrphanMatches] Deleted orphan matches:",
    result.deletedCount
  );

  return { deletedCount: result.deletedCount || 0 };
};

/* ======================= Indexes ======================= */
matchSchema.index({ bracket: 1, branch: 1, round: 1, order: 1 });
matchSchema.index({ bracket: 1, "pool.id": 1, rrRound: 1, order: 1 });
matchSchema.index({ bracket: 1, swissRound: 1, order: 1 });
matchSchema.index({ format: 1 });
matchSchema.index({ stageIndex: 1 });
matchSchema.index({ labelKey: 1 });
matchSchema.index({ bracket: 1, "seedA.type": 1 });
matchSchema.index({ bracket: 1, "seedB.type": 1 });
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
matchSchema.index({ referee: 1 });

// dấu hiệu stream
matchSchema.index(
  { "facebookLive.id": 1 },
  { partialFilterExpression: { "facebookLive.id": { $type: "string" } } }
);

// index cho videoId
matchSchema.index(
  { "facebookLive.videoId": 1 },
  { partialFilterExpression: { "facebookLive.videoId": { $type: "string" } } }
);
matchSchema.index(
  { "facebookLive.permalink_url": 1 },
  {
    partialFilterExpression: {
      "facebookLive.permalink_url": { $type: "string" },
    },
  }
);
matchSchema.index(
  { "facebookLive.permalink_url": 1 },
  {
    partialFilterExpression: {
      "facebookLive.permalink_url": { $type: "string" },
    },
  }
);

matchSchema.index({ createdBy: 1, createdAt: -1 });

export default mongoose.model("Match", matchSchema);
