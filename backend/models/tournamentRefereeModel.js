// models/tournamentRefereeModel.js
// Pool trọng tài của 1 giải. Admin/manager add user vào pool; khi cấu
// hình CourtStation.defaultReferees, dropdown pick từ pool này thay vì
// search toàn bộ User để tiện + không nhầm.
import mongoose from "mongoose";

const tournamentRefereeSchema = new mongoose.Schema(
  {
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Ghi chú ngắn (VD: "trọng tài chính sân 1")
    note: { type: String, default: "", maxlength: 200 },
  },
  { timestamps: true, strict: true }
);

// 1 user chỉ được add 1 lần vào pool của 1 giải
tournamentRefereeSchema.index(
  { tournament: 1, user: 1 },
  { unique: true },
);

export default mongoose.model("TournamentReferee", tournamentRefereeSchema);
