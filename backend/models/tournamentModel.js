import mongoose from "mongoose";
import { DateTime } from "luxon";
import DrawSettingsSchema from "./drawSettingsSchema.js";

const TeleSchema = new mongoose.Schema(
  {
    hubChatId: { type: String },
    topicId: { type: Number },
    inviteLink: { type: String },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const tournamentSchema = new mongoose.Schema(
  {
    /* Thông tin cơ bản */
    name: { type: String, required: true },
    image: { type: String, default: null, required: true },
    sportType: { type: Number, required: true }, // 1 Pickleball, 2 Tennis …
    groupId: { type: Number, default: 0 },

    /* Cấu hình đăng ký & giới hạn điểm */
    regOpenDate: { type: Date, required: true, default: Date.now },
    maxPairs: { type: Number, default: 0, min: 0 },
    registrationDeadline: { type: Date, required: true, default: Date.now },
    startDate: { type: Date, required: true, default: Date.now },
    endDate: { type: Date, required: true, default: Date.now },
    eventType: { type: String, enum: ["single", "double"], default: "double" },
    scoreCap: { type: Number, required: true, default: 0 },
    scoreGap: { type: Number, required: true, default: 0 },
    singleCap: { type: Number, required: true, default: 0 },

    /* Thống kê */
    expected: { type: Number, default: 0 },
    matchesCount: { type: Number, default: 0 },

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

    // === NEW: override theo từng giải ===
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

    noRankDelta: { type: Boolean, default: false },

    scoringScope: {
      type: {
        type: String,
        enum: ["national", "provinces"],
        default: "national",
      },
      provinces: { type: [String], default: [] },
    },

    // ===== NEW: Thông tin thanh toán (SePay VietQR compatible) =====
    bankShortName: { type: String, trim: true, default: "" }, // ví dụ: "Vietcombank", "MBBank"
    bankAccountNumber: {
      type: String,
      default: "",
      set: (v) => String(v || "").replace(/\D/g, ""), // chỉ giữ digits
      validate: {
        validator: (v) => v === "" || /^\d{4,32}$/.test(v),
        message: "bankAccountNumber phải là 4–32 chữ số.",
      },
    },
    bankAccountName: { type: String, trim: true, default: "", maxlength: 64 },
    registrationFee: { type: Number, default: 0, min: 0 }, // VND

    tele: TeleSchema,
  },
  { timestamps: true }
);

// helper chuẩn hóa mốc UTC từ field + timezone
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

tournamentSchema.pre("save", function (next) {
  recomputeUTC(this);
  next();
});

// khi update bằng findOneAndUpdate
tournamentSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate() || {};

  // ✅ luôn bật runValidators để validate bank fields khi update
  const currentOpts = this.getOptions ? this.getOptions() : {};
  this.setOptions({ ...currentOpts, new: true, runValidators: true });

  // nếu đổi timezone hoặc mốc thời gian → sau update sẽ recompute
  if (
    update.$set?.timezone ||
    update.$set?.endDate ||
    update.$set?.startDate ||
    update.timezone ||
    update.endDate ||
    update.startDate
  ) {
    // đã set new: true ở trên
  }
  next();
});

tournamentSchema.post("findOneAndUpdate", async function (doc, next) {
  try {
    if (!doc) return next();
    recomputeUTC(doc);
    await doc.save();
    next();
  } catch (e) {
    next(e);
  }
});

tournamentSchema.index({ status: 1, endAt: 1 });
tournamentSchema.index({ status: 1, startAt: 1 });

// 👇 virtual populate: các manager của giải đấu
// tournamentSchema.virtual('managers', {
//   ref: 'TournamentManager',
//   localField: '_id',
//   foreignField: 'tournament',
//   justOne: false,
// });

export default mongoose.model("Tournament", tournamentSchema);
