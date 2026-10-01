import mongoose from "mongoose";

// Mỗi bản ghi = 1 segment TS của phiên auto-live "xuyên suốt" ĐÃ nằm trên Cloudflare
// R2 (thay cho việc lưu file ở đĩa VPS /tmp — rất tốn & từng làm đầy ổ cứng).
// Dùng để dựng timeline (startMs cộng dồn durMs) khi cắt clip từng trận: khi cắt mới
// tải đúng các segment phủ [trận bắt đầu→kết thúc] từ R2 về temp rồi concat.
const autoLiveSegmentSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "TournamentAutoLiveSession", required: true, index: true },
    name: { type: String, required: true }, // rec-<runEpochSec>-<index>.ts
    runEpoch: { type: Number, required: true },
    index: { type: Number, required: true },
    // Vị trí trên R2
    objectKey: { type: String, required: true },
    storageTargetId: { type: String, default: "" },
    bucketName: { type: String, default: "" },
    // Metadata để dựng timeline mà KHÔNG cần tải/probe lại
    durMs: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

autoLiveSegmentSchema.index({ session: 1, name: 1 }, { unique: true });
autoLiveSegmentSchema.index({ session: 1, runEpoch: 1, index: 1 });

export default mongoose.model("AutoLiveSegment", autoLiveSegmentSchema);
