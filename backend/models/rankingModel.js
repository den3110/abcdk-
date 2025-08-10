// models/rankingModel.js
import mongoose from "mongoose";

const rankingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // 🔒 1 user chỉ có 1 ranking
      index: true,
    },
    // tuỳ bạn cần gì, để mặc định 0 cho an toàn
    single: { type: Number, default: 0 },
    double: { type: Number, default: 0 },
    mix: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Phòng khi cấu hình autoIndex=false trong production:
rankingSchema.index({ user: 1 }, { unique: true });

const Ranking = mongoose.model("Ranking", rankingSchema);
export default Ranking;
