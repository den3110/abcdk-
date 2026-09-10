// models/opsAlertStateModel.js
// Trạng thái từng "vấn đề vận hành" (ops issue) — dùng để:
//  - chỉ báo Telegram khi CHUYỂN trạng thái (mới phát sinh / vừa hồi phục), không spam mỗi vòng check
//  - throttle theo cooldown, an toàn khi chạy PM2 cluster (state ở Mongo, không phải RAM từng process)
import mongoose from "mongoose";

const { Schema } = mongoose;

const opsAlertStateSchema = new Schema(
  {
    // Định danh ổn định của vấn đề, vd "health:zalo-zns", "incident:http-5xx:POST /api/x"
    key: { type: String, required: true, unique: true, index: true },
    // health = từ vòng check định kỳ | incident = lỗi runtime | event = sự kiện nghiệp vụ
    kind: { type: String, default: "health", index: true },
    severity: {
      type: String,
      enum: ["info", "warn", "error", "critical"],
      default: "warn",
    },
    status: { type: String, enum: ["ok", "firing"], default: "firing", index: true },
    title: { type: String, default: "" },
    message: { type: String, default: "" },
    detail: { type: Schema.Types.Mixed, default: null },
    occurrences: { type: Number, default: 0 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    lastNotifiedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    // Admin có thể tạm tắt 1 cảnh báo tới thời điểm này
    mutedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

opsAlertStateSchema.index({ status: 1, lastSeenAt: -1 });
opsAlertStateSchema.index({ kind: 1, lastSeenAt: -1 });

export default mongoose.models.OpsAlertState ||
  mongoose.model("OpsAlertState", opsAlertStateSchema);
