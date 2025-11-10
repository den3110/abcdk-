// middleware/requireAppSession.js
import {
  verifyAppSessionToken,
  createAppSessionToken,
} from "../utils/appSession.js";

export function requireAppSession(req, res, next) {
  try {
    // Chỉ ép rule cho web; app/unknown cho qua để không phá app cũ
    if (!req.isWeb && req.clientType !== "web") {
      return next();
    }

    const ua = req.get("user-agent") || "";
    const existingToken =
      (req.cookies && req.cookies.pt_ses) || req.header("x-pt-ses");

    const existing = verifyAppSessionToken(existingToken, { ua });

    if (existing) {
      // Có session hợp lệ -> dùng luôn
      req.appSession = existing;
      return next();
    }

    // ❗Không có hoặc hết hạn -> tạo MỚI NGAY TẠI ĐÂY (auto init)
    const { sid, token, iat, ttl } = createAppSessionToken({ ua });

    res.cookie("pt_ses", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: ttl * 1000,
    });

    req.appSession = { sid, iat };

    // Cho request này qua luôn, không 403 nữa
    return next();
  } catch (err) {
    console.error("[requireAppSessionForWeb] Error:", err);
    return res.status(500).json({ message: "Invalid app session" });
  }
}
