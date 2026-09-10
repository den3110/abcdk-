// services/ops/opsTelegram.service.js
// Kênh Telegram RIÊNG cho cảnh báo vận hành (ops), tách khỏi bot KYC/support sẵn có.
//   TELEGRAM_OPS_BOT_TOKEN  (không set thì fallback TELEGRAM_BOT_TOKEN)
//   TELEGRAM_OPS_CHAT_ID    (CSV, hỗ trợ nhiều group)
//   TELEGRAM_OPS_THREAD_ID  (tuỳ chọn — topic trong group)
// Có hàng đợi tuần tự + giãn nhịp + retry 429 để không bị Telegram chặn.
import dotenv from "dotenv";

dotenv.config();

// Node ≥18 (prod chạy 20/22) có sẵn global fetch — không cần node-fetch.
const TG_API = "https://api.telegram.org";
const MAX_LEN = 3800; // giới hạn Telegram là 4096, chừa chỗ cho header/footer
const MIN_GAP_MS = 400; // ~2.5 msg/s, dưới hạn 20 msg/phút của group
const MAX_ATTEMPTS = 3;

function csv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getOpsTelegramConfig() {
  const token = String(
    process.env.TELEGRAM_OPS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || ""
  ).trim();
  const chatIds = csv(process.env.TELEGRAM_OPS_CHAT_ID);
  const threadId = String(process.env.TELEGRAM_OPS_THREAD_ID || "").trim();
  return { token, chatIds, threadId };
}

export function isOpsTelegramConfigured() {
  const { token, chatIds } = getOpsTelegramConfig();
  return Boolean(token && chatIds.length);
}

export const htmlEscape = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Cắt text dài thành nhiều mảnh, ưu tiên cắt ở ranh giới dòng. */
function splitMessage(text) {
  const raw = String(text || "");
  if (raw.length <= MAX_LEN) return [raw];

  const parts = [];
  let rest = raw;
  while (rest.length > MAX_LEN) {
    let cut = rest.lastIndexOf("\n", MAX_LEN);
    if (cut < MAX_LEN * 0.5) cut = MAX_LEN;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) parts.push(rest);
  return parts;
}

/* ───────────── hàng đợi tuần tự (một process gửi một lúc một tin) ───────────── */

let queue = Promise.resolve();
let lastSentAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callTelegram(token, method, payload) {
  const res = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok && body?.ok === true, status: res.status, body };
}

async function sendOne(token, payload) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const gap = Date.now() - lastSentAt;
    if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);

    const result = await callTelegram(token, "sendMessage", payload);
    lastSentAt = Date.now();
    if (result.ok) return result.body?.result || null;

    const retryAfter = Number(result.body?.parameters?.retry_after || 0);
    if (result.status === 429 && retryAfter > 0 && attempt < MAX_ATTEMPTS) {
      await sleep(Math.min(retryAfter, 30) * 1000);
      continue;
    }

    // parse_mode HTML hỏng (do nội dung lỗi escape) → gửi lại dạng text thuần
    const description = String(result.body?.description || "");
    if (/can't parse entities/i.test(description) && payload.parse_mode) {
      payload = { ...payload, parse_mode: undefined };
      continue;
    }

    if (attempt >= MAX_ATTEMPTS) {
      console.error(
        "[ops-telegram] sendMessage failed:",
        result.status,
        description || result.body
      );
      return null;
    }
    await sleep(500 * attempt);
  }
  return null;
}

/**
 * Gửi HTML tới toàn bộ TELEGRAM_OPS_CHAT_ID.
 * Không bao giờ throw — cảnh báo hỏng thì không được kéo theo request nghiệp vụ.
 */
export async function opsTgSend(html, { silent = false, chatId } = {}) {
  const { token, chatIds, threadId } = getOpsTelegramConfig();
  if (!token) return { sent: 0, skipped: "missing-token" };

  const targets = chatId ? [String(chatId)] : chatIds;
  if (!targets.length) return { sent: 0, skipped: "missing-chat-id" };

  const chunks = splitMessage(html);
  let sent = 0;

  queue = queue.then(async () => {
    for (const target of targets) {
      for (const chunk of chunks) {
        const payload = {
          chat_id: target,
          text: chunk,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          disable_notification: Boolean(silent),
        };
        if (threadId) payload.message_thread_id = Number(threadId);
        try {
          const res = await sendOne(token, payload);
          if (res) sent += 1;
        } catch (error) {
          console.error("[ops-telegram] send error:", error?.message || error);
        }
      }
    }
  });

  await queue.catch(() => {});
  return { sent, targets: targets.length, chunks: chunks.length };
}

/** Kiểm tra token/chat còn dùng được không (dùng cho endpoint test của admin). */
export async function opsTgProbe() {
  const { token, chatIds } = getOpsTelegramConfig();
  if (!token) return { ok: false, message: "Thiếu TELEGRAM_OPS_BOT_TOKEN" };
  const result = await callTelegram(token, "getMe", {});
  if (!result.ok) {
    return {
      ok: false,
      message: `getMe lỗi: ${result.body?.description || result.status}`,
    };
  }
  return {
    ok: true,
    bot: result.body?.result?.username || "",
    chatIds,
  };
}
