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
  { _id: false },
);

const SignupWebSchema = new mongoose.Schema(
  {
    referer: { type: String, default: "", trim: true },
    origin: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const otpStateSchema = new mongoose.Schema(
  {
    hash: { type: String, default: "" },
    expiresAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: null },
    // trong registerOtpSchema
    tranId: { type: String, default: "" },
    cost: { type: Number, default: 0 },
  },
  { _id: false },
);

const SignupIpSchema = new mongoose.Schema(
  {
    client: { type: String, default: "", trim: true },
    chain: { type: [String], default: [] },
  },
  { _id: false },
);

const SignupGeoSchema = new mongoose.Schema(
  {
    country: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    latitude: { type: String, default: "", trim: true }, // để string cho an toàn parse từ header CDN
    longitude: { type: String, default: "", trim: true },
  },
  { _id: false },
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
  { _id: false },
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
  { _id: false },
);

// ADD: phạm vi trọng tài theo giải
const RefereeScopeSchema = new mongoose.Schema(
  {
    // Danh sách giải được phép chấm
    tournaments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tournament" }],
  },
  { _id: false },
);

const AvatarOptimizationSchema = new mongoose.Schema(
  {
    done: { type: Boolean, default: false },
    optimizedFor: { type: String, default: "" },
    optimizedAt: { type: Date, default: null },
  },
  { _id: false },
);

const PikoraBotPreferenceSchema = new mongoose.Schema(
  {
    assistantMode: {
      type: String,
      enum: ["balanced", "operator", "analyst", ""],
      default: "",
    },
    verificationMode: {
      type: String,
      enum: ["balanced", "strict", ""],
      default: "",
    },
    reasoningMode: {
      type: String,
      enum: ["auto", "force_reasoner", ""],
      default: "",
    },
    answerDensity: {
      type: String,
      enum: ["balanced", "compact_operator", ""],
      default: "",
    },
    suggestionStyle: {
      type: String,
      enum: ["default", "operator_first", ""],
      default: "",
    },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

const PikoraUiPreferenceSchema = new mongoose.Schema(
  {
    scopeKey: { type: String, default: "" },
    pageType: { type: String, default: "" },
    pageSection: { type: String, default: "" },
    pageView: { type: String, default: "" },
    path: { type: String, default: "" },
    activeLabels: { type: [String], default: [] },
    filters: { type: [String], default: [] },
    sort: { type: String, default: "" },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

const PikoraFormDraftSchema = new mongoose.Schema(
  {
    draftKey: { type: String, default: "" },
    title: { type: String, default: "" },
    pageType: { type: String, default: "" },
    pageSection: { type: String, default: "" },
    pageView: { type: String, default: "" },
    path: { type: String, default: "" },
    data: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

/* ---------- Hiệu ứng tên hiển thị (cosmetic — admin cấu hình, hiện khắp app) ---------- */
const NameStyleSchema = new mongoose.Schema(
  {
    // "none" = tên thường; "solid" = 1 màu; "gradient" = nhiều màu (>=2, gồm cầu vồng)
    effect: {
      type: String,
      enum: ["none", "solid", "gradient"],
      default: "none",
    },
    color: { type: String, default: "" }, // dùng cho solid (hex)
    colors: { type: [String], default: [] }, // dùng cho gradient (2..7 hex)
    angle: { type: Number, default: 90 }, // góc gradient (deg)
    animated: { type: Boolean, default: false }, // shimmer / cầu vồng động
    speed: { type: Number, default: 6 }, // thời lượng 1 vòng animation (giây)
    bold: { type: Boolean, default: false }, // in đậm
  },
  { _id: false },
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
    // Lần gần nhất user đổi nickname — dùng cho rate-limit (SystemSettings.profile.nicknameChangeCooldownDays).
    nicknameChangedAt: { type: Date, default: null },
    phone: { type: String, unique: true, sparse: true, trim: true },
    phoneVerified: { type: Boolean, default: false },
    phoneVerifiedAt: { type: Date, default: null },
    // Admin buộc RIÊNG tài khoản này phải xác minh SĐT (Zalo) mới dùng tiếp.
    phoneVerificationRequired: { type: Boolean, default: false, index: true },
    phoneVerificationRequiredAt: { type: Date, default: null },
    phoneVerificationRequiredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    phoneVerificationRequiredReason: { type: String, default: "", trim: true },

    registerOtp: { type: otpStateSchema, default: () => ({}) },
    loginOtp: { type: otpStateSchema, default: () => ({}) }, // ✅ NEW: riêng cho đăng nhập
    // Kích hoạt/đổi SĐT cho tài khoản đã đăng nhập (OTP qua Zalo ZNS)
    activateOtp: { type: otpStateSchema, default: () => ({}) },
    // SĐT mới đang chờ xác thực (khi user đổi số để kích hoạt)
    activatePendingPhone: { type: String, default: "", trim: true },
    // trong userSchema fields
    loginOtpVerifiedAt: { type: Date, default: null }, // ✅ lần gần nhất login thành công qua OTP
    // ✅ ADD: thời hạn bypass OTP (lưu DB để xem log)
    loginOtpBypassUntil: { type: Date, default: null },
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
    // Uy tín người bán trên Chợ (denormalized từ SellerReview)
    marketRatingAvg: { type: Number, default: 0 },
    marketRatingCount: { type: Number, default: 0 },
    avatarOptimization: {
      type: AvatarOptimizationSchema,
      default: () => ({}),
    },
    assistantPreferences: {
      bot: {
        type: PikoraBotPreferenceSchema,
        default: () => ({}),
      },
      ui: {
        type: Map,
        of: PikoraUiPreferenceSchema,
        default: () => new Map(),
      },
      formDrafts: {
        type: Map,
        of: PikoraFormDraftSchema,
        default: () => new Map(),
      },
    },
    cover: { type: String, default: "" }, // 👈 ADD
    bio: { type: String, default: "" },
    // Hiệu ứng màu/chuyển sắc cho tên hiển thị (admin cấu hình, hiện khắp web+app)
    nameStyle: { type: NameStyleSchema, default: () => ({}) },

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
      trim: true,

      // ✅ cho phép: undefined/null hoặc đúng 12 số
      validate: {
        validator: function (v) {
          if (v === undefined || v === null) return true;
          if (typeof v !== "string") return false;
          const s = v.trim();
          if (s === "") return true; // ✅ tạm thời cho "" hợp lệ (nhưng bên dưới mình sẽ normalize thành undefined)
          return /^\d{12}$/.test(s);
        },
        message: "CCCD phải gồm đúng 12 chữ số",
      },
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

    isTempAccount: {
      type: Boolean,
      default: false,
      index: true,
    },
    tempAccountMeta: {
      source: { type: String, default: "" },
      createdForTournament: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Tournament",
        default: null,
      },
      originalPhone: { type: String, default: "" },
      originalEmail: { type: String, default: "" },
    },

    /* ------- Quyền chính ------- */
    role: {
      type: String,
      enum: ["user", "referee", "courtOwner", "admin"],
      default: "user",
      index: true,
    },
    // ✅ Cờ huấn luyện viên — có thể co-exist với admin/referee/user (không phải role
    // exclusive). Bật/tắt độc lập từ admin panel.
    isCoach: {
      type: Boolean,
      default: false,
      index: true,
    },
    // ✅ Super user – quyền cao nhất, thường dùng cho owner hệ thống
    isSuperUser: {
      type: Boolean,
      default: false,
      index: true,
    },
    /* ------- Năng lực chấm trình ------- */
    evaluator: { type: EvaluatorSchema, default: () => ({}) },
    referee: { type: RefereeScopeSchema, default: () => ({ tournaments: [] }) },
    /* ------- Huấn luyện viên ------- */
    // Chỉ có ý nghĩa khi role === "coach". User bình thường bỏ qua khối này.
    coachProfile: {
      headline: { type: String, default: "", maxlength: 120 },
      experienceYears: { type: Number, default: 0, min: 0, max: 100 },
      specialties: { type: [String], default: [] },
      hourlyRate: { type: Number, default: 0, min: 0 },
      // Cho phép hiển thị công khai trong danh sách /coaches
      isPublic: { type: Boolean, default: true },
    },
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
    isHiddenFromRankings: {
      type: Boolean,
      default: false,
    },
    isPushNotificationEnabled: {
      type: Boolean,
      default: true,
    },

    // Preferences chi tiết cho notification — client set qua
    // GET/PATCH /api/users/notification-prefs. isPushNotificationEnabled ở trên
    // vẫn là "kill switch" chung (đăng ký token expo hay không); các cờ dưới
    // đây tinh chỉnh theo kênh.
    notificationPrefs: {
      // Tắt hoàn toàn thông báo tin nhắn (DM + group) — kể cả in-app notif +
      // push. Khác với per-conversation mute (conversation.mutedBy).
      chatMuteAll: { type: Boolean, default: false },
      // Tắt tất cả thông báo từ bảng tin: bình luận trả lời bài mình, phản
      // hồi comment mình, @mention trong post/comment.
      feedMuteAll: { type: Boolean, default: false },
    },

    /* ------- (Đý BỎ) Login tracking ra model riêng ------- */
    // lastLoginAt: { type: Date }
    // loginHistory: [...]
  },
  { timestamps: true, strict: true },
);

/* ---------- Bcrypt helpers ---------- */
userSchema.methods.matchPassword = async function (entered) {
  const rawEntered =
    typeof entered === "string" ? entered : String(entered ?? "");
  const storedPassword =
    typeof this.password === "string" ? this.password : String(this.password ?? "");

  if (!storedPassword) return false;

  const isBcryptHash = /^\$2[aby]\$\d{2}\$/.test(storedPassword);
  if (isBcryptHash) {
    return bcrypt.compare(rawEntered, storedPassword);
  }

  const plainMatch = rawEntered === storedPassword;
  if (!plainMatch || !this._id) return plainMatch;

  try {
    const nextHash = await bcrypt.hash(rawEntered, await bcrypt.genSalt(10));
    await this.constructor.updateOne(
      { _id: this._id, password: storedPassword },
      { $set: { password: nextHash } },
    );
    this.password = nextHash;
  } catch (err) {
    console.error("[user.matchPassword] legacy password upgrade failed:", err);
  }

  return true;
};
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, await bcrypt.genSalt(10));
  next();
});

/* ---------- Validate logic cho evaluator & signupMeta ---------- */
userSchema.pre("validate", function (next) {
  // ✅ Normalize CCCD: "" -> undefined để không dính unique index và không bị match
  if (typeof this.cccd === "string") {
    const v = this.cccd.trim();
    if (!v) this.cccd = undefined;
    else this.cccd = v;
  }
  // Evaluator validation (giữ nguyên)
  if (this.role !== "admin" && this.evaluator?.enabled) {
    const provinces = Array.from(
      new Set(
        (this.evaluator.gradingScopes?.provinces || []).map((s) =>
          String(s || "").trim(),
        ),
      ),
    ).filter(Boolean);
    if (provinces.length === 0) {
      return next(
        new Error(
          "Evaluator phải có ít nhất 1 tỉnh trong gradingScopes.provinces",
        ),
      );
    }
    this.evaluator.gradingScopes.provinces = provinces;

    const sports = Array.from(
      new Set(this.evaluator.gradingScopes?.sports || []),
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

  // ✅ Nếu là super user mà role khác admin thì auto set admin
  if (this.isSuperUser && this.role !== "admin") {
    this.role = "admin";
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
            .filter(Boolean),
        ),
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
      { upsert: true },
    );

    return next();
  } catch (err) {
    console.error(
      "[User.post(save)] Failed to create UserRadar for user",
      doc._id,
      err.message,
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
  { _id: false },
);
userSchema.add({ localRatings: { type: RatingSchema, default: () => ({}) } });

/* ---------- Index ---------- */
userSchema.index(
  { nickname: 1 },
  { name: "idx_nickname_vi", collation: { locale: "vi", strength: 1 } },
);
userSchema.index(
  { name: 1 },
  { name: "idx_name_vi", collation: { locale: "vi", strength: 1 } },
);
userSchema.index(
  { province: 1 },
  { name: "idx_province_vi", collation: { locale: "vi", strength: 1 } },
);
userSchema.index({ cccdStatus: 1, updatedAt: -1 });
// Tra nhanh các VĐV có hiệu ứng tên (endpoint /api/name-styles)
userSchema.index({ "nameStyle.effect": 1 }, { name: "idx_name_style_effect" });
userSchema.index({ "evaluator.enabled": 1 }, { name: "idx_eval_enabled" });
userSchema.index(
  { "evaluator.gradingScopes.provinces": 1 },
  { name: "idx_eval_province" },
);
userSchema.index({ role: 1 }, { name: "idx_role" });

// 👇 Index phục vụ thống kê/loc đăng ký
userSchema.index(
  { "signupMeta.platform": 1, createdAt: -1 },
  { name: "idx_signup_platform" },
);
userSchema.index(
  { "signupMeta.ip.client": 1, createdAt: -1 },
  { name: "idx_signup_ip" },
);
userSchema.index({ lastKnownLocation: "2dsphere" });

userSchema.index(
  { loginOtpBypassUntil: -1 },
  { name: "idx_login_otp_bypass_until" },
);

export default mongoose.model("User", userSchema);
