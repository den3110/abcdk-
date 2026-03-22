import mongoose from "mongoose";
const { Schema } = mongoose;

const appSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("AppSetting", appSettingSchema);
