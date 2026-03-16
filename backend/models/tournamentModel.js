import mongoose from "mongoose";
import { DateTime } from "luxon";
import DrawSettingsSchema from "./drawSettingsSchema.js";
import { es, ES_TOURNAMENT_INDEX } from "../services/esClient.js";

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
    sportType: { type: Number, required: true },
    groupId: { type: Number, default: 0 },

    regOpenDate: { type: Date, required: true, default: Date.now },
    registrationDeadline: { type: Date, required: true, default: Date.now },
    startDate: { type: Date, required: true, default: Date.now },
    endDate: { type: Date, required: true, default: Date.now },
    eventType: { type: String, enum: ["single", "double"], default: "double" },
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
      customCss: { type: String, default: "" },
      logoUrl: { type: String, default: "" },
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

    tele: TeleSchema,

    requireKyc: { type: Boolean, default: true },
    ageRestriction: { type: AgeRestrictionSchema, default: () => ({}) },

    expected: { type: Number, default: 0 },
    matchesCount: { type: Number, default: 0 },

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
  if (!doc?._id) return;
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
  if (!id) return;
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
  // doc ở đây đã là document sau khi save xong
  await indexTournamentToES(doc);
});

/* 🔁 NEW: xoá khỏi Elasticsearch khi dùng findOneAndDelete */
tournamentSchema.post("findOneAndDelete", async function (doc) {
  if (!doc) return;
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
