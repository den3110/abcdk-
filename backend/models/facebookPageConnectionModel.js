// models/facebookPageConnectionModel.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const facebookPageConnectionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Thông tin Page
    pageId: { type: String, required: true }, // FACEBOOK PAGE ID
    pageName: { type: String, required: true },
    pagePicture: { type: String },
    pageCategory: { type: String },

    // Token để live lên page này (long-lived nếu có thể)
    pageAccessToken: { type: String, required: true },

    // Thời điểm hết hạn token (nếu Facebook trả expires_in)
    expireAt: { type: Date }, // NEW

    // Có thể thêm flags
    isDefault: { type: Boolean, default: false },

    // Để sau này mình debug / revoke
    raw: { type: Object },
  },
  {
    timestamps: true,
  }
);

facebookPageConnectionSchema.index({ user: 1, pageId: 1 }, { unique: true });

const FacebookPageConnection = mongoose.model(
  "FacebookPageConnection",
  facebookPageConnectionSchema
);

export default FacebookPageConnection;
