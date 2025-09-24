import mongoose from "mongoose";

const fileAssetSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    fileName: { type: String, required: true }, // stored name on disk
    size: { type: Number, default: 0 },
    mime: { type: String, default: "application/octet-stream" },
    path: { type: String, required: true }, // absolute or relative path on disk
    isPublic: { type: Boolean, default: true },
    category: { type: String, default: "general" }, // e.g., "app", "doc", "image"
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

fileAssetSchema.index({ originalName: "text", fileName: "text", category: 1 });

const FileAsset = mongoose.model("FileAsset", fileAssetSchema);
export default FileAsset;
