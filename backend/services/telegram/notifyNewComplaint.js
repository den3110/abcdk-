// utils/notifyNewComplaint.js  (ESM)
import fetch from "node-fetch"; // dùng trực tiếp cho Telegram API

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_COMPLAINT_ID ?? "";
const FRONTEND_URL = (process.env.HOST ?? process.env.WEB_URL ?? "").replace(
  /\/+$/,
  ""
);

const displayName = (pl) =>
  pl?.nickName ||
  pl?.nickname ||
  pl?.user?.nickname ||
  pl?.fullName ||
  pl?.name ||
  pl?.displayName ||
  "—";

const getPhone = (pl) => pl?.phone || pl?.user?.phone || "";

const getScore = (pl) => {
  return "Điểm trình: " + pl?.score || parseInt(pl?.score) || "0";
};

const regCodeOf = (reg) =>
  reg?.code ||
  reg?.shortCode ||
  String(reg?._id || "")
    .slice(-5)
    .toUpperCase();

/** Tạo dòng mô tả một VĐV với sđt */
const lineForPlayer = (label, pl) => {
  if (!pl) return `${label}: <i>Chưa có</i>`;
  const name = displayName(pl);
  const phone = getPhone(pl);
  const score = getScore(pl);
  return phone
    ? `${label}: <b>${htmlEscape(name)}</b> — ${htmlEscape(
        phone
      )} — ${htmlEscape(score)}`
    : `${label}: <b>${htmlEscape(name)}</b> — ${htmlEscape(score)}`;
};

/**
 * Gửi thông báo khi có khiếu nại mới
 * - Có 2 nút inline: ✅ Đã xử lý / ❌ Từ chối
 * - Gửi vào TELEGRAM_CHAT_ID (hoặc chatId truyền vào). KHÔNG dùng topic.
 */
export async function notifyNewComplaint({
  tournament,
  registration,
  user,
  content,
  complaint,
  chatId, // optional: override chat
}) {
  const hasAnyChat = Boolean(chatId || DEFAULT_CHAT_ID);
  console.log(DEFAULT_CHAT_ID);
  if (!BOT_TOKEN || !hasAnyChat) return;
  if (!registration || !tournament || !user || !complaint) return;

  const code = regCodeOf(registration);
  const senderName =
    user?.nickname || user?.name || user?.email || "Người dùng";

  const p1 = registration?.player1;
  const p2 = registration?.player2;

  const captionLines = [
    "📣 <b>Khiếu nại mới</b>",
    tournament?.name ? `🏆 <b>${htmlEscape(tournament.name)}</b>` : "",
    code ? `#️⃣ Mã ĐK: <code>${htmlEscape(code)}</code>` : "",
    "",
    "👥 <b>Cặp đăng ký</b>",
    lineForPlayer("• VĐV 1", p1),
    p2 ? lineForPlayer("• VĐV 2", p2) : undefined,
    "",
    `🙋 <b>Người gửi:</b> ${htmlEscape(senderName)}`,
    complaint?.createdAt
      ? `🕒 ${new Date(complaint.createdAt).toLocaleString("vi-VN")}`
      : "",
    "",
    "<b>Nội dung:</b>",
    `<pre>${htmlEscape(String(content || "")).slice(0, 3500)}</pre>`,
  ].filter(Boolean);

  const caption = captionLines.join("\n");

  // Link tiện dụng (nếu có FRONTEND_URL)
  const regUrl =
    FRONTEND_URL && registration?._id && tournament?._id
      ? `${FRONTEND_URL}/tournament/${tournament._id}/register`
      : null;
  const tourUrl =
    FRONTEND_URL && tournament?._id
      ? `${FRONTEND_URL}/tournament/${tournament._id}/bracket`
      : null;

  const reply_markup = {
    inline_keyboard: [
      [
        regUrl && { text: "👀 Xem Đăng ký", url: regUrl },
        tourUrl && { text: "🧭 Xem giải", url: tourUrl },
      ].filter(Boolean),
      [
        complaint?._id && {
          text: "✅ Đã xử lý",
          callback_data: `complaint:resolve:${String(complaint._id)}`,
        },
        complaint?._id && {
          text: "❌ Từ chối",
          callback_data: `complaint:reject:${String(complaint._id)}`,
        },
      ].filter(Boolean),
    ].filter((row) => row.length),
  };

  // Gửi (không topic)
  const sentMsg = await tgSend(caption, {
    reply_markup,
    chat_id: chatId, // nếu không truyền, tgSend sẽ dùng env TELEGRAM_CHAT_ID
  });
  return sentMsg;
}

/**
 * Gửi thông báo khi trạng thái khiếu nại thay đổi (khi bấm nút)
 * -> Gửi một tin NHẮN MỚI (có thể reply ngay dưới tin gốc nếu truyền replyToMessageId)
 */
export async function notifyComplaintStatusChange({
  complaint,
  tournament,
  registration,
  newStatus, // "resolved" | "rejected" | "in_progress"
  actor, // cq.from (người bấm)
  chatId, // bắt buộc: chat của message gốc
  replyToMessageId, // optional: reply vào tin gốc
}) {
  if (!complaint || !tournament || !registration || !newStatus || !chatId)
    return;

  const code = regCodeOf(registration);
  const p1 = registration?.player1;
  const p2 = registration?.player2;

  const actorName = actor?.username
    ? `@${actor.username}`
    : [actor?.first_name, actor?.last_name].filter(Boolean).join(" ") || "BTC";

  const statusLabel = (s) =>
    s === "resolved"
      ? "✅ ĐÃ XỬ LÝ"
      : s === "rejected"
      ? "❌ TỪ CHỐI"
      : s === "in_progress"
      ? "🔁 ĐANG XỬ LÝ"
      : s;

  const lines = [
    "🧾 <b>Cập nhật khiếu nại</b>",
    tournament?.name ? `🏆 <b>${htmlEscape(tournament.name)}</b>` : "",
    code ? `#️⃣ Mã ĐK: <code>${htmlEscape(code)}</code>` : "",
    "",
    "👥 <b>Cặp đăng ký</b>",
    lineForPlayer("• VĐV 1", p1),
    p2 ? lineForPlayer("• VĐV 2", p2) : undefined,
    "",
    `📌 Trạng thái: <b>${statusLabel(newStatus)}</b>`,
    `👤 Thao tác bởi: ${htmlEscape(actorName)}`,
    `🕒 ${new Date().toLocaleString("vi-VN")}`,
  ].filter(Boolean);

  await tgSend(lines.join("\n"), {
    chat_id: chatId,
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
  });
}

// Cho phép nhiều chat id ngăn cách bởi dấu phẩy
const DEFAULT_CHAT_IDS = String(DEFAULT_CHAT_ID || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ===== Helpers: htmlEscape & Telegram API thin client =====
export function htmlEscape(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  // (Telegram HTML không cần escape ' )
}

async function tg(method, body) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing");
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Telegram response is not JSON: ${text}`);
  }
  if (!json.ok) {
    const desc = json.description || "Unknown Telegram error";
    throw new Error(desc);
  }
  return json.result;
}

// ===== tgSend: ưu tiên chat_id truyền vào, nếu không sẽ broadcast theo DEFAULT_CHAT_IDS =====
export async function tgSend(
  text,
  {
    chat_id, // string | number (ưu tiên nếu có)
    message_thread_id, // topic id
    parse_mode = "HTML",
    disable_web_page_preview = true,
    reply_markup,
    reply_to_message_id,
    disable_notification,
    protect_content,
  } = {}
) {
  // build payload chỉ với field có giá trị
  const payload = { text };
  if (parse_mode != null) payload.parse_mode = parse_mode;
  if (disable_web_page_preview != null)
    payload.disable_web_page_preview = disable_web_page_preview;
  if (reply_markup != null) payload.reply_markup = reply_markup;
  if (reply_to_message_id != null)
    payload.reply_to_message_id = reply_to_message_id;
  if (message_thread_id != null) payload.message_thread_id = message_thread_id;
  if (disable_notification != null)
    payload.disable_notification = disable_notification;
  if (protect_content != null) payload.protect_content = protect_content;

  // 1) Có chat_id -> gửi thẳng
  if (
    chat_id !== undefined &&
    chat_id !== null &&
    String(chat_id).trim() !== ""
  ) {
    return tg("sendMessage", { chat_id, ...payload });
  }

  // 2) Không có chat_id -> broadcast theo DEFAULT_CHAT_IDS
  if (!DEFAULT_CHAT_IDS.length) {
    console.warn(
      "[telegram] No TELEGRAM_CHAT_COMPLAINT_ID configured; skip send."
    );
    return null;
  }

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
