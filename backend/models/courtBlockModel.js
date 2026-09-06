import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Khoá sân / bảo trì theo khoảng thời gian.
 * court = null → khoá TOÀN BỘ cụm sân (vd nghỉ lễ, sửa chữa chung).
 */
const courtBlockSchema = new Schema(
  {
    venue: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    court: { type: Schema.Types.ObjectId, ref: "VenueCourt", default: null, index: true },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    reason: { type: String, default: "", maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

courtBlockSchema.index({ venue: 1, startAt: 1, endAt: 1 });

export default mongoose.model("CourtBlock", courtBlockSchema);
