// backend/models/cmsBlockModel.js
import mongoose from "mongoose";

const cmsBlockSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      unique: true,
      required: true,
      trim: true,
      index: true,
    }, // vd: 'hero', 'contact'
    // Cho phép mọi cấu trúc lồng nhau (hero/contact…)
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    minimize: false, // giữ lại {} rỗng trong data để không bị Mongoose tự bỏ
  }
);

const CmsBlock = mongoose.model("CmsBlock", cmsBlockSchema);
export default CmsBlock;
