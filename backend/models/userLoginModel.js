// models/UserLogin.js
import mongoose from "mongoose";

/* ------ Login event schema (giữ nguyên) ------ */
const LoginEventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    method: {
      type: String,
      enum: [
        "password",
        "google",
        "facebook",
        "apple",
        "otp",
        "refresh",
        "other",
      ],
      default: "password",
    },
    success: { type: Boolean, default: true },
    meta: {
      os: { type: String, default: "" },
      browser: { type: String, default: "" },
      device: { type: String, default: "" },
    },
  },
  { _id: false }
);

/* ------ UserLogin (1-1 với User) ------ */
const userLoginSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    lastLoginAt: { type: Date },
    loginHistory: { type: [LoginEventSchema], default: [] }, // giữ tên cũ để đỡ sửa code
  },
  { timestamps: true, strict: true }
);

/* ------ Indexes thường dùng ------ */
userLoginSchema.index({ lastLoginAt: -1 }, { name: "idx_login_last" });
userLoginSchema.index({ "loginHistory.at": -1 }, { name: "idx_login_at" });

/* ------ Statics tiện dụng ------ */
userLoginSchema.statics.recordLogin = async function (
  userId,
  {
    req,
    ip: ipArg,
    userAgent: uaArg,
    method = "password",
    success = true,
    maxEntries = 50,
  } = {}
) {
  const now = new Date();
  const ip =
    ipArg ||
    req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req?.ip ||
    req?.connection?.remoteAddress ||
    "";
  const userAgent = uaArg || req?.headers?.["user-agent"] || "";
  const event = { at: now, ip, userAgent, method, success };

  const update = {
    $push: {
      loginHistory: { $each: [event], $position: 0, $slice: maxEntries },
    },
  };
  if (success) {
    update.$set = { lastLoginAt: now };
  }

  // upsert để auto tạo record cho user lần đầu login
  return this.updateOne({ user: userId }, update, { upsert: true }).exec();
};

export default mongoose.model("UserLogin", userLoginSchema);
