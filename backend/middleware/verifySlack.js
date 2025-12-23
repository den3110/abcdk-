// src/middleware/verifySlack.js
import crypto from "crypto";

export function verifySlackRequest(req, res, next) {
  const signingSecret = process.env.SLACK_CRASH_CHANNEL_ID || "";
  if (!signingSecret) return next(); // không set secret thì skip

  const ts = req.header("X-Slack-Request-Timestamp");
  const sig = req.header("X-Slack-Signature");

  if (!ts || !sig) return res.status(401).send("missing slack headers");

  // chống replay (5 phút)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 60 * 5) {
    return res.status(401).send("stale request");
  }

  const rawBody = String(req.rawBody || ""); // phải có rawBody
  const baseString = `v0:${ts}:${rawBody}`;

  const mySig =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(baseString, "utf8")
      .digest("hex");

  const a = Buffer.from(mySig);
  const b = Buffer.from(sig);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) return res.status(401).send("bad signature");

  next();
}
