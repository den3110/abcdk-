import mongoose from "mongoose";

// Máy PC live (desktop app) đăng ký để điều khiển TỪ APP qua backend proxy (Tailscale).
// App gọi backend (internet) → backend forward tới control-server của desktop trên
// Tailscale (VPS cùng Tailscale với PC live). Điện thoại KHÔNG cần Tailscale.
const liveControlMachineSchema = new mongoose.Schema(
  {
    machineId: { type: String, required: true, unique: true }, // ổn định theo máy (persist ở desktop)
    label: { type: String, default: "" },                      // tên máy (hostname)
    tailscaleIp: { type: String, default: "" },                // 100.x.x.x
    port: { type: Number, default: 8788 },                     // cổng control-server desktop
    pin: { type: String, default: "" },                        // PIN control-server (server giữ, không lộ cho app)
    cpuModel: { type: String, default: "" },
    cpuPct: { type: Number, default: 0 },
    moreCourts: { type: Number, default: null },               // ước tính còn live được bao nhiêu sân
    lastSeenAt: { type: Date, default: Date.now, index: true },
    registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("LiveControlMachine", liveControlMachineSchema);
