// models/Match.js
import mongoose from "mongoose";

const matchSchema = new mongoose.Schema(
  {
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    bracket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bracket",
      required: true,
    },

    round: { type: Number, default: 1 },
    order: { type: Number, default: 0 },

    // ❗ Bỏ required để cho phép dùng previousA/previousB
    pairA: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      default: null,
    },
    pairB: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      default: null,
    },

    // Winner feed-in từ trận trước
    previousA: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
    },
    previousB: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
    },

    rules: {
      bestOf: { type: Number, enum: [1, 3, 5], default: 3 },
      pointsToWin: { type: Number, enum: [11, 15, 21], default: 11 },
      winByTwo: { type: Boolean, default: true },
    },

    gameScores: [
      { a: { type: Number, default: 0 }, b: { type: Number, default: 0 } },
    ],

    status: {
      type: String,
      enum: ["scheduled", "live", "finished"],
      default: "scheduled",
    },
    winner: { type: String, enum: ["A", "B", ""], default: "" },

    referee: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    note: { type: String, default: "" },

    // Link đi lên
    nextMatch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
    },
    nextSlot: { type: String, enum: ["A", "B", null], default: null },
  },
  { timestamps: true }
);

/* Yêu cầu logic: Mỗi bên phải có pair hoặc previous */
matchSchema.pre("validate", function (next) {
  const okA = !!this.pairA || !!this.previousA;
  const okB = !!this.pairB || !!this.previousB;
  if (!okA) return next(new Error("Either pairA or previousA is required"));
  if (!okB) return next(new Error("Either pairB or previousB is required"));
  next();
});

/* Khi trận kết thúc: đổ đội thắng sang nextMatch[nextSlot] nếu trống */
matchSchema.post("save", async function (doc, next) {
  try {
    if (
      doc.status === "finished" &&
      doc.winner &&
      doc.nextMatch &&
      doc.nextSlot
    ) {
      const winnerRegId = doc.winner === "A" ? doc.pairA : doc.pairB;
      if (winnerRegId) {
        const Next = doc.model("Match");
        const nm = await Next.findById(doc.nextMatch);
        if (nm) {
          const field = doc.nextSlot === "A" ? "pairA" : "pairB";
          if (!nm[field]) {
            nm[field] = winnerRegId;
            await nm.save();
          }
        }
      }
    }
    next();
  } catch (e) {
    next(e);
  }
});

// pseudo mongoose hook
matchSchema.post("findOneAndUpdate", async function (doc) {
  if (!doc) return;
  if (doc.status === "finished" && doc.winner) {
    const winnerReg = doc.winner === "A" ? doc.pairA : doc.pairB;
    await Match.updateMany(
      { previousA: doc._id },
      { $set: { pairA: winnerReg }, $unset: { previousA: "" } }
    );
    await Match.updateMany(
      { previousB: doc._id },
      { $set: { pairB: winnerReg }, $unset: { previousB: "" } }
    );
  }
});

export default mongoose.model("Match", matchSchema);
