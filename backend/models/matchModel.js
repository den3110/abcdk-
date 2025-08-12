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

    // Optional: mã trận tuỳ ý (nếu không có, FE có thể tự hiển thị M-{round}-{order})
    code: { type: String, default: "" },

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

    // Luật thi đấu
    rules: {
      bestOf: { type: Number, enum: [1, 3, 5], default: 3 },
      pointsToWin: { type: Number, enum: [11, 15, 21], default: 11 },
      winByTwo: { type: Boolean, default: true },
    },

    // Điểm từng ván
    gameScores: [
      { a: { type: Number, default: 0 }, b: { type: Number, default: 0 } },
    ],

    // Trạng thái cơ bản
    status: {
      type: String,
      enum: ["scheduled", "live", "finished"],
      default: "scheduled",
    },
    winner: { type: String, enum: ["A", "B", ""], default: "" },

    referee: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    note: { type: String, default: "" },

    // Liên kết sang trận tiếp theo
    nextMatch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
    },
    nextSlot: { type: String, enum: ["A", "B", null], default: null },

    /* ---------- Lịch & sân (đã dùng ở các pipeline BE/FE) ---------- */
    scheduledAt: { type: Date, default: null }, // ngày/giờ dự kiến
    court: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Court",
      default: null,
    },
    courtLabel: { type: String, default: "" }, // fallback text khi chưa có court

    /* ---------- Trường phục vụ LIVE realtime (referee chấm) ---------- */
    currentGame: { type: Number, default: 0 }, // index ván hiện tại
    // ✅ pickleball serving state
    serve: {
      side: { type: String, enum: ["A", "B"], default: "A" }, // đội đang giao
      server: { type: Number, enum: [1, 2], default: 2 }, // người thứ mấy trong đội đang giao
    },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    liveBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    liveVersion: { type: Number, default: 0 }, // tăng mỗi lần cập nhật live
    video: { type: String, default: "" },
    liveLog: [
      {
        type: {
          type: String,
          enum: [
            "point",
            "undo",
            "start",
            "finish",
            "forfeit",
            "serve", // 👈 thêm
            "sideout", // 👈 nếu bạn có log side-out
            "rotate", // 👈 nếu bạn có log đổi ô/đổi người giao
          ],
          required: true,
        },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        payload: { type: mongoose.Schema.Types.Mixed },
        at: { type: Date, default: Date.now },
      },
    ],
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

matchSchema.pre("save", function(next) {
  if (!this.code) {
    const r = this.round ?? "";
    const o = this.order ?? "";
    this.code = `R${r}#${o}`; // giống ảnh mẫu: V{round}-B{order}
  }
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

/* Sau khi update xong: nếu đã finished + có winner thì feed winner cho các trận phụ thuộc previousA/B */
matchSchema.post("findOneAndUpdate", async function (doc) {
  if (!doc) return;
  try {
    if (doc.status === "finished" && doc.winner) {
      const MatchModel = doc.model("Match"); // ✅ Lấy model đúng cách
      const winnerReg = doc.winner === "A" ? doc.pairA : doc.pairB;

      await MatchModel.updateMany(
        { previousA: doc._id },
        { $set: { pairA: winnerReg }, $unset: { previousA: "" } }
      );
      await MatchModel.updateMany(
        { previousB: doc._id },
        { $set: { pairB: winnerReg }, $unset: { previousB: "" } }
      );
    }
  } catch (err) {
    console.error("[Match post(findOneAndUpdate)] propagate error:", err);
  }
});

/* ---------- Indexes ---------- */
matchSchema.index({ tournament: 1, bracket: 1, status: 1, createdAt: -1 });
matchSchema.index({ bracket: 1, createdAt: -1 });
matchSchema.index({ tournament: 1, createdAt: -1 });
matchSchema.index({ scheduledAt: 1 });
matchSchema.index({ court: 1 });
matchSchema.index({ status: 1, finishedAt: -1 });
matchSchema.index({ pairA: 1, status: 1 });
matchSchema.index({ pairB: 1, status: 1 });

export default mongoose.model("Match", matchSchema);
