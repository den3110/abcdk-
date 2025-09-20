// utils/notifyNewComplaint.js  (ESM)
import { tgSend, htmlEscape } from "../../utils/telegram.js"; // sửa import

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
      ? `${FRONTEND_URL}/tournament/${tournament._id}/registration/${registration._id}`
      : null;
  const tourUrl =
    FRONTEND_URL && tournament?._id
      ? `${FRONTEND_URL}/tournament/${tournament._id}`
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
