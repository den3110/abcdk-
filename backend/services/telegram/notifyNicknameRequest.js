// services/telegram/notifyNicknameRequest.js
// Gửi tin nhắn Telegram khi có user xin đổi biệt danh, kèm inline button
// [Duyệt] / [Từ chối] để admin thao tác thẳng trong Telegram.
// Dùng cùng TELEGRAM_CHAT_ID với KYC bot.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function tgApi(method, payload) {
  if (!BOT_TOKEN || !DEFAULT_CHAT_ID) return null;
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      }
    );
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok || j?.ok === false) {
      console.warn("[nickname-tg] " + method + " failed:", j?.description || resp.status);
    }
    return j;
  } catch (err) {
    console.warn("[nickname-tg] " + method + " error:", err?.message || err);
    return null;
  }
}

/**
 * Gửi thông báo yêu cầu đổi nickname mới cho admin duyệt qua Telegram.
 * @param {object} request - NicknameChangeRequest doc (đã save)
 * @param {object} user - User doc (đã save, snapshot lúc request)
 */
export async function notifyNewNicknameRequest(request, user) {
  if (!BOT_TOKEN || !DEFAULT_CHAT_ID) return;
  const requestedAt = request.requestedAt || request.createdAt || new Date();
  const lines = [
    "🪪 <b>YÊU CẦU ĐỔI BIỆT DANH</b>",
    `• User: <b>${esc(user.name || user.nickname || "-")}</b>`,
    `• ID: <code>${esc(String(user._id))}</code>`,
    `• SĐT: ${esc(user.phone || "-")}`,
    user.email ? `• Email: ${esc(user.email)}` : null,
    user.province ? `• Tỉnh: ${esc(user.province)}` : null,
    "",
    `• Biệt danh cũ: <b>${esc(request.oldNickname || user.nickname || "-")}</b>`,
    `• Biệt danh mới: <b>${esc(request.newNickname)}</b>`,
    `• Thời điểm: ${new Date(requestedAt).toLocaleString("vi-VN")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: "✅ Duyệt",
          callback_data: `nick:approve:${String(request._id)}`,
        },
        {
          text: "❌ Từ chối",
          callback_data: `nick:reject:${String(request._id)}`,
        },
      ],
    ],
  };

  await tgApi("sendMessage", {
    chat_id: DEFAULT_CHAT_ID,
    text: lines,
    parse_mode: "HTML",
    reply_markup,
    disable_web_page_preview: true,
  });
}

/**
 * Cập nhật lại tin nhắn Telegram sau khi ai đó duyệt/từ chối.
 * Không edit inline_keyboard nếu chỉ có message id — dùng bên trong bot.action.
 */
export function buildResultHtml({ request, resolvedBy, actionLabel }) {
  const lines = [
    `${actionLabel} <b>${esc(request.newNickname)}</b>`,
    `• User: <code>${esc(String(request.user))}</code>`,
    `• Biệt danh cũ: <b>${esc(request.oldNickname || "-")}</b>`,
    resolvedBy ? `• Xử lý bởi: ${esc(resolvedBy)}` : null,
    request.rejectionReason
      ? `• Lý do: <i>${esc(request.rejectionReason)}</i>`
      : null,
    `• Thời điểm: ${new Date().toLocaleString("vi-VN")}`,
  ]
    .filter(Boolean)
    .join("\n");
  return lines;
}
