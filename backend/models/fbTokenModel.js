// models/FbToken.js
import mongoose from "mongoose";

const FbTokenSchema = new mongoose.Schema(
  {
    pageId: { type: String, index: true, unique: true, required: true },
    pageName: String,
    category: String,
    tasks: [String],

    // token gốc
    longUserToken: String,
    longUserExpiresAt: Date,
    longUserScopes: [String],

    // page token dùng để tạo live
    pageToken: String,
    pageTokenExpiresAt: Date, // null = "Expires: never"
    pageTokenIsNever: { type: Boolean, default: false },

    needsReauth: { type: Boolean, default: false },
    lastCheckedAt: Date,
    lastError: String,
    // ✅ lưu kết quả health check gần nhất
    lastStatusCode: { type: String, default: null }, // "OK" | "INVALID" | ...
    lastStatusProblems: [String],
    lastStatusHints: [String],
    // ➕ NEW: quản lý "rảnh/bận"
    isBusy: { type: Boolean, default: false }, // mặc định rảnh
    busyMatch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
    },
    busyLiveVideoId: { type: String, default: null },
    busySince: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.FbToken ||
  mongoose.model("FbToken", FbTokenSchema);
