import mongoose from "mongoose";
import bcrypt from "bcryptjs";

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
      sparse: true, // cho phép null trùng nhau
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
    /* ------- Quyền ------- */
    role: {
      type: String,
      enum: ["user", "referee", "admin"],
      default: "user",
    },
  },
  { timestamps: true, strict: true }
);

/* ---------- Index ---------- */
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

export default mongoose.model("User", userSchema);
