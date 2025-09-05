// server/bot/kycBot.js
import { Telegraf } from "telegraf";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import dotenv from "dotenv";
import { registerKycReviewButtons } from "../services/telegram/telegramNotifyKyc.js";
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// ADMIN_IDS hiện không dùng nữa (ai cũng dùng được), nhưng giữ lại nếu sau này cần
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ===== Utils =====
function isEmail(s = "") {
  return /\S+@\S+\.\S+/.test(s);
}
function isDigits(s = "") {
  return /^\d{6,}$/.test(String(s).replace(/\D/g, "")); // phone >= 6 digits
}
const toPosix = (s = "") => String(s).replace(/\\/g, "/");

function fmtUser(u) {
  const label = {
    unverified: "Chưa KYC",
    pending: "Chờ KYC",
    verified: "Đã KYC",
    rejected: "Từ chối",
  };
  return [
    `👤 <b>${u?.name || "—"}</b>${
      u?.nickname ? " <i>(" + u.nickname + ")</i>" : ""
    }`,
    u?.email ? `✉️ ${u.email}` : "",
    u?.phone ? `📞 ${u.phone}` : "",
    u?.province ? `📍 ${u.province}` : "",
    u?.cccd ? `🪪 ${u.cccd}` : "",
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
    return new URL(s).toString();
  } catch {
    const host = (process.env.HOST || "").replace(/\/+$/, "");
    if (!host) return "";
    const path = s.startsWith("/") ? s : `/${s}`;
    return `${host}${path}`;
  }
}

async function fetchImageAsBuffer(url) {
  // Hỗ trợ Node < 18: dynamic import node-fetch nếu thiếu global fetch
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

async function sendPhotoSafely(telegram, chatId, url, opts = {}) {
  if (!url) return;
  const { buffer, contentType, filename } = await fetchImageAsBuffer(url);
  const sizeMB = buffer.byteLength / (1024 * 1024);

  // Ảnh lớn > ~10MB → gửi dạng document
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
    "• <code>/kyc_status &lt;email|phone|nickname&gt;</code> — Tra cứu chi tiết 1 người dùng (kèm ảnh CCCD nếu có).",
    "• <code>/kyc_pending [limit]</code> — Liệt kê người dùng đang chờ duyệt (mặc định 20, tối đa 50).",
    "",
    "Lưu ý:",
    "• Ảnh CCCD sẽ tự gửi kèm nếu tìm thấy, bot tự fallback gửi file nếu gửi ảnh lỗi.",
    "• Sử dụng <i>email</i> hoặc <i>số điện thoại</i> hoặc <i>nickname</i> để tra cứu.",
  ].join("\n");
}

// =====================================================================

export function initKycBot(app) {
  if (!BOT_TOKEN) {
    console.warn("[kycBot] No TELEGRAM_BOT_TOKEN provided, bot disabled.");
    return null;
  }

  const bot = new Telegraf(BOT_TOKEN);

  // Không chặn quyền: ai cũng dùng được tất cả lệnh
  // (Nếu sau này cần giới hạn, có thể thêm middleware kiểm tra ADMIN_IDS)

  // Log callback_query (ví dụ bấm nút duyệt/từ chối)
  bot.on("callback_query", async (ctx, next) => {
    console.log(
      "[kycBot] callback_query:",
      ctx.callbackQuery?.data,
      "from",
      ctx.from?.id
    );
    return next();
  });

  // Đăng ký handler nút Duyệt/Từ chối
  registerKycReviewButtons(bot, {
    UserModel: User,
    onAfterReview: ({ user, action, reviewer }) => {
      console.log(
        `[kycBot] ${action.toUpperCase()} user=${user?._id} by=${reviewer?.id}`
      );
      // TODO: emit socket/io, audit log...
    },
  });

  // Hiển thị lệnh trong menu của Telegram (không await để giữ sync)
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
        `Your Telegram ID: <code>${uid}</code>`,
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

  // /kyc_status <email|phone|nickname>
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

      const msg = fmtUser(u);
      await ctx.reply(msg, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });

      const frontUrl = normalizeImageUrl(toPosix(u?.cccdImages?.front || ""));
      const backUrl = normalizeImageUrl(toPosix(u?.cccdImages?.back || ""));
      const chatId = ctx.chat?.id;

      if (frontUrl) {
        try {
          await sendPhotoSafely(ctx.telegram, chatId, frontUrl);
        } catch (e) {
          console.error("send front image failed:", e?.message);
          await ctx.reply("⚠️ Không gửi được ảnh CCCD mặt trước.");
        }
      }
      if (backUrl) {
        try {
          await sendPhotoSafely(ctx.telegram, chatId, backUrl);
        } catch (e) {
          console.error("send back image failed:", e?.message);
          await ctx.reply("⚠️ Không gửi được ảnh CCCD mặt sau.");
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

      const lines = list.map(
        (u, i) =>
          `${i + 1}. ${u?.name || "—"}${
            u?.nickname ? ` (@${u.nickname})` : ""
          } — ${u?.phone || u?.email || ""}`
      );

      const header = `📝 Danh sách KYC đang chờ (${list.length}):\n`;
      let msg = header + lines.join("\n");

      // Telegram message limit ~4096 chars → tách nếu dài
      if (msg.length > 3900) {
        await ctx.reply(header);
        for (const u of list) {
          await ctx.reply(fmtUser(u), {
            parse_mode: "HTML",
            disable_web_page_preview: true,
          });
        }
      } else {
        await ctx.reply(msg);
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
