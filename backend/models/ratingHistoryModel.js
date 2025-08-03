// models/ratingHistoryModel.js
import mongoose from "mongoose";
const ratingHistorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: Date, required: true },
    ratingSingle: { type: Number, required: true },
    ratingDouble: { type: Number, required: true },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);
export default mongoose.model("RatingHistory", ratingHistorySchema);
