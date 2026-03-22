// models/registrationModel.js
import mongoose from "mongoose";
import Tournament from "./tournamentModel.js";

/* ========= Atomic counter (global) cho mã đăng ký ========= */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // ví dụ: 'registration_code'
    seq: { type: Number, required: true, default: 0 },
  },
  { collection: "counters" }
);

// tránh recompile model khi hot-reload
const Counter =
  mongoose.models.Counter || mongoose.model("Counter", counterSchema);

/**
 * Lấy mã đăng ký tiếp theo (atomic, không trùng).
 * Bắt đầu từ 10000 (5 chữ số), khi vượt 99999 tự nhiên lên 6 chữ số (100000), v.v.
 */
async function getNextRegistrationCode() {
  try {
    // ✅ Cách 1: aggregation pipeline update -> không còn xung đột path
    const doc = await Counter.findOneAndUpdate(
      { _id: "registration_code" },
      [
        {
          $set: {
            // seq = (seq ?? 9999) + 1  -> lần đầu ra 10000
            seq: { $add: [{ $ifNull: ["$seq", 9999] }, 1] },
          },
        },
      ],
      { new: true, upsert: true }
    ).lean();

    return doc.seq; // 10000, 10001, ...
  } catch (err) {
    // 🔁 Fallback (MongoDB quá cũ không hỗ trợ pipeline update):
    // Tách làm 2 bước vẫn an toàn với _id cố định.
    await Counter.updateOne(
      { _id: "registration_code" },
      { $setOnInsert: { seq: 9999 } },
      { upsert: true }
    );
    const doc = await Counter.findOneAndUpdate(
      { _id: "registration_code" },
      { $inc: { seq: 1 } },
      { new: true }
    ).lean();
    return doc.seq;
  }
}

/* ======================= Player subdoc ======================= */
const playerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    phone: { type: String, required: true },
    fullName: { type: String, required: true },
    nickName: { type: String },
    avatar: { type: String },
    score: { type: Number, required: true, default: 0 }, // Skill score locked at registration time
  },
  { _id: false }
);

/* ======================= Registration ======================= */
const registrationSchema = new mongoose.Schema(
  {
    // 🔢 Mã đăng ký tự tăng, duy nhất toàn hệ thống
    code: { type: Number },

    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    player1: { type: playerSchema, required: true },
    player2: { type: playerSchema, required: false, default: null },
    message: { type: String },

    payment: {
      status: {
        type: String,
        enum: ["Unpaid", "Paid"],
        default: "Unpaid",
      },
      paidAt: { type: Date },
    },

    checkinAt: { type: Date },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true }
);

/* ======================= Virtuals ======================= */
registrationSchema.virtual("users").get(function () {
  const ids = [];
  if (this.player1?.user) ids.push(this.player1.user);
  if (this.player2?.user) ids.push(this.player2.user);
  return ids;
});

/* ======================= Hooks ======================= */
// ✅ validate theo loại giải
registrationSchema.pre("validate", async function (next) {
  try {
    const tour = await Tournament.findById(this.tournament).select("eventType");
    if (!tour) return next(new Error("Tournament not found"));

    if (tour.eventType === "single") {
      // singles: player2 phải null
      this.player2 = null;
    } else {
      // doubles: bắt buộc có player2
      if (!this.player2 || !this.player2.fullName) {
        return next(new Error("Doubles requires two players"));
      }
    }

    // 🔢 Tạo mã đăng ký nếu chưa có (áp dụng cho cả tài liệu cũ khi được update lại)
    if (this.isNew && this.code == null) {
      this.code = await getNextRegistrationCode();
    }
    next();
  } catch (e) {
    next(e);
  }
});

// 🔢 insertMany: đảm bảo mọi doc đều có code khi tạo hàng loạt
registrationSchema.pre("insertMany", async function (next, docs) {
  try {
    for (const d of docs) {
      if (d.code == null) {
        // tuần tự để đảm bảo thứ tự & không đụng nhau
        // eslint-disable-next-line no-await-in-loop
        d.code = await getNextRegistrationCode();
      }
    }
    next();
  } catch (e) {
    next(e);
  }
});

/* ======================= Indexes ======================= */
registrationSchema.index({ tournament: 1 });
registrationSchema.index({ "player1.phone": 1 });
registrationSchema.index({ "player2.phone": 1 });
registrationSchema.index({ "player1.user": 1 });
registrationSchema.index({ "player2.user": 1 });

// hữu ích khi lọc theo tournament + user
registrationSchema.index({ tournament: 1, "player1.user": 1 });
registrationSchema.index({ tournament: 1, "player2.user": 1 });

// 🔢 Đảm bảo duy nhất cho code, cho phép doc cũ thiếu code (sparse)
registrationSchema.index({ code: 1 }, { unique: true, sparse: true });

/* ======================= Statics (helpers) ======================= */
registrationSchema.statics.hasParticipated = async function (userId, opts = {}) {
  if (!userId) return false;
  const { tournament, requirePaid = false, requireCheckin = false } = opts;

  const filter = {
    $or: [{ "player1.user": userId }, { "player2.user": userId }],
  };
  if (tournament) filter.tournament = tournament;
  if (requirePaid) filter["payment.status"] = "Paid";
  if (requireCheckin) filter.checkinAt = { $ne: null };

  const exists = await this.exists(filter);
  return !!exists;
};

registrationSchema.statics.countParticipations = async function (
  userId,
  opts = {}
) {
  if (!userId) return 0;
  const { tournament, requirePaid = false, requireCheckin = false } = opts;

  const filter = {
    $or: [{ "player1.user": userId }, { "player2.user": userId }],
  };
  if (tournament) filter.tournament = tournament;
  if (requirePaid) filter["payment.status"] = "Paid";
  if (requireCheckin) filter.checkinAt = { $ne: null };

  return this.countDocuments(filter);
};

/**
 * 🔧 Backfill code cho các bản ghi cũ chưa có mã (tuỳ chọn chạy thủ công).
 * Ví dụ: await Registration.backfillCodes(1000) // backfill tối đa 1000 bản ghi
 */
registrationSchema.statics.backfillCodes = async function (limit = 1000) {
  const docs = await this.find({
    $or: [{ code: { $exists: false } }, { code: null }],
  })
    .select("_id code")
    .limit(limit);

  for (const doc of docs) {
    // eslint-disable-next-line no-await-in-loop
    doc.code = await getNextRegistrationCode();
    // eslint-disable-next-line no-await-in-loop
    await doc.save();
  }
  return docs.length;
};

const Registration =
  mongoose.models.Registration ||
  mongoose.model("Registration", registrationSchema);

export default Registration;
