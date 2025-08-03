import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    /* ------- Thông tin cơ bản ------- */
    name: { type: String, required: true, trim: true },
    nickname: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: { type: String, required: true },
    dob: { type: Date, required: true },

    /* ------- Avatar + giới thiệu ------- */
    avatar: { type: String, default: "" },
    bio: { type: String, default: "" },

    /* ------- Thông tin phụ ------- */
    gender: { type: String, enum: ["Nam", "Nữ", "--"], default: "--" },
    province: { type: String, default: "" },

    /* ------- Xác thực & điểm ------- */
    verified: {
      type: String,
      enum: ["Chờ xác thực", "Xác thực"],
      default: "Chờ xác thực",
    },
    cccd: { type: String, unique: true, sparse: true, match: /^\d{12}$/ },
    cccdStatus: {
      type: String,
      enum: ["Chưa xác minh", "Đã xác minh"],
      default: "Chưa xác minh",
    },
    ratingSingle: { type: Number, default: 0 },
    ratingDouble: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/* ---------- Index giúp tìm nhanh nickname (không unique) ---------- */
userSchema.index({ nickname: 1 });

/* ---------- Bcrypt helpers ---------- */
userSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password);
};

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, await bcrypt.genSalt(10));
  next();
});

const User = mongoose.model("User", userSchema);
export default User;
