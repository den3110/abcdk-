import { verifySlackRequest } from "../middleware/verifySlack.js";
import { sendTelegramMessage } from "../services/telegram.service.js";

// dedup event_id tránh Slack retry spam
const seen = new Map(); // eventId -> expireAtMs
function isDup(eventId) {
  const now = Date.now();
  for (const [k, exp] of seen) if (exp <= now) seen.delete(k);

  if (!eventId) return false;
  if (seen.has(eventId)) return true;
  seen.set(eventId, now + 10 * 60 * 1000); // 10 phút
  return false;
}

function safeClip(s, max = 3500) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "…";
}

function shouldForward(text) {
  // tuỳ bạn, mình lọc nhẹ để khỏi forward mấy tin chat thường
  const t = String(text || "");
  return /crashlytics|fatal|anr|regression|velocity|crash/i.test(t);
}

// controllers/slackEventsController.js
export async function slackEventsHandler(req, res) {
  const rawBody = req.body

  // ✅ Slack verify URL: trả plaintext challenge
  if (rawBody.type === "url_verification") {
    return res
      .status(200)
      .type("text/plain")
      .send(String(rawBody.challenge || ""));
  }

  // các event khác thì ack 200
  return res.status(200).send("ok");
}
