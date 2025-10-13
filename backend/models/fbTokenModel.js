import mongoose from "mongoose";

const FbTokenSchema = new mongoose.Schema(
  {
    pageId: { type: String, index: true, unique: true, required: true },
    pageName: String,
    category: String,
    tasks: [String],

    longUserToken: String,
    longUserExpiresAt: Date,
    longUserScopes: [String],

    pageToken: String,
    pageTokenExpiresAt: Date, // null = "Expires: never"
    pageTokenIsNever: { type: Boolean, default: false },

    needsReauth: { type: Boolean, default: false },
    lastCheckedAt: Date,
    lastError: String,
  },
  { timestamps: true }
);

export default mongoose.models.FbToken ||
  mongoose.model("FbToken", FbTokenSchema);
