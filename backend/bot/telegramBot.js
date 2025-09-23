// server/bot/kycBot.js
// --------------------------------------------------------------
// Bot KYC + Chấm điểm nhanh (/rank)
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

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// ======================= Utils chung ==========================

// === Helpers cho Registration ===
const TELE_PAYMENT_ADMINS = String(process.env.TELEGRAM_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isPaymentAdmin = (telegramUserId) => {
  if (!TELE_PAYMENT_ADMINS.length) return true; // nếu không cấu hình thì cho phép hết
  return TELE_PAYMENT_ADMINS.includes(String(telegramUserId));
};
// Ai thực hiện thao tác trên Telegram
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
    ? `💰 Lệ phí: <b>ĐÃ THANH TOÁN</b>${when ? ` <i>(${when})</i>` : ""}`
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
            text: "✅ Xác nhận ĐÃ thanh toán",
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
  // Escape HTML cho parse_mode: "HTML"
  const escText = esc(text);
  const max = 3800; // chừa chỗ cho <pre><code>...</code></pre>
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

// --- Helpers cho /spc ---
function parseDotNetDate(s) {
  // "/Date(1758534749547)/" -> Date
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
  // tùy hệ thống SC: 1 Tennis? 2 Pickleball? (bạn điều chỉnh nếu cần)
  if (String(id) === "2") return "Pickleball";
  if (String(id) === "1") return "Tennis";
  return String(id ?? "—");
}

/** Render 1 bản ghi theo format đẹp (caption) */
function renderSpcCaption(
  it,
  { index = 1, total = 1, proxyUrl, status, debug = false } = {}
) {
  const when = parseDotNetDate(it?.ThoiGianCham);
  const joined = parseDotNetDate(it?.JoinDate);

  const lines = [
    `🏸 <b>SportConnect • LevelPoint</b> ${
      total > 1 ? `(#${index}/${total})` : ""
    }`,
    `🆔 ID: <b>${esc(it?.ID ?? it?.MaskId ?? "—")}</b>`,
    `👤 Họ tên: <b>${esc(it?.HoVaTen || "—")}</b>`,
    it?.NickName ? `🏷 Nickname: <i>${esc(String(it.NickName).trim())}</i>` : "",
    `⚧ Giới tính: <b>${esc(fmtGender(it?.GioiTinh))}</b>`,
    it?.TenTinhThanh ? `📍 Tỉnh/TP: <b>${esc(it.TenTinhThanh)}</b>` : "",
    it?.SoDienThoai ? `📞 SĐT: <b>${esc(it.SoDienThoai)}</b>` : "",
    `🥇 Điểm: <b>Single ${fmt1(it?.DiemDon)}</b> • <b>Double ${fmt1(
      it?.DiemDoi
    )}</b>`,
    `🏟 Môn: <b>${esc(sportNameById(it?.IDMonTheThao))}</b>`,
    it?.DienGiai ? `📝 Ghi chú: <i>${esc(it.DienGiai)}</i>` : "",
    when ? `🕒 Chấm: <i>${fmtTimeVN(when)}</i>` : "",
    joined ? `📅 Tham gia: <i>${fmtTimeVN(joined)}</i>` : "",
    debug ? "" : "",
    debug
      ? `\n<b>Debug</b> • Status: <code>${esc(String(status ?? ""))}</code>${
          proxyUrl ? ` • Proxy: <code>${esc(proxyUrl)}</code>` : ""
        }`
      : "",
  ].filter(Boolean);

  return lines.join("\n");
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

/**
 * Gửi ảnh an toàn:
 * - Nếu ảnh > ~10MB → gửi Document
 * - Nếu sendPhoto lỗi → fallback sendDocument
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

// ========================= Khởi tạo BOT =========================
export async function initKycBot(app) {
  if (!BOT_TOKEN) {
    console.warn("[kycBot] No TELEGRAM_BOT_TOKEN provided, bot disabled.");
    return null;
  }

  const bot = new Telegraf(BOT_TOKEN);

  // Logger callback_query (không nuốt chain)

  bot.on("callback_query", async (ctx, next) => {
    const data = String(ctx.callbackQuery?.data || "");
    console.log(data);
    if (!data.startsWith("kyc:")) return next(); // <<< QUAN TRỌNG
    console.log(
      "[kycBot] callback_query:",
      ctx.callbackQuery?.data,
      "from",
      ctx.from?.id
    );
    return next();
  });

  // ====== Toggle thanh toán: reg:pay / reg:unpay ======
  // ====== Toggle thanh toán: reg:pay / reg:unpay ======
  bot.action(/^reg:(pay|unpay):([a-fA-F0-9]{24})$/, async (ctx) => {
    try {
      const [, action, regId] = ctx.match || [];
      // Quyền thao tác (tuỳ chọn): hạn chế theo TELEGRAM_PAYMENT_ADMINS
      if (!isPaymentAdmin(ctx.from?.id)) {
        return ctx.answerCbQuery("Bạn không có quyền thực hiện thao tác này.", {
          show_alert: true,
        });
      }

      await ctx.answerCbQuery("Đang cập nhật…");

      const update =
        action === "pay"
          ? { "payment.status": "Paid", "payment.paidAt": new Date() }
          : { "payment.status": "Unpaid", "payment.paidAt": null };

      const reg = await Registration.findByIdAndUpdate(
        regId,
        { $set: update },
        { new: true }
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

      // Cập nhật lại message + nút
      try {
        await ctx.editMessageText(msg, {
          parse_mode: "HTML",
          reply_markup: buildPayKeyboard(reg._id, isPaid),
          disable_web_page_preview: true,
        });
      } catch (e) {
        // Nếu edit thất bại (vd: đã xoá/tin cũ), gửi tin mới
        await ctx.reply(msg, {
          parse_mode: "HTML",
          reply_markup: buildPayKeyboard(reg._id, isPaid),
          disable_web_page_preview: true,
        });
      }

      // 🔔 GỬI THÊM MỘT TIN NHẮN XÁC NHẬN
      const confirmTitle = isPaid
        ? "✅ ĐÃ XÁC NHẬN THANH TOÁN"
        : "↩️ ĐÃ ĐÁNH DẤU CHƯA THANH TOÁN";

      const et = normET(tour?.eventType);
      const whoLine =
        et === "single"
          ? `• VĐV: <b>${esc(teamNameOf(reg, tour))}</b>`
          : `• Cặp VĐV: <b>${esc(teamNameOf(reg, tour))}</b>`;

      const whenLine =
        isPaid && reg?.payment?.paidAt
          ? `• Thời điểm: <i>${new Date(reg.payment.paidAt).toLocaleString(
              "vi-VN"
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

      await ctx.reply(confirmMsg, {
        parse_mode: "HTML",
        reply_to_message_id: ctx.update?.callback_query?.message?.message_id,
        disable_web_page_preview: true,
      });

      await ctx.answerCbQuery(
        isPaid ? "Đã đánh dấu: ĐÃ thanh toán" : "Đã đánh dấu: CHƯA thanh toán"
      );
    } catch (e) {
      console.error("[reg:pay|unpay] error:", e);
      try {
        await ctx.answerCbQuery("Có lỗi xảy ra.", { show_alert: true });
      } catch {}
    }
  });

  // ===== KYC: Duyệt / Từ chối =====
  bot.action(/^kyc:(approve|reject):([a-fA-F0-9]{24})$/, async (ctx) => {
    try {
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

      // Idempotent
      // if (user.cccdStatus === "verified" && action === "approve") {
      //   ctx.answerCbQuery("Đã duyệt trước đó ✅");
      // }
      // if (user.cccdStatus === "rejected" && action === "reject") {
      //   ctx.answerCbQuery("Đã từ chối trước đó ❌");
      // }

      const $set =
        action === "approve"
          ? { cccdStatus: "verified", verified: "verified" }
          : { cccdStatus: "rejected" };
      const updated = await User.findByIdAndUpdate(
        userId,
        { $set },
        { new: true, runValidators: true }
      ).select("_id cccdStatus verified");
      if (!updated) {
        ctx.answerCbQuery("Cập nhật thất bại.", { show_alert: true });
      }

      await ctx.answerCbQuery(
        action === "approve" ? "Đã duyệt ✅" : "Đã từ chối ❌"
      );
      await notifyKycReviewed(user, action);
      // (tuỳ chọn) bạn có thể gửi thêm 1 message vào chat nếu muốn
    } catch (e) {
      console.error("[kycBot] KYC action error:", e);
      // try {
      //   await ctx.answerCbQuery("Có lỗi xảy ra.", { show_alert: true });
      // } catch(e) {
      //   console.error(e)
      // }
    }
  });

  // ===== Complaint: ĐÃ XỬ LÝ / TỪ CHỐI =====
  bot.action(/^complaint:(resolve|reject):([a-fA-F0-9]{24})$/, async (ctx) => {
    try {
      const [, action, id] = ctx.match || [];
      await ctx.answerCbQuery("Đang cập nhật…");

      // 1) Tải complaint
      const complaint = await Complaint.findById(id);
      if (!complaint) {
        return ctx.answerCbQuery("Không tìm thấy khiếu nại", {
          show_alert: true,
        });
      }

      // 2) Cập nhật trạng thái
      const newStatus = action === "resolve" ? "resolved" : "rejected";
      complaint.status = newStatus;
      await complaint.save();

      // 3) Load thêm để hiển thị đủ thông tin cặp (tên/nickname sđt)
      const [tour, reg] = await Promise.all([
        Tournament.findById(complaint.tournament).lean(),
        Registration.findById(complaint.registration).lean(),
      ]);

      // 4) Gửi một TIN NHẮN MỚI, reply ngay dưới tin gốc
      const chatId =
        ctx.update?.callback_query?.message?.chat?.id ?? ctx.chat?.id;
      const replyToMessageId = ctx.update?.callback_query?.message?.message_id;
      await notifyComplaintStatusChange({
        complaint: complaint.toObject?.() || complaint,
        tournament: tour,
        registration: reg,
        newStatus,
        actor: ctx.from,
        chatId,
        replyToMessageId, // => hiện ngay dưới tin khiếu nại
      });

      // 5) (khuyến nghị) Gỡ nút khỏi tin gốc để tránh bấm lại
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (e) {
        console.warn("editMessageReplyMarkup failed:", e?.message);
      }

      // 6) Toast confirm
      await ctx.answerCbQuery(
        newStatus === "resolved"
          ? "Đã đánh dấu: ĐÃ XỬ LÝ"
          : "Đã đánh dấu: TỪ CHỐI"
      );
    } catch (e) {
      console.error("[kycBot] complaint action error:", e);
      try {
        await ctx.answerCbQuery("Có lỗi xảy ra", { show_alert: true });
      } catch {}
    }
  });
  // Hiển thị lệnh trong menu của Telegram (đổi tên, bỏ dấu "_")
  bot.telegram
    .setMyCommands([
      { command: "start", description: "Giới thiệu & hướng dẫn nhanh" },
      {
        command: "startkyc",
        description: "Danh sách toàn bộ lệnh & cách dùng",
      },
      {
        command: "statuskyc",
        description: "Tra cứu người dùng (email/phone/nickname)",
      },
      { command: "pendkyc", description: "Danh sách KYC chờ duyệt" },
      {
        command: "rank",
        description:
          "Chấm điểm nhanh (single double) + tuỳ chọn --guard/--note",
      },
      { command: "point", description: "Xem điểm hiện tại (alias)" },
      { command: "reg", description: "Tra cứu & cập nhật thanh toán đăng ký" },
      { command: "spc", description: "SportConnect LevelPoint: /spc <phone>" },
    ])
    .catch((e) => console.warn("setMyCommands failed:", e?.message));

  // ----------------------- /start -----------------------
  bot.start((ctx) => {
    const uid = ctx.from?.id;
    ctx.reply(
      [
        "Bot KYC đã sẵn sàng.",
        `Your Telegram ID: <code>${esc(uid)}</code>`,
        "",
        "Gõ <code>/startkyc</code> để xem đầy đủ lệnh & cách dùng.",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  });

  // ------------------- /startkyc (thay /startkyc) -------------------
  bot.command("startkyc", async (ctx) => {
    try {
      const msg = [
        "<b>Hướng dẫn KYC Bot</b>",
        "",
        "Các lệnh khả dụng:",
        "• <code>/start</code> — Giới thiệu nhanh & hiện Telegram ID",
        "• <code>/startkyc</code> — Danh sách toàn bộ lệnh & cách dùng",
        "• <code>/statuskyc &lt;email|phone|nickname&gt;</code> — Tra cứu chi tiết 1 người dùng (kèm ảnh CCCD & nút duyệt/từ chối).",
        "• <code>/pendkyc [limit]</code> — Liệt kê người dùng đang chờ duyệt (mặc định 20, tối đa 50).",
        "",
        "• <code>/rank &lt;email|phone|nickname&gt; &lt;single&gt; &lt;double&gt; [--guard] [--note &quot;ghi chú...&quot;]</code>",
        "   - Chấm nhanh điểm trình theo logic adminUpdateRanking (bỏ auth).",
        "   - <code>--guard</code>: chỉ ghi lịch sử, KHÔNG cập nhật Ranking.",
        "",
        "• <code>/rankget &lt;email|phone|nickname&gt;</code> — Xem điểm hiện tại.",
        "   Alias: <code>/point</code>, <code>/rating</code>",
        "",
        "Ví dụ:",
        "• <code>/rank v1b2 3.5 3.0 --note &quot;đánh ổn định&quot;</code>",
        "• <code>/point v1b2</code>",
        "",
        "Lưu ý:",
        "• Ảnh CCCD được gửi sau và bám (reply) vào tin nhắn KYC.",
        "• Bot tự fallback gửi file nếu gửi ảnh lỗi.",
      ].join("\n");
      await ctx.reply(msg, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch (e) {
      console.error("startkyc error:", e);
      await ctx.reply("Có lỗi xảy ra khi hiển thị hướng dẫn.");
    }
  });

  // -------------------- /statuskyc <q> (thay /kyc_status) -----------------
  bot.command("statuskyc", async (ctx) => {
    const args = (ctx.message?.text || "").split(" ").slice(1);
    const q = (args[0] || "").trim();
    if (!q) {
      return ctx.reply("Cách dùng:\n/statuskyc <email|số điện thoại|nickname>");
    }

    try {
      const u = await findUserByQuery(q);
      if (!u) return ctx.reply("Không tìm thấy người dùng phù hợp.");

      // 1) Gửi thông tin + NÚT duyệt/từ chối
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
      console.error("statuskyc error:", e);
      ctx.reply("Có lỗi xảy ra khi tra cứu.");
    }
  });

  // -------------------- /pendkyc [limit] (thay /kyc_pending) -----------------
  bot.command("pendkyc", async (ctx) => {
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

      // Dạng ngắn gọn
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
        // Quá dài → tách từng user (kèm nút)
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

      // Gửi thêm chi tiết từng user (kèm nút) nếu danh sách nhỏ
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
          "Mẹo: Dùng /statuskyc <email|phone|nickname> để mở chi tiết từng hồ sơ kèm ảnh & nút duyệt."
        );
      }
    } catch (e) {
      console.error("pendkyc error:", e);
      ctx.reply("Có lỗi xảy ra khi lấy danh sách.");
    }
  });

  // ======================= /rank =========================
  bot.command("rank", async (ctx) => {
    const raw = ctx.message?.text || "";
    const args = raw.split(" ").slice(1);

    if (args.length < 3) {
      return ctx.reply(
        [
          "Cách dùng:",
          '/rank <email|phone|nickname> <single> <double> [--guard] [--note "ghi chú..."]',
          'Ví dụ: /rank abcd 3.5 3.0 --note "đánh ổn định"',
        ].join("\n")
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
        "❌ Điểm không hợp lệ. Ví dụ: 3.5 3.0 (dùng . hoặc , đều được)."
      );
    }

    sSingle = clamp(sSingle, 2.0, 8.0);
    sDouble = clamp(sDouble, 2.0, 8.0);

    try {
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
            "✅ ĐÃ GHI LỊCH SỬ (KHÔNG TÍNH ĐIỂM)",
            `• Người dùng: ${u?.name || "—"}${
              u?.nickname ? ` (@${u.nickname})` : ""
            }`,
            `• Single: ${sSingle.toFixed(1)} | Double: ${sDouble.toFixed(1)}`,
            note ? `• Ghi chú: ${note}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        );
      }

      const userExists = await User.exists({ _id: userId });
      if (!userExists) return ctx.reply("❌ Không tìm thấy người dùng.");

      const rank = await Ranking.findOneAndUpdate(
        { user: userId },
        { $set: { single: sSingle, double: sDouble, updatedAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true, lean: true }
      );

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
          "✅ ĐÃ CẬP NHẬT ĐIỂM",
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
          .join("\n")
      );
    } catch (e) {
      console.error("rank command error:", e);
      return ctx.reply("❌ Có lỗi xảy ra khi chấm điểm.");
    }
  });

  // ==================== /rankget | /point | /rating ====================
  bot.command(["rankget", "point", "rating"], async (ctx) => {
    const args = (ctx.message?.text || "").split(" ").slice(1);
    const q = args.join(" ").trim();
    if (!q) {
      return ctx.reply(
        [
          "Cách dùng:",
          "/rankget <email|phone|nickname>",
          "Ví dụ: /rankget v1b2",
        ].join("\n")
      );
    }

    try {
      const u = await findUserByQuery(q);
      if (!u) return ctx.reply("❌ Không tìm thấy người dùng phù hợp.");

      const userId = String(u._id);
      const rank = await Ranking.findOne(
        { user: userId },
        { single: 1, double: 1, updatedAt: 1 }
      ).lean();

      const fmt1 = (v) =>
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
            `• Single: <b>${fmt1(rank.single)}</b>`,
            `• Double: <b>${fmt1(rank.double)}</b>`,
            updated ? `• Cập nhật: <i>${updated}</i>` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          { parse_mode: "HTML" }
        );
      }

      const last = await ScoreHistory.findOne(
        { user: userId },
        { single: 1, double: 1, note: 1, scoredAt: 1 }
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
            `• Single: <b>${fmt1(last.single)}</b>`,
            `• Double: <b>${fmt1(last.double)}</b>`,
            when ? `• Thời điểm: <i>${when}</i>` : "",
            last.note ? `• Ghi chú: <i>${esc(last.note)}</i>` : "",
            "",
            "💡 Dùng /rank để cập nhật điểm chính thức.",
          ]
            .filter(Boolean)
            .join("\n"),
          { parse_mode: "HTML" }
        );
      }

      return ctx.reply(
        [
          "ℹ️ Chưa có điểm cho người dùng này.",
          "💡 Dùng /rank <q> <single> <double> để cập nhật.",
        ].join("\n")
      );
    } catch (e) {
      console.error("rankget error:", e);
      return ctx.reply("❌ Có lỗi xảy ra khi lấy điểm.");
    }
  });

  // ========================== /reg ==========================
  bot.command(["reg", "reginfo"], async (ctx) => {
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
        ].join("\n")
      );
    }

    try {
      let reg = null;
      if (/^\d{5,}$/.test(q)) {
        reg = await Registration.findOne({ code: Number(q) }).lean();
      } else if (/^[a-fA-F0-9]{24}$/.test(q)) {
        reg = await Registration.findById(q).lean();
      } else {
        return ctx.reply(
          "❌ Định dạng không hợp lệ. Nhập mã số (>=5 chữ số) hoặc _id (24 hex)."
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
    } catch (e) {
      console.error("[/reg] error:", e);
      return ctx.reply("❌ Có lỗi xảy ra khi tra cứu đăng ký.");
    }
  });

  //  /spc <phone> ==========================
  // ========================== /spc <phone> [--debug] ==========================
  bot.command("spc", async (ctx) => {
    const args = (ctx.message?.text || "").trim().split(/\s+/).slice(1);
    const phone = (args[0] || "").trim();
    const debug = args.some((a) => a.toLowerCase() === "--debug");

    if (!phone) {
      return ctx.reply(
        [
          "Cách dùng:",
          "/spc <số điện thoại> [--debug]",
          "VD: /spc 0888698383 --debug",
        ].join("\n")
      );
    }

    try {
      const { status, data, proxyUrl } =
        await SportConnectService.listLevelPoint({
          searchCriterial: phone,
          sportId: 2,
          page: 0,
          waitingInformation: "",
        });

      const arr = Array.isArray(data?.data) ? data.data : [];
      if (!arr.length) {
        return ctx.reply(
          [
            "❌ Không tìm thấy dữ liệu trên SportConnect.",
            debug
              ? `Status: ${status}${proxyUrl ? ` • Proxy: ${proxyUrl}` : ""}`
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        );
      }

      // Chỉ gửi TEXT, không gửi ảnh
      const total = arr.length;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        const caption = renderSpcCaption(it, {
          index: i + 1,
          total,
          proxyUrl,
          status,
          debug,
        });

        await ctx.reply(caption, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      }
    } catch (e) {
      console.error("[/spc] error:", e);
      return ctx.reply("❌ Có lỗi xảy ra khi gọi SportConnect.");
    }
  });

  // --------------------- Launch & Stop -------------------
  // XÓA WEBHOOK trước khi bật polling để tránh 409 conflict
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
  } catch (e) {
    console.warn("deleteWebhook failed:", e?.message);
  }

  bot.launch().then(() => {
    console.log("[kycBot] Bot started (polling).");
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
  return bot;
}
