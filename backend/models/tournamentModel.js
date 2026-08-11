import mongoose from "mongoose";
import { DateTime } from "luxon";
import DrawSettingsSchema from "./drawSettingsSchema.js";
import { es, ES_ENABLED, ES_TOURNAMENT_INDEX } from "../services/esClient.js";
import { clearTournamentPresentationCaches } from "../services/cacheInvalidation.service.js";

/* ------------ Sub-schemas ------------ */
const TeleSchema = new mongoose.Schema(
  {
    hubChatId: { type: String },
    topicId: { type: Number },
    inviteLink: { type: String },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const AgeRestrictionSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    minAge: { type: Number, default: 0, min: 0, max: 100 },
    maxAge: { type: Number, default: 100, min: 0, max: 100 },
    minBirthYear: { type: Number, default: null },
    maxBirthYear: { type: Number, default: null },
  },
  { _id: false }
);

const TeamFactionSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    captainUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

/**
 * MLP config — cấu hình cho tournamentMode="mlp".
 * Mỗi dual match (team vs team) gồm N sub-matches (slots) tuỳ config,
 * cộng dồn điểm slot thắng → team thắng dual. Nếu hoà → DreamBreaker.
 */
const MlpSlotSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 20 }, // "WD","MD","XD1","XD2"
    label: { type: String, default: "", maxlength: 60 }, // "Đôi nữ"
    matchType: {
      type: String,
      enum: ["single", "double"],
      default: "double",
    },
    // Ràng buộc giới tính khi chọn VĐV từ roster team.
    // any = không ràng buộc; male/female = toàn nam/nữ; mixed = 1 nam + 1 nữ (double only)
    genderRule: {
      type: String,
      enum: ["any", "male", "female", "mixed"],
      default: "any",
    },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const MlpCapSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: ["none", "hard", "soft"],
      default: "none",
    },
    points: { type: Number, min: 1, default: null },
  },
  { _id: false }
);

const MlpDreamBreakerSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    pointsToWin: { type: Number, default: 21, min: 1, max: 99 },
    // Cứ N điểm ghi được thì rotate sang VĐV kế tiếp trong lineup.
    // MLP chính thức = 4.
    rotationEveryPoints: { type: Number, default: 4, min: 1, max: 21 },
    winByTwo: { type: Boolean, default: false }, // MLP chính thức = false
  },
  { _id: false }
);

/**
 * MLP Group Stage — cấu hình chia bảng + knockout.
 * - enabled=false → giữ hành vi cũ (vòng tròn tất cả gặp nhau, không knockout tự động).
 * - enabled=true → sinh dual round-robin TRONG mỗi bảng; sau đó knockout lấy topPerPool
 *   mỗi bảng ghép seed chéo (A1-B2, B1-A2, ...).
 * poolCount × poolSize KHÔNG cần bằng số đội — cho phép bảng lệch (VD 15 đội / 4 bảng = 4-4-4-3).
 */
const MlpGroupStageSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    poolCount: { type: Number, default: 4, min: 1, max: 32 },
    poolSize: { type: Number, default: 4, min: 2, max: 32 },
    topPerPool: { type: Number, default: 2, min: 1, max: 16 },
    doubleRound: { type: Boolean, default: false }, // vòng tròn 2 lượt trong bảng
    // Phương pháp bốc thăm mặc định — có thể override khi gọi endpoint.
    seedMethod: {
      type: String,
      enum: ["random", "snake", "manual"],
      default: "random",
    },
    // Danh sách thứ tự tiebreaker khi tính BXH trong bảng.
    tiebreakers: {
      type: [String],
      default: ["wins", "headToHead", "slotDiff", "pointDiff", "pointsFor"],
    },
    // Ghi lại thời điểm bốc thăm gần nhất (draft/finalized).
    drawStatus: {
      type: String,
      enum: ["idle", "drafted", "committed"],
      default: "idle",
    },
    drawnAt: { type: Date, default: null },
  },
  { _id: false }
);

const MlpConfigSchema = new mongoose.Schema(
  {
    // Roster limits — BTC không ép giới tính, chỉ min/max size.
    minRosterSize: { type: Number, default: 4, min: 1, max: 30 },
    maxRosterSize: { type: Number, default: 8, min: 1, max: 30 },
    // Trần tổng điểm trình ĐÔI của roster; null = không giới hạn.
    maxTeamScore: { type: Number, default: null, min: 0 },
    // Danh sách sub-matches trong 1 dual match (thứ tự = order).
    slots: {
      type: [MlpSlotSchema],
      default: () => [
        { key: "WD", label: "Đôi nữ", matchType: "double", genderRule: "female", order: 0 },
        { key: "MD", label: "Đôi nam", matchType: "double", genderRule: "male", order: 1 },
        { key: "XD1", label: "Đôi hỗn hợp 1", matchType: "double", genderRule: "mixed", order: 2 },
        { key: "XD2", label: "Đôi hỗn hợp 2", matchType: "double", genderRule: "mixed", order: 3 },
      ],
    },
    // Luật tính điểm áp dụng cho MỌI sub-match (BTC có thể override cho từng match sau).
    pointsToWin: { type: Number, default: 21, enum: [11, 15, 21] },
    winByTwo: { type: Boolean, default: true },
    cap: { type: MlpCapSchema, default: () => ({ mode: "none", points: null }) },
    // Rally scoring (MLP dùng), khác side-out truyền thống.
    rallyScoring: { type: Boolean, default: true },
    // DreamBreaker khi hoà số slot.
    dreamBreaker: {
      type: MlpDreamBreakerSchema,
      default: () => ({}),
    },
    // Group stage + knockout config. enabled=false → hành vi cũ (round-robin all-vs-all).
    groupStage: {
      type: MlpGroupStageSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

/**
 * ✅ NEW: toạ độ địa lý cho giải (dùng cho WeatherKit, map…)
 * - location: string địa chỉ hiển thị (đã có sẵn)
 * - locationGeo: thông tin toạ độ, lấy từ AI / geocoder
 */
const LocationGeoSchema = new mongoose.Schema(
  {
    lat: { type: Number, default: null }, // vĩ độ
    lon: { type: Number, default: null }, // kinh độ
    displayName: { type: String, default: "" }, // ví dụ: tên sân + quận/huyện + tỉnh/thành
    confidence: {
      type: String,
      default: "",
    }, // map từ AI: "high" | "medium" | "low"
    source: {
      type: String,
      enum: ["ai", "manual", "geocoder", ""],
      default: "",
    }, // ai: từ OpenAI, manual: admin nhập tay, geocoder: service khác
    resolvedAt: { type: Date, default: null }, // thời điểm resolve toạ độ
  },
  { _id: false }
);

/* ------------- Main schema ------------ */
const tournamentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: {
      type: String,
      trim: true,
      uppercase: true,
      minlength: 3,
      maxlength: 32,
    },
    image: { type: String, default: null, required: true },
    // URL scoreboard overlay đã generate + deploy (VD https://scoreboard.pickletour.vn/xxx.html).
    overlayUrl: { type: String, default: "", trim: true },
    registrationPosterConfig: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    sportType: { type: Number, required: true },
    groupId: { type: Number, default: 0 },

    regOpenDate: { type: Date, required: true, default: Date.now },
    registrationDeadline: { type: Date, required: true, default: Date.now },
    startDate: { type: Date, required: true, default: Date.now },
    endDate: { type: Date, required: true, default: Date.now },
    eventType: { type: String, enum: ["single", "double"], default: "double" },
    tournamentMode: {
      type: String,
      enum: ["standard", "team", "mlp"],
      default: "standard",
      index: true,
    },
    nameDisplayMode: {
      type: String,
      enum: ["nickname", "fullName"],
      default: "nickname",
    },
    scoreCap: { type: Number, required: true, default: 0 },
    scoreGap: { type: Number, required: true, default: 0 },
    singleCap: { type: Number, required: true, default: 0 },
    maxPairs: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: ["upcoming", "ongoing", "finished"],
      default: "upcoming",
    },
    finishedAt: { type: Date, default: null },
    isTest: { type: Boolean, default: false, index: true },

    // 🏠 Địa chỉ text hiển thị (giữ nguyên)
    location: { type: String, required: true },

    // 🗺️ Toạ độ thực tế (NEW) – điền từ AI / geocoder
    locationGeo: {
      type: LocationGeoSchema,
      default: () => ({}),
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    contactHtml: { type: String, default: "" },
    contentHtml: { type: String, default: "" },
    timezone: { type: String, default: "Asia/Ho_Chi_Minh" },

    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },

    drawSettings: { type: DrawSettingsSchema, default: () => ({}) },

    // ✅ NEW: option global cho knockout – có tạo trận tranh hạng 3/4 hay không
    knockoutThirdPlace: {
      type: Boolean,
      default: false,
    },

    overlay: {
      theme: { type: String, enum: ["dark", "light"], default: "dark" },
      accentA: { type: String, default: "#25C2A0" },
      accentB: { type: String, default: "#4F46E5" },
      corner: { type: String, enum: ["tl", "tr", "bl", "br"], default: "tl" },
      rounded: { type: Number, default: 18, min: 0, max: 40 },
      shadow: { type: Boolean, default: true },
      showSets: { type: Boolean, default: true },
      fontFamily: { type: String, default: "" },
      nameScale: { type: Number, default: 1 },
      scoreScale: { type: Number, default: 1 },
      overlayNameStyle: {
        type: String,
        enum: ["1", "2", "3", "4"],
        default: "1",
      },
      customCss: { type: String, default: "" },
      logoUrl: { type: String, default: "" },
      // Server-driven overlay widgets cho app native live:
      // [{ id, type: "image"|"text", enabled, url, text, x, y, w, size, opacity, color, bg }]
      // Mixed để linh hoạt thêm type mới — app cũ tự bỏ qua type lạ, không crash.
      widgets: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },

    noRankDelta: { type: Boolean, default: false },
    allowExceedMaxRating: { type: Boolean, default: false },

    scoringScope: {
      type: {
        type: String,
        enum: ["national", "provinces"],
        default: "national",
      },
      provinces: { type: [String], default: [] },
    },

    bankShortName: { type: String, trim: true, default: "" },
    bankAccountNumber: {
      type: String,
      default: "",
      set: (v) => String(v || "").replace(/\D/g, ""),
      validate: {
        validator: (v) => v === "" || /^\d{4,32}$/.test(v),
        message: "bankAccountNumber phải là 4–32 chữ số.",
      },
    },
    bankAccountName: { type: String, trim: true, default: "", maxlength: 64 },
    registrationFee: { type: Number, default: 0, min: 0 },
    isFreeRegistration: { type: Boolean, default: false },

    tele: TeleSchema,

    teamConfig: {
      factions: {
        type: [TeamFactionSchema],
        default: [],
      },
    },

    // Chỉ dùng khi tournamentMode === "mlp".
    mlpConfig: {
      type: MlpConfigSchema,
      default: () => ({}),
    },

    requireKyc: { type: Boolean, default: true },
    ageRestriction: { type: AgeRestrictionSchema, default: () => ({}) },

    expected: { type: Number, default: 0 },
    matchesCount: { type: Number, default: 0 },
    allowedCourtClusterIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "CourtCluster",
      },
    ],

    drawPlan: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

/* ------------- Helpers ------------- */
function clampAge(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

function recomputeUTC(doc) {
  if (doc.startDate) {
    doc.startAt = doc.startDate;
  }
  if (doc.endDate) {
    doc.endAt = doc.endDate;
  }
}

function recomputeBirthYears(doc) {
  const ar = doc.ageRestriction || {};
  if (!ar.enabled || !doc.startDate) {
    doc.ageRestriction = { ...ar, minBirthYear: null, maxBirthYear: null };
    return;
  }
  const tz = doc.timezone || "Asia/Ho_Chi_Minh";
  const year = DateTime.fromJSDate(doc.startDate).setZone(tz).year;
  const minAge = clampAge(ar.minAge);
  const maxAge = clampAge(ar.maxAge);
  doc.ageRestriction = {
    ...ar,
    minAge,
    maxAge,
    minBirthYear: year - maxAge,
    maxBirthYear: year - minAge,
  };
}

/* ------------- Elasticsearch helpers ------------- */

function buildTournamentSearchDoc(doc) {
  const obj = doc.toObject
    ? doc.toObject({ depopulate: true })
    : doc;

  const {
    _id,
    name,
    code,
    location,
    status,
    sportType,
    groupId,
    image,
    eventType,
    timezone,
    regOpenDate,
    registrationDeadline,
    startDate,
    endDate,
    startAt,
    endAt,
    scoringScope,
    locationGeo,
    createdAt,
    updatedAt,
  } = obj;

  return {
    // field dùng để search / filter
    name,
    code,
    location,
    status,
    sportType,
    groupId,
    image,
    eventType,
    timezone,

    regOpenDate,
    registrationDeadline,
    startDate,
    endDate,
    startAt,
    endAt,

    scoringScopeType: scoringScope?.type || null,
    scoringScopeProvinces: scoringScope?.provinces || [],

    locationGeo: locationGeo || {},

    // text tổng hợp cho tìm kiếm free-text
    searchText: [name, code, location].filter(Boolean).join(" - "),

    createdAt,
    updatedAt,
  };
}

async function indexTournamentToES(doc) {
  if (!ES_ENABLED || !doc?._id) return;
  const body = buildTournamentSearchDoc(doc);

  try {
    await es.index({
      index: ES_TOURNAMENT_INDEX,
      id: String(doc._id),
      document: body,
    });
  } catch (err) {
    console.error("[ES] index tournament error:", err?.message || err);
  }
}

async function deleteTournamentFromES(id) {
  if (!ES_ENABLED || !id) return;
  try {
    await es.delete({
      index: ES_TOURNAMENT_INDEX,
      id: String(id),
    });
  } catch (err) {
    // nếu không tồn tại thì bỏ qua
    if (err.meta?.statusCode !== 404) {
      console.error("[ES] delete tournament error:", err?.message || err);
    }
  }
}


/* ------------- Hooks ------------- */
let tournamentCacheClearTimer = null;

function scheduleTournamentPresentationCacheClear() {
  if (tournamentCacheClearTimer) return;
  tournamentCacheClearTimer = setTimeout(async () => {
    tournamentCacheClearTimer = null;
    try {
      await clearTournamentPresentationCaches();
    } catch (error) {
      console.warn(
        "[Tournament.cache] Failed to clear presentation caches:",
        error?.message || error,
      );
    }
  }, 0);
  if (typeof tournamentCacheClearTimer.unref === "function") {
    tournamentCacheClearTimer.unref();
  }
}

tournamentSchema.pre("save", function (next) {
  if (this.ageRestriction) {
    this.ageRestriction.minAge = clampAge(this.ageRestriction.minAge);
    this.ageRestriction.maxAge = clampAge(this.ageRestriction.maxAge);
  }
  recomputeUTC(this);
  recomputeBirthYears(this);
  next();
});

tournamentSchema.pre("findOneAndUpdate", function (next) {
  const opts = this.getOptions?.() || {};
  this.setOptions({ ...opts, new: true, runValidators: true });

  const update = this.getUpdate() || {};
  const set = update.$set || {};
  if (set["ageRestriction.minAge"] !== undefined) {
    set["ageRestriction.minAge"] = clampAge(set["ageRestriction.minAge"]);
  }
  if (set["ageRestriction.maxAge"] !== undefined) {
    set["ageRestriction.maxAge"] = clampAge(set["ageRestriction.maxAge"]);
  }

  this.setUpdate({ ...update, $set: set });
  next();
});

tournamentSchema.post("findOneAndUpdate", async function (doc, next) {
  try {
    if (!doc) return next();
    recomputeUTC(doc);
    recomputeBirthYears(doc);
    await doc.save();
    next();
  } catch (e) {
    next(e);
  }
});

/* 🔁 NEW: đồng bộ sang Elasticsearch sau mỗi lần save (create / update) */
tournamentSchema.post("save", async function (doc) {
  scheduleTournamentPresentationCacheClear();
  // doc ở đây đã là document sau khi save xong
  await indexTournamentToES(doc);
});

/* 🔁 NEW: xoá khỏi Elasticsearch khi dùng findOneAndDelete */
tournamentSchema.post("findOneAndDelete", async function (doc) {
  if (!doc) return;
  scheduleTournamentPresentationCacheClear();
  await deleteTournamentFromES(doc._id);
});

/* ------------- Statics ------------- */
tournamentSchema.statics.clearDrawPlanIfNoBrackets = async function (
  tournamentId
) {
  if (!tournamentId) return;

  const BracketModel =
    mongoose.models.Bracket ||
    mongoose.models.TournamentBracket ||
    mongoose.models.Brackets ||
    null;

  if (!BracketModel) return;

  try {
    const count = await BracketModel.countDocuments({
      tournament: tournamentId,
    });
    if (count === 0) {
      await this.findByIdAndUpdate(
        tournamentId,
        { $set: { drawPlan: null } },
        { new: false }
      );
    }
  } catch (err) {
    if (err?.name === "MissingSchemaError") return;
    console.error("[Tournament] clearDrawPlanIfNoBrackets error:", err);
  }
};

tournamentSchema.statics.syncToSearch = async function (tournamentId) {
  if (!tournamentId) return;
  const doc = await this.findById(tournamentId);
  if (doc) {
    await indexTournamentToES(doc);
  }
};

tournamentSchema.statics.reindexAllToSearch = async function () {
  if (!ES_ENABLED) {
    console.log("[Tournament] reindexAllToSearch skipped because ES is disabled");
    return;
  }
  console.log("[Tournament] reindexAllToSearch START");

  const cursor = this.find().cursor();
  let count = 0;

  for await (const doc of cursor) {
    await indexTournamentToES(doc); // dùng helper đã  ở trên
    count++;
    if (count % 50 === 0) {
      console.log(`[Tournament] indexed ${count} tournaments...`);
    }
  }

  await es.indices.refresh({ index: ES_TOURNAMENT_INDEX });
  console.log(`[Tournament] reindexAllToSearch DONE, total = ${count}`);
};

/* ------------- Indexes ------------- */
tournamentSchema.index({ status: 1, endAt: 1 });
tournamentSchema.index({ status: 1, startAt: 1 });
// (optional) nếu sau này search theo toạ độ nhiều, bạn có thể thêm index:
// tournamentSchema.index({ "locationGeo.lat": 1, "locationGeo.lon": 1 });

tournamentSchema.set("toJSON", {
  transform(doc, ret) {
    const toLocalString = (field) => {
      if (!ret[field]) return;
      const val = ret[field];

      const d = val instanceof Date ? val : new Date(val);
      if (Number.isNaN(d.getTime())) return;

      // ✅ Parse Date như UTC, không convert timezone
      const dt = DateTime.fromJSDate(d, { zone: "UTC" });
      ret[field] = dt.toFormat("yyyy-LL-dd'T'HH:mm:ss");
    };

    toLocalString("regOpenDate");
    toLocalString("registrationDeadline");
    toLocalString("startDate");
    toLocalString("endDate");
    toLocalString("startAt");
    toLocalString("endAt");

    return ret;
  },
});

export default mongoose.model("Tournament", tournamentSchema);
