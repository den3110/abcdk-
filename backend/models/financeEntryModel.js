// models/financeEntryModel.js
// Bút toán thu/chi (doanh thu & chi phí giải đấu) để admin tính lợi nhuận.
import mongoose from "mongoose";
const { Schema } = mongoose;

const financeEntrySchema = new Schema(
  {
    type: {
      type: String,
      enum: ["revenue", "expense"], // doanh thu / chi phí
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 }, // VND
    category: { type: String, trim: true, default: "", index: true }, // vd Vé, Tài trợ, Thuê sân, Giải thưởng...
    // Nhãn giải (free text, tiện gom lợi nhuận theo giải); có thể link tới giải thật.
    tournamentName: { type: String, trim: true, default: "", index: true },
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      default: null,
      index: true,
    },
    note: { type: String, trim: true, default: "" },
    occurredAt: { type: Date, default: Date.now, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

financeEntrySchema.index({ occurredAt: -1 });
financeEntrySchema.index({ tournamentName: 1, type: 1 });

const FinanceEntry =
  mongoose.models.FinanceEntry ||
  mongoose.model("FinanceEntry", financeEntrySchema);

export default FinanceEntry;
