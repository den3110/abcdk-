// models/User.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const ALLOWED_SPORTS = ["pickleball", "tennis"];

const EvaluatorSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    gradingScopes: {
      provinces: { type: [String], default: [] },
      sports: {
        type: [String],
        enum: ALLOWED_SPORTS,
        default: ["pickleball"],
      },
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    /* ------- Thông tin cơ bản ------- */
    name: { type: String, required: true, trim: true },

    nickname: {
      type: String,
      trim: true,
      required() {
        return this.role === "user"; // chỉ user thường mới bắt buộc
      },
    },

    phone: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      required() {
        return this.role === "user";
      },
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    password: { type: String, required: true },

    dob: {
      type: Date,
      required() {
        return this.role === "user";
      },
    },

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
    role: {
      type: String,
      enum: ["user", "referee", "admin"], // ❌ bỏ 'evaluator' khỏi role
      default: "user",
    },

    /* ------- Năng lực chấm trình (có/không) ------- */
    evaluator: { type: EvaluatorSchema, default: () => ({}) },
  },
  { timestamps: true, strict: true }
);

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

// cho trang evaluator
userSchema.index({ "evaluator.enabled": 1 }, { name: "idx_eval_enabled" });
userSchema.index(
  { "evaluator.gradingScopes.provinces": 1 },
  { name: "idx_eval_province" }
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
  if (this.evaluator?.enabled) {
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
    const invalid = sports.filter((s) => !["pickleball", "tennis"].includes(s));
    if (invalid.length) {
      return next(new Error(`Môn không hợp lệ: ${invalid.join(", ")}`));
    }
    this.evaluator.gradingScopes.sports = sports.length
      ? sports
      : ["pickleball"];
  }
  next();
});

/* ---------- Helper methods ---------- */
userSchema.methods.isEvaluator = function () {
  return !!this.evaluator?.enabled;
};
userSchema.methods.canGradeProvince = function (province) {
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
    "evaluator.enabled": true,
    "evaluator.gradingScopes.provinces": p,
  });
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

export default mongoose.model("User", userSchema);
