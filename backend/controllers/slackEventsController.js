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

export async function slackEventsHandler(req, res) {
  const rawBody = req.body?.toString("utf8") || "";

  // 1) verify signature
  if (!verifySlackRequest(req, rawBody)) {
    return res.status(401).send("bad signature");
  }

  // 2) parse JSON
  let payload = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).send("bad json");
  }

  // 3) url_verification (Slack verify Request URL)
  if (payload?.type === "url_verification") {
    return res.status(200).json({ challenge: payload?.challenge });
  }

  // 4) ACK nhanh
  res.status(200).send("ok");

  // 5) xử lý async
  try {
    if (payload?.type !== "event_callback") return;
    if (isDup(payload?.event_id)) return;

    const ev = payload?.event;
    if (!ev || ev.type !== "message") return;

    // lọc đúng channel (optional)
    const targetChannel = process.env.SLACK_CRASH_CHANNEL_ID;
    if (targetChannel && ev.channel !== targetChannel) return;

    // bỏ message changed/deleted...
    // Firebase post qua webhook thường là bot_message, mình cho qua luôn
    if (ev.subtype && ev.subtype !== "bot_message") return;

    const text = String(ev.text || "").trim();
    if (!text) return;

    if (!shouldForward(text)) return;

    await sendTelegramMessage(`🧯 Crashlytics Alert\n\n${safeClip(text)}`);
  } catch (e) {
    console.error("[slack->tele] forward error:", e?.message || e);
  }
}
