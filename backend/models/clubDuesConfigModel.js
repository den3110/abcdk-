// models/clubDuesConfigModel.js
// Cấu hình phí hội viên định kỳ của CLB (1 doc / club)
import mongoose from "mongoose";

export const DUES_PERIODS = ["monthly", "quarterly", "yearly"];

const ClubDuesConfigSchema = new mongoose.Schema(
  {
    club: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      required: true,
      unique: true,
      index: true,
    },
    amount: { type: Number, default: 0, min: 0 },
    period: { type: String, enum: DUES_PERIODS, default: "monthly" },
    active: { type: Boolean, default: false },
    note: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

export default mongoose.model("ClubDuesConfig", ClubDuesConfigSchema);
