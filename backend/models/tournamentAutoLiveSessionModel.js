// Session livestream tự động cho 1 court trong 1 giải: cam Imou → server ffmpeg
// → RTMP FB/YT/custom. Mỗi court chỉ có tối đa 1 session ACTIVE cùng lúc
// (unique partial index).
import mongoose from "mongoose";

const { Schema } = mongoose;

const destinationSchema = new Schema(
  {
    // fb | youtube | rtmp (custom)
    type: { type: String, enum: ["fb", "youtube", "rtmp"], required: true },
    label: { type: String, default: "" },
    // rtmp full URL (đã có key gộp) HOẶC rtmp base + streamKey riêng
    streamUrl: { type: String, required: true },
    streamKey: { type: String, default: "" },
    // Cho FB/YT: reference các bản ghi trong FbToken / YoutubeToken
    pageId: { type: String, default: "" },
    pageName: { type: String, default: "" },
    broadcastId: { type: String, default: "" },
    // YouTube: id của liveStream (để endAndDelete khi dừng / chuyển trận).
    ytStreamId: { type: String, default: "" },
    // Link người xem (FB permalink / YouTube watch) — public, hiện trên admin
    watchUrl: { type: String, default: "" },
    // Ẩn khi trả API để không lộ key
    _isSecret: { type: Boolean, default: true },
  },
  { _id: false }
);

const tournamentAutoLiveSessionSchema = new Schema(
  {
    tournament: { type: Schema.Types.ObjectId, ref: "Tournament", index: true, required: true },
    court: { type: Schema.Types.ObjectId, ref: "CourtStation", index: true, required: true },
    // Venue chứa cam Imou (nơi lấy imouCreds / imouSession). Không bắt buộc khi
    // dùng nguồn Custom link.
    venue: { type: Schema.Types.ObjectId, ref: "Venue", index: true },
    // Cam Imou đã gắn vào court (rỗng nếu dùng sourceUrl)
    imouDeviceId: { type: String, default: "" },
    imouCamName: { type: String, default: "" },
    // Nguồn video tuỳ chỉnh (m3u8/RTSP/RTMP/http) thay cho cam Imou
    sourceUrl: { type: String, default: "" },
    // Nguồn đầu thu Dahua/DMSS qua P2P (serial+mật khẩu). Mật khẩu KHÔNG lưu ở
    // session — lấy từ venue.dahuaNvr (mã hoá) lúc spawn worker. Chỉ metadata.
    dahuaP2p: {
      serial: { type: String, default: "" },
      channel: { type: Number, default: 1 },
      subtype: { type: Number, default: 0 },
    },
    // User bấm Start (owner giải / staff)
    startedBy: { type: Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["starting", "live", "reconnecting", "paused", "stopped", "error"],
      default: "starting",
      index: true,
    },
    destinations: { type: [destinationSchema], default: [] },
    // Trận đang phát overlay — do orchestrator poll /next-match update
    currentMatch: { type: Schema.Types.ObjectId, ref: "Match", default: null },
    currentMatchLabel: { type: String, default: "" },
    // Tăng khi overlay data đổi — worker fetch PNG dùng ?v={version} để bust cache
    overlayVersion: { type: Number, default: 0 },
    // Nơi chạy encode: "server" (VPS) hoặc "client" (app desktop PC/Mac có GPU)
    runner: { type: String, enum: ["server", "client"], default: "server", index: true },
    runnerLabel: { type: String, default: "" }, // tên máy client
    runnerOs: { type: String, default: "" },
    encoder: { type: String, default: "" }, // h264_nvenc / videotoolbox / libx264…
    // Metadata process Python
    workerId: { type: String, default: "" }, // uuid nội bộ
    workerPid: { type: Number, default: 0 },
    workerStartedAt: { type: Date, default: null },
    workerLastHeartbeatAt: { type: Date, default: null },
    // Stats
    // Tài nguyên tiêu thụ (worker + ffmpeg) — cập nhật mỗi lần poll
    cpuPct: { type: Number, default: 0 }, // % của 1 lõi (100 = 1 core)
    memMB: { type: Number, default: 0 },
    bitrateKbps: { type: Number, default: 0 }, // tốc độ đẩy live
    fps: { type: Number, default: 0 },
    speed: { type: Number, default: 0 }, // 1.0 = realtime; <1 = nghẽn
    startedAt: { type: Date, default: Date.now },
    stoppedAt: { type: Date, default: null },
    lastMatchChangeAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    lastErrorAt: { type: Date, default: null },
    // Auto behaviour
    autoNext: { type: Boolean, default: true },
    // true → mỗi trận 1 broadcast riêng, và CHỈ live khi trận BẮT ĐẦU (status="live"),
    // không live khi mới gán sân. false → 1 live xuyên suốt mọi trận (mặc định).
    perMatchLive: { type: Boolean, default: false },
    // perMatchLive: trận đang được stream (null = đang chờ trận bắt đầu).
    liveMatchId: { type: Schema.Types.ObjectId, ref: "Match", default: null },
    // perMatchLive: spec điểm đến để TẠO broadcast khi trận bắt đầu (lazy).
    // [{type, pageId?, pageName?, label?, streamUrl?, streamKey?}]
    destSpecs: { type: [Schema.Types.Mixed], default: [] },
    // Tiêu đề live (FB/YT). perMatchLive: tự đặt "Tên giải - Tên trận" mỗi trận.
    liveTitle: { type: String, default: "" },
    // Ghi bản ghi local + cắt clip TỪNG TRẬN rồi upload Google Drive ban đêm.
    // Chỉ áp dụng live XUYÊN SUỐT (perMatchLive=false). Worker desktop ghi segment,
    // ban đêm đẩy segment về server → server cắt [startedAt,finishedAt] → Drive.
    recordClips: { type: Boolean, default: false },
    // Đã dọn thư mục segment tạm trên server sau khi mọi clip xong (tránh dọn lại).
    recordCleanedAt: { type: Date, default: null },
    // Vị trí overlay trên stream (corner: top-left/top-right/bottom-left/bottom-right)
    layout: {
      scoreboard: { type: String, default: "top-left" },
      brand: { type: String, default: "top-right" },
      sponsor: { type: String, default: "bottom-right" },
    },
    // Cấu hình nâng cao encode (chỉnh từ app desktop)
    advanced: {
      videoBitrateKbps: { type: Number, default: 4500 },
      maxBitrateKbps: { type: Number, default: 0 }, // 0 = auto (~1.15x)
      resolutionH: { type: Number, default: 1080 }, // 1080/720/480
      fps: { type: Number, default: 0 },            // 0 = khớp nguồn
      audioBitrateKbps: { type: Number, default: 128 },
      encoder: { type: String, default: "auto" },
    },
  },
  { timestamps: true }
);

// 1 court chỉ có 1 session không phải stopped
tournamentAutoLiveSessionSchema.index(
  { court: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["starting", "live", "reconnecting", "paused"] } },
  }
);
tournamentAutoLiveSessionSchema.index({ tournament: 1, status: 1 });

export default mongoose.model("TournamentAutoLiveSession", tournamentAutoLiveSessionSchema);
