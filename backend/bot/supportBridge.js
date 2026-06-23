// server/bot/supportBridge.js
// --------------------------------------------------------------
// Support Bridge: nhận ticket/message từ app -> notify Telegram
// và admin reply ngay trên Telegram -> tạo message senderRole="staff"
// --------------------------------------------------------------

import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

import SupportTicket from "../models/supportTicketModel.js";
import SupportMessage from "../models/supportMessageModel.js";
import { getIO } from "../socket/index.js";
import {
  EVENTS,
  publishNotification,
} from "../services/notifications/notificationHub.js";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

let BOT_REF = null;

// quyền admin support
const TELE_SUPPORT_ADMIN_IDS = String(
  process.env.TELEGRAM_SUPPORT_ADMIN_IDS || process.env.TELEGRAM_ADMIN_IDS || ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// nơi nhận notify support (group hoặc private chat)
const TELE_SUPPORT_CHAT_IDS = String(
  process.env.TELEGRAM_SUPPORT_CHAT_IDS || ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const TELE_CRASH_CHAT_IDS = String(
  process.env.TELEGRAM_SUPPORT_CRASH_CHAT_IDS ||
    process.env.TELEGRAM_CHAT_CRASH_ID ||
    ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SUPPORT_CTX_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const supportCtx = new Map(); // chatId -> { ticketId, at }

/* ======================= Utils (safe) ======================= */

function escHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isSupportAdmin(telegramUserId) {
  try {
    if (!TELE_SUPPORT_ADMIN_IDS.length) return true;
    return TELE_SUPPORT_ADMIN_IDS.includes(String(telegramUserId));
  } catch {
    return false;
  }
}

function setSupportCtx(chatId, ticketId) {
  try {
    supportCtx.set(String(chatId), {
      ticketId: String(ticketId),
      at: Date.now(),
    });
  } catch {}
}

function getSupportCtx(chatId) {
  try {
    const it = supportCtx.get(String(chatId));
    if (!it) return null;
    if (Date.now() - it.at > SUPPORT_CTX_TTL_MS) {
      supportCtx.delete(String(chatId));
      return null;
    }
    return it.ticketId;
  } catch {
    return null;
  }
}

function clearSupportCtx(chatId) {
  try {
    supportCtx.delete(String(chatId));
  } catch {}
}

function shortId(id) {
  const s = String(id || "");
  return s.slice(-6);
}

function safePreview(s = "", maxLen = 160) {
  const t = String(s || "").trim();
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

function absUrl(p) {
  try {
    const host = String(process.env.HOST || "").replace(/\/+$/, "");
    if (!p) return "";
    if (/^https?:\/\//i.test(p)) return p;
    if (!host) return p;
    return host + (p.startsWith("/") ? p : `/${p}`);
  } catch {
    return String(p || "");
  }
}

function isCrashSupportPayload({ title, text, attachments = [] } = {}) {
  const haystack = [
    title,
    text,
    ...attachments.flatMap((a) => [a?.url, a?.name, a?.mime]),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return (
    haystack.includes("báo lỗi app bị văng") ||
    haystack.includes("app bị văng") ||
    haystack.includes("crash") ||
    haystack.includes("support-crash") ||
    haystack.includes("thông tin lỗi tự động")
  );
}

function normalizeSupportAttachment(a) {
  const url = absUrl(a?.url || "");
  if (!url) return null;
  return {
    url,
    name: String(a?.name || url.split("/").pop() || "attachment").trim(),
    mime: String(a?.mime || "").trim(),
    size: Number(a?.size || 0) || 0,
  };
}

function isTelegramPhotoAttachment(att) {
  const mime = String(att?.mime || "").toLowerCase();
  const url = String(att?.url || "").toLowerCase();
  return (
    mime.startsWith("image/") ||
    /\.(jpe?g|png|webp)(?:\?|#|$)/i.test(url)
  );
}

async function ensureDir(dir) {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (e) {
    console.warn("[supportBridge] ensureDir failed:", e?.message);
  }
}

/* ======================= Validation ======================= */

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

async function validateAndGetTicket(ticketId) {
  const tId = String(ticketId || "");

  if (!isValidObjectId(tId)) {
    throw new Error("TicketId không hợp lệ (phải là 24 ký tự hex)");
  }

  const ticket = await SupportTicket.findById(tId)
    .select("_id user title status lastMessageAt lastMessagePreview")
    .lean();

  if (!ticket) {
    throw new Error("Ticket không tồn tại");
  }

  return ticket;
}

/* ======================= Format helpers ======================= */

function formatTicketStatus(status) {
  const map = {
    open: "🟢 Mở",
    pending: "🟡 Chờ",
    closed: "⚫ Đã đóng",
  };
  return map[status] || status;
}

function formatTicketLine(ticket, index = 0) {
  const statusIcon = formatTicketStatus(ticket.status);
  const preview = ticket.lastMessagePreview || "—";
  const when = ticket.lastMessageAt
    ? new Date(ticket.lastMessageAt).toLocaleString("vi-VN")
    : "—";

  return [
    `${index ? `${index}. ` : ""}${statusIcon} <b>#${shortId(ticket._id)}</b>`,
    `   • Chủ đề: <i>${escHtml(ticket.title || "Hỗ trợ")}</i>`,
    `   • Tin nhắn cuối: <i>${escHtml(safePreview(preview, 60))}</i>`,
    `   • Cập nhật: <i>${when}</i>`,
    `   • ID: <code>${escHtml(String(ticket._id))}</code>`,
  ].join("\n");
}

/* ======================= Telegram REST (Bot API) ======================= */

const TG_API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tgCall(
  method,
  payload,
  { timeoutMs = 15000, retry429 = true } = {}
) {
  if (!TG_API_BASE) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  try {
    const { data } = await axios.post(`${TG_API_BASE}/${method}`, payload, {
      timeout: timeoutMs,
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
    });

    if (data?.ok) return data.result;

    // retry 429 once
    const code = data?.error_code;
    const retryAfter = data?.parameters?.retry_after;
    if (retry429 && code === 429 && retryAfter) {
      await sleep((Number(retryAfter) + 1) * 1000);
      return tgCall(method, payload, { timeoutMs, retry429: false });
    }

    throw new Error(
      `Telegram ${method} failed (${code || "?"}): ${
        data?.description || "Unknown"
      }`
    );
  } catch (e) {
    // axios network/timeout
    throw e;
  }
}

async function tgSendMessageChunked({
  chatId,
  text,
  parse_mode = "HTML",
  disable_web_page_preview = true,
  reply_markup,
}) {
  const s = String(text || "");
  if (!s) return null;

  // Telegram giới hạn ~4096; HTML chunk an toàn hơn
  const MAX = 3800;

  let last = null;
  for (let i = 0; i < s.length; i += MAX) {
    const chunk = s.slice(i, i + MAX);
    last = await tgCall("sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode,
      disable_web_page_preview,
      reply_markup: i === 0 ? reply_markup : undefined,
    });
  }
  return last;
}

async function tgSendSupportAttachment({ chatId, attachment, index }) {
  const att = normalizeSupportAttachment(attachment);
  if (!att) return null;

  const caption = `Đính kèm ${index}: ${escHtml(att.name)}`;

  try {
    if (isTelegramPhotoAttachment(att)) {
      return await tgCall("sendPhoto", {
        chat_id: chatId,
        photo: att.url,
        caption,
        parse_mode: "HTML",
      });
    }

    return await tgCall("sendDocument", {
      chat_id: chatId,
      document: att.url,
      caption,
      parse_mode: "HTML",
    });
  } catch (e) {
    console.warn(
      "[notifySupportToTelegram] send attachment failed:",
      chatId,
      att.url,
      e?.message || e
    );

    return tgSendMessageChunked({
      chatId,
      text: `<b>Đính kèm ${index}:</b> <a href="${escHtml(att.url)}">${escHtml(
        att.name
      )}</a>`,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });
  }
}

/* ======================= Telegram file -> uploads ======================= */

async function downloadTelegramFileToUploads(telegram, fileId) {
  if (!BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const file = await telegram.getFile(fileId);
  const filePath = file?.file_path;
  if (!filePath) throw new Error("Missing file_path");

  const ext = path.extname(filePath) || ".jpg";
  const name = `tg_support_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}${ext}`;

  const uploadDir = path.join(process.cwd(), "uploads", "support");
  await ensureDir(uploadDir);

  const abs = path.join(uploadDir, name);
  const tgUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

  const resp = await axios.get(tgUrl, {
    responseType: "arraybuffer",
    timeout: 20000,
  });

  await fs.promises.writeFile(abs, Buffer.from(resp.data));

  return {
    url: absUrl(`/uploads/support/${name}`),
    name,
    mime: "image/jpeg",
    size: Buffer.byteLength(resp.data),
  };
}

async function extractSupportAttachments(ctx) {
  const msg = ctx?.message || {};
  const out = [];

  try {
    // photo (lấy size lớn nhất)
    if (Array.isArray(msg.photo) && msg.photo.length) {
      const biggest = msg.photo[msg.photo.length - 1];
      const fileId = biggest?.file_id;
      if (fileId) {
        try {
          out.push(await downloadTelegramFileToUploads(ctx.telegram, fileId));
        } catch (e) {
          console.warn("[supportBridge] download photo failed:", e?.message);
        }
      }
    }

    // document (ảnh gửi dạng file)
    const doc = msg.document;
    if (doc?.file_id && String(doc?.mime_type || "").startsWith("image/")) {
      try {
        out.push(
          await downloadTelegramFileToUploads(ctx.telegram, doc.file_id)
        );
      } catch (e) {
        console.warn(
          "[supportBridge] download document image failed:",
          e?.message
        );
      }
    }
  } catch (e) {
    console.warn(
      "[supportBridge] extractSupportAttachments failed:",
      e?.message
    );
  }

  return out;
}

/* ======================= DB write (staff message) ======================= */

async function createSupportStaffMessage({
  ticketId,
  text,
  attachments,
  actor,
  actorLabel,
}) {
  const cleanText = String(text || "").trim();
  const cleanAtt = Array.isArray(attachments) ? attachments : [];

  if (!cleanText && cleanAtt.length === 0) {
    throw new Error("Nội dung tin nhắn trống");
  }

  // ✅ Validate ticket
  const ticket = await validateAndGetTicket(ticketId);

  // ✅ Check ticket đã đóng chưa
  if (ticket.status === "closed") {
    throw new Error("Ticket đã đóng, không thể reply");
  }

  // Create message
  const message = await SupportMessage.create({
    ticket: ticket._id,
    senderRole: "staff",
    senderUser: null,
    text: cleanText,
    attachments: cleanAtt.map((a) => ({
      url: a.url,
      mime: a.mime || "image/jpeg",
      name: a.name || "image.jpg",
      size: a.size || 0,
    })),
    meta: {
      telegram: {
        fromId: actor?.id,
        username: actor?.username,
        name: actorLabel?.(actor) || "",
      },
    },
  });

  // ✅ Emit socket về app
  try {
    const io = getIO();
    if (io && ticket.user) {
      const userId = String(ticket.user);

      io.to(`user:${userId}`).emit("support:newMessage", {
        ticketId: String(ticket._id),
        message: {
          _id: message._id,
          senderRole: message.senderRole,
          text: message.text,
          attachments: message.attachments,
          createdAt: message.createdAt,
          meta: message.meta,
        },
      });

      console.log(`✅ [supportBridge] Emitted newMessage to user:${userId}`);
    }
  } catch (e) {
    console.warn("[supportBridge] socket emit failed:", e?.message);
  }

  // Update ticket
  try {
    await SupportTicket.findByIdAndUpdate(ticket._id, {
      $set: {
        lastMessageAt: new Date(),
        lastMessagePreview:
          safePreview(cleanText) || (cleanAtt.length ? "[Ảnh đính kèm]" : ""),
        status: "pending", // ✅ Đánh dấu đang chờ user reply
      },
    });
  } catch (e) {
    console.warn("[supportBridge] ticket update failed:", e?.message);
  }

  // ✅ THÊM NOTIFICATION
  try {
    publishNotification(EVENTS.SUPPORT_STAFF_REPLIED, {
      ticketId: String(ticket._id),
      messageId: String(message._id),
      title: ticket.title || "Hỗ trợ",
      preview:
        safePreview(cleanText) || (cleanAtt.length ? "[Ảnh đính kèm]" : ""),
      // staffName: actorLabel?.(actor) || "Support", // ❌ BỎ DÒNG NÀY
      topicType: "support",
      topicId: String(ticket._id),
      category: "support",
    });
  } catch (e) {
    console.warn("[supportBridge] notification failed:", e?.message);
  }

  return message;
}

/* ======================= Public APIs ======================= */

/** gọi từ telegramBot để bind bot ref (chỉ phục vụ handlers, notify không cần) */
export function bindSupportBotRef(bot) {
  BOT_REF = bot || null;
  console.log("[supportBridge] BOT_REF bound?", !!BOT_REF);
  return BOT_REF;
}

/** gọi từ telegramBot để register handlers */
export function installSupportBridge({
  bot,
  safe,
  replySafe,
  esc,
  actorLabel,
}) {
  try {
    // ==================== /chatid ====================
    bot.command(
      "chatid",
      safe("support:chatid", async (ctx) => {
        const chatId = String(ctx.chat?.id || "");
        try {
          await replySafe(
            ctx,
            [
              `chatId: <code>${esc(chatId)}</code>`,
              "",
              "💡 <b>Cách config nhận notify support:</b>",
              "Thêm vào <code>.env</code>:",
              "<code>TELEGRAM_SUPPORT_CHAT_IDS=" + chatId + "</code>",
              "",
              "Nếu có nhiều chat (group + private):",
              "<code>TELEGRAM_SUPPORT_CHAT_IDS=123456," +
                chatId +
                ",789012</code>",
            ].join("\n"),
            { parse_mode: "HTML" }
          );
        } catch (e) {
          console.warn("[supportBridge] /chatid reply failed:", e?.message);
        }
      })
    );

    // ==================== /suplist ====================
    bot.command(
      "suplist",
      safe("support:suplist", async (ctx) => {
        if (!isSupportAdmin(ctx.from?.id)) {
          return replySafe(ctx, "Bạn không có quyền.");
        }

        const args = (ctx.message?.text || "").trim().split(/\s+/).slice(1);
        const statusFilter = args[0]; // open, pending, closed, hoặc all
        const limit = Math.min(parseInt(args[1] || "20", 10) || 20, 50);

        let query = {};
        if (
          statusFilter &&
          ["open", "pending", "closed"].includes(statusFilter)
        ) {
          query.status = statusFilter;
        } else if (!statusFilter || statusFilter === "all") {
          // Không filter, lấy tất cả
        } else {
          // Mặc định lấy open + pending
          query.status = { $in: ["open", "pending"] };
        }

        const tickets = await SupportTicket.find(query)
          .sort({ lastMessageAt: -1 })
          .limit(limit)
          .lean();

        if (!tickets.length) {
          return replySafe(
            ctx,
            [
              "📭 Không có ticket nào.",
              "",
              "<b>Cách dùng:</b>",
              "• <code>/suplist</code> — Liệt kê ticket open + pending (mặc định 20)",
              "• <code>/suplist open 30</code> — Chỉ ticket open, tối đa 30",
              "• <code>/suplist pending</code> — Chỉ ticket pending",
              "• <code>/suplist closed</code> — Ticket đã đóng",
              "• <code>/suplist all</code> — Tất cả ticket",
            ].join("\n"),
            { parse_mode: "HTML" }
          );
        }

        const header = `📋 <b>Danh sách Support Tickets (${tickets.length})</b>\n`;
        const lines = tickets.map((t, i) => formatTicketLine(t, i + 1));
        const summary = header + "\n" + lines.join("\n\n");

        if (summary.length <= 3900) {
          await replySafe(ctx, summary, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
          });
        } else {
          await replySafe(ctx, header, { parse_mode: "HTML" });
          for (const line of lines) {
            await replySafe(ctx, line, {
              parse_mode: "HTML",
              disable_web_page_preview: true,
            });
          }
        }

        await replySafe(
          ctx,
          [
            "",
            "💡 <b>Mẹo:</b>",
            "• <code>/supopen &lt;ticketId&gt;</code> để reply ticket",
            "• <code>/supdone</code> để đóng ticket hiện tại",
          ].join("\n"),
          { parse_mode: "HTML" }
        );
      })
    );

    // ==================== inline button open context ====================
    bot.action(
      /^support:open:([a-fA-F0-9]{24})$/,
      safe("support:open", async (ctx) => {
        if (!isSupportAdmin(ctx.from?.id)) {
          try {
            return ctx.answerCbQuery("Bạn không có quyền.", {
              show_alert: true,
            });
          } catch {
            return;
          }
        }

        const [, ticketId] = ctx.match || [];

        // ✅ Validate ticket
        let ticket;
        try {
          ticket = await validateAndGetTicket(ticketId);
        } catch (e) {
          try {
            return ctx.answerCbQuery(e.message, { show_alert: true });
          } catch {
            return;
          }
        }

        setSupportCtx(ctx.chat?.id, ticketId);

        try {
          await ctx.answerCbQuery("Đã chọn ticket ✅", { show_alert: false });
        } catch {}

        try {
          await replySafe(
            ctx,
            [
              `✅ Đã mở ticket #${esc(shortId(ticketId))}`,
              `• TicketId: <code>${esc(ticketId)}</code>`,
              `• Chủ đề: <b>${esc(ticket.title || "Hỗ trợ")}</b>`,
              `• Trạng thái: ${formatTicketStatus(ticket.status)}`,
              "",
              "Giờ bạn nhắn/ảnh bình thường để reply vào ticket này.",
              "Gõ /supdone để đóng ticket.",
            ].join("\n"),
            { parse_mode: "HTML", disable_web_page_preview: true }
          );
        } catch (e) {
          console.warn("[supportBridge] open reply failed:", e?.message);
        }
      })
    );

    // ==================== inline button done context ====================
    bot.action(
      /^support:done$/,
      safe("support:done", async (ctx) => {
        clearSupportCtx(ctx.chat?.id);

        try {
          await ctx.answerCbQuery("Đã thoát ✅", { show_alert: false });
        } catch {}

        try {
          await replySafe(ctx, "✅ Đã thoát khỏi support context.");
        } catch (e) {
          console.warn("[supportBridge] done reply failed:", e?.message);
        }
      })
    );

    // ==================== /supopen <ticketId> ====================
    bot.command(
      "supopen",
      safe("support:supopen", async (ctx) => {
        if (!isSupportAdmin(ctx.from?.id)) return;

        const args = (ctx.message?.text || "").trim().split(/\s+/).slice(1);
        const ticketId = args[0];

        if (!isValidObjectId(ticketId)) {
          try {
            return replySafe(
              ctx,
              "❌ TicketId không hợp lệ.\nCách dùng: /supopen <ticketId_24hex>"
            );
          } catch {
            return;
          }
        }

        // ✅ Validate ticket
        let ticket;
        try {
          ticket = await validateAndGetTicket(ticketId);
        } catch (e) {
          try {
            return replySafe(ctx, `❌ ${e.message}`);
          } catch {
            return;
          }
        }

        setSupportCtx(ctx.chat?.id, ticketId);

        try {
          await replySafe(
            ctx,
            [
              `✅ Đã mở ticket #${esc(shortId(ticketId))}`,
              `• TicketId: <code>${esc(ticketId)}</code>`,
              `• Chủ đề: <b>${esc(ticket.title || "Hỗ trợ")}</b>`,
              `• Trạng thái: ${formatTicketStatus(ticket.status)}`,
              "",
              "Giờ bạn nhắn/ảnh bình thường để reply vào ticket này.",
              "Gõ /supdone để đóng ticket.",
            ].join("\n"),
            { parse_mode: "HTML", disable_web_page_preview: true }
          );
        } catch (e) {
          console.warn("[supportBridge] supopen reply failed:", e?.message);
        }
      })
    );

    // ==================== /supdone ====================
    bot.command(
      "supdone",
      safe("support:supdone", async (ctx) => {
        if (!isSupportAdmin(ctx.from?.id)) return;

        const ticketId = getSupportCtx(ctx.chat?.id);

        if (!ticketId) {
          try {
            return replySafe(
              ctx,
              "ℹ️ Không có ticket nào đang mở.\nDùng /supopen <ticketId> để mở ticket."
            );
          } catch {
            return;
          }
        }

        // ✅ Validate & close ticket
        try {
          const ticket = await validateAndGetTicket(ticketId);

          await SupportTicket.findByIdAndUpdate(ticket._id, {
            $set: { status: "closed" },
          });

          // Gửi notification
          try {
            publishNotification(EVENTS.SUPPORT_TICKET_CLOSED, {
              ticketId: String(ticket._id),
              title: ticket.title || "Hỗ trợ",
            });
          } catch (error) {
            console.error("[notify] SUPPORT_TICKET_CLOSED failed:", err);
          }

          clearSupportCtx(ctx.chat?.id);

          await replySafe(
            ctx,
            [
              `✅ Đã đóng ticket #${esc(shortId(ticketId))}`,
              `• Chủ đề: <b>${esc(ticket.title || "Hỗ trợ")}</b>`,
              `• Trạng thái: ${formatTicketStatus("closed")}`,
            ].join("\n"),
            { parse_mode: "HTML" }
          );
        } catch (e) {
          console.warn("[supportBridge] supdone error:", e?.message);
          try {
            await replySafe(ctx, `❌ ${e.message}`);
          } catch {}
        }
      })
    );

    // ==================== /supreply <ticketId> <content> ====================
    bot.command(
      "supreply",
      safe("support:supreply", async (ctx) => {
        if (!isSupportAdmin(ctx.from?.id)) return;

        const raw = ctx.message?.text || "";
        const parts = raw.trim().split(/\s+/);
        const ticketId = parts[1];
        const content = parts.slice(2).join(" ").trim();

        if (!isValidObjectId(ticketId)) {
          try {
            return replySafe(
              ctx,
              "❌ TicketId không hợp lệ.\nCách dùng: /supreply <ticketId_24hex> <nội dung>"
            );
          } catch {
            return;
          }
        }

        let attachments = [];
        try {
          attachments = await extractSupportAttachments(ctx);
        } catch (e) {
          console.warn(
            "[supportBridge] extract attachments failed:",
            e?.message
          );
          attachments = [];
        }

        try {
          await createSupportStaffMessage({
            ticketId,
            text: content,
            attachments,
            actor: ctx.from,
            actorLabel,
          });
        } catch (e) {
          console.warn(
            "[supportBridge] create staff message failed:",
            e?.message
          );
          try {
            await replySafe(ctx, `❌ ${e.message}`);
          } catch {}
          return;
        }

        try {
          await replySafe(
            ctx,
            `✅ Đã gửi vào ticket #${esc(shortId(ticketId))}.`,
            { parse_mode: "HTML" }
          );
        } catch (e) {
          console.warn("[supportBridge] supreply reply failed:", e?.message);
        }
      })
    );

    // ==================== auto reply ====================
    bot.on(
      "message",
      safe("support:autoReply", async (ctx, next) => {
        if (!isSupportAdmin(ctx.from?.id)) return next();

        const ticketId = getSupportCtx(ctx.chat?.id);
        if (!ticketId) return next();

        const msg = ctx.message || {};
        const text = String(msg.text || msg.caption || "").trim();

        // không ăn command để không phá bot
        if (text.startsWith("/")) return next();

        let attachments = [];
        try {
          attachments = await extractSupportAttachments(ctx);
        } catch (e) {
          console.warn(
            "[supportBridge] extract attachments failed:",
            e?.message
          );
          attachments = [];
        }

        if (!text && attachments.length === 0) return next();

        try {
          await createSupportStaffMessage({
            ticketId,
            text,
            attachments,
            actor: ctx.from,
            actorLabel,
          });
        } catch (e) {
          console.warn(
            "[supportBridge] create staff message failed:",
            e?.message
          );
          try {
            await replySafe(ctx, `❌ ${e.message}`);
          } catch {}
          return next();
        }

        try {
          await replySafe(
            ctx,
            `✅ Đã reply ticket #${esc(
              shortId(ticketId)
            )}. ( /supdone để đóng ticket )`,
            { parse_mode: "HTML" }
          );
        } catch (e) {
          console.warn("[supportBridge] autoReply ack failed:", e?.message);
        }

        return next();
      })
    );
  } catch (e) {
    console.warn("[supportBridge] installSupportBridge fatal:", e?.message);
  }
}

/** Controller gọi để notify admin khi user gửi ticket/message (✅ REST API, không cần BOT_REF) */
export async function notifySupportToTelegram({
  ticketId,
  title,
  fromUserLabel,
  text,
  attachmentsCount = 0,
}) {
  try {
    if (!BOT_TOKEN) return;
    if (!TELE_SUPPORT_CHAT_IDS.length) return;

    const tId = String(ticketId || "");
    const subject = title ? String(title) : "Hỗ trợ / Góp ý";
    const from = fromUserLabel ? String(fromUserLabel) : "User";

    const bodyText = String(text || "").trim()
      ? String(text).trim()
      : attachmentsCount
      ? "[Ảnh đính kèm]"
      : "—";

    const msg =
      `<b>📩 SUPPORT</b>\n` +
      `<b>Ticket:</b> <code>${escHtml(tId)}</code> (#${escHtml(
        shortId(tId)
      )})\n` +
      `<b>Chủ đề:</b> ${escHtml(subject)}\n` +
      `<b>Từ:</b> ${escHtml(from)}\n\n` +
      `<b>Nội dung:</b>\n${escHtml(bodyText)}`;

    const keyboard = {
      inline_keyboard: [
        [{ text: "Mở ticket để reply", callback_data: `support:open:${tId}` }],
        [{ text: "Thoát context", callback_data: `support:done` }],
      ],
    };

    for (const chatId of TELE_SUPPORT_CHAT_IDS) {
      try {
        await tgSendMessageChunked({
          chatId,
          text: msg,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: keyboard,
        });
      } catch (e) {
        console.warn(
          "[notifySupportToTelegram] REST sendMessage failed:",
          chatId,
          e?.message || e
        );
      }
    }
  } catch (e) {
    console.warn("[notifySupportToTelegram] failed:", e?.message);
  }
}
