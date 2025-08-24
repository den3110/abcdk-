import mongoose from "mongoose";
import Tournament from "./tournamentModel.js";

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

const registrationSchema = new mongoose.Schema(
  {
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
    next();
  } catch (e) {
    next(e);
  }
});

registrationSchema.index({ tournament: 1 });
registrationSchema.index({ "player1.phone": 1 });
registrationSchema.index({ "player2.phone": 1 });
registrationSchema.index({ "player1.user": 1 });
registrationSchema.index({ "player2.user": 1 });

// hữu ích khi lọc theo tournament + user
registrationSchema.index({ tournament: 1, "player1.user": 1 });
registrationSchema.index({ tournament: 1, "player2.user": 1 });

/* ======================= Statics (helpers) ======================= */
/**
 * Kiểm tra user đã từng tham gia giải đấu nào (ở bất kỳ vai trò player1/2) chưa.
 * @param {mongoose.Types.ObjectId|string} userId
 * @param {{ tournament?: string|ObjectId, requirePaid?: boolean, requireCheckin?: boolean }} opts
 * @returns {Promise<boolean>}
 */
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

/**
 * Đếm số lần tham gia (hữu ích cho thống kê/huy hiệu).
 * @param {mongoose.Types.ObjectId|string} userId
 * @param {{ tournament?: string|ObjectId, requirePaid?: boolean, requireCheckin?: boolean }} opts
 * @returns {Promise<number>}
 */
registrationSchema.statics.countParticipations = async function (userId, opts = {}) {
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

const Registration = mongoose.model("Registration", registrationSchema);
export default Registration;

