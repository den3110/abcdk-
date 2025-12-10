// models/User.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import UserLogin from "./userLoginModel.js"; // dùng để proxy recordLogin

const ALLOWED_SPORTS = ["pickleball"];

/* ---------- Signup meta (nền tảng đăng ký) ---------- */
const SignupDeviceSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["mobile", "tablet", "desktop", "unknown"],
      default: "unknown",
    },
    os: { type: String, default: "Unknown", trim: true },
    browser: { type: String, default: "Unknown", trim: true },
    model: { type: String, default: "", trim: true },
    ua: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const SignupWebSchema = new mongoose.Schema(
  {
    referer: { type: String, default: "", trim: true },
    origin: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const SignupIpSchema = new mongoose.Schema(
  {
    client: { type: String, default: "", trim: true },
    chain: { type: [String], default: [] },
  },
  { _id: false }
);

const SignupGeoSchema = new mongoose.Schema(
  {
    country: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    latitude: { type: String, default: "", trim: true }, // để string cho an toàn parse từ header CDN
    longitude: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const SignupMetaSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ["web", "app", "unknown"],
      default: "unknown",
    },
    appVersion: { type: String, default: "", trim: true },
    device: { type: SignupDeviceSchema, default: () => ({}) },
    web: { type: SignupWebSchema, default: () => ({}) },
    ip: { type: SignupIpSchema, default: () => ({}) },
    geo: { type: SignupGeoSchema, default: () => ({}) },
    registeredAt: { type: Date, default: Date.now }, // thời điểm ghi nhận meta
  },
  { _id: false }
);

/* ---------- Evaluator ---------- */
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

// ADD: phạm vi trọng tài theo giải
const RefereeScopeSchema = new mongoose.Schema(
  {
    // Danh sách giải được phép chấm
    tournaments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tournament" }],
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
    cover: { type: String, default: "" }, // 👈 ADD
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
    referee: { type: RefereeScopeSchema, default: () => ({ tournaments: [] }) },
    /* ------- Đăng ký: metadata nền tảng ------- */
    signupMeta: { type: SignupMetaSchema, default: () => ({}) },

    // soft delete
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletionReason: { type: String, default: "" },

    // reset password
    resetPasswordToken: { type: String, index: true },
    resetPasswordExpires: { type: Date },
    rankingSearchLimit: {
      type: Number,
      default: null, // null = dùng default 5
    },
    rankingSearchUnlimited: {
      type: Boolean,
      default: false, // true = không giới hạn khi đăng nhập
    },

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

/* ---------- Validate logic cho evaluator & signupMeta ---------- */
userSchema.pre("validate", function (next) {
  // Evaluator validation (giữ nguyên)
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

  // ADD: chuẩn hoá referee.tournaments (lọc rỗng, dedupe, ép ObjectId)
  if (this.referee && Array.isArray(this.referee.tournaments)) {
    const ids = this.referee.tournaments
      .map((x) => (mongoose.Types.ObjectId.isValid(x) ? String(x) : ""))
      .filter(Boolean);
    const uniq = Array.from(new Set(ids));
    this.referee.tournaments = uniq.map((s) => new mongoose.Types.ObjectId(s));
  }

  // Signup meta normalization
  if (this.signupMeta) {
    // platform
    const allowedPlatforms = ["web", "app", "unknown"];
    if (!allowedPlatforms.includes(this.signupMeta.platform)) {
      this.signupMeta.platform = "unknown";
    }

    // device.type
    const dt = this.signupMeta.device?.type;
    const allowedTypes = ["mobile", "tablet", "desktop", "unknown"];
    if (!allowedTypes.includes(dt)) {
      this.signupMeta.device = this.signupMeta.device || {};
      this.signupMeta.device.type = "unknown";
    }

    // cap độ dài UA để tránh document quá lớn (tuỳ chọn)
    if (this.signupMeta.device?.ua && this.signupMeta.device.ua.length > 1024) {
      this.signupMeta.device.ua = this.signupMeta.device.ua.slice(0, 1024);
    }

    // unique + lọc trống cho ip.chain
    if (Array.isArray(this.signupMeta.ip?.chain)) {
      const uniq = Array.from(
        new Set(
          this.signupMeta.ip.chain
            .map((s) => String(s || "").trim())
            .filter(Boolean)
        )
      );
      this.signupMeta.ip.chain = uniq.slice(0, 20); // cắt bớt nếu chuỗi quá dài
    }
  }

  next();
});

userSchema.post("save", async function (doc, next) {
  try {
    // Chỉ xử lý khi user mới tạo
    if (!doc.isNew) return next();

    // Dùng upsert cho idempotent (tránh trùng)
    await UserRadar.updateOne(
      { user: doc._id },
      {
        $setOnInsert: {
          user: doc._id,
          // có thể set một số default khác nếu muốn
          radarSettings: {
            enabled: false,
            radiusKm: 5,
            preferredPlayType: "any",
            preferredGender: "any",
          },
        },
      },
      { upsert: true }
    );

    return next();
  } catch (err) {
    console.error(
      "[User.post(save)] Failed to create UserRadar for user",
      doc._id,
      err.message
    );
    // tuỳ bạn: nếu không muốn chặn signup thì vẫn cho next()
    return next(); // hoặc next(err) nếu muốn fail cứng
  }
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

// ADD: check trọng tài được chấm giải nào
userSchema.methods.isRefereeForTournament = function (tournamentId) {
  if (this.role === "admin") return true; // admin full quyền
  if (this.role !== "referee") return false;
  if (!tournamentId) return false;
  const tid = String(tournamentId);
  return (this.referee?.tournaments || []).some((t) => String(t) === tid);
};

// (tuỳ chọn) Tìm danh sách trọng tài của 1 giải
userSchema.statics.findRefereesForTournament = function (tournamentId) {
  if (!mongoose.Types.ObjectId.isValid(tournamentId))
    return Promise.resolve([]);
  return this.find({
    isDeleted: { $ne: true },
    role: "referee",
    "referee.tournaments": tournamentId,
  }).select("name nickname fullName email province");
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

// 👇 Index phục vụ thống kê/loc đăng ký
userSchema.index(
  { "signupMeta.platform": 1, createdAt: -1 },
  { name: "idx_signup_platform" }
);
userSchema.index(
  { "signupMeta.ip.client": 1, createdAt: -1 },
  { name: "idx_signup_ip" }
);
userSchema.index({ lastKnownLocation: "2dsphere" });

export default mongoose.model("User", userSchema);
