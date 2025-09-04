// server/services/telegramNotify.js
import fetch from "node-fetch";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // group/private chat id

export async function tgSend(text, opts = {}) {
  if (!BOT_TOKEN || !DEFAULT_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: DEFAULT_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...opts,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("Telegram send failed:", res.status, t);
  }
}

// Thông báo khi có KYC mới (gọi ở controller nộp KYC)
export async function notifyNewKyc(user) {
  if (!user) return;
  const lines = [
    "🆕 <b>KYC mới</b>",
    `👤 <b>${user?.name || "Ẩn danh"}</b>`,
    user?.nickname ? `🏷️ ${user.nickname}` : "",
    user?.email ? `✉️ ${user.email}` : "",
    user?.phone ? `📞 ${user.phone}` : "",
    user?.province ? `📍 ${user.province}` : "",
    user?.cccd ? `🪪 CCCD: <code>${user.cccd}</code>` : "",
    user?.createdAt
      ? `🕒 ${new Date(user.createdAt).toLocaleString("vi-VN")}`
      : "",
    "",
    "Trạng thái: <b>pending</b>",
    user?.cccdImages?.front ? "➡️ Ảnh mặt trước đã gửi" : "",
    user?.cccdImages?.back ? "➡️ Ảnh mặt sau đã gửi" : "",
  ].filter(Boolean);
  await tgSend(lines.join("\n"));
}

// (tuỳ chọn) Thông báo khi duyệt/từ chối
export async function notifyKycReviewed(user, action) {
  const map = { approve: "✅ ĐÃ DUYỆT", reject: "❌ BỊ TỪ CHỐI" };
  const tag = map[action] || action;
  const text = [
    `🔔 <b>Kết quả KYC</b>: ${tag}`,
    `👤 ${user?.name || "—"} ${
      user?.nickname ? "(" + user.nickname + ")" : ""
    }`,
    user?.email ? `✉️ ${user.email}` : "",
    user?.phone ? `📞 ${user.phone}` : "",
    user?.cccd ? `🪪 ${user.cccd}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  await tgSend(text);
}
