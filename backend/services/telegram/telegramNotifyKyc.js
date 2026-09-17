import fetch from "node-fetch";
import dotenv from "dotenv";
import {
  CLAUDE_CCCD_MODEL,
  createClaudeJsonMessage,
} from "../../lib/anthropicClient.js";
import FormData from "form-data";
import {
  CATEGORY,
  EVENTS,
  publishNotification,
} from "../notifications/notificationHub.js";
import { stripVN } from "../../utils/cccdParsing.js";
import {
  fetchImageAsBuffer as fetchCccdImageAsBuffer,
  normDOB as normalizeCccdDOB,
  normId as normalizeCccdId,
  normName as normalizeCccdName,
  openaiExtractFromImageUrl as extractCccdFromImageUrl,
} from "../ocr/claudeCccdExtractor.js";

dotenv.config();

// ---- KYC auto flags (from System Settings) ----
let __settingsCache = { ts: 0, val: null };
const SETTINGS_TTL_MS = 10_000;

async function getKycAutoFlag() {
  const now = Date.now();
  if (!__settingsCache.val || now - __settingsCache.ts > SETTINGS_TTL_MS) {
    try {
      const Sys = (await import("../../models/systemSettingsModel.js")).default;
      const s = (await Sys.findById("system").lean()) || {};
      __settingsCache = {
        ts: now,
        val: {
          // ON khi cả kyc.enabled và kyc.autoApprove đều true
          autoKycOn: !!(s?.kyc?.enabled && s?.kyc?.autoApprove),
          // faceMatchThreshold vẫn để nguyên ở schema nhưng KHÔNG dùng ở đây
        },
      };
    } catch {
      __settingsCache = { ts: now, val: { autoKycOn: false } };
    }
  }
  return __settingsCache.val;
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // group/private chat id
const HOST =
  process.env.NODE_ENV === "production"
    ? (process.env.HOST || "").replace(/\/+$/, "")
    : "http://localhost:5001"; // ví dụ: https://pickletour.vn
const toPosix = (s = "") => s.replace(/\\/g, "/");
const MAX_KYC_IMAGE_BYTES = 8 * 1024 * 1024;

// ---------------- utils ----------------
function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Public absolute URL if possible; keep http for localhost/dev
function normalizeImageUrl(raw = "") {
  if (!raw) return "";
  let s = String(raw).trim();
  try {
    const u = new URL(s); // absolute
    return u.toString();
  } catch {
    if (!HOST) return "";
    const path = s.startsWith("/") ? s : `/${s}`;
    return `${HOST}${path}`;
  }
}

function isHttpUrl(value = "") {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isLocalish(value = "") {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    );
  } catch {
    return true;
  }
}

async function fetchImageAsBuffer(url) {
  const r = await fetch(url, {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "user-agent": "PickleTour-KYC-Claude/1.0",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} when fetching ${url}`);
  const ct = r.headers.get("content-type") || "image/jpeg";
  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
  if (!buf.length) throw new Error(`Empty image when fetching ${url}`);
  if (buf.length > MAX_KYC_IMAGE_BYTES) {
    throw new Error(`Image is larger than ${MAX_KYC_IMAGE_BYTES / 1024 / 1024}MB`);
  }
  // đoán tên file
  let filename = "image";
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").pop() || "image";
    filename = base;
  } catch {}
  return { buffer: buf, contentType: ct, filename };
}

function bufferToDataUrl(buffer, contentType = "image/jpeg") {
  const b64 = buffer.toString("base64");
  return `data:${contentType};base64,${b64}`;
}

// ---------------- Core Telegram helpers ----------------
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
    ...opts, // reply_to_message_id, reply_markup, ...
  });
}

// Multipart upload (buffer) cho sendPhoto
async function tgSendPhotoFile({
  buffer,
  filename = "photo.jpg",
  caption,
  reply_to_message_id,
}) {
  if (!BOT_TOKEN || !DEFAULT_CHAT_ID) return { ok: false, skipped: true };
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  const form = new FormData();
  form.append("chat_id", DEFAULT_CHAT_ID);
  if (caption) form.append("caption", caption);
  form.append("parse_mode", "HTML");
  if (reply_to_message_id)
    form.append("reply_to_message_id", String(reply_to_message_id));
  form.append("photo", buffer, { filename });
  const res = await fetch(url, {
    method: "POST",
    body: form,
    headers: form.getHeaders?.(),
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok || json?.ok === false) {
    console.error(`Telegram sendPhoto(file) failed: ${res.status} ${text}`);
  }
  return json;
}

// Multipart upload (buffer) cho sendDocument
async function tgSendDocumentFile({
  buffer,
  filename = "file.jpg",
  caption,
  reply_to_message_id,
}) {
  if (!BOT_TOKEN || !DEFAULT_CHAT_ID) return { ok: false, skipped: true };
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`;
  const form = new FormData();
  form.append("chat_id", DEFAULT_CHAT_ID);
  if (caption) form.append("caption", caption);
  form.append("parse_mode", "HTML");
  if (reply_to_message_id)
    form.append("reply_to_message_id", String(reply_to_message_id));
  form.append("document", buffer, { filename });
  const res = await fetch(url, {
    method: "POST",
    body: form,
    headers: form.getHeaders?.(),
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok || json?.ok === false) {
    console.error(`Telegram sendDocument(file) failed: ${res.status} ${text}`);
  }
  return json;
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

// ---------------- Auto KYC ----------------
// KYC extractor delegate về DISPATCHER chung (`openaiExtractFromDataUrl` +
// `openaiExtractFromImageUrl` trong claudeCccdExtractor.js) — provider được
// điều phối theo env `CCCD_OCR_PROVIDER` (default cedrus: quét QR chip trước,
// fallback OCR Cedrus, fallback Claude khi thiếu field trọng yếu).
// Không được cài bản Claude-only riêng ở đây để tránh bypass dispatcher.

function buildMatchReport(extracted, user) {
  const userName = normalizeCccdName(user?.name || "");
  const userDob = normalizeCccdDOB(user?.dob || user?.birthday || "");
  const userCccd = normalizeCccdId(user?.cccd || user?.citizenId || "");

  const nameOK =
    extracted.fullName && userName && extracted.fullName === userName;
  const dobOK = extracted.dob && userDob && extracted.dob === userDob;
  const idOK =
    extracted.idNumber && userCccd && extracted.idNumber === userCccd;

  const allOK = !!(nameOK && dobOK && idOK);
  return {
    allOK,
    nameOK,
    dobOK,
    idOK,
    wanted: { name: userName, dob: userDob, id: userCccd },
    got: {
      name: extracted.fullName,
      dob: extracted.dob,
      id: extracted.idNumber,
    },
  };
}

// ---------------- Public APIs ----------------
export async function notifyNewKyc(user) {
  if (!user || !BOT_TOKEN || !DEFAULT_CHAT_ID) return;

  // Đọc cờ auto duyệt/từ chối
  const { autoKycOn } = await getKycAutoFlag();
  // console.log(autoKycOn);
  const frontUrl = normalizeImageUrl(toPosix(user?.cccdImages?.front || ""));
  const backUrl = normalizeImageUrl(toPosix(user?.cccdImages?.back || ""));

  let auto = { status: "pending", reason: "", report: null, usage: null };

  try {
    if (frontUrl) {
      // Pass both front and back if available
      const extracted = await extractCccdFromImageUrl([frontUrl, backUrl], "auto");
      auto.usage = extracted._usage || null;
      const report = buildMatchReport(extracted, user);
      auto.report = report;

      // ❗Chỉ auto duyệt/từ chối khi autoKycOn = true
      if (autoKycOn) {
        const UM = (await import("../../models/userModel.js")).default;
        if (report.allOK) {
          auto.status = "approved";
          auto.reason =
            "Thông tin CCCD trùng khớp (họ tên, ngày sinh, số CCCD).";
          await UM.findByIdAndUpdate(
            user._id,
            { $set: { cccdStatus: "verified", verified: "verified" } },
            { new: false },
          ).lean();
          try {
            await publishNotification(EVENTS.KYC_APPROVED, {
              userId: String(user._id),
              topicType: "user",
              topicId: String(user._id),
              category: CATEGORY.KYC,
            });
          } catch (e) {
            console.error("[notifyNewKyc] publish APPROVED error:", e?.message);
          }
        } else {
          auto.status = "rejected";
          auto.reason = "Thông tin CCCD KHÔNG khớp với hồ sơ gửi.";
          await UM.findByIdAndUpdate(
            user._id,
            { $set: { cccdStatus: "rejected" } },
            { new: false },
          ).lean();
          try {
            await publishNotification(EVENTS.KYC_REJECTED, {
              userId: String(user._id),
              topicType: "user",
              topicId: String(user._id),
              category: CATEGORY.KYC,
              reason: auto.reason,
            });
          } catch (e) {
            console.error("[notifyNewKyc] publish REJECTED error:", e?.message);
          }
        }
      } else {
        // Auto OFF → luôn để pending, không cập nhật DB
        auto.status = "pending";
        auto.reason = "Auto review đang tắt. Chờ người duyệt.";
      }
    } else {
      auto.status = "pending";
      auto.reason = "Thiếu ảnh mặt trước";
    }
  } catch (e) {
    console.error("[kyc-auto] error:", e?.message);
    auto.status = "pending";
    auto.reason = "Lỗi khi trích xuất CCCD (để Chờ KYC).";
  }

  // 2) Gửi tin nhắn KYC (text + buttons)
  if (auto.reason && String(auto.reason).includes("CCCD") && !auto.report) {
    auto.reason = "Lỗi khi trích xuất KYC qua Claude (giữ trạng thái Chờ KYC).";
  }

  const statusText =
    auto.status === "approved"
      ? "✅ <b>TỰ ĐỘNG DUYỆT</b>"
      : auto.status === "rejected"
        ? "❌ <b>TỰ ĐỘNG TỪ CHỐI</b>"
        : "⏳ <b>Chờ KYC</b>";

  const reportLines = [];
  if (auto.report) {
    const { wanted, got, nameOK, dobOK, idOK } = auto.report;
    console.log(wanted);
    reportLines.push(
      "🔎 <b>Kết quả so khớp</b>",
      `• Họ tên: ${nameOK ? "✅" : "❌"} <code>${escapeHtml(
        got.name || "—",
      )}</code> (kỳ vọng: <code>${escapeHtml(wanted.name || "—")}</code>)`,
      `• Ngày sinh: ${dobOK ? "✅" : "❌"} <code>${escapeHtml(
        got.dob || "—",
      )}</code> (kỳ vọng: <code>${escapeHtml(wanted.dob || "—")}</code>)`,
      `• Số CCCD: ${idOK ? "✅" : "❌"} <code>${escapeHtml(
        got.id || "—",
      )}</code> (kỳ vọng: <code>${escapeHtml(wanted.id || "—")}</code>)`,
    );
  } else if (auto.reason) {
    reportLines.push(`ℹ️ ${escapeHtml(auto.reason)}`);
  }

  const captionLines = [
    "🆕 <b>KYC mới</b>",
    `👤 <b>${escapeHtml(user?.name || "Ẩn danh")}</b>${
      user?.nickname ? " <i>(" + escapeHtml(user.nickname) + ")</i>" : ""
    }`,
    user?.email ? `✉️ ${escapeHtml(user.email)}` : "",
    user?.phone ? `📞 ${escapeHtml(user.phone)}` : "",
    user?.province ? `📍 ${escapeHtml(user.province)}` : "",
    user?.cccd ? `🪪 CCCD: <code>${escapeHtml(user.cccd)}</code>` : "",
    user?.createdAt
      ? `🕒 ${new Date(user.createdAt).toLocaleString("vi-VN")}`
      : "",
    "",
    `Trạng thái: ${statusText}`,
    ...(reportLines.length ? ["", ...reportLines] : []),
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

  const sentMsg = await tgSend(caption, { reply_markup });
  const replyToId = sentMsg?.result?.message_id;

  // 3) Gửi ảnh (reply vào tin nhắn vừa gửi)
  async function sendOnePhoto(url, label) {
    if (!url) return;
    if (isHttpUrl(url) && !isLocalish(url)) {
      // URL public -> gửi bằng URL
      const r = await tgSendPhotoUrl({
        photo: url,
        caption: label,
        reply_to_message_id: replyToId,
      });
      if (r?.ok) return r;
      const r2 = await tgSendDocumentUrl({
        document: url,
        caption: label,
        reply_to_message_id: replyToId,
      });
      if (r2?.ok) return r2;
      console.error("Failed to send photo/document by URL, fallback to file:", url);
    }

    // URL local/private hoặc Telegram không fetch được URL public -> tải về rồi upload file
    try {
      const { buffer, filename } = await fetchCccdImageAsBuffer(url);
      const r = await tgSendPhotoFile({
        buffer,
        filename,
        caption: label,
        reply_to_message_id: replyToId,
      });
      if (r?.ok) return r;
      const r2 = await tgSendDocumentFile({
        buffer,
        filename,
        caption: label,
        reply_to_message_id: replyToId,
      });
      if (!r2?.ok)
        console.error("Failed to send photo/document(file) for:", url);
      return r2;
    } catch (e) {
      console.error("sendOnePhoto(file fallback) error:", e?.message);
    }
  }

  if (frontUrl) await sendOnePhoto(frontUrl, "CCCD - Mặt trước");
  if (backUrl) await sendOnePhoto(backUrl, "CCCD - Mặt sau");
}

// (tuỳ chọn) Thông báo khi duyệt/từ chối
export async function notifyKycReviewed(user, action) {
  const map = { approve: "✅ ĐÃ DUYỆT", reject: "❌ BỊ TỪ CHỐI" };
  const tag = map[action] || action;
  const text = [
    `🔔 <b>Kết quả KYC</b>: ${tag}`,
    `👤 ${escapeHtml(user?.name || "—")}${
      user?.nickname ? " (" + escapeHtml(user.nickname) + ")" : ""
    }`,
    user?.email ? `✉️ ${escapeHtml(user.email)}` : "",
    user?.phone ? `📞 ${escapeHtml(user.phone)}` : "",
    user?.cccd ? `🪪 ${escapeHtml(user.cccd)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return tgSend(text);
}

// ---------------- Register callback buttons ----------------
export function registerKycReviewButtons(
  bot,
  { UserModel, onAfterReview } = {},
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

      const UM = UserModel || (await import("../../models/userModel")).default; // <- chỉnh path nếu cần
      const user = await UM.findById(userId)
        .select("_id cccdStatus verified name nickname email phone cccd")
        .lean();

      if (!user) {
        await ctx.answerCbQuery("Không tìm thấy người dùng.", {
          show_alert: true,
        });
        return;
      }

      if (user.cccdStatus === "verified" && action === "approve") {
        await ctx.answerCbQuery("Đã duyệt trước đó ✅");
        return;
      }
      if (user.cccdStatus === "rejected" && action === "reject") {
        await ctx.answerCbQuery("Đã từ chối trước đó ❌");
        return;
      }

      const $set =
        action === "approve"
          ? { cccdStatus: "verified", verified: "verified" }
          : { cccdStatus: "rejected" };

      const updated = await UM.findByIdAndUpdate(
        userId,
        { $set },
        { new: true, runValidators: true },
      ).select("_id cccdStatus verified name nickname email phone cccd");

      if (!updated) {
        await ctx.answerCbQuery("Cập nhật thất bại.", { show_alert: true });
        return;
      }

      try {
        if (action === "approve") {
          await publishNotification(EVENTS.KYC_APPROVED, {
            userId: String(updated._id),
            topicType: "user",
            topicId: String(updated._id),
            category: CATEGORY.KYC,
          });
        } else {
          const defaultReason =
            "Hồ sơ chưa đạt yêu cầu, vui lòng cập nhật lại thông tin CCCD.";
          await publishNotification(EVENTS.KYC_REJECTED, {
            userId: String(updated._id),
            topicType: "user",
            topicId: String(updated._id),
            category: CATEGORY.KYC,
            reason: defaultReason,
          });
        }
      } catch (err) {
        console.error("[kycBot] publishNotification error:", err?.message);
      }

      try {
        await ctx.answerCbQuery(
          action === "approve" ? "Đã duyệt ✅" : "Đã từ chối ❌",
        );
        await notifyKycReviewed(updated, action);
      } catch (err) {
        console.error("[kycBot] telegram notify error:", err?.message);
      }

      if (typeof onAfterReview === "function") {
        try {
          await onAfterReview({ user: updated, action, reviewer: ctx.from });
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
