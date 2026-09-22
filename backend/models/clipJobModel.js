import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * ClipJob = 1 yêu cầu "cắt clip" từ camera Imou (thẻ SD playback) của 1 sân.
 *
 * Luồng (giống PickleBook — xem services/clip/clipWorker.service.js):
 *   user chọn khoảng thời gian TRONG giờ đã đặt sân → tạo ClipJob (status=queued)
 *     → worker DUY NHẤT poll DB, claim NGUYÊN TỬ (findOneAndUpdate queued→processing,
 *       sort createdAt = FIFO) nên xử lý LẦN LƯỢT, mỗi lúc 1 job (tránh nặng máy chủ)
 *     → spawn scripts/clip/clip_grab.py: kéo playback SD qua relay Imou → decode DHAV
 *       → ffmpeg -f dhav -c:v copy (không transcode) → uploads/clips/<id>.mp4
 *     → status=done + fileUrl → push thông báo user.
 *   File tự xoá sau CLIP_TTL_DAYS (mặc định 7) qua cron cleanup của worker.
 */
const clipJobSchema = new Schema(
  {
    // ── Tham chiếu ──────────────────────────────────────────────────────
    venue: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    court: { type: Schema.Types.ObjectId, ref: "VenueCourt", required: true, index: true },
    courtName: { type: String, default: "" },
    booking: { type: Schema.Types.ObjectId, ref: "Booking", default: null, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    requesterRole: { type: String, enum: ["user", "owner"], default: "user" },

    // ── Camera nguồn ────────────────────────────────────────────────────
    deviceId: { type: String, required: true }, // Imou deviceId của cam trên sân
    productId: { type: String, default: "" }, // "" với cam legacy
    camName: { type: String, default: "" },

    // ── Khoảng thời gian cắt (GIỜ LOCAL của camera) ─────────────────────
    // Format underscore mà cloud Imou dùng: yyyy_MM_dd_HH_mm_ss.
    beginLocal: { type: String, required: true },
    endLocal: { type: String, required: true },
    durationSec: { type: Number, required: true, min: 1 },

    // ── Máy trạng thái (xử lý tuần tự) ──────────────────────────────────
    status: {
      type: String,
      enum: ["queued", "processing", "done", "failed", "cancelled"],
      default: "queued",
      index: true,
    },
    progressPct: { type: Number, default: 0, min: 0, max: 100 },
    error: { type: String, default: "" }, // thông báo lỗi thân thiện (tiếng Việt)
    attempts: { type: Number, default: 0 },
    // Gate retry cho lỗi tạm thời (cam bận 555) — worker bỏ qua tới thời điểm này.
    nextAttemptAt: { type: Date, default: null },

    // ── Kết quả ─────────────────────────────────────────────────────────
    fileUrl: { type: String, default: "" }, // /uploads/clips/<id>.mp4
    fileSize: { type: Number, default: 0 }, // bytes
    workerPid: { type: Number, default: null },

    // ── Vòng đời ────────────────────────────────────────────────────────
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true }, // cron xoá file+doc
  },
  { timestamps: true },
);

// Truy vấn claim của worker: job queued cũ nhất trước (FIFO).
clipJobSchema.index({ status: 1, createdAt: 1 });
// Danh sách clip của user / theo booking.
clipJobSchema.index({ requestedBy: 1, createdAt: -1 });

export default mongoose.model("ClipJob", clipJobSchema);
