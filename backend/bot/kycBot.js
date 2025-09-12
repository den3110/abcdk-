// server/bot/kycBot.js
// --------------------------------------------------------------
// Bot KYC + Chấm điểm nhanh (/rank)
// - Giữ nguyên /start, /kyc_command, /kyc_status, /kyc_pending
// - Thêm /rank <email|phone|nickname> <single> <double> [--guard] [--note "..."]
//   • --guard  : chỉ ghi lịch sử, KHÔNG cập nhật Ranking
//   • --note   : ghi chú (nên đặt ở cuối dòng)
//   Ví dụ:
//   /rank v1b2 3.5 3.0 --note "đánh ổn định"
//   /rank 0987654321 4 3.5 --guard --note "để theo dõi"
// --------------------------------------------------------------

import { Telegraf } from "telegraf";
import dotenv from "dotenv";

import User from "../models/userModel.js";
import Ranking from "../models/rankingModel.js";
import Assessment from "../models/assessmentModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";

import { registerKycReviewButtons } from "../services/telegram/telegramNotifyKyc.js";

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// ADMIN_IDS giữ lại nếu sau này muốn hạn chế, hiện tại không dùng
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ======================= Utils chung ==========================
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

// ------------------ Help & Buttons cho KYC --------------------
function buildKycHelp() {
  return [
    "<b>Hướng dẫn KYC Bot</b>",
    "",
    "Các lệnh khả dụng:",
    "• <code>/start</code> — Giới thiệu nhanh & hiện Telegram ID",
    "• <code>/kyc_command</code> — Danh sách toàn bộ lệnh & cách dùng",
    "• <code>/kyc_status &lt;email|phone|nickname&gt;</code> — Tra cứu chi tiết 1 người dùng (kèm ảnh CCCD & nút duyệt/từ chối).",
    "• <code>/kyc_pending [limit]</code> — Liệt kê người dùng đang chờ duyệt (mặc định 20, tối đa 50).",
    "",
    "• <code>/rank &lt;email|phone|nickname&gt; &lt;single&gt; &lt;double&gt; [--guard] [--note &quot;ghi chú...&quot;]</code>",
    "   - Chấm nhanh điểm trình theo logic adminUpdateRanking (bỏ auth).",
    "   - <code>--guard</code>: chỉ ghi lịch sử, KHÔNG cập nhật Ranking.",
    "",
    "• <code>/rank_get &lt;email|phone|nickname&gt;</code> — Xem điểm hiện tại (BXH).",
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
}

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

// ========================= Khởi tạo BOT =========================
export function initKycBot(app) {
  if (!BOT_TOKEN) {
    console.warn("[kycBot] No TELEGRAM_BOT_TOKEN provided, bot disabled.");
    return null;
  }

  const bot = new Telegraf(BOT_TOKEN);

  // Không chặn quyền: ai cũng dùng được tất cả lệnh

  // Log callback_query (Duyệt/Từ chối KYC)
  bot.on("callback_query", async (ctx, next) => {
    console.log(
      "[kycBot] callback_query:",
      ctx.callbackQuery?.data,
      "from",
      ctx.from?.id
    );
    return next();
  });

  // Đăng ký handler nút Duyệt/Từ chối (toast & message kết quả)
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
        description: "Tra cứu người dùng (email/phone/nickname)",
      },
      { command: "kyc_pending", description: "Danh sách KYC chờ duyệt" },
      {
        command: "rank",
        description:
          "Chấm điểm nhanh (single double) + tuỳ chọn --guard/--note",
      },
      { command: "point", description: "Xem điểm hiện tại (alias)" },
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
        "Gõ <code>/kyc_command</code> để xem đầy đủ lệnh & cách dùng.",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  });

  // ------------------- /kyc_command ---------------------
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

  // -------------------- /kyc_status <q> -----------------
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

  // -------------------- /kyc_pending [limit] -----------------
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
            reply_markup: buildReviewButtons(String(u._id)),
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

  // ======================= /rank =========================
  // /rank <q> <single> <double> [--guard] [--note "..."]
  bot.command("rank", async (ctx) => {
    const raw = ctx.message?.text || "";
    const args = raw.split(" ").slice(1); // sau /rank

    // Usage
    if (args.length < 3) {
      return ctx.reply(
        [
          "Cách dùng:",
          '/rank <email|phone|nickname> <single> <double> [--guard] [--note "ghi chú..."]',
          'Ví dụ: /rank abcd 3.5 3.0 --note "đánh ổn định"',
        ].join("\n")
      );
    }

    // Flags:
    const guard = /(?:^|\s)--guard(?:\s|$)/i.test(raw);
    // Lưu ý: --note nên đặt ở CUỐI dòng để bắt đúng phần ghi chú
    const noteMatch = raw.match(/--note\s+(.+)$/i);
    const note = noteMatch ? noteMatch[1].trim().replace(/^"|"$/g, "") : "";

    // Ba tham số đầu: q single double
    const q = args[0];
    const singleStr = args[1];
    const doubleStr = args[2];

    // Parse điểm
    let sSingle = parseNumLoose(singleStr);
    let sDouble = parseNumLoose(doubleStr);
    if (sSingle == null || sDouble == null) {
      return ctx.reply(
        "❌ Điểm không hợp lệ. Ví dụ: 3.5 3.0 (dùng . hoặc , đều được)."
      );
    }

    // (tuỳ chọn) giới hạn 2.0–8.0 (DUPR min 2.0)
    sSingle = clamp(sSingle, 2.0, 8.0);
    sDouble = clamp(sDouble, 2.0, 8.0);

    try {
      const u = await findUserByQuery(q);
      if (!u) return ctx.reply("❌ Không tìm thấy người dùng phù hợp.");
      const userId = String(u._id);

      if (guard) {
        // CHỈ ghi lịch sử (KHÔNG cập nhật Ranking) — bỏ auth
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

      // === ÁP DỤNG ĐIỂM (logic adminUpdateRanking, bỏ qua auth) ===

      // 1) User tồn tại?
      const userExists = await User.exists({ _id: userId });
      if (!userExists) return ctx.reply("❌ Không tìm thấy người dùng.");

      // 2) Upsert Ranking
      const rank = await Ranking.findOneAndUpdate(
        { user: userId },
        { $set: { single: sSingle, double: sDouble, updatedAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true, lean: true }
      );

      // 3) Nếu CHƯA có "tự chấm" meta.selfScored → tạo tự chấm (admin hỗ trợ)
      const hasSelfAssessment = await Assessment.exists({
        user: userId,
        "meta.selfScored": true,
      });

      let createdSelfAssessment = false;
      if (!hasSelfAssessment) {
        await Assessment.create({
          user: userId,
          scorer: null, // bỏ auth
          items: [],
          singleScore: sSingle,
          doubleScore: sDouble,
          meta: { selfScored: true },
          note: "Tự chấm trình (admin hỗ trợ)",
          scoredAt: new Date(),
        });
        createdSelfAssessment = true;
      }

      // 4) Ghi lịch sử
      const baseNote = createdSelfAssessment
        ? "Admin chấm điểm và tạo tự chấm (admin hỗ trợ)"
        : "Admin chấm điểm trình";

      await ScoreHistory.create({
        user: userId,
        scorer: null, // bỏ auth
        single: sSingle,
        double: sDouble,
        note: note ? `${baseNote}. Ghi chú: ${note}` : baseNote,
        scoredAt: new Date(),
      });

      // 5) Trả kết quả
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

  bot.command(["rank_get", "point", "rating"], async (ctx) => {
    const args = (ctx.message?.text || "").split(" ").slice(1);
    const q = args.join(" ").trim();
    if (!q) {
      return ctx.reply(
        [
          "Cách dùng:",
          "/rank_get <email|phone|nickname>",
          "Ví dụ: /rank_get v1b2",
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

      // helper format
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

      // Fallback: chưa có Ranking → thử lấy bản ghi lịch sử gần nhất
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

      // Không có Ranking & không có lịch sử
      return ctx.reply(
        [
          "ℹ️ Chưa có điểm cho người dùng này.",
          "💡 Dùng /rank <q> <single> <double> để cập nhật.",
        ].join("\n")
      );
    } catch (e) {
      console.error("rank_get error:", e);
      return ctx.reply("❌ Có lỗi xảy ra khi lấy điểm.");
    }
  });

  // --------------------- Launch & Stop -------------------
  bot.launch().then(() => {
    console.log("[kycBot] Bot started (polling).");
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
  return bot;
}
