import mongoose from "mongoose";

const authLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["login", "register"],
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ["web", "mobile", "admin", "unknown"],
      default: "unknown",
      index: true,
    },
    status: {
      type: String,
      enum: ["success", "failed"],
      default: "failed",
      index: true,
    },
    statusCode: { type: Number, default: 0 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    loginKey: { type: String, default: "", index: true },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    nickname: { type: String, default: "" },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    method: { type: String, default: "" },
    path: { type: String, default: "" },
    errorMessage: { type: String, default: "" },
    request: {
      email: String,
      phone: String,
      identifier: String,
      nickname: String,
      name: String,
    },
    response: {
      userId: String,
      role: String,
      isAdmin: Boolean,
    },
  },
  { timestamps: true },
);

authLogSchema.index({ createdAt: -1 });
authLogSchema.index({ action: 1, status: 1, createdAt: -1 });
authLogSchema.index({ loginKey: "text", email: "text", phone: "text", nickname: "text" });

export default mongoose.model("AuthLog", authLogSchema);
