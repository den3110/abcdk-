// utils/cursor.js
import crypto from "crypto";

const CURSOR_SECRET = process.env.CURSOR_SECRET || "dev-cursor-secret";

/**
 * Encode payload (VD: { lastId: "...", dir: "asc" }) thành cursor string
 */
export function encodeCursor(payload) {
  const json = JSON.stringify(payload);
  const sig = crypto
    .createHmac("sha256", CURSOR_SECRET)
    .update(json)
    .digest("hex");

  const data = JSON.stringify({ payload, sig });

  // base64url (không có =, +, / cho đẹp)
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decode cursor -> payload hoặc null nếu sai/ bị fake
 */
export function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== "string") return null;
  try {
    let b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    // bổ sung '=' cho đủ length % 4
    while (b64.length % 4 !== 0) b64 += "=";

    const raw = Buffer.from(b64, "base64").toString("utf8");
    const { payload, sig } = JSON.parse(raw);

    const json = JSON.stringify(payload);
    const expectedSig = crypto
      .createHmac("sha256", CURSOR_SECRET)
      .update(json)
      .digest("hex");

    if (sig !== expectedSig) return null; // bị sửa tay

    return payload;
  } catch (e) {
    return null;
  }
}
