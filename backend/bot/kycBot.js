// server/bot/kycBot.js
import { Telegraf } from "telegraf";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import dotenv from "dotenv";
dotenv.config();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean); // ví dụ: "123456789,987654321"

function isEmail(s="") { return /\S+@\S+\.\S+/.test(s); }
function isDigits(s="") { return /^\d{6,}$/.test(s.replace(/\D/g, "")); } // phone >= 6 digits

function fmtUser(u) {
  const label = {
    unverified: "Chưa KYC",
    pending: "Chờ KYC",
    verified: "Đã KYC",
    rejected: "Từ chối",
  };
  return [
    `👤 <b>${u?.name || "—"}</b>${u?.nickname ? " <i>("+u.nickname+")</i>" : ""}`,
    u?.email ? `✉️ ${u.email}` : "",
    u?.phone ? `📞 ${u.phone}` : "",
    u?.province ? `📍 ${u.province}` : "",
    u?.cccd ? `🪪 ${u.cccd}` : "",
    `🧾 Trạng thái: <b>${label[u?.cccdStatus || "unverified"]}</b>`,
    u?.updatedAt ? `🕒 Cập nhật: ${new Date(u.updatedAt).toLocaleString("vi-VN")}` : "",
  ].filter(Boolean).join("\n");
}

// Tìm user theo email/phone/nickname
async function findUserByQuery(q) {
  const s = (q || "").trim();
  if (!s) return null;

  if (isEmail(s)) {
    return await User.findOne({ email: s }).lean();
  }
  if (isDigits(s)) {
    const phone = s.replace(/\D/g, "");
    return await User.findOne({ phone }).lean();
  }
  // nickname: match exact trước, không có thì regex i
  let u = await User.findOne({ nickname: s }).lean();
  if (u) return u;
  const rx = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return await User.findOne({ nickname: rx }).lean();
}

export function initKycBot(app) {
  if (!BOT_TOKEN) {
    console.warn("[kycBot] No TELEGRAM_BOT_TOKEN provided, bot disabled.");
    return null;
  }

  const bot = new Telegraf(BOT_TOKEN);

  // Middleware hạn chế quyền dùng lệnh (nếu cấu hình ADMIN_IDS)
  bot.use(async (ctx, next) => {
    if (!ADMIN_IDS.length) return next();
    const uid = String(ctx.from?.id || "");
    if (ADMIN_IDS.includes(uid)) return next();
    // Cho phép /start để biết chat id
    if (ctx.message?.text?.startsWith("/start")) return next();
    return ctx.reply("Bạn không có quyền dùng bot này.");
  });

  // /start
  bot.start((ctx) => {
    const uid = ctx.from?.id;
    ctx.reply(
      [
        "Bot KYC đã sẵn sàng.",
        `Your Telegram ID: <code>${uid}</code>`,
        "",
        "Lệnh:",
        "• /kyc_status <email|phone|nickname>",
        "• /kyc_pending [limit]",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  });

  // /kyc_status foo@bar.com | 0987... | nickname
  bot.command("kyc_status", async (ctx) => {
    const args = (ctx.message?.text || "").split(" ").slice(1);
    const q = (args[0] || "").trim();

    if (!q) {
      return ctx.reply("Cách dùng:\n/kyc_status <email|số điện thoại|nickname>");
    }

    try {
      const u = await findUserByQuery(q);
      if (!u) return ctx.reply("Không tìm thấy người dùng phù hợp.");

      const msg = fmtUser(u);
      await ctx.reply(msg, { parse_mode: "HTML", disable_web_page_preview: true });

      // Gửi kèm ảnh CCCD nếu có
      const front = u?.cccdImages?.front;
      const back = u?.cccdImages?.back;
      if (front) await ctx.replyWithPhoto(front);
      if (back) await ctx.replyWithPhoto(back);

    } catch (e) {
      console.error("kyc_status error:", e);
      ctx.reply("Có lỗi xảy ra khi tra cứu.");
    }
  });

  // /kyc_pending [limit]
  bot.command("kyc_pending", async (ctx) => {
    const args = (ctx.message?.text || "").split(" ").slice(1);
    const limit = Math.min(Math.max(parseInt(args[0] || "20", 10) || 20, 1), 50);

    try {
      const list = await User.find({ cccdStatus: "pending" })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();

      if (!list.length) return ctx.reply("Hiện không có KYC đang chờ duyệt.");

      // Ghép gọn thành message ≤ 4096 char
      const lines = list.map((u, i) => `${i + 1}. ${u?.name || "—"}${u?.nickname ? " ("+u.nickname+")" : ""} — ${u?.phone || u?.email || ""}`);
      const header = `📝 Danh sách KYC đang chờ (${list.length}):\n`;
      let msg = header + lines.join("\n");

      if (msg.length > 3900) {
        // gửi rải
        await ctx.reply(header);
        for (const u of list) {
          await ctx.reply(fmtUser(u), { parse_mode: "HTML", disable_web_page_preview: true });
        }
      } else {
        await ctx.reply(msg);
      }
    } catch (e) {
      console.error("kyc_pending error:", e);
      ctx.reply("Có lỗi xảy ra khi lấy danh sách.");
    }
  });

  // Khởi chạy polling (đơn giản). Nếu muốn webhook thì tự set từ server ngoài.
  bot.launch().then(() => {
    console.log("[kycBot] Bot started (polling).");
  });

  // graceful stop
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  return bot;
}
