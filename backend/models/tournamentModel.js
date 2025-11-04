// models/tournamentModel.js
import mongoose from "mongoose";
import { DateTime } from "luxon";
import DrawSettingsSchema from "./drawSettingsSchema.js";

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
    // Tự tính theo startDate + timezone
    minBirthYear: { type: Number, default: null },
    maxBirthYear: { type: Number, default: null },
  },
  { _id: false }
);

/* ------------- Main schema ------------ */
const tournamentSchema = new mongoose.Schema(
  {
    /* Thông tin cơ bản */
    name: { type: String, required: true },
    image: { type: String, default: null, required: true },
    sportType: { type: Number, required: true }, // 1 Pickleball, 2 Tennis …
    groupId: { type: Number, default: 0 },

    /* Cấu hình đăng ký & giới hạn điểm */
    regOpenDate: { type: Date, required: true, default: Date.now },
    registrationDeadline: { type: Date, required: true, default: Date.now },
    startDate: { type: Date, required: true, default: Date.now },
    endDate: { type: Date, required: true, default: Date.now },
    eventType: { type: String, enum: ["single", "double"], default: "double" },
    scoreCap: { type: Number, required: true, default: 0 },
    scoreGap: { type: Number, required: true, default: 0 },
    singleCap: { type: Number, required: true, default: 0 },
    maxPairs: { type: Number, default: 0, min: 0 },

    /* Trạng thái & mô tả */
    status: {
      type: String,
      enum: ["upcoming", "ongoing", "finished"],
      default: "upcoming",
    },
    finishedAt: { type: Date, default: null },
    location: { type: String, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    contactHtml: { type: String, default: "" },
    contentHtml: { type: String, default: "" },
    timezone: { type: String, default: "Asia/Ho_Chi_Minh" },

    // Mốc chuẩn UTC (quy đổi từ startDate/endDate + timezone)
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },

    // Tuỳ biến draw/overlay
    drawSettings: { type: DrawSettingsSchema, default: () => ({}) },
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

    // Điểm trình toàn giải
    noRankDelta: { type: Boolean, default: false },

    // Phạm vi giải (đa tỉnh)
    scoringScope: {
      type: {
        type: String,
        enum: ["national", "provinces"],
        default: "national",
      },
      provinces: { type: [String], default: [] },
    },

    // Thanh toán (SePay VietQR)
    bankShortName: { type: String, trim: true, default: "" }, // ví dụ: "Vietcombank"
    bankAccountNumber: {
      type: String,
      default: "",
      set: (v) => String(v || "").replace(/\D/g, ""), // chỉ giữ số
      validate: {
        validator: (v) => v === "" || /^\d{4,32}$/.test(v),
        message: "bankAccountNumber phải là 4–32 chữ số.",
      },
    },
    bankAccountName: { type: String, trim: true, default: "", maxlength: 64 },
    registrationFee: { type: Number, default: 0, min: 0 }, // VND

    // Liên kết Telegram
    tele: TeleSchema,

    /* Điều kiện tham gia */
    requireKyc: { type: Boolean, default: true },
    ageRestriction: { type: AgeRestrictionSchema, default: () => ({}) },

    /* Thống kê */
    expected: { type: Number, default: 0 },
    matchesCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/* ------------- Helpers ------------- */
function clampAge(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

// chuẩn hóa mốc UTC theo timezone
function recomputeUTC(doc) {
  const tz = doc.timezone || "Asia/Ho_Chi_Minh";
  if (doc.startDate) {
    const s = DateTime.fromJSDate(doc.startDate).setZone(tz).toUTC();
    doc.startAt = s.toJSDate();
  }
  if (doc.endDate) {
    const e = DateTime.fromJSDate(doc.endDate).setZone(tz).toUTC();
    doc.endAt = e.toJSDate();
  }
}

// tính lại năm sinh min/max dựa theo startDate + timezone
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
    minBirthYear: year - maxAge, // tuổi lớn → năm sinh nhỏ hơn
    maxBirthYear: year - minAge, // tuổi nhỏ → năm sinh lớn hơn
  };
}

/* ------------- Hooks ------------- */
tournamentSchema.pre("save", function (next) {
  // clamp tuổi trước khi lưu
  if (this.ageRestriction) {
    this.ageRestriction.minAge = clampAge(this.ageRestriction.minAge);
    this.ageRestriction.maxAge = clampAge(this.ageRestriction.maxAge);
  }
  recomputeUTC(this);
  recomputeBirthYears(this);
  next();
});

tournamentSchema.pre("findOneAndUpdate", function (next) {
  // bật validators + trả doc mới sau update
  const opts = this.getOptions?.() || {};
  this.setOptions({ ...opts, new: true, runValidators: true });

  // clamp nếu client set trực tiếp qua $set
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
    await doc.save(); // lưu lại thay đổi min/maxBirthYear & startAt/endAt
    next();
  } catch (e) {
    next(e);
  }
});

/* ------------- Indexes ------------- */
tournamentSchema.index({ status: 1, endAt: 1 });
tournamentSchema.index({ status: 1, startAt: 1 });

export default mongoose.model("Tournament", tournamentSchema);
