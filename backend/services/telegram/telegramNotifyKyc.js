// server/services/telegramNotify.js
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // group/private chat id
const HOST = (process.env.HOST || "").replace(/\/+$/, ""); // ví dụ: https://pickletour.vn
const toPosix = (s = "") => s.replace(/\\/g, "/");

// ---------------- Core API helpers ----------------
async function tgApi(method, body) {
  if (!BOT_TOKEN || !DEFAULT_CHAT_ID) return { ok: false, skipped: true };
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok || json?.ok === false) {
    console.error(`Telegram ${method} failed: ${res.status} ${text}`);
  }
  return json;
}

export async function tgSend(text, opts = {}) {
  return tgApi("sendMessage", {
    chat_id: DEFAULT_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...opts, // có thể truyền reply_to_message_id, reply_markup, ...
  });
}

async function tgSendPhotoUrl({
  photo,
  caption,
  reply_markup,
  parse_mode = "HTML",
  reply_to_message_id,
}) {
  return tgApi("sendPhoto", {
    chat_id: DEFAULT_CHAT_ID,
    photo,
    caption,
    parse_mode,
    ...(reply_markup ? { reply_markup } : {}),
    ...(reply_to_message_id ? { reply_to_message_id } : {}),
  });
}

async function tgSendDocumentUrl({
  document,
  caption,
  parse_mode = "HTML",
  reply_to_message_id,
}) {
  return tgApi("sendDocument", {
    chat_id: DEFAULT_CHAT_ID,
    document,
    ...(caption ? { caption, parse_mode } : {}),
    ...(reply_to_message_id ? { reply_to_message_id } : {}),
  });
}

function normalizeImageUrl(raw = "") {
  if (!raw) return "";
  let s = String(raw)
    .trim()
    .replace(/^http:\/\//i, "https://");
  try {
    const u = new URL(s); // absolute
    return u.toString();
  } catch {
    if (!HOST) return "";
    const path = s.startsWith("/") ? s : `/${s}`;
    return `${HOST}${path}`;
  }
}

// ---------------- Public APIs ----------------

// Gọi từ controller nộp KYC
// Yêu cầu mới:
// - LUÔN gửi tin nhắn KYC (text + buttons) TRƯỚC.
// - Sau đó mới gửi ảnh CCCD (mặt trước/mặt sau), reply vào message KYC.
// - Nếu sendPhoto lỗi -> fallback sendDocument (URL). Nếu vẫn lỗi -> bỏ qua ảnh đó.
export async function notifyNewKyc(user) {
  if (!user || !BOT_TOKEN || !DEFAULT_CHAT_ID) return;

  const captionLines = [
    "🆕 <b>KYC mới</b>",
    `👤 <b>${user?.name || "Ẩn danh"}</b>${
      user?.nickname ? " <i>(" + user.nickname + ")</i>" : ""
    }`,
    user?.email ? `✉️ ${user.email}` : "",
    user?.phone ? `📞 ${user.phone}` : "",
    user?.province ? `📍 ${user.province}` : "",
    user?.cccd ? `🪪 CCCD: <code>${user.cccd}</code>` : "",
    user?.createdAt
      ? `🕒 ${new Date(user.createdAt).toLocaleString("vi-VN")}`
      : "",
    "",
    "Trạng thái: <b>Chờ KYC</b>",
  ].filter(Boolean);
  const caption = captionLines.join("\n");

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ Duyệt", callback_data: `kyc:approve:${user._id}` },
        { text: "❌ Từ chối", callback_data: `kyc:reject:${user._id}` },
      ],
    ],
  };

  const frontUrl = normalizeImageUrl(toPosix(user?.cccdImages?.front || ""));
  const backUrl = normalizeImageUrl(toPosix(user?.cccdImages?.back || ""));

  // 1) GỬI TIN NHẮN KYC TRƯỚC
  const sentMsg = await tgSend(caption, { reply_markup });
  const replyToId = sentMsg?.result?.message_id;

  // 2) SAU ĐÓ GỬI ẢNH (reply vào tin nhắn vừa gửi)
  async function sendOnePhoto(url, label) {
    if (!url) return;
    // Thử sendPhoto trước
    const r = await tgSendPhotoUrl({
      photo: url,
      caption: label,
      reply_to_message_id: replyToId,
    });
    if (r?.ok) return r;

    // Fallback: sendDocument (URL)
    const r2 = await tgSendDocumentUrl({
      document: url,
      caption: label,
      reply_to_message_id: replyToId,
    });
    if (!r2?.ok) {
      console.error("Failed to send photo/document for:", url);
    }
    return r2;
  }

  // Gửi mặt trước rồi mặt sau (nếu có)
  if (frontUrl) {
    await sendOnePhoto(frontUrl, "CCCD - Mặt trước");
  }
  if (backUrl) {
    await sendOnePhoto(backUrl, "CCCD - Mặt sau");
  }
}

// (tuỳ chọn) Thông báo khi duyệt/từ chối
export async function notifyKycReviewed(user, action) {
  const map = { approve: "✅ ĐÃ DUYỆT", reject: "❌ BỊ TỪ CHỐI" };
  const tag = map[action] || action;
  const text = [
    `🔔 <b>Kết quả KYC</b>: ${tag}`,
    `👤 ${user?.name || "—"}${
      user?.nickname ? " (" + user.nickname + ")" : ""
    }`,
    user?.email ? `✉️ ${user.email}` : "",
    user?.phone ? `📞 ${user.phone}` : "",
    user?.cccd ? `🪪 ${user.cccd}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return tgSend(text);
}

// ---------------- Register callback buttons ----------------
// KHÔNG xoá nút sau khi bấm; Idempotent nếu bấm lại.
export function registerKycReviewButtons(
  bot,
  { UserModel, onAfterReview } = {}
) {
  if (!bot) return;

  bot.on("callback_query", async (ctx) => {
    const data = String(ctx.callbackQuery?.data || "");
    if (!data.startsWith("kyc:")) return;

    try {
      const [, action, userId] = data.split(":");
      if (!userId || !["approve", "reject"].includes(action)) {
        return ctx.answerCbQuery("Callback không hợp lệ.");
      }

      const UM = UserModel || (await import("../models/userModel.js")).default;
      const user = await UM.findById(userId);
      if (!user) {
        await ctx.answerCbQuery("Không tìm thấy người dùng.", {
          show_alert: true,
        });
        return;
      }

      // Idempotent
      if (user.cccdStatus === "verified" && action === "approve") {
        await ctx.answerCbQuery("Đã duyệt trước đó ✅");
        return;
      }
      if (user.cccdStatus === "rejected" && action === "reject") {
        await ctx.answerCbQuery("Đã từ chối trước đó ❌");
        return;
      }

      user.cccdStatus = action === "approve" ? "verified" : "rejected";
      await user.save();

      await ctx.answerCbQuery(
        action === "approve" ? "Đã duyệt ✅" : "Đã từ chối ❌"
      );
      await notifyKycReviewed(user, action);

      if (typeof onAfterReview === "function") {
        try {
          await onAfterReview({ user, action, reviewer: ctx.from });
        } catch (e) {
          console.warn("onAfterReview hook error:", e?.message);
        }
      }
    } catch (e) {
      console.error("registerKycReviewButtons error:", e);
      try {
        await ctx.answerCbQuery("Có lỗi xảy ra.", { show_alert: true });
      } catch {}
    }
  });
}
