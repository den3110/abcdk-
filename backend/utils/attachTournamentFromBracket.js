// ví dụ: trong routes/drawRoutes.js hoặc bất kỳ file nào
import mongoose from "mongoose";
import Bracket from "../models/bracketModel.js";

/**
 * Middleware: lấy tournamentId từ bracketId rồi gắn vào req
 * - Đọc bracketId từ: req.params.bracketId || req.body.bracketId || req.query.bracketId
 * - Gắn:
 *    + req.bracketId
 *    + req.tournamentId  (string)
 *    + req.tournamentObjectId (ObjectId)
 */
export async function attachTournamentFromBracket(req, res, next) {
  try {
    const bracketId =
      req?.bracketId ||
      req.params?.bracketId ||
      req.body?.bracketId ||
      req.query?.bracketId;

    if (!bracketId) {
      return res.status(400).json({ message: "Missing bracketId" });
    }

    if (!mongoose.Types.ObjectId.isValid(bracketId)) {
      return res.status(400).json({ message: "Invalid bracketId" });
    }

    const bracket = await Bracket.findById(bracketId)
      .select("tournament")
      .lean();

    if (!bracket) {
      return res.status(404).json({ message: "Bracket not found" });
    }

    // ✅ gắn thêm field nhưng không đụng gì những thứ trước đó trên req
    req.bracketId = bracketId;
    req.tournamentId = String(bracket.tournament);
    req.tournamentObjectId = bracket.tournament;

    return next();
  } catch (err) {
    console.error("[attachTournamentFromBracket] error:", err);
    return res
      .status(500)
      .json({ message: err.message || "Internal server error" });
  }
}
