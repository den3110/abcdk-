// utils/appSession.js
import crypto from "crypto";

const APP_SESSION_SECRET =
  process.env.APP_SESSION_SECRET;

// TTL tính bằng giây (vd: 2 tiếng)
const APP_SESSION_TTL =
  parseInt(process.env.APP_SESSION_TTL, 10) || 7200;

// hash UA nhẹ để ràng buộc device mà không quá gắt
function hashUA(ua) {
  if (!ua) return "na";
  return crypto.createHash("md5").update(ua).digest("hex").slice(0, 12);
}

// Tạo token session mới
export function createAppSessionToken({ ua }) {
  const sid = crypto.randomBytes(16).toString("hex");
  const iat = Math.floor(Date.now() / 1000);

  const base = `${sid}|${iat}|${hashUA(ua)}`;
  const sig = crypto
    .createHmac("sha256", APP_SESSION_SECRET)
    .update(base)
    .digest("hex");

  const token = `${sid}.${iat}.${sig}`;

  return {
    sid,
    token,
    iat,
    ttl: APP_SESSION_TTL,
  };
}

// Verify token từ cookie/header
export function verifyAppSessionToken(token, { ua }) {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [sid, iatStr, sig] = parts;
  const iat = parseInt(iatStr, 10);
  if (!sid || !iat || !sig) return null;

  const base = `${sid}|${iat}|${hashUA(ua)}`;
  const expectedSig = crypto
    .createHmac("sha256", APP_SESSION_SECRET)
    .update(base)
    .digest("hex");

  if (expectedSig !== sig) return null;

  const now = Math.floor(Date.now() / 1000);
  if (now - iat > APP_SESSION_TTL) return null; // hết hạn

  return { sid, iat };
}

export { APP_SESSION_TTL };
