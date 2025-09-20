// utils/notifyNewComplaint.js  (ESM)
import { tgSend, htmlEscape } from "../../utils/telegram.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
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
  return phone
    ? `${label}: <b>${htmlEscape(name)}</b> — ${htmlEscape(phone)}`
    : `${label}: <b>${htmlEscape(name)}</b>`;
};

/**
 * Gửi thông báo khi có khiếu nại mới
 * - KHÔNG dùng callback_data nữa.
 * - Dùng Reply Keyboard với 2 nút lệnh: /complaint_resolve <id>, /complaint_reject <id>
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
    "",
    "➡️ Bấm một trong hai nút lệnh bên dưới để cập nhật trạng thái.",
  ].filter(Boolean);

  const caption = captionLines.join("\n");

  // Link tiện dụng (nếu có FRONTEND_URL)
  const regUrl =
    FRONTEND_URL && registration?._id && tournament?._id
      ? `${FRONTEND_URL}/tournament/${tournament._id}/registration/${registration._id}`
      : null;
  const tourUrl =
    FRONTEND_URL && tournament?._id
      ? `${FRONTEND_URL}/tournament/${tournament._id}`
      : null;

  // Reply Keyboard (KHÔNG dùng inline/callback)
  const resolveCmd = `/complaint_resolve ${String(complaint._id)}`;
  const rejectCmd = `/complaint_reject ${String(complaint._id)}`;

  const reply_markup = {
    keyboard: [
      [{ text: resolveCmd }, { text: rejectCmd }],
      [
        ...(regUrl
          ? [
              {
                text: "👀 Xem Đăng ký",
                web_app: undefined,
                request_contact: false,
              },
            ]
          : []),
        ...(tourUrl
          ? [
              {
                text: "🧭 Xem giải",
                web_app: undefined,
                request_contact: false,
              },
            ]
          : []),
      ].filter(Boolean),
    ].filter((row) => row.length),
    resize_keyboard: true,
    one_time_keyboard: true,
    selective: false,
  };

  // Gửi (không topic)
  const sentMsg = await tgSend(caption, {
    reply_markup,
    chat_id: chatId, // nếu không truyền, tgSend sẽ dùng env TELEGRAM_CHAT_ID
  });

  // Nếu có link, gửi kèm link dạng message riêng (đỡ “fake” nút URL trong reply keyboard)
  if (regUrl || tourUrl) {
    const linkLines = [
      regUrl ? `👀 Xem Đăng ký: ${regUrl}` : "",
      tourUrl ? `🧭 Xem giải: ${tourUrl}` : "",
    ].filter(Boolean);
    if (linkLines.length) {
      await tgSend(linkLines.join("\n"), {
        chat_id: chatId,
        reply_to_message_id: sentMsg?.message_id ?? sentMsg?.result?.message_id,
      });
    }
  }

  return sentMsg;
}

/**
 * Gửi thông báo khi trạng thái khiếu nại thay đổi (sau khi gửi lệnh)
 * → Gửi một TIN NHẮN MỚI (có thể reply vào tin gốc nếu truyền replyToMessageId)
 */
export async function notifyComplaintStatusChange({
  complaint,
  tournament,
  registration,
  newStatus, // "resolved" | "rejected" | "in_progress"
  actor, // người bấm/ra lệnh
  chatId, // chat của message gốc hoặc để trống dùng DEFAULT_CHAT_ID
  replyToMessageId, // optional
}) {
  if (!complaint || !tournament || !registration || !newStatus) return;

  const code = regCodeOf(registration);
  const p1 = registration?.player1;
  const p2 = registration?.player2;

  const actorName = actor?.username
    ? `@${actor.username}`
    : [actor?.first_name, actor?.last_name].filter(Boolean).join(" ") || "BTC";

  const statusLabel =
    newStatus === "resolved"
      ? "✅ ĐÃ XỬ LÝ"
      : newStatus === "rejected"
      ? "❌ TỪ CHỐI"
      : newStatus === "in_progress"
      ? "🔁 ĐANG XỬ LÝ"
      : newStatus;

  const lines = [
    "🧾 <b>Cập nhật khiếu nại</b>",
    tournament?.name ? `🏆 <b>${htmlEscape(tournament.name)}</b>` : "",
    code ? `#️⃣ Mã ĐK: <code>${htmlEscape(code)}</code>` : "",
    "",
    "👥 <b>Cặp đăng ký</b>",
    lineForPlayer("• VĐV 1", p1),
    p2 ? lineForPlayer("• VĐV 2", p2) : undefined,
    "",
    `📌 Trạng thái: <b>${statusLabel}</b>`,
    `👤 Thao tác bởi: ${htmlEscape(actorName)}`,
    `🕒 ${new Date().toLocaleString("vi-VN")}`,
  ].filter(Boolean);

  await tgSend(lines.join("\n"), {
    ...(chatId ? { chat_id: chatId } : {}),
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    // Có thể gửi kèm remove_keyboard để đóng bàn phím tạm:
    reply_markup: { remove_keyboard: true },
  });
}
