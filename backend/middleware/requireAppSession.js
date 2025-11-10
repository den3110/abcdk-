// middleware/requireAppSession.js
import { verifyAppSessionToken } from "../utils/appSession.js";

export function requireAppSession(req, res, next) {
  try {
    // Ưu tiên cookie (httpOnly), fallback header nếu cần debug
    const token =
      (req.cookies && req.cookies.pt_ses) || req.header("x-pt-ses");

    const ua = req.get("user-agent") || "";
    const session = verifyAppSessionToken(token, { ua });

    if (!session) {
      return res
        .status(403)
        .json({ message: "Missing me?" });
    }

    // cho các route sau dùng nếu cần
    req.appSession = session;

    return next();
  } catch (err) {
    console.error("[requireAppSession] Error:", err);
    return res.status(403).json({ message: "Invalid app session" });
  }
}
