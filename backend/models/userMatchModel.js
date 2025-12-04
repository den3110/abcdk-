// models/userMatchModel.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/* =========================================
 * BREAK helpers (giữ nguyên như Match)
 * ========================================= */
const BREAK_DEFAULT = {
  active: false,
  afterGame: null,
  note: "",
  startedAt: null,
  expectedResumeAt: null,
};

function normalizeBreak(val) {
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

/* =========================================
 * USER MATCH (tự do, không thuộc tournament/bracket)
 * ========================================= */

const participantSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    displayName: { type: String, trim: true, default: "" }, // tên hiển thị
    side: { type: String, enum: ["A", "B", null], default: null },
    order: { type: Number, default: 1 },
  },
  { _id: false }
);

const userMatchSchema = new Schema(
  {
    // 🧑‍💻 Người tạo match tự do
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Tên / tiêu đề match tự do (để show ngoài list)
    title: { type: String, trim: true, default: "" },

    // Mô tả thêm
    note: { type: String, trim: true, default: "" },

    // Loại môn (mặc định pickleball, để sau mở rộng)
    sportType: {
      type: String,
      default: "pickleball",
      index: true,
    },

    // Địa điểm đơn giản
    location: {
      name: { type: String, trim: true, default: "" }, // vd: "CLB A"
      address: { type: String, trim: true, default: "" },
    },

    /* ========= Các field giống Match (trừ tournament/bracket/seed/propagate) ========= */

    // format / branch / round info (để tái dùng UI/overlay nếu cần)
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
    order: { type: Number, default: 0 }, // 0-based
    code: { type: String, default: "" }, // ví dụ: R1#0

    // Luật tính điểm
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

    referee: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    scheduledAt: { type: Date, default: null, index: true },
    court: { type: Schema.Types.ObjectId, ref: "Court", default: null },
    courtLabel: { type: String, default: "" },
    courtCluster: { type: String, default: "Main", index: true },
    queueOrder: { type: Number, default: null, index: true },
    assignedAt: { type: Date, default: null },

    // Lưu user tham gia (dv: User + displayName) – riêng cho match tự do
    participants: {
      type: [participantSchema],
      default: [],
    },

    // Live state
    currentGame: { type: Number, default: 0 },
    serve: {
      side: { type: String, enum: ["A", "B"], default: "A" },
      server: { type: Number, enum: [1, 2], default: 2 },
      serverId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },

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

    // Rating meta (giữ nguyên field để sau tái dùng, không gắn tournament)
    ratingDelta: { type: Number, default: 0 },
    ratingApplied: { type: Boolean, default: false },
    ratingAppliedAt: { type: Date, default: null },

    // Stage & label (vẫn giữ để tái dùng UI/overlay nếu muốn)
    stageIndex: { type: Number, default: 1, index: true },
    labelKey: { type: String, default: "" },

    meta: { type: Schema.Types.Mixed, default: {} },

    // Facebook Live (giữ nguyên để tái dùng)
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
      pageId: { type: String },
    },

    isThirdPlace: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* ======================= PRE-VALIDATE ======================= */
userMatchSchema.pre("validate", function (next) {
  // ép isBreak về object chuẩn
  this.isBreak = normalizeBreak(this.isBreak);

  if (this.winner == null) this.winner = "";

  if (this.referee && !Array.isArray(this.referee)) {
    this.referee = [this.referee];
  }

  next();
});

/* ======================= PRE-SAVE (đơn giản) ======================= */
userMatchSchema.pre("save", function (next) {
  try {
    this.isBreak = normalizeBreak(this.isBreak);

    // code: R{round}#{order}
    if (!this.code) {
      const r = this.round ?? "";
      const o = this.order ?? "";
      this.code = `R${r}#${o}`;
    }

    // labelKey: V{stage}#R{round}#{order+1}
    if (!this.labelKey) {
      const r = this.round ?? 1;
      const o = (this.order ?? 0) + 1;
      const v = this.stageIndex || 1;
      this.labelKey = `V${v}#R${r}#${o}`;
    }

    next();
  } catch (e) {
    next(e);
  }
});

/* ======================= PRE-UPDATE (fix isBreak) ======================= */
userMatchSchema.pre("updateOne", function (next) {
  normalizeBreakInUpdate(this, next);
});
userMatchSchema.pre("findOneAndUpdate", function (next) {
  normalizeBreakInUpdate(this, next);
});
userMatchSchema.pre("updateMany", function (next) {
  normalizeBreakInUpdate(this, next);
});

/* ======================= Indexes ======================= */

userMatchSchema.index({ createdBy: 1, scheduledAt: -1 });
userMatchSchema.index({ createdBy: 1, createdAt: -1 });
userMatchSchema.index({ status: 1, scheduledAt: -1 });
userMatchSchema.index({ participants: 1 });
userMatchSchema.index({ "participants.user": 1 });
userMatchSchema.index({ referee: 1 });

// dấu hiệu stream
userMatchSchema.index(
  { "facebookLive.id": 1 },
  { partialFilterExpression: { "facebookLive.id": { $type: "string" } } }
);

// index cho videoId
userMatchSchema.index(
  { "facebookLive.videoId": 1 },
  {
    partialFilterExpression: {
      "facebookLive.videoId": { $type: "string" },
    },
  }
);
userMatchSchema.index(
  { "facebookLive.permalink_url": 1 },
  {
    partialFilterExpression: {
      "facebookLive.permalink_url": { $type: "string" },
    },
  }
);

export default mongoose.model("UserMatch", userMatchSchema);
