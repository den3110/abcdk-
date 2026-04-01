// server/bot/telegramBot.js
// --------------------------------------------------------------
// Bot KYC + Chấm điểm nhanh (/rank)
// Đý BỌC TRY/CATCH TOÀN DIỆN + GLOBAL GUARDS (không crash app)
// --------------------------------------------------------------

import { Telegraf } from "telegraf";
import dotenv from "dotenv";

import User from "../models/userModel.js";
import Ranking from "../models/rankingModel.js";
import Assessment from "../models/assessmentModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Complaint from "../models/complaintModel.js";
import Tournament from "../models/tournamentModel.js";
import Registration from "../models/registrationModel.js";
import { notifyComplaintStatusChange } from "../services/telegram/notifyNewComplaint.js";
import { notifyKycReviewed } from "../services/telegram/telegramNotifyKyc.js";
import SportConnectService from "../services/sportconnect.service.js";
import { replySafe } from "../utils/telegramSafe.js";
import {
  search as spcSearch,
  adaptForCaption as spcAdapt,
  getMeta as spcGetMeta,
  loadAll as spcLoadAll,
} from "../services/spcStore.js";

import { installSupportBridge, bindSupportBotRef } from "./supportBridge.js";

// để controller import từ kycBot vẫn được (re-export)
export { notifySupportToTelegram } from "./supportBridge.js";

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/* ======================= GLOBAL SAFETY GUARDS ======================= */
// Không để app chết vì lỗi không bắt
process.on("unhandledRejection", (reason, p) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

// Wrapper an toàn cho mọi handler Telegraf (command/action/on)
function safe(label, fn, { silentCbError = false } = {}) {
  return async function wrapped(ctx, next) {
    try {
      return await fn(ctx, next);
    } catch (e) {
      console.error(`[${label}] handler error:`, e);
      // Ưu tiên show toast ngắn gọn cho callback_query (khỏi spam chat)
      if (!silentCbError && ctx?.answerCbQuery) {
        try {
          await ctx.answerCbQuery("Có lỗi xảy ra, thử lại sau nhé.", {
            show_alert: false,
          });
          return;
        } catch (_) {}
      }
      // Fallback trả lời an toàn (tự retry khi 429 trong replySafe của bạn)
      try {
        await replySafe(
          ctx,
          "❌ Có lỗi xảy ra, vui lòng thử lại sau hoặc liên hệ admin.",
        );
      } catch (_) {}
    }
  };
}

/* ======================= Utils chung (GIỮ NGUYÊN) ======================= */

// === Helpers cho Registration ===
const TELE_PAYMENT_ADMINS = String(process.env.TELEGRAM_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isPaymentAdmin = (telegramUserId) => {
  if (!TELE_PAYMENT_ADMINS.length) return true; // nếu không cấu hình thì cho phép hết
  return TELE_PAYMENT_ADMINS.includes(String(telegramUserId));
};
const actorLabel = (from = {}) => {
  const name = [from.first_name, from.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const uname = from.username ? `@${from.username}` : "";
  const id = from.id ? `#${from.id}` : "";
  return [name, uname, id].filter(Boolean).join(" ");
};
const normET = (t) => {
  const s = String(t || "").toLowerCase();
  if (s === "single" || s === "singles") return "single";
  return "double";
};

const displayNameSimple = (pl) => {
  if (!pl) return "—";
  const nn = pl.nickName || pl.nickname || "";
  return nn || pl.fullName || pl.name || pl.displayName || "—";
};

const teamNameOf = (reg, tour) => {
  const et = normET(tour?.eventType);
  if (et === "single") return displayNameSimple(reg?.player1);
  const a = displayNameSimple(reg?.player1);
  const b = displayNameSimple(reg?.player2);
  return `${a} / ${b}`.replace(/\s+\/\s+$/, ""); // nếu thiếu player2
};

const fmtPaymentLine = (payment = {}) => {
  const isPaid = String(payment.status || "") === "Paid";
  const when = payment.paidAt
    ? new Date(payment.paidAt).toLocaleString("vi-VN")
    : "";
  return isPaid
    ? `💰 Lệ phí: <b>Đý THANH TOÁN</b>${when ? ` <i>(${when})</i>` : ""}`
    : "💰 Lệ phí: <b>CHƯA THANH TOÁN</b>";
};

const buildPayKeyboard = (regId, isPaid) => ({
  inline_keyboard: [
    [
      isPaid
        ? {
            text: "↩️ Đánh dấu CHƯA thanh toán",
            callback_data: `reg:unpay:${regId}`,
          }
        : {
            text: "✅ Xác nhận Đý thanh toán",
            callback_data: `reg:pay:${regId}`,
          },
    ],
  ],
});

const fmtRegMessage = (reg, tour) => {
  const created = reg?.createdAt
    ? new Date(reg.createdAt).toLocaleString("vi-VN")
    : "";
  const et = normET(tour?.eventType);
  const nameLine =
    et === "single"
      ? `👤 VĐV: <b>${esc(teamNameOf(reg, tour))}</b>`
      : `👥 Cặp VĐV: <b>${esc(teamNameOf(reg, tour))}</b>`;
  const codeStr = reg?.code != null ? String(reg.code) : "—";

  return [
    `🧾 <b>Đăng ký #${esc(codeStr)}</b>`,
    `🏆 Giải: <b>${esc(tour?.name || "—")}</b> • <i>${
      et === "single" ? "Đơn" : "Đôi"
    }</i>`,
    nameLine,
    `🕒 Thời gian: <i>${created || "—"}</i>`,
    fmtPaymentLine(reg?.payment),
  ].join("\n");
};

const toPosix = (s = "") => String(s).replace(/\\/g, "/");
function isEmail(s = "") {
  return /\S+@\S+\.\S+/.test(s);
}
function isDigits(s = "") {
  return /^\d{6,}$/.test(String(s).replace(/\D/g, "")); // phone >= 6 digits
}
/** Escape an toàn cho parse_mode: "HTML" */
function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function parseNumLoose(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : null;
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

// -------------- Ảnh CCCD: fetch buffer & fallback an toàn ---------------
function normalizeImageUrl(rawPath = "") {
  if (!rawPath) return "";
  let s = String(rawPath)
    .trim()
    .replace(/^http:\/\//i, "https://");
  try {
    return new URL(s).toString(); // absolute
  } catch {
    const host = (process.env.HOST || "").replace(/\/+$/, "");
    if (!host) return "";
    const path = s.startsWith("/") ? s : `/${s}`;
    return `${host}${path}`;
  }
}

function sendJsonChunked(ctx, obj, prefix = "") {
  let text;
  try {
    text = JSON.stringify(obj, null, 2);
  } catch {
    text = String(obj ?? "");
  }
  const escText = esc(text);
  const max = 3800;
  if (prefix) {
    ctx.reply(prefix, { parse_mode: "HTML", disable_web_page_preview: true });
  }
  for (let i = 0; i < escText.length; i += max) {
    const chunk = escText.slice(i, i + max);
    ctx.reply(`<pre><code>${chunk}</code></pre>`, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }
}

async function fetchImageAsBuffer(url) {
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

// --------- Tìm user theo email/phone/nickname (nickname có fuzzy) ---------
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

/* ======================= Helpers cho /spc (NEW) ======================= */
// Bỏ dấu + so khớp mờ (VN-friendly)
function vnFold(s = "") {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}
function fuzzyIncludes(hay = "", needle = "") {
  if (!needle) return true;
  return vnFold(hay).includes(vnFold(needle));
}

/* ========================= Khởi tạo BOT ========================= */
export async function initKycBot(app) {
  console.log("[telegramBot.js] LOADED", import.meta.url);
  try {
    if (!BOT_TOKEN) {
      console.warn("[kycBot] No TELEGRAM_BOT_TOKEN provided, bot disabled.");
      return null;
    }

    const handlerTimeout =
      process.env.TELEGRAM_HANDLER_TIMEOUT_MS === "0"
        ? 0
        : Number(process.env.TELEGRAM_HANDLER_TIMEOUT_MS || 0); // 0 = disable
    const bot = new Telegraf(BOT_TOKEN, { handlerTimeout });
    installSupportBridge({ bot, safe, replySafe, esc, actorLabel });

    // Middleware global: nuốt lỗi ở mọi handler
    bot.use(
      safe("global-mw", async (_ctx, next) => {
        await next();
      }),
    );

    // Nuốt lỗi Telegraf-level
    bot.catch(
      safe(
        "bot.catch",
        async (err, ctx) => {
          const name = err?.name || "Error";
          const msg = err?.message || err;
          console.warn("[bot.catch]", name, msg);
          if (name === "TimeoutError") return;
          if (err?.response?.error_code === 429) return;
          await replySafe(
            ctx,
            "⚠️ Bot đang bận hoặc bị giới hạn, thử lại sau nhé.",
          );
        },
        { silentCbError: true },
      ),
    );

    // Logger callback_query (bọc an toàn + giữ next)
    bot.on(
      "callback_query",
      safe("callback_query", async (ctx, next) => {
        const data = String(ctx.callbackQuery?.data || "");
        console.log(data);
        if (!data.startsWith("kyc:") && !data.startsWith("reg:")) return next();
        console.log(
          "[kycBot] callback_query:",
          ctx.callbackQuery?.data,
          "from",
          ctx.from?.id,
        );
        return next();
      }),
    );

    // ====== Toggle thanh toán: reg:pay / reg:unpay ======
    bot.action(
      /^reg:(pay|unpay):([a-fA-F0-9]{24})$/,
      safe("reg:pay|unpay", async (ctx) => {
        const [, action, regId] = ctx.match || [];
        if (!isPaymentAdmin(ctx.from?.id)) {
          return ctx.answerCbQuery(
            "Bạn không có quyền thực hiện thao tác này.",
            {
              show_alert: true,
            },
          );
        }

        await ctx.answerCbQuery("Đang cập nhật…");

        const update =
          action === "pay"
            ? { "payment.status": "Paid", "payment.paidAt": new Date() }
            : { "payment.status": "Unpaid", "payment.paidAt": null };

        const reg = await Registration.findByIdAndUpdate(
          regId,
          { $set: update },
          { new: true },
        ).lean();

        if (!reg) {
          return ctx.answerCbQuery("Không tìm thấy đăng ký.", {
            show_alert: true,
          });
        }

        const tour = await Tournament.findById(reg.tournament)
          .select("_id name eventType")
          .lean();

        const msg = fmtRegMessage(reg, tour);
        const isPaid = String(reg?.payment?.status || "") === "Paid";

        try {
          await ctx.editMessageText(msg, {
            parse_mode: "HTML",
            reply_markup: buildPayKeyboard(reg._id, isPaid),
            disable_web_page_preview: true,
          });
        } catch {
          await replySafe(ctx, msg, {
            parse_mode: "HTML",
            reply_markup: buildPayKeyboard(reg._id, isPaid),
            disable_web_page_preview: true,
          });
        }

        const confirmTitle = isPaid
          ? "✅ Đý XÁC NHẬN THANH TOÁN"
          : "↩️ Đý ĐÁNH DẤU CHƯA THANH TOÁN";

        const et = normET(tour?.eventType);
        const whoLine =
          et === "single"
            ? `• VĐV: <b>${esc(teamNameOf(reg, tour))}</b>`
            : `• Cặp VĐV: <b>${esc(teamNameOf(reg, tour))}</b>`;

        const whenLine =
          isPaid && reg?.payment?.paidAt
            ? `• Thời điểm: <i>${new Date(reg.payment.paidAt).toLocaleString(
                "vi-VN",
              )}</i>`
            : `• Thời điểm: <i>${new Date().toLocaleString("vi-VN")}</i>`;

        const confirmMsg = [
          confirmTitle,
          `• Mã đăng ký: <b>${esc(String(reg.code ?? "—"))}</b>`,
          `• Giải: <b>${esc(tour?.name || "—")}</b>`,
          whoLine,
          whenLine,
          `• Thao tác bởi: <i>${esc(actorLabel(ctx.from))}</i>`,
        ].join("\n");

        await replySafe(ctx, confirmMsg, {
          parse_mode: "HTML",
          reply_to_message_id: ctx.update?.callback_query?.message?.message_id,
          disable_web_page_preview: true,
        });

        await ctx.answerCbQuery(
          isPaid
            ? "Đã đánh dấu: Đý thanh toán"
            : "Đã đánh dấu: CHƯA thanh toán",
        );
      }),
    );

    // ===== KYC: Duyệt / Từ chối =====
    bot.action(
      /^kyc:(approve|reject):([a-fA-F0-9]{24})$/,
      safe("kyc:approve|reject", async (ctx) => {
        const [, action, userId] = ctx.match || [];
        await ctx.answerCbQuery("Đang xử lý…");

        const user = await User.findById(userId)
          .select("_id cccdStatus verified name nickname email phone cccd")
          .lean();

        if (!user) {
          return ctx.answerCbQuery("Không tìm thấy người dùng.", {
            show_alert: true,
          });
        }

        const $set =
          action === "approve"
            ? { cccdStatus: "verified", verified: "verified" }
            : { cccdStatus: "rejected" };

        const updated = await User.findByIdAndUpdate(
          userId,
          { $set },
          { new: true, runValidators: true },
        ).select("_id cccdStatus verified");
        if (!updated) {
          await ctx.answerCbQuery("Cập nhật thất bại.", { show_alert: true });
          return;
        }

        await ctx.answerCbQuery(
          action === "approve" ? "Đã duyệt ✅" : "Đã từ chối ❌",
        );

        // Không để lỗi notify làm crash flow
        try {
          await notifyKycReviewed(user, action);
        } catch (e) {
          console.warn("[notifyKycReviewed] failed:", e?.message);
        }
      }),
    );

    // ===== Complaint: Đý XỬ LÝ / TỪ CHỐI =====
    bot.action(
      /^complaint:(resolve|reject):([a-fA-F0-9]{24})$/,
      safe("complaint:resolve|reject", async (ctx) => {
        const [, action, id] = ctx.match || [];
        await ctx.answerCbQuery("Đang cập nhật…");

        const complaint = await Complaint.findById(id);
        if (!complaint) {
          return ctx.answerCbQuery("Không tìm thấy khiếu nại", {
            show_alert: true,
          });
        }

        const newStatus = action === "resolve" ? "resolved" : "rejected";
        complaint.status = newStatus;
        await complaint.save();

        const [tour, reg] = await Promise.all([
          Tournament.findById(complaint.tournament).lean(),
          Registration.findById(complaint.registration).lean(),
        ]);

        const chatId =
          ctx.update?.callback_query?.message?.chat?.id ?? ctx.chat?.id;
        const replyToMessageId =
          ctx.update?.callback_query?.message?.message_id;

        try {
          await notifyComplaintStatusChange({
            complaint: complaint.toObject?.() || complaint,
            tournament: tour,
            registration: reg,
            newStatus,
            actor: ctx.from,
            chatId,
            replyToMessageId,
          });
        } catch (e) {
          console.warn("[notifyComplaintStatusChange] failed:", e?.message);
        }

        try {
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch (e) {
          console.warn("editMessageReplyMarkup failed:", e?.message);
        }

        await ctx.answerCbQuery(
          newStatus === "resolved"
            ? "Đã đánh dấu: Đý XỬ LÝ"
            : "Đã đánh dấu: TỪ CHỐI",
        );
      }),
    );

    // Hiển thị lệnh (bọc try/catch)
    try {
      await bot.telegram.setMyCommands([
        { command: "start", description: "Giới thiệu & hướng dẫn nhanh" },
        {
          command: "startkyc",
          description: "Danh sách toàn bộ lệnh & cách dùng",
        },
        {
          command: "findkyc",
          description: "Tra cứu người dùng (email/phone/nickname)",
        },
        { command: "pendkyc", description: "Danh sách KYC chờ duyệt" },
        {
          command: "rank",
          description:
            "Chấm điểm nhanh (single double) + tuỳ chọn --guard/--note",
        },
        { command: "point", description: "Xem điểm hiện tại (alias)" },
        {
          command: "reg",
          description: "Tra cứu & cập nhật thanh toán đăng ký",
        },
        {
          command: "spc",
          description: "SportConnect LevelPoint: /spc <tên/sđt>[;tỉnh]",
        },
        // ✅ THÊM CÁC LỆNH SUPPORT
        {
          command: "chatid",
          description: "Lấy Chat ID (dùng để config TELEGRAM_SUPPORT_CHAT_IDS)",
        },
        {
          command: "supopen",
          description: "Mở context ticket để reply: /supopen <ticketId>",
        },
        {
          command: "supreply",
          description:
            "Reply ticket trực tiếp: /supreply <ticketId> <nội dung>",
        },
        {
          command: "supdone",
          description: "Thoát khỏi context ticket hiện tại",
        },
      ]);
    } catch (e) {
      console.warn("setMyCommands failed:", e?.message);
    }

    // ----------------------- /start -----------------------
    bot.start(
      safe("start", (ctx) => {
        const uid = ctx.from?.id;
        return ctx.reply(
          [
            "Bot KYC đã sẵn sàng.",
            `Your Telegram ID: <code>${esc(uid)}</code>`,
            "",
            "Gõ <code>/startkyc</code> để xem đầy đủ lệnh & cách dùng.",
          ].join("\n"),
          { parse_mode: "HTML" },
        );
      }),
    );

    // ------------------- /startkyc -------------------
    bot.command(
      "startkyc",
      safe("startkyc", async (ctx) => {
        const msg = [
          "<b>Hướng dẫn KYC Bot</b>",
          "",
          "<b>📋 Các lệnh KYC:</b>",
          "• <code>/start</code> — Giới thiệu nhanh & hiện Telegram ID",
          "• <code>/startkyc</code> — Danh sách toàn bộ lệnh & cách dùng",
          "• <code>/findkyc &lt;email|phone|nickname&gt;</code> — Tra cứu chi tiết 1 người dùng (kèm ảnh CCCD & nút duyệt/từ chối).",
          "• <code>/pendkyc [limit]</code> — Liệt kê người dùng đang chờ duyệt (mặc định 20, tối đa 50).",
          "",
          "<b>🏅 Các lệnh chấm điểm:</b>",
          "• <code>/rank &lt;email|phone|nickname&gt; &lt;single&gt; &lt;double&gt; [--guard] [--note &quot;ghi chú...&quot;]</code>",
          "   - Chấm nhanh điểm trình theo logic adminUpdateRanking (bỏ auth).",
          "   - <code>--guard</code>: chỉ ghi lịch sử, KHÔNG cập nhật Ranking.",
          "",
          "• <code>/rankget &lt;email|phone|nickname&gt;</code> — Xem điểm hiện tại.",
          "   Alias: <code>/point</code>, <code>/rating</code>",
          "",
          "<b>🎫 Các lệnh đăng ký giải:</b>",
          "• <code>/reg &lt;mã đăng ký|_id&gt;</code> — Tra cứu đăng ký & toggle thanh toán",
          "",
          "<b>🏸 Tra cứu SportConnect:</b>",
          "• <code>/spc &lt;tên/sđt&gt;[;&lt;tỉnh/thành&gt;] [--debug]</code> — Tra SPC (lọc tỉnh mờ, bỏ dấu).",
          "",
          // ✅ THÊM PHẦN SUPPORT
          "<b>💬 Hệ thống Support (Reply Ticket):</b>",
          "• <code>/chatid</code> — Lấy Chat ID của group/chat hiện tại",
          "   (Dùng để config <code>TELEGRAM_SUPPORT_CHAT_IDS</code> trong .env)",
          "",
          "• <code>/supopen &lt;ticketId&gt;</code> — Mở context ticket để reply",
          "   Sau khi mở, mọi tin nhắn/ảnh thường sẽ tự động gửi vào ticket.",
          "   Ví dụ: <code>/supopen 694409f707b5a9c441cf6909</code>",
          "",
          "• <code>/supreply &lt;ticketId&gt; &lt;nội dung&gt;</code> — Reply trực tiếp (không cần mở context)",
          "   Ví dụ: <code>/supreply 694409f707b5a9c441cf6909 Cảm ơn bạn đã góp ý!</code>",
          "",
          "• <code>/supdone</code> — Thoát khỏi context ticket hiện tại",
          "",
          "<b>📌 Cách dùng Support:</b>",
          "1️⃣ Khi user gửi ticket từ app → Bot notify tới group support",
          '2️⃣ Admin click nút <b>"Mở ticket để reply"</b> hoặc gõ <code>/supopen &lt;ticketId&gt;</code>',
          "3️⃣ Nhắn/gửi ảnh bình thường → Tự động lưu vào ticket & gửi về app user",
          "4️⃣ Gõ <code>/supdone</code> khi xong",
          "",
          "<b>📝 Ví dụ:</b>",
          "• <code>/rank v1b2 3.5 3.0 --note &quot;đánh ổn định&quot;</code>",
          "• <code>/point v1b2</code>",
          "• <code>/reg 10025</code>",
          "• <code>/spc Nguyen Van A;Ha Noi</code>",
          "• <code>/supopen 694409f707b5a9c441cf6909</code>",
          "",
          "<b>⚙️ Lưu ý:</b>",
          "• Ảnh CCCD được gửi sau và bám (reply) vào tin nhắn KYC.",
          "• Bot tự fallback gửi file nếu gửi ảnh lỗi.",
          "• Để bot nhận messages thường trong group, phải <b>Disable Privacy Mode</b> qua @BotFather.",
          "• Quyền admin support: config <code>TELEGRAM_SUPPORT_ADMIN_IDS</code> trong .env (bỏ trống = tất cả đều admin).",
        ].join("\n");
        await ctx.reply(msg, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      }),
    );

    // -------------------- /findkyc <q> -----------------
    bot.command(
      "findkyc",
      safe("findkyc", async (ctx) => {
        const args = (ctx.message?.text || "").split(" ").slice(1);
        const q = (args[0] || "").trim();
        if (!q) {
          return ctx.reply(
            "Cách dùng:\n/findkyc <email|số điện thoại|nickname>",
          );
        }

        const u = await findUserByQuery(q);
        if (!u) return ctx.reply("Không tìm thấy người dùng phù hợp.");

        const infoMsg = await ctx.reply(fmtUser(u), {
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ Duyệt",
                  callback_data: `kyc:approve:${String(u._id)}`,
                },
                {
                  text: "❌ Từ chối",
                  callback_data: `kyc:reject:${String(u._id)}`,
                },
              ],
            ],
          },
        });

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
      }),
    );

    // -------------------- /pendkyc [limit] -----------------
    bot.command(
      "pendkyc",
      safe("pendkyc", async (ctx) => {
        const args = (ctx.message?.text || "").split(" ").slice(1);
        const limit = Math.min(
          Math.max(parseInt(args[0] || "20", 10) || 20, 1),
          50,
        );

        const list = await User.find({ cccdStatus: "pending" })
          .sort({ updatedAt: -1 })
          .limit(limit)
          .lean();

        if (!list.length) return ctx.reply("Hiện không có KYC đang chờ duyệt.");

        const lines = list.map(
          (u, i) =>
            `${i + 1}. ${u?.name || "—"}${
              u?.nickname ? ` (@${u.nickname})` : ""
            } — ${u?.phone || u?.email || ""}`,
        );
        const header = `📝 Danh sách KYC đang chờ (${list.length}):\n`;
        const summary = header + lines.join("\n");

        if (summary.length <= 3900) {
          await ctx.reply(summary);
        } else {
          await ctx.reply(header);
          for (const u of list) {
            await ctx.reply(fmtUser(u), {
              parse_mode: "HTML",
              disable_web_page_preview: true,
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "✅ Duyệt",
                      callback_data: `kyc:approve:${String(u._id)}`,
                    },
                    {
                      text: "❌ Từ chối",
                      callback_data: `kyc:reject:${String(u._id)}`,
                    },
                  ],
                ],
              },
            });
          }
          return;
        }

        if (list.length <= 10) {
          for (const u of list) {
            await ctx.reply(fmtUser(u), {
              parse_mode: "HTML",
              disable_web_page_preview: true,
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "✅ Duyệt",
                      callback_data: `kyc:approve:${String(u._id)}`,
                    },
                    {
                      text: "❌ Từ chối",
                      callback_data: `kyc:reject:${String(u._id)}`,
                    },
                  ],
                ],
              },
            });
          }
        } else {
          await ctx.reply(
            "Mẹo: Dùng /findkyc <email|phone|nickname> để mở chi tiết từng hồ sơ kèm ảnh & nút duyệt.",
          );
        }
      }),
    );

    // ======================= /rank =========================
    bot.command(
      "rank",
      safe("rank", async (ctx) => {
        const raw = ctx.message?.text || "";
        const args = raw.split(" ").slice(1);

        if (args.length < 3) {
          return ctx.reply(
            [
              "Cách dùng:",
              '/rank <email|phone|nickname> <single> <double> [--guard] [--note "ghi chú..."]',
              'Ví dụ: /rank abcd 3.5 3.0 --note "đánh ổn định"',
            ].join("\n"),
          );
        }

        const guard = /(?:^|\s)--guard(?:\s|$)/i.test(raw);
        const noteMatch = raw.match(/--note\s+(.+)$/i);
        const note = noteMatch ? noteMatch[1].trim().replace(/^"|"$/g, "") : "";

        const q = args[0];
        const singleStr = args[1];
        const doubleStr = args[2];

        let sSingle = parseNumLoose(singleStr);
        let sDouble = parseNumLoose(doubleStr);
        if (sSingle == null || sDouble == null) {
          return ctx.reply(
            "❌ Điểm không hợp lệ. Ví dụ: 3.5 3.0 (dùng . hoặc , đều được).",
          );
        }

        sSingle = clamp(sSingle, 2.0, 8.0);
        sDouble = clamp(sDouble, 2.0, 8.0);

        const u = await findUserByQuery(q);
        if (!u) return ctx.reply("❌ Không tìm thấy người dùng phù hợp.");
        const userId = String(u._id);

        if (guard) {
          await ScoreHistory.create({
            user: userId,
            scorer: null,
            single: sSingle,
            double: sDouble,
            note: note
              ? `Telegram (KHÔNG TÍNH ĐIỂM): ${note}`
              : "Telegram (KHÔNG TÍNH ĐIỂM)",
            scoredAt: new Date(),
          });

          return ctx.reply(
            [
              "✅ Đý GHI LỊCH SỬ (KHÔNG TÍNH ĐIỂM)",
              `• Người dùng: ${u?.name || "—"}${
                u?.nickname ? ` (@${u.nickname})` : ""
              }`,
              `• Single: ${sSingle.toFixed(1)} | Double: ${sDouble.toFixed(1)}`,
              note ? `• Ghi chú: ${note}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }

        const userExists = await User.exists({ _id: userId });
        if (!userExists) return ctx.reply("❌ Không tìm thấy người dùng.");

        const rank = await Ranking.findOneAndUpdate(
          { user: userId },
          {
            $set: {
              single: sSingle,
              double: sDouble,
              updatedAt: new Date(),
              hasStaffAssessment: true,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        // Recalculate tier after setting hasStaffAssessment
        if (rank) {
          rank.recalculateTier();
          await rank.save();
        }

        const hasSelfAssessment = await Assessment.exists({
          user: userId,
          "meta.selfScored": true,
        });

        let createdSelfAssessment = false;
        if (!hasSelfAssessment) {
          await Assessment.create({
            user: userId,
            scorer: null,
            items: [],
            singleScore: sSingle,
            doubleScore: sDouble,
            meta: { selfScored: true },
            note: "Tự chấm trình (admin hỗ trợ)",
            scoredAt: new Date(),
          });
          createdSelfAssessment = true;
        }

        const baseNote = createdSelfAssessment
          ? "Admin chấm điểm và tạo tự chấm (admin hỗ trợ)"
          : "Admin chấm điểm trình";

        await ScoreHistory.create({
          user: userId,
          scorer: null,
          single: sSingle,
          double: sDouble,
          note: note ? `${baseNote}. Ghi chú: ${note}` : baseNote,
          scoredAt: new Date(),
        });

        return ctx.reply(
          [
            "✅ Đý CẬP NHẬT ĐIỂM",
            `• Người dùng: ${u?.name || "—"}${
              u?.nickname ? ` (@${u.nickname})` : ""
            }`,
            `• Single: ${
              rank.single?.toFixed ? rank.single.toFixed(1) : rank.single
            }`,
            `• Double: ${
              rank.double?.toFixed ? rank.double.toFixed(1) : rank.double
            }`,
            createdSelfAssessment ? "• Đã tạo tự chấm (admin hỗ trợ)" : "",
            note ? `• Ghi chú: ${note}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }),
    );

    // ==================== /rankget | /point | /rating ====================
    bot.command(
      ["rankget", "point", "rating"],
      safe("rankget|point|rating", async (ctx) => {
        const args = (ctx.message?.text || "").split(" ").slice(1);
        const q = args.join(" ").trim();
        if (!q) {
          return ctx.reply(
            [
              "Cách dùng:",
              "/rankget <email|phone|nickname>",
              "Ví dụ: /rankget v1b2",
            ].join("\n"),
          );
        }

        const u = await findUserByQuery(q);
        if (!u) return ctx.reply("❌ Không tìm thấy người dùng phù hợp.");

        const userId = String(u._id);
        const rank = await Ranking.findOne(
          { user: userId },
          { single: 1, double: 1, updatedAt: 1 },
        ).lean();

        const _fmt1 = (v) =>
          Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "—";
        const updated = rank?.updatedAt
          ? new Date(rank.updatedAt).toLocaleString("vi-VN")
          : null;

        if (rank) {
          return ctx.reply(
            [
              "🏅 <b>Điểm hiện tại</b>",
              `• Người dùng: <b>${esc(u?.name || "—")}</b>${
                u?.nickname ? ` <i>(${esc(u.nickname)})</i>` : ""
              }`,
              `• Single: <b>${_fmt1(rank.single)}</b>`,
              `• Double: <b>${_fmt1(rank.double)}</b>`,
              updated ? `• Cập nhật: <i>${updated}</i>` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            { parse_mode: "HTML" },
          );
        }

        const last = await ScoreHistory.findOne(
          { user: userId },
          { single: 1, double: 1, note: 1, scoredAt: 1 },
        )
          .sort({ scoredAt: -1, _id: -1 })
          .lean();

        if (last) {
          const when = last.scoredAt
            ? new Date(last.scoredAt).toLocaleString("vi-VN")
            : "";
          return ctx.reply(
            [
              "ℹ️ Chưa có điểm chính thức trên BXH.",
              "🔎 <b>Bản chấm gần nhất</b>:",
              `• Người dùng: <b>${esc(u?.name || "—")}</b>${
                u?.nickname ? ` <i>(${esc(u.nickname)})</i>` : ""
              }`,
              `• Single: <b>${_fmt1(last.single)}</b>`,
              `• Double: <b>${_fmt1(last.double)}</b>`,
              when ? `• Thời điểm: <i>${when}</i>` : "",
              last.note ? `• Ghi chú: <i>${esc(last.note)}</i>` : "",
              "",
              "💡 Dùng /rank để cập nhật điểm chính thức.",
            ]
              .filter(Boolean)
              .join("\n"),
            { parse_mode: "HTML" },
          );
        }

        return ctx.reply(
          [
            "ℹ️ Chưa có điểm cho người dùng này.",
            "💡 Dùng /rank <q> <single> <double> để cập nhật.",
          ].join("\n"),
        );
      }),
    );

    // ========================== /reg ==========================
    bot.command(
      ["reg", "reginfo"],
      safe("reg|reginfo", async (ctx) => {
        const args = (ctx.message?.text || "").trim().split(/\s+/).slice(1);
        const q = args[0];

        if (!q) {
          return ctx.reply(
            [
              "Cách dùng:",
              "/reg <mã đăng ký|_id>",
              "Ví dụ:",
              "• /reg 10025",
              "• /reg 68c81897630cb625c458ea6f",
            ].join("\n"),
          );
        }

        let reg = null;
        if (/^\d{5,}$/.test(q)) {
          reg = await Registration.findOne({ code: Number(q) }).lean();
        } else if (/^[a-fA-F0-9]{24}$/.test(q)) {
          reg = await Registration.findById(q).lean();
        } else {
          return ctx.reply(
            "❌ Định dạng không hợp lệ. Nhập mã số (>=5 chữ số) hoặc _id (24 hex).",
          );
        }

        if (!reg) return ctx.reply("❌ Không tìm thấy đăng ký.");

        const tour = await Tournament.findById(reg.tournament)
          .select("_id name eventType")
          .lean();

        const msg = fmtRegMessage(reg, tour);
        const isPaid = String(reg?.payment?.status || "") === "Paid";

        await ctx.reply(msg, {
          parse_mode: "HTML",
          reply_markup: buildPayKeyboard(reg._id, isPaid),
          disable_web_page_preview: true,
        });
      }),
    );

    // ========================== /spc <query>[;province] [--debug] ==========================
    function parseDotNetDate(s) {
      if (!s) return null;
      const m = String(s).match(/\/Date\((\d+)\)\//);
      return m ? new Date(Number(m[1])) : null;
    }
    function fmtTimeVN(d) {
      return d ? d.toLocaleString("vi-VN") : "—";
    }
    function fmt1(v) {
      const n = Number(v);
      return Number.isFinite(n) ? (Math.round(n * 100) / 100).toFixed(2) : "—";
    }
    function fmtGender(g) {
      if (g === 1) return "Nam";
      if (g === 2) return "Nữ";
      return "—";
    }
    function sportNameById(id) {
      if (String(id) === "2") return "Pickleball";
      if (String(id) === "1") return "Tennis";
      return String(id ?? "—");
    }
    function renderSpcCaption(
      it,
      { index = 1, total = 1, proxyUrl, status, debug = false } = {},
    ) {
      const when = parseDotNetDate(it?.ThoiGianCham);
      const joined = parseDotNetDate(it?.JoinDate);

      const lines = [
        `🏸 <b>SportConnect • LevelPoint</b> ${
          total > 1 ? `(#${index}/${total})` : ""
        }`,
        `🆔 ID: <b>${esc(it?.ID ?? it?.MaskId ?? "—")}</b>`,
        `👤 Họ tên: <b>${esc(it?.HoVaTen || "—")}</b>`,
        it?.NickName
          ? `🏷 Nickname: <i>${esc(String(it.NickName).trim())}</i>`
          : "",
        `⚧ Giới tính: <b>${esc(fmtGender(it?.GioiTinh))}</b>`,
        it?.TenTinhThanh ? `📍 Tỉnh/TP: <b>${esc(it?.TenTinhThanh)}</b>` : "",
        it?.SoDienThoai ? `📞 SĐT: <b>${esc(it?.SoDienThoai)}</b>` : "",
        `🥇 Điểm: <b>Single ${fmt1(it?.DiemDon)}</b> • <b>Double ${fmt1(
          it?.DiemDoi,
        )}</b>`,
        `🏟 Môn: <b>${esc(sportNameById(it?.IDMonTheThao))}</b>`,
        it?.DienGiai ? `📝 Ghi chú: <i>${esc(it?.DienGiai)}</i>` : "",
        when ? `🕒 Chấm: <i>${fmtTimeVN(when)}</i>` : "",
        joined ? `📅 Tham gia: <i>${fmtTimeVN(joined)}</i>` : "",
        debug
          ? `\n<b>Debug</b> • Status: <code>${esc(
              String(status ?? ""),
            )}</code>${
              proxyUrl ? ` • Proxy: <code>${esc(proxyUrl)}</code>` : ""
            }`
          : "",
      ].filter(Boolean);

      return lines.join("\n");
    }

    bot.command(
      "spc",
      safe("spc", async (ctx) => {
        const raw = ctx.message?.text || "";
        const after = raw.replace(/^\/spc(?:@\w+)?\s*/i, "");
        const debug = /(?:^|\s)--debug(?:\s|$)/i.test(after);
        const cleaned = after.replace(/(?:^|\s)--debug(?:\s|$)/gi, "").trim();

        let mainQuery = cleaned;
        let provinceQuery = "";
        if (cleaned.includes(";")) {
          const parts = cleaned.split(";");
          mainQuery = (parts[0] || "").trim();
          provinceQuery = (parts[1] || "").trim();
        }

        if (!mainQuery && !provinceQuery) {
          return replySafe(
            ctx,
            [
              "Cách dùng:",
              "/spc <chuỗi tìm kiếm>[;<tỉnh/thành>] [--debug]",
              "VD: /spc 0941xxxxxx",
              "VD: /spc Truong Vinh Hien;Ho Chi Minh",
            ].join("\n"),
          );
        }

        const all = await spcLoadAll();
        if (!all.length) {
          const meta = await spcGetMeta();
          return replySafe(
            ctx,
            [
              "❌ Chưa có dữ liệu SPC trong hệ thống.",
              "• Vào Admin → SPC để tải file .txt (mảng JSON)",
              debug
                ? `Meta: count=${meta?.count ?? 0} size=${meta?.size ?? 0}`
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }

        const results = await spcSearch({
          q: mainQuery,
          province: provinceQuery,
          limit: 40,
        });
        if (!results.length) {
          return replySafe(
            ctx,
            [
              "❌ Không tìm thấy kết quả phù hợp trong dữ liệu SPC.",
              provinceQuery ? `• Bộ lọc tỉnh: \"${provinceQuery}\"` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }

        const total = results.length;
        const parts = results.map((it, idx) => {
          const x = spcAdapt(it);
          const when = x.joinedAt
            ? new Date(x.joinedAt).toLocaleString("vi-VN")
            : "—";
          const s1 = Number.isFinite(Number(x.single))
            ? Number(x.single).toFixed(2)
            : "—";
          const s2 = Number.isFinite(Number(x.double))
            ? Number(x.double).toFixed(2)
            : "—";
          return [
            `🏸 <b>SportConnect • LevelPoint</b> (#${idx + 1}/${total})`,
            `🆔 ID: <b>${esc(x.id)}</b>`,
            `👤 Họ tên: <b>${esc(x.name)}</b>` +
              (x.nick && x.nick !== x.name
                ? ` (aka <i>${esc(x.nick)}</i>)`
                : ""),
            x.tinh ? `📍 Tỉnh/TP: <b>${esc(x.tinh)}</b>` : "",
            x.phone ? `📞 SĐT: <b>${esc(x.phone)}</b>` : "",
            `🥇 Điểm: <b>Single ${s1}</b> • <b>Double ${s2}</b>`,
            when ? `📅 Tham gia: <i>${when}</i>` : "",
            debug ? `\n<b>Debug</b> • Source: local .txt` : "",
          ]
            .filter(Boolean)
            .join("\n");
        });

        let buffer = "";
        for (const p of parts) {
          if ((buffer + "\n\n" + p).length > 3900) {
            await replySafe(ctx, buffer, {
              parse_mode: "HTML",
              disable_web_page_preview: true,
            });
            buffer = p;
          } else {
            buffer = buffer ? buffer + "\n\n" + p : p;
          }
        }
        if (buffer) {
          await replySafe(ctx, buffer, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
          });
        }
      }),
    );

    // --------------------- Launch & Stop -------------------
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    } catch (e) {
      console.warn("deleteWebhook failed:", e?.message);
    }

    try {
      console.log("🔄 Step 1: Getting bot info...");
      const me = await bot.telegram.getMe();
      console.log("✅ Bot info:", me.username);

      console.log("🔄 Step 2: Deleting webhook (FORCE)...");
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      console.log("✅ Webhook deleted");

      console.log("🔄 Step 3: Starting polling (NO AWAIT)...");

      // ✅ KHÔNG dùng await bot.launch() vì nó sẽ treo
      // Dùng startPolling() và KHÔNG await
      bot.startPolling(
        30, // timeout (seconds)
        100, // limit (messages per request)
        ["message", "callback_query", "inline_query"], // allowed updates
      );

      // ✅ Hoặc dùng launch() KHÔNG AWAIT
      // bot.launch({ dropPendingUpdates: true });

      console.log("✅ Step 4: Polling started (non-blocking)");

      bindSupportBotRef(bot);
      console.log("✅ Step 5: Bot ref bound");

      console.log("✅ [kycBot] Bot started successfully!");
    } catch (e) {
      console.error("❌ Error:", e);
      throw e;
    }

    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
    return bot;
  } catch (e) {
    console.error("[initKycBot] fatal init error:", e);
    // Không throw để tránh crash tiến trình; trả null để caller tự quyết
    return null;
  }
}
