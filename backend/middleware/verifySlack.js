// src/middleware/verifySlack.js
import crypto from "crypto";

function clip(s = "", n = 120) {
  const t = String(s || "");
  return t.length <= n ? t : t.slice(0, n) + "…";
}

function maskSig(s = "") {
  const t = String(s || "");
  if (!t) return "";
  if (t.length <= 18) return t;
  return `${t.slice(0, 10)}…${t.slice(-6)}`;
}

export function verifySlackRequest(req, res, next) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";

  console.log("[slack][verify] === start ===");
  console.log("[slack][verify] req", {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    hasSecret: !!signingSecret,
    secretLen: signingSecret ? signingSecret.length : 0,
  });

  if (!signingSecret) {
    console.log("[slack][verify] SKIP: missing SLACK_SIGNING_SECRET");
    console.log("[slack][verify] === end (skip) ===");
    return next();
  }

  const ts = req.header("X-Slack-Request-Timestamp");
  const sig = req.header("X-Slack-Signature");

  console.log("[slack][verify] headers", {
    hasTs: !!ts,
    hasSig: !!sig,
    tsRaw: ts || null,
    tsNum: ts ? Number(ts) : null,
    sig: sig ? maskSig(sig) : null,
  });

  if (!ts || !sig) {
    console.log("[slack][verify] FAIL: missing slack headers");
    console.log("[slack][verify] === end (401) ===");
    return res.status(401).send("missing slack headers");
  }

  const now = Math.floor(Date.now() / 1000);
  const tsNum = Number(ts);
  const delta = Number.isFinite(tsNum) ? Math.abs(now - tsNum) : null;

  console.log("[slack][verify] timestamp", {
    now,
    ts: tsNum,
    deltaSec: delta,
    ok: Number.isFinite(tsNum) && delta <= 60 * 5,
  });

  if (!Number.isFinite(tsNum) || delta > 60 * 5) {
    console.log("[slack][verify] FAIL: stale request");
    console.log("[slack][verify] === end (401) ===");
    return res.status(401).send("stale request");
  }

  const rawBody = String(req.rawBody || "");
  console.log("[slack][verify] rawBody", {
    hasRawBody: !!rawBody,
    rawLen: rawBody.length,
    rawPreview: rawBody ? clip(rawBody, 200) : "",
  });

  if (!rawBody) {
    console.log(
      "[slack][verify] FAIL: missing rawBody. (Bạn phải set req.rawBody trong express.json verify hoặc dùng express.raw)"
    );
    console.log("[slack][verify] === end (401) ===");
    return res.status(401).send("missing rawBody");
  }

  const baseString = `v0:${ts}:${rawBody}`;
  console.log("[slack][verify] baseString", {
    baseLen: baseString.length,
    basePreview: clip(baseString, 120),
  });

  const mySig =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(baseString, "utf8")
      .digest("hex");

  console.log("[slack][verify] signature compare", {
    computed: maskSig(mySig),
    received: maskSig(sig),
    computedLen: mySig.length,
    receivedLen: sig.length,
  });

  const a = Buffer.from(mySig);
  const b = Buffer.from(sig);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  console.log("[slack][verify] result", { ok });

  if (!ok) {
    console.log("[slack][verify] FAIL: bad signature");
    console.log("[slack][verify] === end (401) ===");
    return res.status(401).send("bad signature");
  }

  console.log("[slack][verify] PASS ✅");
  console.log("[slack][verify] === end (next) ===");
  return next();
}
