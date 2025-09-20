// utils/telegram.js
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const FRONTEND_URL = process.env.NODE_ENV=== "production" ? (process.env.HOST ?? process.env.WEB_URL ?? "").replace(
  /\/+$/,
  ""
) : "https://localhost:5001";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
if (!BOT_TOKEN) {
  console.warn("[telegram] Missing TELEGRAM_BOT_TOKEN");
}
const DEFAULT_CHAT_IDS = (process.env.TELEGRAM_CHAT_ID ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

export const htmlEscape = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

async function tg(method, params) {
  const r = await fetch(`${BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  let j;
  try {
    j = await r.json();
  } catch {
    const txt = await r.text().catch(() => "");
    throw new Error(`${method} failed: http ${r.status} ${txt}`);
  }
  if (!j?.ok) {
    throw new Error(`${method} failed: ${j?.description || "unknown error"}`);
  }
  return j.result;
}

/* ─────────────────────────────
   Core send helpers (single/broadcast)
   ───────────────────────────── */

/**
 * Gửi text. Nếu không truyền chat_id, sẽ broadcast tới tất cả DEFAULT_CHAT_ID (env).
 * Hỗ trợ message_thread_id (topic).
 */
export async function tgSend(
  text,
  {
    chat_id, // string | number
    message_thread_id, // topic id
    parse_mode = "HTML",
    disable_web_page_preview = true,
    reply_markup,
    reply_to_message_id,
  } = {}
) {
  const payload = {
    text,
    parse_mode,
    disable_web_page_preview,
    reply_markup,
    reply_to_message_id,
    message_thread_id,
  };

  if (chat_id) {
    return tg("sendMessage", { chat_id, ...payload });
  }

  if (!DEFAULT_CHAT_IDS.length) {
    console.warn("[telegram] No TELEGRAM_CHAT_ID configured; skip send.");
    return null;
  }

  // broadcast tới nhiều chat_id
  const results = [];
  for (const cid of DEFAULT_CHAT_IDS) {
    try {
      const res = await tg("sendMessage", { chat_id: cid, ...payload });
      results.push(res);
    } catch (err) {
      console.error(
        "[telegram] sendMessage broadcast error:",
        cid,
        err?.message || err
      );
    }
  }
  return results.length === 1 ? results[0] : results;
}

/** Gửi ảnh qua URL (sendPhoto). Hỗ trợ topic & broadcast logic như tgSend */
export async function tgSendPhotoUrl({
  chat_id,
  photo,
  caption,
  parse_mode = "HTML",
  reply_markup,
  reply_to_message_id,
  message_thread_id,
}) {
  const payload = {
    photo,
    caption,
    parse_mode,
    reply_markup,
    reply_to_message_id,
    message_thread_id,
  };

  if (chat_id) return tg("sendPhoto", { chat_id, ...payload });

  if (!DEFAULT_CHAT_IDS.length) {
    console.warn("[telegram] No TELEGRAM_CHAT_ID configured; skip sendPhoto.");
    return null;
  }
  const results = [];
  for (const cid of DEFAULT_CHAT_IDS) {
    try {
      const res = await tg("sendPhoto", { chat_id: cid, ...payload });
      results.push(res);
    } catch (err) {
      console.error(
        "[telegram] sendPhoto broadcast error:",
        cid,
        err?.message || err
      );
    }
  }
  return results.length === 1 ? results[0] : results;
}

/** Gửi document qua URL (sendDocument). Hỗ trợ topic & broadcast logic như tgSend */
export async function tgSendDocumentUrl({
  chat_id,
  document,
  caption,
  parse_mode = "HTML",
  reply_markup,
  reply_to_message_id,
  message_thread_id,
}) {
  const payload = {
    document,
    caption,
    parse_mode,
    reply_markup,
    reply_to_message_id,
    message_thread_id,
  };

  if (chat_id) return tg("sendDocument", { chat_id, ...payload });

  if (!DEFAULT_CHAT_IDS.length) {
    console.warn(
      "[telegram] No TELEGRAM_CHAT_ID configured; skip sendDocument."
    );
    return null;
  }
  const results = [];
  for (const cid of DEFAULT_CHAT_IDS) {
    try {
      const res = await tg("sendDocument", { chat_id: cid, ...payload });
      results.push(res);
    } catch (err) {
      console.error(
        "[telegram] sendDocument broadcast error:",
        cid,
        err?.message || err
      );
    }
  }
  return results.length === 1 ? results[0] : results;
}

/* ─────────────────────────────
   Inline/callback utilities
   ───────────────────────────── */

export async function tgAnswerCallbackQuery({
  callback_query_id,
  text = "",
  show_alert = false,
  cache_time, // optional
}) {
  return tg("answerCallbackQuery", {
    callback_query_id,
    text,
    show_alert,
    cache_time,
  });
}

export async function tgEditMessageReplyMarkup({
  chat_id,
  message_id,
  reply_markup,
}) {
  return tg("editMessageReplyMarkup", { chat_id, message_id, reply_markup });
}

export async function tgEditMessageText({
  chat_id,
  message_id,
  text,
  parse_mode = "HTML",
  disable_web_page_preview = true,
  reply_markup,
}) {
  return tg("editMessageText", {
    chat_id,
    message_id,
    text,
    parse_mode,
    disable_web_page_preview,
    reply_markup,
  });
}

/* ─────────────────────────────
   Your existing helpers (kept)
   ───────────────────────────── */

export async function createForumTopic({ chatId, name }) {
  // Trả về ForumTopic { message_thread_id, ... }
  const res = await tg("createForumTopic", { chat_id: chatId, name });
  return res?.message_thread_id; // int
}

export async function sendToTopic({
  chatId,
  topicId,
  text,
  parseMode = "HTML",
  reply_markup,
  reply_to_message_id,
}) {
  // Gửi vào đúng topic bằng message_thread_id
  return tg("sendMessage", {
    chat_id: chatId,
    message_thread_id: topicId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
    reply_markup,
    reply_to_message_id,
  });
}

export async function createInviteLink({ chatId, name }) {
  const res = await tg("createChatInviteLink", { chat_id: chatId, name });
  return res?.invite_link;
}

// Xóa webhook (để bật polling, tránh 409 Conflict)
export async function tgDeleteWebhook({ drop_pending_updates = false } = {}) {
  return tg("deleteWebhook", { drop_pending_updates });
}

// Gọi getUpdates (polling)
export async function tgGetUpdates({
  offset,
  timeout = 50, // seconds
  allowed_updates = ["callback_query"], // chỉ nhận callback
} = {}) {
  return tg("getUpdates", { offset, timeout, allowed_updates });
}