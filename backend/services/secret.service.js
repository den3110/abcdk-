// services/secret.service.js
import crypto from "crypto";

const ENC_PREFIX = "enc:gcm:";
const ENABLED = String(process.env.LIVE_ENCRYPTION || "1") === "1";
console.log(ENABLED)

function decodeKey(b64) {
  if (!b64) return null;
  const buf = Buffer.from(b64, "base64");
  return buf.length === 32 ? buf : null;
}

const KEY_NEW = decodeKey(process.env.LIVE_SECRET_KEY_BASE64 || "");
const KEY_OLD = decodeKey(process.env.LIVE_SECRET_KEY_BASE64_OLD || "");

function assertKeyAvailable() {
  if (!ENABLED) return;
  if (!KEY_NEW)
    throw new Error(
      "LIVE_SECRET_KEY_BASE64 must be a base64-encoded 32-byte key when LIVE_ENCRYPTION=1"
    );
}

export function isEncryptionEnabled() {
  return ENABLED && !!KEY_NEW;
}

function encryptWithKey(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, enc]).toString("base64");
  return ENC_PREFIX + payload;
}

function decryptWithKey(payloadB64, key) {
  const raw = Buffer.from(payloadB64, "base64");
  if (raw.length < 12 + 16 + 1) throw new Error("ciphertext too short");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf8");
}

/** Encrypt before storing (if enabled) */
export function encryptToken(plain) {
  if (plain == null) return plain;
  if (!isEncryptionEnabled()) return String(plain);
  assertKeyAvailable();
  return encryptWithKey(String(plain), KEY_NEW);
}

/** Read from DB and always return plaintext */
export function decryptToken(stored) {
  if (stored == null) return stored;
  const s = String(stored);
  if (!s.startsWith(ENC_PREFIX)) return s; // plaintext (compat cũ)
  const payload = s.slice(ENC_PREFIX.length);
  let lastErr;
  for (const key of [KEY_NEW, KEY_OLD].filter(Boolean)) {
    try {
      return decryptWithKey(payload, key);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    "Failed to decrypt token with provided keys: " +
      (lastErr?.message || lastErr)
  );
}
