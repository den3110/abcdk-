// controllers/bracketController.js
import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Bracket from "../models/bracketModel.js";

export const getBracket = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(bracketId)) {
    res.status(400);
    throw new Error("BracketId không hợp lệ");
  }

  const expand = String(req.query.expand || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // base query
  let q = Bracket.findById(bracketId);

  // tùy chọn mở rộng: expand=teams -> populate groups.regIds với player1/player2
  if (expand.includes("teams")) {
    q = q.populate({
      path: "groups.regIds",
      select: "player1 player2",
    });
  }

  const br = await q.lean();
  if (!br) {
    res.status(404);
    throw new Error("Không tìm thấy Bracket");
  }

  // Trả nguyên document (đã populate nếu có expand)
  res.json(br);
});
