// models/otpLogModel.js
// Nhật ký gửi OTP qua Zalo ZNS (đăng ký / kích hoạt SĐT / test).
import mongoose from "mongoose";

const { Schema } = mongoose;

const otpLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    phone: { type: String, default: "", index: true }, // dạng lưu 84xxxxxxxxx
    purpose: {
      type: String,
      enum: ["register", "activate", "login", "test", "reset"],
      default: "register",
      index: true,
    },
    channel: { type: String, default: "zalo_zns" },
    status: { type: String, enum: ["success", "failed"], required: true, index: true },
    error: { type: String, default: "" },
    tranId: { type: String, default: "" },
    msgId: { type: String, default: "" },
    cost: { type: Number, default: 0 },
    ip: { type: String, default: "" },
  },
  { timestamps: true }
);

otpLogSchema.index({ phone: 1, createdAt: -1 });
otpLogSchema.index({ createdAt: -1 });

const OtpLog =
  mongoose.models.OtpLog || mongoose.model("OtpLog", otpLogSchema);

export default OtpLog;
