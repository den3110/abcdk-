// models/User.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import UserLogin from "./userLoginModel.js"; // dùng để proxy recordLogin

const ALLOWED_SPORTS = ["pickleball", "tennis"];

const EvaluatorSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    gradingScopes: {
      provinces: { type: [String], default: [] },
      sports: { type: [String], enum: ALLOWED_SPORTS, default: ["pickleball"] },
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    /* ------- Thông tin cơ bản ------- */
    name: { type: String, trim: true },
    nickname: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      required() {
        return this.role === "user";
      },
    },
    phone: { type: String, unique: true, sparse: true, trim: true },
    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },
    password: { type: String, required: true },
    dob: { type: Date },

    /* ------- Avatar + giới thiệu ------- */
    avatar: { type: String, default: "" },
    bio: { type: String, default: "" },

    /* ------- Thông tin phụ ------- */
    gender: {
      type: String,
      enum: ["male", "female", "unspecified", "other"],
      default: "unspecified",
    },
    province: { type: String, default: "" },

    /* ------- Xác thực & điểm ------- */
    verified: {
      type: String,
      enum: ["pending", "verified"],
      default: "pending",
    },
    cccd: {
      type: String,
      unique: true,
      sparse: true,
      match: /^\d{12}$/,
      trim: true,
    },
    cccdImages: {
      front: { type: String, default: "" },
      back: { type: String, default: "" },
    },
    cccdStatus: {
      type: String,
      enum: ["unverified", "pending", "verified", "rejected"],
      default: "unverified",
    },

    /* ------- Quyền chính ------- */
    role: { type: String, enum: ["user", "referee", "admin"], default: "user" },

    /* ------- Năng lực chấm trình ------- */
    evaluator: { type: EvaluatorSchema, default: () => ({}) },

    // soft delete
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletionReason: { type: String, default: "" },

    // reset password
    resetPasswordToken: { type: String, index: true },
    resetPasswordExpires: { type: Date },

    /* ------- (ĐÃ BỎ) Login tracking ra model riêng ------- */
    // lastLoginAt: { type: Date }
    // loginHistory: [...]
  },
  { timestamps: true, strict: true }
);

/* ---------- Bcrypt helpers ---------- */
userSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password);
};
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, await bcrypt.genSalt(10));
  next();
});

/* ---------- Validate logic cho evaluator ---------- */
userSchema.pre("validate", function (next) {
  if (this.role !== "admin" && this.evaluator?.enabled) {
    const provinces = Array.from(
      new Set(
        (this.evaluator.gradingScopes?.provinces || []).map((s) =>
          String(s || "").trim()
        )
      )
    ).filter(Boolean);
    if (provinces.length === 0) {
      return next(
        new Error(
          "Evaluator phải có ít nhất 1 tỉnh trong gradingScopes.provinces"
        )
      );
    }
    this.evaluator.gradingScopes.provinces = provinces;

    const sports = Array.from(
      new Set(this.evaluator.gradingScopes?.sports || [])
    );
    const invalid = sports.filter((s) => !ALLOWED_SPORTS.includes(s));
    if (invalid.length)
      return next(new Error(`Môn không hợp lệ: ${invalid.join(", ")}`));
    this.evaluator.gradingScopes.sports = sports.length
      ? sports
      : ["pickleball"];
  }
  next();
});

/* ---------- Helper methods ---------- */
userSchema.methods.isEvaluator = function () {
  return this.role === "admin" || !!this.evaluator?.enabled;
};
userSchema.methods.canGradeProvince = function (province) {
  if (this.role === "admin") return true;
  if (!this.isEvaluator()) return false;
  const p = String(province || "").trim();
  return !!p && this.evaluator?.gradingScopes?.provinces?.includes(p);
};
userSchema.methods.canGradeUser = function (targetUserOrProvince) {
  const province =
    typeof targetUserOrProvince === "string"
      ? targetUserOrProvince
      : targetUserOrProvince?.province;
  return this.canGradeProvince(province);
};
userSchema.statics.findEvaluatorsForProvince = function (province) {
  const p = String(province || "").trim();
  if (!p) return Promise.resolve([]);
  return this.find({
    isDeleted: { $ne: true },
    $or: [
      { role: "admin" },
      { "evaluator.enabled": true, "evaluator.gradingScopes.provinces": p },
    ],
  });
};

/* ---------- NEW: virtual populate loginMeta ---------- */
userSchema.virtual("loginMeta", {
  ref: "UserLogin",
  localField: "_id",
  foreignField: "user",
  justOne: true,
});

/* ---------- NEW: proxy recordLogin để không phải sửa code chỗ khác ---------- */
userSchema.statics.recordLogin = function (userId, args = {}) {
  return UserLogin.recordLogin(userId, args);
};

/* ---------- Ratings giữ nguyên ---------- */
const RatingSchema = new mongoose.Schema(
  {
    singles: { type: Number, default: 2.5 },
    doubles: { type: Number, default: 2.5 },
    matchesSingles: { type: Number, default: 0 },
    matchesDoubles: { type: Number, default: 0 },
    reliabilitySingles: { type: Number, default: 0 },
    reliabilityDoubles: { type: Number, default: 0 },
    minBound: { type: Number, default: 2.0 },
    maxBound: { type: Number, default: 8.0 },
  },
  { _id: false }
);
userSchema.add({ localRatings: { type: RatingSchema, default: () => ({}) } });

/* ---------- Index ---------- */
userSchema.index(
  { nickname: 1 },
  { name: "idx_nickname_vi", collation: { locale: "vi", strength: 1 } }
);
userSchema.index(
  { name: 1 },
  { name: "idx_name_vi", collation: { locale: "vi", strength: 1 } }
);
userSchema.index(
  { province: 1 },
  { name: "idx_province_vi", collation: { locale: "vi", strength: 1 } }
);
userSchema.index({ cccdStatus: 1, updatedAt: -1 });
userSchema.index({ "evaluator.enabled": 1 }, { name: "idx_eval_enabled" });
userSchema.index(
  { "evaluator.gradingScopes.provinces": 1 },
  { name: "idx_eval_province" }
);
userSchema.index({ role: 1 }, { name: "idx_role" });

/* ---------- (ĐÃ BỎ) index login khỏi User ----------
userSchema.index({ lastLoginAt: -1 }, { name: "idx_last_login" });
userSchema.index({ "loginHistory.at": -1 }, { name: "idx_login_at" });
*/

export default mongoose.model("User", userSchema);
