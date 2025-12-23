import crypto from "crypto";

function timingSafeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function verifySlackRequest(req, rawBody) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;

  const ts = req.header("X-Slack-Request-Timestamp");
  const sig = req.header("X-Slack-Signature");
  if (!ts || !sig) return false;

  // chống replay (5 phút)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 60 * 5) return false;

  const base = `v0:${ts}:${rawBody}`;
  const mySig =
    "v0=" +
    crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex");

  return timingSafeEqual(mySig, sig);
}
