// lib/telegram.js
import fetch from "node-fetch";
import dotenv from "dotenv"
dotenv.config()

const TOK = process.env.TELEGRAM_BOT_TOKEN;
const BASE = `https://api.telegram.org/bot${TOK}`;

async function tg(method, params) {
  const r = await fetch(`${BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method} failed: ${j.description}`);
  return j.result;
}

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
}) {
  // Gửi vào đúng topic bằng message_thread_id
  return tg("sendMessage", {
    chat_id: chatId,
    message_thread_id: topicId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  });
}

export async function createInviteLink({ chatId, name }) {
  const res = await tg("createChatInviteLink", { chat_id: chatId, name });
  return res?.invite_link;
}
