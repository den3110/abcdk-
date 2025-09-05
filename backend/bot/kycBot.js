// server/bot/kycBot.js
import { Telegraf } from "telegraf";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import dotenv from "dotenv";
import { registerKycReviewButtons } from "../services/telegram/telegramNotifyKyc.js";
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// ADMIN_IDS giữ lại nếu sau này bạn muốn hạn chế, hiện tại không dùng
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ===== Utils =====
const toPosix = (s = "") => String(s).replace(/\\/g, "/");
function isEmail(s = "") {
  return /\S+@\S+\.\S+/.test(s);
}
function isDigits(s = "") {
  return /^\d{6,}$/.test(String(s).replace(/\D/g, "")); // phone >= 6 digits
}
/** Escape an toàn khi dùng parse_mode: "HTML" */
function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtUser(u) {
  const label = {
    unverified: "Chưa KYC",
    pending: "Chờ KYC",
    verified: "Đã KYC",
    rejected: "Từ chối",
  };
  return [
    `👤 <b>${esc(u?.name || "—")}</b>${
      u?.nickname ? ` <i>(${esc(u.nickname)})</i>` : ""
    }`,
    u?.email ? `✉️ ${esc(u.email)}` : "",
    u?.phone ? `📞 ${esc(u.phone)}` : "",
    u?.province ? `📍 ${esc(u.province)}` : "",
    u?.cccd ? `🪪 ${esc(u.cccd)}` : "",
    `🧾 Trạng thái: <b>${label[u?.cccdStatus || "unverified"]}</b>`,
    u?.updatedAt
      ? `🕒 Cập nhật: ${new Date(u.updatedAt).toLocaleString("vi-VN")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ===== Helpers ảnh: tự fetch rồi gửi buffer (kèm fallback) =====
function normalizeImageUrl(rawPath = "") {
  if (!rawPath) return "";
  let s = String(rawPath)
    .trim()
    .replace(/^http:\/\//i, "https://");
  try {
    // URL tuyệt đối hợp lệ
    return new URL(s).toString();
  } catch {
    // Ghép từ HOST + path tương đối
    const host = (process.env.HOST || "").replace(/\/+$/, "");
    if (!host) return "";
    const path = s.startsWith("/") ? s : `/${s}`;
    return `${host}${path}`;
  }
}

async function fetchImageAsBuffer(url) {
  // Node < 18: dùng node-fetch nếu thiếu global fetch
  const _fetch =
    typeof fetch === "function" ? fetch : (await import("node-fetch")).default;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await _fetch(url, {
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok)
      throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
    const ctype = res.headers.get("content-type") || "";
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    const filename = (() => {
      try {
        const u = new URL(url);
        return u.pathname.split("/").filter(Boolean).pop() || "image.jpg";
      } catch {
        return "image.jpg";
      }
    })();
    return { buffer: buf, contentType: ctype, filename };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Gửi ảnh an toàn:
 * - Nếu ảnh > ~10MB → gửi Document
 * - Nếu sendPhoto lỗi → fallback sendDocument
 * - opts có thể chứa reply_to_message_id, caption, ...
 */
async function sendPhotoSafely(telegram, chatId, url, opts = {}) {
  if (!url) return;
  const { buffer, contentType, filename } = await fetchImageAsBuffer(url);
  const sizeMB = buffer.byteLength / (1024 * 1024);

  if (contentType?.startsWith("image/") && sizeMB > 9.9) {
    return telegram.sendDocument(chatId, { source: buffer, filename }, opts);
  }
  try {
    return await telegram.sendPhoto(chatId, { source: buffer, filename }, opts);
  } catch (e) {
    console.warn("sendPhoto failed, fallback to sendDocument:", e?.message);
    return telegram.sendDocument(chatId, { source: buffer, filename }, opts);
  }
}

// ===== Tìm user theo email/phone/nickname (có fuzzy cho nickname) =====
async function findUserByQuery(q) {
  const s = (q || "").trim();
  if (!s) return null;
  if (isEmail(s)) return await User.findOne({ email: s }).lean();
  if (isDigits(s)) {
    const phone = s.replace(/\D/g, "");
    return await User.findOne({ phone }).lean();
  }
  let u = await User.findOne({ nickname: s }).lean();
  if (u) return u;
  const rx = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return await User.findOne({ nickname: rx }).lean();
}

// ===== Build nội dung help (dùng cho /kyc_command) =====
function buildKycHelp() {
  return [
    "<b>Hướng dẫn KYC Bot</b>",
    "",
    "Các lệnh khả dụng:",
    "• <code>/kyc_command</code> — Danh sách toàn bộ lệnh & cách dùng",
    "• <code>/start</code> — Giới thiệu nhanh và nhận Telegram ID của bạn",
    "• <code>/kyc_status &lt;email|phone|nickname&gt;</code> — Tra cứu chi tiết 1 người dùng (kèm ảnh CCCD & nút duyệt/từ chối).",
    "• <code>/kyc_pending [limit]</code> — Liệt kê người dùng đang chờ duyệt (mặc định 20, tối đa 50).",
    "",
    "Lưu ý:",
    "• Ảnh CCCD được gửi sau và bám (reply) vào tin nhắn KYC.",
    "• Bot tự fallback gửi file nếu gửi ảnh lỗi.",
  ].join("\n");
}

/** Tạo inline keyboard duyệt/từ chối cho 1 user */
function buildReviewButtons(userId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Duyệt", callback_data: `kyc:approve:${userId}` },
        { text: "❌ Từ chối", callback_data: `kyc:reject:${userId}` },
      ],
    ],
  };
}

// =====================================================================

export function initKycBot(app) {
  if (!BOT_TOKEN) {
    console.warn("[kycBot] No TELEGRAM_BOT_TOKEN provided, bot disabled.");
    return null;
  }

  const bot = new Telegraf(BOT_TOKEN);

  // Không chặn quyền: ai cũng dùng được tất cả lệnh

  // Log callback_query (bấm nút duyệt/từ chối)
  bot.on("callback_query", async (ctx, next) => {
    console.log(
      "[kycBot] callback_query:",
      ctx.callbackQuery?.data,
      "from",
      ctx.from?.id
    );
    return next();
  });

  // Đăng ký handler nút Duyệt/Từ chối (gửi toast & message kết quả)
  registerKycReviewButtons(bot, {
    UserModel: User,
    onAfterReview: ({ user, action, reviewer }) => {
      console.log(
        `[kycBot] ${action.toUpperCase()} user=${user?._id} by=${reviewer?.id}`
      );
      // TODO: emit socket/io, audit log...
    },
  });

  // Hiển thị lệnh trong menu của Telegram
  bot.telegram
    .setMyCommands([
      { command: "start", description: "Giới thiệu & hướng dẫn nhanh" },
      {
        command: "kyc_command",
        description: "Danh sách toàn bộ lệnh & cách dùng",
      },
      {
        command: "kyc_status",
        description: "Tra cứu 1 người dùng (email/phone/nickname)",
      },
      { command: "kyc_pending", description: "Danh sách KYC chờ duyệt" },
    ])
    .catch((e) => console.warn("setMyCommands failed:", e?.message));

  // /start
  bot.start((ctx) => {
    const uid = ctx.from?.id;
    ctx.reply(
      [
        "Bot KYC đã sẵn sàng.",
        `Your Telegram ID: <code>${esc(uid)}</code>`,
        "",
        "Gõ <code>/kyc_command</code> để xem đầy đủ lệnh & cách dùng.",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  });

  // /kyc_command — show toàn bộ lệnh & cách dùng
  bot.command("kyc_command", async (ctx) => {
    try {
      const msg = buildKycHelp();
      await ctx.reply(msg, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch (e) {
      console.error("kyc_command error:", e);
      await ctx.reply("Có lỗi xảy ra khi hiển thị hướng dẫn.");
    }
  });

  // /kyc_status <email|phone|nickname> — trả về info + NÚT duyệt/từ chối; ảnh gửi sau và reply vào tin đó
  bot.command("kyc_status", async (ctx) => {
    const args = (ctx.message?.text || "").split(" ").slice(1);
    const q = (args[0] || "").trim();
    if (!q) {
      return ctx.reply(
        "Cách dùng:\n/kyc_status <email|số điện thoại|nickname>"
      );
    }

    try {
      const u = await findUserByQuery(q);
      if (!u) return ctx.reply("Không tìm thấy người dùng phù hợp.");

      // 1) Gửi thông tin + NÚT duyệt/từ chối
      const infoMsg = await ctx.reply(fmtUser(u), {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: buildReviewButtons(String(u._id)),
      });

      // 2) Gửi ảnh sau, reply vào message trên
      const chatId = ctx.chat?.id;
      const reply_to_message_id = infoMsg?.message_id;

      const frontUrl = normalizeImageUrl(toPosix(u?.cccdImages?.front || ""));
      const backUrl = normalizeImageUrl(toPosix(u?.cccdImages?.back || ""));

      if (frontUrl) {
        try {
          await sendPhotoSafely(ctx.telegram, chatId, frontUrl, {
            caption: "CCCD - Mặt trước",
            reply_to_message_id,
          });
        } catch (e) {
          console.error("send front image failed:", e?.message);
          await ctx.reply("⚠️ Không gửi được ảnh CCCD mặt trước.", {
            reply_to_message_id,
          });
        }
      }
      if (backUrl) {
        try {
          await sendPhotoSafely(ctx.telegram, chatId, backUrl, {
            caption: "CCCD - Mặt sau",
            reply_to_message_id,
          });
        } catch (e) {
          console.error("send back image failed:", e?.message);
          await ctx.reply("⚠️ Không gửi được ảnh CCCD mặt sau.", {
            reply_to_message_id,
          });
        }
      }
    } catch (e) {
      console.error("kyc_status error:", e);
      ctx.reply("Có lỗi xảy ra khi tra cứu.");
    }
  });

  // /kyc_pending [limit]
  bot.command("kyc_pending", async (ctx) => {
    const args = (ctx.message?.text || "").split(" ").slice(1);
    const limit = Math.min(
      Math.max(parseInt(args[0] || "20", 10) || 20, 1),
      50
    );

    try {
      const list = await User.find({ cccdStatus: "pending" })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();

      if (!list.length) return ctx.reply("Hiện không có KYC đang chờ duyệt.");

      // Dạng ngắn gọn trước
      const lines = list.map(
        (u, i) =>
          `${i + 1}. ${u?.name || "—"}${
            u?.nickname ? ` (@${u.nickname})` : ""
          } — ${u?.phone || u?.email || ""}`
      );
      const header = `📝 Danh sách KYC đang chờ (${list.length}):\n`;
      const summary = header + lines.join("\n");

      if (summary.length <= 3900) {
        await ctx.reply(summary);
      } else {
        // Nếu quá dài → tách ra từng user (kèm nút)
        await ctx.reply(header);
        for (const u of list) {
          await ctx.reply(fmtUser(u), {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: buildReviewButtons(String(u._id)),
          });
        }
        return;
      }

      // Gửi thêm chi tiết từng user (kèm nút) nếu danh sách không quá lớn
      if (list.length <= 10) {
        for (const u of list) {
          await ctx.reply(fmtUser(u), {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: buildReviewButtons(String(u._id)),
          });
        }
      } else {
        await ctx.reply(
          "Mẹo: Dùng /kyc_status <email|phone|nickname> để mở chi tiết từng hồ sơ kèm ảnh & nút duyệt."
        );
      }
    } catch (e) {
      console.error("kyc_pending error:", e);
      ctx.reply("Có lỗi xảy ra khi lấy danh sách.");
    }
  });

  bot.launch().then(() => {
    console.log("[kycBot] Bot started (polling).");
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
  return bot;
}
