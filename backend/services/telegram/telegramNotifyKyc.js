// server/services/telegramNotify.js
import fetch from "node-fetch";
import dotenv from "dotenv";
import OpenAI from "openai";
import FormData from "form-data";
import {
  CATEGORY,
  EVENTS,
  publishNotification,
} from "../notifications/notificationHub.js";
import { stripVN } from "../../utils/cccdParsing.js";

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
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

function isHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

// true nếu URL là localhost hoặc IP nội bộ -> không public
function isLocalish(u) {
  try {
    const { hostname } = new URL(u);
    if (!hostname) return true;
    if (hostname === "localhost") return true;
    if (hostname === "::1") return true;
    if (/^127\./.test(hostname)) return true;
    if (/^10\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;
    const m = hostname.match(/^172\.(\d+)\./);
    if (m) {
      const n = +m[1];
      if (n >= 16 && n <= 31) return true;
    }
    return false;
  } catch {
    return true;
  }
}

async function fetchImageAsBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} when fetching ${url}`);
  const ct = r.headers.get("content-type") || "application/octet-stream";
  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
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

// ---------------- Auto KYC (OpenAI Vision) ----------------
const CCCD_JSON_SCHEMA = {
  name: "cccd_extract",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      idNumber: { type: ["string", "null"] },
      fullName: { type: ["string", "null"] },
      dob: { type: ["string", "null"], description: "yyyy-mm-dd" },
      sex: { type: ["string", "null"] },
      nationality: { type: ["string", "null"] },
      hometown: { type: ["string", "null"] },
      residence: { type: ["string", "null"] },
      expiry: { type: ["string", "null"], description: "yyyy-mm-dd" },
      notes: { type: ["string", "null"] },
    },
    required: [
      "idNumber",
      "fullName",
      "dob",
      "sex",
      "nationality",
      "hometown",
      "residence",
      "expiry",
      "notes",
    ],
  },
  strict: true,
};

function normName(s = "") {
  return stripVN(String(s).trim()).replace(/\s+/g, " ").toUpperCase();
}
function normId(s = "") {
  return String(s || "").replace(/\D+/g, "");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function ymdUTC(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function normDOB(value) {
  if (value === null || value === undefined) return null;

  // Nếu là Date object
  if (value instanceof Date && !isNaN(value)) {
    return ymdUTC(value);
  }

  const s = String(value).trim();
  if (!s) return null;

  // dd/mm/yyyy hoặc dd-mm-yyyy hoặc dd.mm.yyyy
  const m1 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m1) {
    const d = +m1[1],
      mo = +m1[2],
      y = +m1[3];
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  // yyyy-mm-dd (đã chuẩn)
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return s;

  // ISO 8601 (vd: 1991-03-26T00:00:00.000Z) hoặc chuỗi date parse được
  const d = new Date(s);
  if (!isNaN(d)) {
    return ymdUTC(d); // dùng UTC để không lệch ngày do timezone
  }

  return null;
}

async function openaiExtractFromImageUrl(imageUrl, detail = "low") {
  if (!openai.apiKey) throw new Error("Missing OPENAI_API_KEY");

  // Nếu URL local/private -> tải buffer và đổi sang data URL
  let imagePart;
  if (isHttpUrl(imageUrl) && !isLocalish(imageUrl)) {
    imagePart = { type: "image_url", image_url: { url: imageUrl, detail } };
  } else {
    const { buffer, contentType } = await fetchImageAsBuffer(imageUrl);
    const dataUrl = bufferToDataUrl(buffer, contentType);
    imagePart = { type: "image_url", image_url: { url: dataUrl, detail } };
  }

  const systemPrompt = [
    "Bạn là trình TRÍCH XUẤT CHÍNH XÁC CAO từ ảnh Căn cước công dân Việt Nam.",
    "YÊU CẦU: tuyệt đối không suy đoán; nếu bất kỳ ký tự nào mơ hồ → trả null cho trường đó.",
    "Ưu tiên đọc đúng vùng 'Số/No.' trên mặt trước. idNumber phải là DÃY SỐ THUẦN, liền nhau, không khoảng trắng.",
    "CHỐNG NHẦM LẪN ký tự: 0≠9, O≠0, 1≠7, 3≠8, 5≠S, 2≠Z, 6≠G.",
    "Nếu không chắc chắn 100% về một chữ số trong idNumber → idNumber=null.",
    "Nếu thấy dạng ngày dd/mm/yyyy → đổi sang yyyy-mm-dd.",
    "Không dùng suy luận ngữ nghĩa hay dự đoán theo tên; CHỈ dựa vào pixel nhìn thấy.",
    "Không đọc từ mã QR, không đọc từ vùng mờ/che phản quang.",
    "Nếu idNumber khác độ dài chuẩn (ưu tiên 12), coi là không chắc → idNumber=null.",
    "fullName: viết HOA, BỎ DẤU (chuẩn hoá bởi hệ thống phía sau).",
  ].join(" ");

  const userPrompt = [
    "Nhiệm vụ: Trích xuất JSON theo schema, với các field:",
    "- idNumber (Số/No., chỉ số; nếu mơ hồ bất kỳ ký tự → null)",
    "- fullName (HỌ VÀ TÊN, nguyên văn; nếu mờ → null)",
    "- dob (Ngày sinh, format yyyy-mm-dd; nếu mờ → null)",
    "Chỉ trả JSON đúng schema. Không mô tả thêm.",
  ].join(" ");

  const resp = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    response_format: { type: "json_schema", json_schema: CCCD_JSON_SCHEMA },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [{ type: "text", text: userPrompt }, imagePart],
      },
    ],
  });

  const msg = resp.choices?.[0]?.message;
  const jsonText =
    typeof msg?.content === "string"
      ? msg.content
      : msg?.content?.find?.(
          (p) => p.type === "output_text" || p.type === "text"
        )?.text;

  let data = {};
  try {
    data = JSON.parse(jsonText || "{}");
  } catch {}

  return {
    idNumber: normId(data.idNumber),
    fullName: data.fullName ? normName(data.fullName) : null,
    dob: normDOB(data.dob),
    _usage: resp.usage,
  };
}

function buildMatchReport(extracted, user) {
  const userName = normName(user?.name || "");
  const userDob = normDOB(user?.dob || user?.birthday || "");
  const userCccd = normId(user?.cccd || user?.citizenId || "");

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
    if (frontUrl && process.env.OPENAI_API_KEY) {
      const extracted = await openaiExtractFromImageUrl(frontUrl, "auto");
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
            { new: false }
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
            { new: false }
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
      auto.reason = !frontUrl ? "Thiếu ảnh mặt trước" : "Thiếu OPENAI_API_KEY";
    }
  } catch (e) {
    console.error("[kyc-auto] error:", e?.message);
    auto.status = "pending";
    auto.reason = "Lỗi khi trích xuất CCCD (để Chờ KYC).";
  }

  // 2) Gửi tin nhắn KYC (text + buttons)
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
        got.name || "—"
      )}</code> (kỳ vọng: <code>${escapeHtml(wanted.name || "—")}</code>)`,
      `• Ngày sinh: ${dobOK ? "✅" : "❌"} <code>${escapeHtml(
        got.dob || "—"
      )}</code> (kỳ vọng: <code>${escapeHtml(wanted.dob || "—")}</code>)`,
      `• Số CCCD: ${idOK ? "✅" : "❌"} <code>${escapeHtml(
        got.id || "—"
      )}</code> (kỳ vọng: <code>${escapeHtml(wanted.id || "—")}</code>)`
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
      if (!r2?.ok) console.error("Failed to send photo/document for:", url);
      return r2;
    } else {
      // URL local/private -> tải về rồi upload file
      try {
        const { buffer, filename } = await fetchImageAsBuffer(url);
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
        console.error("sendOnePhoto(local) error:", e?.message);
      }
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
        { new: true, runValidators: true }
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
          action === "approve" ? "Đã duyệt ✅" : "Đã từ chối ❌"
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
