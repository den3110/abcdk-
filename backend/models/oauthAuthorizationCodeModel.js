import mongoose from "mongoose";

const oauthAuthorizationCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    clientId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    redirectUri: {
      type: String,
      required: true,
      trim: true,
    },
    scope: {
      type: String,
      default: "",
      trim: true,
    },
    codeChallenge: {
      type: String,
      required: true,
      trim: true,
    },
    codeChallengeMethod: {
      type: String,
      required: true,
      enum: ["S256", "plain"],
      default: "S256",
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    usedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

oauthAuthorizationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model(
  "OAuthAuthorizationCode",
  oauthAuthorizationCodeSchema
);
