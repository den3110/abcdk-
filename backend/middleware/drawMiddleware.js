// middlewares/drawMiddleware.js
import DrawSession from "../models/drawSessionModel.js";

/**
 * Middleware: lấy bracketId từ drawId rồi gắn vào req.bracketId
 * Ưu tiên: req.params.drawId -> req.body.drawId -> req.query.drawId
 */
export async function attachBracketIdFromDraw(req, res, next) {
  try {
    const drawId = req.params?.drawId || req.body?.drawId || req.query?.drawId;

    if (!drawId) {
      return res.status(400).json({
        message: "drawId là bắt buộc (params/body/query)",
      });
    }

    const draw = await DrawSession.findById(drawId).select("bracket");
    if (!draw) {
      return res.status(404).json({
        message: "Không tìm thấy phiên bốc thăm (DrawSession)",
      });
    }

    if (!draw.bracket) {
      return res.status(400).json({
        message: "DrawSession không gắn bracket nào",
      });
    }

    // Gắn cho các middleware/controller sau dùng
    req.drawId = String(drawId);
    req.bracketId = String(draw.bracket);

    return next();
  } catch (err) {
    console.error("[attachBracketIdFromDraw] error:", err);
    return next(err);
  }
}
