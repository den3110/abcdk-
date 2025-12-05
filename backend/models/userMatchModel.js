// models/userMatchModel.js
import mongoose from "mongoose";
import {
  markFacebookPageFreeByMatch,
  markFacebookPageFreeByPage,
} from "../services/facebookPagePool.service.js";

const { Schema } = mongoose;

/* =========================================
 * BREAK helpers (giống Match model)
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

function normalizeBreakInUpdate(ctx, next) {
  const update = ctx.getUpdate() || {};
  const $set = update.$set || {};
  let changed = false;

  if (Object.prototype.hasOwnProperty.call($set, "isBreak")) {
    $set.isBreak = normalizeBreak($set.isBreak);
    changed = true;
  }

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
 * PARTICIPANT SCHEMA (hỗ trợ cả user + guest)
 * ========================================= */
const participantSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    displayName: { type: String, trim: true, default: "" },
    side: { type: String, enum: ["A", "B", null], default: null },
    order: { type: Number, default: 1 }, // 1 = player1, 2 = player2 (doubles)

    // Guest player support
    isGuest: { type: Boolean, default: false },
    avatar: { type: String, trim: true, default: "" },
    contact: {
      phone: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, default: "" },
    },

    // Role (để mở rộng sau)
    role: {
      type: String,
      enum: ["player", "substitute", "observer"],
      default: "player",
    },
  },
  { _id: false }
);

/* =========================================
 * REACTION SCHEMA (cho social features)
 * ========================================= */
const reactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["like", "love", "fire", "clap"],
      default: "like",
    },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

/* =========================================
 * PAIR SCHEMAS (field thật, build từ participants)
 * ========================================= */

const pairPlayerSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    phone: { type: String, trim: true, default: "" },
    fullName: { type: String, trim: true, default: "" },
    nickName: { type: String, trim: true, default: "" },
    avatar: { type: String, trim: true, default: "" },
    score: { type: Number, default: 0 },
  },
  { _id: false }
);

const pairPaymentSchema = new Schema(
  {
    status: { type: String, default: "Paid" },
    paidAt: { type: Date, default: null },
  },
  { _id: false }
);

const pairSchema = new Schema(
  {
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      default: null,
    },
    player1: { type: pairPlayerSchema, default: null },
    player2: { type: pairPlayerSchema, default: null },
    seed: { type: Number, default: null },
    label: { type: String, default: "" },
    teamName: { type: String, default: "" },
    payment: {
      type: pairPaymentSchema,
      default: () => ({ status: "Paid", paidAt: null }),
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    code: { type: String, default: null },
  },
  { _id: false }
);

function buildPlayerFromParticipant(p) {
  if (!p) return null;

  return {
    user: p.user || null,
    phone: (p.contact && p.contact.phone) || "",
    fullName: p.displayName || "",
    nickName: "",
    avatar: p.avatar || "",
    score: 0,
  };
}

function buildPairForSide(doc, side) {
  const list = Array.isArray(doc.participants)
    ? doc.participants.filter((p) => p.side === side)
    : [];

  if (!list.length) return null;

  const sorted = [...list].sort((a, b) => (a.order || 0) - (b.order || 0));

  const p1 = sorted[0];
  const p2 = sorted[1] || null;

  return {
    tournament: null,
    player1: buildPlayerFromParticipant(p1),
    player2: p2 ? buildPlayerFromParticipant(p2) : null,
    seed: null,
    label: "",
    teamName: "",
    payment: { status: "Paid", paidAt: null },
    createdBy: doc.createdBy || null,
    code: null,
  };
}

function rebuildPairs(doc) {
  doc.pairA = buildPairForSide(doc, "A");
  doc.pairB = buildPairForSide(doc, "B");
}

/* =========================================
 * USER MATCH SCHEMA
 * ========================================= */
const userMatchSchema = new Schema(
  {
    /* ========= OWNERSHIP & BASIC INFO ========= */
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    title: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },

    sportType: {
      type: String,
      default: "pickleball",
      index: true,
    },

    /* ========= PRIVACY & SHARING ========= */
    visibility: {
      type: String,
      enum: ["public", "private", "friends", "invited"],
      default: "private",
      index: true,
    },
    invitedUsers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    allowComments: { type: Boolean, default: true },
    allowShare: { type: Boolean, default: false },

    /* ========= LOCATION ========= */
    location: {
      name: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      coordinates: {
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
      },
    },

    /* ========= CATEGORIZATION ========= */
    category: {
      type: String,
      enum: ["casual", "practice", "club", "league", "tournament", "other"],
      default: "casual",
      index: true,
    },
    tags: [{ type: String, trim: true }],

    // Custom league/season (nếu user tự tổ chức giải riêng)
    customLeague: {
      name: { type: String, trim: true, default: "" },
      season: { type: String, trim: true, default: "" },
    },

    /* ========= MATCH STRUCTURE (giống Match) ========= */
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
    },

    pool: {
      id: { type: Schema.Types.ObjectId, default: null },
      name: { type: String, default: "" },
    },
    phase: {
      type: String,
      enum: ["group", "winners", "losers", "decider", "grand_final", null],
      default: null,
    },
    swissRound: { type: Number, default: null },
    rrRound: { type: Number, default: null },

    round: { type: Number, default: 1, index: true },
    order: { type: Number, default: 0 },
    code: { type: String, default: "" },

    /* ========= RULES & SCORING ========= */
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

    /* ========= STATUS & RESULT ========= */
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

    /* ========= PARTICIPANTS ========= */
    participants: {
      type: [participantSchema],
      default: [],
    },

    /* ========= PAIRS (field thật) ========= */
    pairA: { type: pairSchema, default: null },
    pairB: { type: pairSchema, default: null },

    /* ========= OFFICIALS ========= */
    referee: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    /* ========= SCHEDULING ========= */
    scheduledAt: { type: Date, default: null, index: true },
    court: { type: Schema.Types.ObjectId, ref: "Court", default: null },
    courtLabel: { type: String, default: "" },
    courtCluster: { type: String, default: "Main" },
    queueOrder: { type: Number, default: null },
    assignedAt: { type: Date, default: null },

    /* ========= LIVE STATE ========= */
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

    // 🔹 NEW: slots cho userMatch (giống Match)
    slots: {
      type: Schema.Types.Mixed,
      default: () => ({
        base: { A: {}, B: {} },
        serverId: null,
        version: 0,
        updatedAt: null,
      }),
    },

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

    /* ========= RATING (để sau mở rộng) ========= */
    ratingDelta: { type: Number, default: 0 },
    ratingApplied: { type: Boolean, default: false },
    ratingAppliedAt: { type: Date, default: null },

    /* ========= METADATA ========= */
    stageIndex: { type: Number, default: 1 },
    labelKey: { type: String, default: "" },
    meta: { type: Schema.Types.Mixed, default: {} },

    /* ========= FACEBOOK LIVE ========= */
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

    /* ========= SOCIAL FEATURES ========= */
    reactions: [reactionSchema],
    views: { type: Number, default: 0 },
    viewedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],

    /* ========= MISC ========= */
    isThirdPlace: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* ======================= PRE-VALIDATE ======================= */
userMatchSchema.pre("validate", function (next) {
  this.isBreak = normalizeBreak(this.isBreak);

  if (this.winner == null) this.winner = "";

  if (this.referee && !Array.isArray(this.referee)) {
    this.referee = [this.referee];
  }

  // build pairA / pairB từ participants trước khi validate/save
  rebuildPairs(this);

  next();
});

/* ======================= PRE-SAVE ======================= */
userMatchSchema.pre("save", function (next) {
  try {
    this.isBreak = normalizeBreak(this.isBreak);

    // 🔹 đảm bảo slots luôn có base A/B
    if (!this.slots || typeof this.slots !== "object") {
      this.slots = {
        base: { A: {}, B: {} },
        serverId: null,
        version: 0,
        updatedAt: null,
      };
    } else {
      const s = this.slots;
      this.slots = {
        ...s,
        base: {
          A: (s.base && s.base.A) || {},
          B: (s.base && s.base.B) || {},
        },
        serverId: s.serverId || null,
        version: typeof s.version === "number" ? s.version : 0,
        updatedAt: s.updatedAt || null,
      };
    }

    // bảo hiểm: rebuild pair trước khi save
    rebuildPairs(this);

    // Auto-generate code
    if (!this.code) {
      const r = this.round ?? "";
      const o = this.order ?? "";
      this.code = `R${r}#${o}`;
    }

    // Auto-generate labelKey
    if (!this.labelKey) {
      const r = this.round ?? 1;
      const o = (this.order ?? 0) + 1;
      const v = this.stageIndex || 1;
      this.labelKey = `V${v}#R${r}#${o}`;
    }

    // Auto-generate title if empty
    if (!this.title) {
      const sideA = this.participants.filter((p) => p.side === "A");
      const sideB = this.participants.filter((p) => p.side === "B");

      const getNames = (side) =>
        side
          .map((p) => p.displayName || "Player")
          .join("/")
          .substring(0, 30);

      if (sideA.length && sideB.length) {
        this.title = `${getNames(sideA)} vs ${getNames(sideB)}`;
      } else {
        this.title = "Trận đấu tự do";
      }
    }

    next();
  } catch (e) {
    next(e);
  }
});

/* ======================= PRE-UPDATE ======================= */
userMatchSchema.pre("updateOne", function (next) {
  normalizeBreakInUpdate(this, next);
});
userMatchSchema.pre("findOneAndUpdate", function (next) {
  normalizeBreakInUpdate(this, next);
});
userMatchSchema.pre("updateMany", function (next) {
  normalizeBreakInUpdate(this, next);
});

/* ======================= INSTANCE METHODS ======================= */

/**
 * Thêm participant vào match
 */
userMatchSchema.methods.addParticipant = async function (data) {
  const { user, displayName, side, order, isGuest, avatar, contact, role } =
    data;

  // Validate side
  if (!["A", "B"].includes(side)) {
    throw new Error('Side must be "A" or "B"');
  }

  // Check duplicate
  const exists = this.participants.some(
    (p) =>
      (p.user && user && String(p.user) === String(user) && p.side === side) ||
      (p.displayName === displayName && p.side === side)
  );

  if (exists) {
    throw new Error("Participant already exists on this side");
  }

  // Check số lượng (doubles: max 2 per side)
  const sameSize = this.participants.filter((p) => p.side === side).length;
  if (sameSize >= 2) {
    throw new Error(`Side ${side} already has 2 players (doubles)`);
  }

  this.participants.push({
    user: user || null,
    displayName: displayName || "",
    side,
    order: order || sameSize + 1,
    isGuest: isGuest || false,
    avatar: avatar || "",
    contact: contact || {},
    role: role || "player",
  });

  // rebuild pair fields từ participants mới
  rebuildPairs(this);

  await this.save();
  return this;
};

/**
 * Xoá participant
 */
userMatchSchema.methods.removeParticipant = async function (userId, side) {
  if (side) {
    this.participants = this.participants.filter(
      (p) => !(String(p.user) === String(userId) && p.side === side)
    );
  } else {
    this.participants = this.participants.filter(
      (p) => String(p.user) !== String(userId)
    );
  }

  // rebuild pair fields sau khi xoá
  rebuildPairs(this);

  await this.save();
  return this;
};

/**
 * Thêm reaction
 */
userMatchSchema.methods.addReaction = async function (userId, type = "like") {
  // Remove old reaction from same user
  this.reactions = this.reactions.filter(
    (r) => String(r.user) !== String(userId)
  );

  this.reactions.push({
    user: userId,
    type,
    at: new Date(),
  });

  await this.save();
  return this;
};

/**
 * Remove reaction
 */
userMatchSchema.methods.removeReaction = async function (userId) {
  this.reactions = this.reactions.filter(
    (r) => String(r.user) !== String(userId)
  );

  await this.save();
  return this;
};

/**
 * Track view
 */
userMatchSchema.methods.trackView = async function (userId) {
  if (!userId) return this;

  const alreadyViewed = this.viewedBy.some(
    (id) => String(id) === String(userId)
  );

  if (!alreadyViewed) {
    this.viewedBy.push(userId);
    this.views = (this.views || 0) + 1;
    await this.save();
  }

  return this;
};

/* ======================= STATIC METHODS ======================= */

/**
 * Lấy match history của user
 */
userMatchSchema.statics.getUserMatchHistory = async function (
  userId,
  options = {}
) {
  const {
    limit = 20,
    skip = 0,
    status,
    category,
    visibility,
    includeAsReferee = true,
  } = options;

  const orConditions = [{ createdBy: userId }, { "participants.user": userId }];

  if (includeAsReferee) {
    orConditions.push({ referee: userId });
  }

  const query = { $or: orConditions };

  if (status) query.status = status;
  if (category) query.category = category;
  if (visibility) query.visibility = visibility;

  return this.find(query)
    .sort({ scheduledAt: -1, createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .populate("createdBy", "name fullName avatar nickname nickName")
    .populate(
      "participants.user",
      "name fullName avatar nickname nickName phone"
    )
    .populate("referee", "name fullName nickname nickName")
    .populate("liveBy", "name fullName nickname nickName")
    .lean(); // pairA / pairB là field thật nên lean vẫn ok
};

/**
 * Lấy stats của user từ matches tự do
 */
userMatchSchema.statics.getUserStats = async function (userId) {
  const matches = await this.find({
    "participants.user": userId,
    status: "finished",
  }).lean();

  let wins = 0;
  let losses = 0;
  let totalGames = 0;
  let totalPoints = 0;
  let totalOpponentPoints = 0;

  for (const m of matches) {
    if (!m.winner) continue;

    const userSide = m.participants.find(
      (p) => p.user && String(p.user) === String(userId)
    )?.side;

    if (!userSide) continue;

    const games = m.gameScores || [];
    totalGames += games.length;

    // Count points
    for (const g of games) {
      if (userSide === "A") {
        totalPoints += g.a || 0;
        totalOpponentPoints += g.b || 0;
      } else {
        totalPoints += g.b || 0;
        totalOpponentPoints += g.a || 0;
      }
    }

    if (m.winner === userSide) wins++;
    else losses++;
  }

  return {
    totalMatches: matches.length,
    wins,
    losses,
    winRate:
      matches.length > 0 ? ((wins / matches.length) * 100).toFixed(1) : 0,
    totalGames,
    totalPoints,
    totalOpponentPoints,
    avgPointsPerGame:
      totalGames > 0 ? (totalPoints / totalGames).toFixed(1) : 0,
  };
};

/**
 * Tìm matches public gần user (theo location)
 */
userMatchSchema.statics.findNearbyPublicMatches = async function (
  coordinates,
  options = {}
) {
  const { maxDistance = 50000, limit = 20, status = "scheduled" } = options; // 50km default

  if (!coordinates || !coordinates.lat || !coordinates.lng) {
    // Fallback: return recent public matches
    return this.find({
      visibility: "public",
      status,
    })
      .sort({ scheduledAt: 1 })
      .limit(limit)
      .populate("createdBy", "name fullName avatar")
      .lean();
  }

  // TODO: Implement geo queries nếu cần (cần index 2dsphere)
  // Hiện tại return public matches
  return this.find({
    visibility: "public",
    status,
  })
    .sort({ scheduledAt: 1 })
    .limit(limit)
    .populate("createdBy", "name fullName avatar")
    .lean();
};

/* ======================= POST-SAVE (Socket + Cleanup) ======================= */
userMatchSchema.post("save", async function (doc, next) {
  try {
    // 1) Socket real-time updates
    try {
      const [{ getIO }] = await Promise.all([import("../socket/index.js")]);

      const io = getIO?.();
      if (io) {
        // Populate before emit
        await doc.populate([
          {
            path: "createdBy",
            select: "name fullName avatar nickname nickName",
          },
          {
            path: "participants.user",
            select: "name fullName avatar nickname nickName phone",
          },
          { path: "referee", select: "name fullName nickname nickName" },
          { path: "liveBy", select: "name fullName nickname nickName" },
        ]);

        // Emit to match room
        io.to(`match:${String(doc._id)}`).emit("match:snapshot", doc);

        // Emit status
        io.to(String(doc._id)).emit("status:updated", {
          matchId: doc._id,
          status: doc.status,
          type: "userMatch",
        });

        // Notify participants khi finished
        if (doc.status === "finished") {
          const userIds = doc.participants
            .map((p) => p.user)
            .filter(Boolean)
            .map((id) => String(id));

          for (const uid of userIds) {
            io.to(`user:${uid}`).emit("match:finished", {
              matchId: doc._id,
              winner: doc.winner,
              title: doc.title,
            });
          }
        }
      }
    } catch (e) {
      console.error("[userMatch] socket emit error:", e?.message || e);
    }

    // 2) Auto free FB page khi finished
    if (doc.status === "finished") {
      try {
        const fbPageId = doc.facebookLive?.pageId;
        if (fbPageId) {
          await markFacebookPageFreeByPage(fbPageId);
        } else {
          await markFacebookPageFreeByMatch(doc._id);
        }
      } catch (e) {
        console.error("[userMatch] auto-free FB page failed:", e?.message || e);
      }
    }

    next();
  } catch (e) {
    console.error("[userMatch] post-save error:", e?.message || e);
    next();
  }
});

/* ======================= POST findOneAndUpdate ======================= */
userMatchSchema.post("findOneAndUpdate", async function (res) {
  try {
    const q = this.getQuery?.() || {};
    const id = res?._id || q._id || q.id;
    if (!id) return;

    const fresh = await this.model.findById(id);
    if (!fresh) return;

    // Auto free FB page
    if (fresh.status === "finished") {
      // tuỳ bạn có muốn auto-free ở đây nữa không
      // try {
      //   const fbPageId = fresh.facebookLive?.pageId;
      //   if (fbPageId) {
      //     await markFacebookPageFreeByPage(fresh.facebookLive.pageId);
      //   } else {
      //     await markFacebookPageFreeByMatch(fresh._id);
      //   }
      // } catch (e) {
      //   console.error(
      //     "[userMatch] auto-free FB page (update) failed:",
      //     e?.message || e
      //   );
      // }
    }
  } catch (err) {
    console.error("[UserMatch post(findOneAndUpdate)] error:", err);
  }
});

/* ======================= INDEXES ======================= */

// Basic queries
userMatchSchema.index({ createdBy: 1, scheduledAt: -1 });
userMatchSchema.index({ createdBy: 1, createdAt: -1 });
userMatchSchema.index({ status: 1, scheduledAt: -1 });
userMatchSchema.index({ status: 1, createdAt: -1 });

// Participants
userMatchSchema.index({ participants: 1 });
userMatchSchema.index({ "participants.user": 1 });
userMatchSchema.index({ "participants.user": 1, status: 1 });

// Privacy & sharing
userMatchSchema.index({ visibility: 1, scheduledAt: -1 });
userMatchSchema.index({ visibility: 1, createdAt: -1 });
userMatchSchema.index({ invitedUsers: 1 });

// Categorization
userMatchSchema.index({ category: 1, createdAt: -1 });
userMatchSchema.index({ tags: 1 });
userMatchSchema.index({ "customLeague.name": 1, scheduledAt: -1 });

// Officials
userMatchSchema.index({ referee: 1 });

// Social
userMatchSchema.index({ "reactions.user": 1 });
userMatchSchema.index({ viewedBy: 1 });

// Facebook Live
userMatchSchema.index(
  { "facebookLive.id": 1 },
  { partialFilterExpression: { "facebookLive.id": { $type: "string" } } }
);
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

// Composite indexes for common queries
userMatchSchema.index({
  visibility: 1,
  status: 1,
  scheduledAt: -1,
});
userMatchSchema.index({
  "participants.user": 1,
  status: 1,
  scheduledAt: -1,
});
userMatchSchema.index({
  createdBy: 1,
  status: 1,
  category: 1,
});

// Geo index (nếu implement location-based search)
// userMatchSchema.index({ "location.coordinates": "2dsphere" });

export default mongoose.model("UserMatch", userMatchSchema);
