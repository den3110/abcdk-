import { sendTelegramMessage } from "../services/telegram.service.js";

// dedup event_id tránh Slack retry spam
const seen = new Map();
function isDup(eventId) {
  const now = Date.now();
  for (const [k, exp] of seen) if (exp <= now) seen.delete(k);
  if (!eventId) return false;
  if (seen.has(eventId)) return true;
  seen.set(eventId, now + 10 * 60 * 1000);
  return false;
}

function safeClip(s, max = 3500) {
  const t = String(s || "").trim();
  return t.length <= max ? t : t.slice(0, max) + "…";
}

function shouldForward(text) {
  const t = String(text || "");
  return /crashlytics|fatal|anr|regression|velocity|crash/i.test(t);
}

export async function slackEventsHandler(req, res) {
  const rawBody = req.body || {};

  // ✅ Slack verify URL: trả plaintext challenge
  if (rawBody.type === "url_verification") {
    return res
      .status(200)
      .type("text/plain")
      .send(String(rawBody.challenge || ""));
  }
  // ✅ ACK ngay cho Slack trước (tránh timeout)
  res.status(200).send("ok");

  // ===== xử lý async để bắn Telegram =====
  setImmediate(async () => {
    try {
      if (rawBody.type !== "event_callback") return;
      if (isDup(rawBody.event_id)) return;

      const ev = rawBody.event;
      console.log(ev)
      console.log(0);

      if (!ev || ev.type !== "message") return;

      // lọc đúng channel (khuyên set env cho chắc)
      const targetChannel = process.env.TELEGRAM_CHAT_CRASH_ID;
      console.log(1);
      if (targetChannel && ev.channel !== targetChannel) return;
      console.log(2);
      // bỏ edit/delete
      if (ev.subtype && ev.subtype !== "bot_message") return;

      const text = String(ev.text || "").trim();
      if (!text) return;
      console.log(3);
      if (!shouldForward(text)) return;
      console.log(4);

      await sendTelegramMessage(`🧯 Crashlytics Alert\n\n${safeClip(text)}`);
      console.log(5);
    } catch (e) {
      console.error("[slack->tele] forward error:", e?.message || e);
    }
  });
}
