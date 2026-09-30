// models/rtspSourceModel.js
// Thư viện nguồn RTSP có tên (dùng cho auto-live): admin lưu sẵn link RTSP +
// tên gợi nhớ + vị trí overlay (bảng điểm / logo / tài trợ) để chọn nhanh khi
// Start live thay vì dán link mỗi lần.
import mongoose from "mongoose";

const { Schema } = mongoose;

const rtspLayoutSchema = new Schema(
  {
    scoreboard: { type: String, default: "top-left" }, // Bảng điểm
    brand: { type: String, default: "top-right" }, // Logo PickleTour
    sponsor: { type: String, default: "bottom-right" }, // Tài trợ
  },
  { _id: false },
);

const rtspSourceSchema = new Schema(
  {
    label: { type: String, required: true, trim: true }, // tên gợi nhớ
    url: { type: String, required: true, trim: true }, // link RTSP/HLS/RTMP
    layout: { type: rtspLayoutSchema, default: () => ({}) },
    note: { type: String, default: "", trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

rtspSourceSchema.index({ label: 1 });

export default mongoose.model("RtspSource", rtspSourceSchema);
