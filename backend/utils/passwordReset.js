// utils/passwordReset.js
import crypto from "crypto";

export function createPasswordResetToken() {
  // token thô gửi qua email (không lưu DB)
  const raw = crypto.randomBytes(32).toString("hex");
  // hash để lưu DB
  const hashed = crypto.createHash("sha256").update(raw).digest("hex");
  // hết hạn 1 giờ
  const expiresAt = Date.now() + 60 * 60 * 1000;
  return { raw, hashed, expiresAt };
}

export function maskEmail(email = "") {
  const [user, domain] = email.split("@");
  if (!user || !domain) return email;
  const head = user.slice(0, 2);
  const tail = user.length > 4 ? user.slice(-1) : "";
  return `${head}${"*".repeat(
    Math.max(1, user.length - head.length - tail.length)
  )}${tail}@${domain}`;
}
