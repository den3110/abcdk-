import mongoose from "mongoose";

const bracketSchema = new mongoose.Schema(
  {
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    name: { type: String, required: true }, // VD: "Bảng A" / "Nhánh Knockout"
    type: { type: String, enum: ["group", "knockout"], default: "knockout" },
    stage: { type: Number, default: 1 }, // vòng/đợt
    order: { type: Number, default: 0 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    matchesCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("Bracket", bracketSchema);
