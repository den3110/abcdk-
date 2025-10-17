// models/configModel.js
import mongoose from "mongoose";

const ConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: String, default: "" }, // lưu dạng string, JSON thì stringify
    isSecret: { type: Boolean, default: false }, // để UI mask
    description: { type: String, default: "" },
    updatedBy: { type: String, default: "" }, // email/username admin
  },
  { timestamps: true }
);

ConfigSchema.index({ key: 1 }, { unique: true });
export default mongoose.model("Config", ConfigSchema);
