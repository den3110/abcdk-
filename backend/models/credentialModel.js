// models/credentialModel.js
import mongoose from "mongoose";

const CredentialSchema = new mongoose.Schema({
  provider: { type: String, enum: ["facebook", "youtube", "tiktok"], required: true },
  label: String,
  ownerKey: String,
  authType: { type: String, enum: ["long_user_token", "oauth2", "manual"], required: true },
  accessToken: String,   // plaintext hoặc enc:gcm:<b64> (tuỳ ENV)
  refreshToken: String,
  expiresAt: Date,
  scopes: [String],
  meta: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

export default mongoose.model("Credential", CredentialSchema);
