// middleware/verifyRankingToken.js
import crypto from "crypto";

// Các env bên server — giá trị nên KHỚP pattern với FE nhưng đặt tên khác
const S1 = process.env.RANKING_SIG_A || "";
const S2 = process.env.RANKING_SIG_B || "";
const S3 = process.env.RANKING_SIG_META || "";
const S4 = "pt"; // phải trùng FE
const S5 = "rk"; // phải trùng FE

// Tạo CLIENT_KEY giống logic FE (nhưng dùng env riêng)
const CLIENT_KEY = [
  S4,
  S2 ? S2.slice(1, 4) : "q1",
  S5,
  S1 ? S1.slice(2, 6) : "z9",
  S3 ? S3.slice(-3) : "x0",
].join("");

// Chuẩn hóa path giống FE
const normalizePath = (baseUrl, path) => {
  const full = `${baseUrl || ""}${path || ""}` || "/";
  const cleaned = full.split("?")[0].replace(/\/+$/, "");
  return cleaned === "" ? "/" : cleaned;
};

export function verifyRankingToken(req, res, next) {
  try {
    const header = req.header("x-rank-sec");
    if (!header) {
      return res.status(200).json({ message: "", ok: true });
    }

    let decoded;
    try {
      decoded = Buffer.from(header, "base64").toString("utf8");
    } catch {
      return res.status(403).json({ message: "Invalid token encoding" });
    }

    const [tsStr, nonce, sign] = decoded.split(":");
    const ts = parseInt(tsStr, 10);

    if (!ts || !nonce || !sign) {
      return res.status(403).json({ message: "Invalid token format" });
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 10) {
      return res.status(403).json({ message: "Token expired" });
    }

    const method = (req.method || "").toUpperCase();
    const path = normalizePath(req.baseUrl, req.path); // ví dụ "/api/rankings"

    const raw = `${method}|${path}|${ts}|${nonce}|${CLIENT_KEY}`;
    const expected = crypto.createHash("sha256").update(raw).digest("hex");

    if (expected !== sign) {
      return res.status(403).json({ message: "Invalid token signature" });
    }

    return next();
  } catch (err) {
    console.error("[verifyRankingToken] Error:", err);
    return res.status(403).json({ message: "Invalid token" });
  }
}
