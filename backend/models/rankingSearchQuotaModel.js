import mongoose from "mongoose";

const rankingSearchQuotaSchema = new mongoose.Schema(
  {
    ip: { type: String, required: true },
    ymd: { type: String, required: true }, // YYYY-MM-DD theo giờ local server
    total: { type: Number, default: 0 }, // tổng lượt search (guest + login)
    hasLoggedIn: { type: Boolean, default: false }, // IP này đã từng search khi đang đăng nhập hay chưa
  },
  { timestamps: true }
);

rankingSearchQuotaSchema.index({ ip: 1, ymd: 1 }, { unique: true });

const RankingSearchQuota = mongoose.model(
  "RankingSearchQuota",
  rankingSearchQuotaSchema
);

export default RankingSearchQuota;
