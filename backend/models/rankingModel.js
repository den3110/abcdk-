// models/rankingModel.js
import mongoose from "mongoose";

const rankingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ========== Điểm số ==========
    single: { type: Number, default: 0, min: 0 },
    double: { type: Number, default: 0, min: 0 },
    mix: { type: Number, default: 0, min: 0 },
    points: { type: Number, default: 0, min: 0 },

    // ========== Uy tín ==========
    reputation: { type: Number, default: 0, min: 0, max: 100 },
    repMeta: {
      tournamentsFinished: { type: Number, default: 0 },
      lastBonusAt: { type: Date },
    },

    // ========== Denormalized fields (tối ưu query) ==========
    // Số giải đã kết thúc mà user tham gia
    totalFinishedTours: { type: Number, default: 0, min: 0 },

    // User có assessment do staff chấm không
    hasStaffAssessment: { type: Boolean, default: false },

    // Tier/màu xếp hạng (Gold/Red/Grey)
    tierColor: {
      type: String,
      enum: ["yellow", "red", "grey"],
      default: "grey",
    },

    tierLabel: {
      type: String,
      enum: [
        "Official/Đã duyệt",
        "Tự chấm",
        "0 điểm / Chưa đấu",
        "Chưa có điểm",
      ],
      default: "0 điểm / Chưa đấu",
    },

    // Số thứ tự ưu tiên sort: 0=Gold, 1=Red, 2=Grey, 3=Default
    colorRank: {
      type: Number,
      default: 2,
      min: 0,
      max: 3,
    },

    // Check xem user có bị ẩn khỏi Bảng xếp hạng không
    isHiddenFromRankings: {
      type: Boolean,
      default: false,
    },

    // ========== Metadata ==========
    lastUpdated: { type: Date, default: Date.now },

    // Cache timestamp của lần update tier cuối
    tierUpdatedAt: { type: Date },
  },
  {
    timestamps: true,
    // Tối ưu cho queries lớn
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ========== INDEXES ==========
// Index chính cho user (unique)
rankingSchema.index({ user: 1 }, { unique: true });

// Compound index cho sorting rankings (QUAN TRỌNG nhất!)
rankingSchema.index(
  {
    colorRank: 1, // Sort tier trước
    double: -1, // Sau đó sort theo double
    single: -1, // Rồi single
    points: -1, // Rồi points
    updatedAt: -1, // Cuối cùng updatedAt
    _id: 1, // Tie-breaker
  },
  { name: "ranking_sort_idx" },
);

// Index cho filter theo tier
rankingSchema.index({ tierColor: 1, colorRank: 1 });
rankingSchema.index({ hasStaffAssessment: 1 });

// Index cho queries theo điểm
rankingSchema.index({ points: -1, double: -1, single: -1 });

// Index cho reputation queries
rankingSchema.index({ reputation: -1 });

// ========== VIRTUALS ==========
// Check xem user có điểm hay chưa
rankingSchema.virtual("hasPoints").get(function () {
  return this.points > 0 || this.single > 0 || this.double > 0 || this.mix > 0;
});

// Check xem có phải 0 điểm không
rankingSchema.virtual("isZeroPoints").get(function () {
  return (
    this.points === 0 &&
    this.single === 0 &&
    this.double === 0 &&
    this.mix === 0
  );
});

// ========== METHODS ==========
// Method để recalculate tier
rankingSchema.methods.recalculateTier = function () {
  const zeroPoints =
    this.points === 0 &&
    this.single === 0 &&
    this.double === 0 &&
    this.mix === 0;

  const isGrey = zeroPoints && this.totalFinishedTours === 0;
  const isGold =
    !isGrey && (this.totalFinishedTours > 0 || this.hasStaffAssessment);
  const isRed = this.totalFinishedTours === 0 && !isGold && !isGrey;

  // Update tier fields
  if (isGold) {
    this.colorRank = 0;
    this.tierColor = "yellow";
    this.tierLabel = "Official/Đã duyệt";
  } else if (isRed) {
    this.colorRank = 1;
    this.tierColor = "red";
    this.tierLabel = "Tự chấm";
  } else if (isGrey) {
    this.colorRank = 2;
    this.tierColor = "grey";
    this.tierLabel = "0 điểm / Chưa đấu";
  } else {
    this.colorRank = 3;
    this.tierColor = "grey";
    this.tierLabel = "Chưa có điểm";
  }

  // Update reputation
  this.reputation = Math.min(100, this.totalFinishedTours * 10);
  this.tierUpdatedAt = new Date();

  return this;
};

// ========== STATICS ==========
// Static method để bulk update tiers
rankingSchema.statics.bulkRecalculateTiers = async function (userIds = []) {
  const query = userIds.length > 0 ? { user: { $in: userIds } } : {};
  const rankings = await this.find(query);

  const bulkOps = rankings.map((ranking) => {
    ranking.recalculateTier();
    return {
      updateOne: {
        filter: { _id: ranking._id },
        update: {
          $set: {
            colorRank: ranking.colorRank,
            tierColor: ranking.tierColor,
            tierLabel: ranking.tierLabel,
            reputation: ranking.reputation,
            tierUpdatedAt: ranking.tierUpdatedAt,
          },
        },
      },
    };
  });

  if (bulkOps.length > 0) {
    await this.bulkWrite(bulkOps);
  }

  return bulkOps.length;
};

// ========== MIDDLEWARE ==========
// Auto update lastUpdated trước khi save
rankingSchema.pre("save", function (next) {
  this.lastUpdated = new Date();
  next();
});

// Auto recalculate tier nếu điểm thay đổi
rankingSchema.pre("save", function (next) {
  if (
    this.isModified("single") ||
    this.isModified("double") ||
    this.isModified("mix") ||
    this.isModified("points") ||
    this.isModified("totalFinishedTours") ||
    this.isModified("hasStaffAssessment")
  ) {
    this.recalculateTier();
  }
  next();
});

const Ranking = mongoose.model("Ranking", rankingSchema);
export default Ranking;
