// utils/notifyNewUser.js (ESM, safe/no-throw)
import fetch from "node-fetch";
import asyncHandler from "express-async-handler";
import SportConnectService from "../sportconnect.service.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_NEWUSER_ID ?? "";
const FRONTEND_URL = (process.env.HOST ?? process.env.WEB_URL ?? "").replace(
  /\/+$/,
  ""
);
const SPC_SPORT_ID = Number(process.env.SPC_SPORT_ID || 2); // mặc định Pickleball=2

/* ============== utils nhỏ ============== */
export function htmlEscape(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
const fmt1 = (v) =>
  Number.isFinite(Number(v))
    ? (Math.round(Number(v) * 100) / 100).toFixed(2)
    : "—";
const sportNameById = (id) =>
  String(id) === "2"
    ? "Pickleball"
    : String(id) === "1"
    ? "Tennis"
    : String(id ?? "—");
const viGender = (g) =>
  ({ male: "Nam", female: "Nữ", other: "Khác" }[
    String(g || "").toLowerCase()
  ] || "—");

/* ============== Telegram thin client (SAFE) ============== */
async function tg(method, body) {
  if (!BOT_TOKEN) {
    console.warn("[notifyNewUser] BOT_TOKEN missing");
    return { ok: false, error: "BOT_TOKEN missing" };
  }
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      console.warn("[notifyNewUser] Telegram not JSON:", text);
      return { ok: false, error: "telegram_not_json" };
    }
    if (!json.ok) {
      console.warn("[notifyNewUser] Telegram API error:", json.description);
      return { ok: false, error: json.description || "telegram_error" };
    }
    return { ok: true, result: json.result };
  } catch (e) {
    console.warn("[notifyNewUser] Telegram fetch error:", e?.message || e);
    return { ok: false, error: e?.message || "telegram_fetch_error" };
  }
}

const DEFAULT_CHAT_IDS = String(DEFAULT_CHAT_ID || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** SAFE: gửi 1 chat hoặc broadcast; không throw, trả {ok, result|results|error} */
export async function tgSend(
  text,
  {
    chat_id,
    message_thread_id,
    parse_mode = "HTML",
    disable_web_page_preview = true,
    reply_markup,
    reply_to_message_id,
    disable_notification,
    protect_content,
  } = {}
) {
  const payload = { text, parse_mode, disable_web_page_preview };
  if (reply_markup != null) payload.reply_markup = reply_markup;
  if (reply_to_message_id != null)
    payload.reply_to_message_id = reply_to_message_id;
  if (message_thread_id != null) payload.message_thread_id = message_thread_id;
  if (disable_notification != null)
    payload.disable_notification = disable_notification;
  if (protect_content != null) payload.protect_content = protect_content;

  // có chat_id → gửi thẳng
  if (
    chat_id !== undefined &&
    chat_id !== null &&
    String(chat_id).trim() !== ""
  ) {
    return await tg("sendMessage", { chat_id, ...payload });
  }

  // broadcast theo env
  if (!DEFAULT_CHAT_IDS.length) {
    console.warn(
      "[notifyNewUser] TELEGRAM_CHAT_NEWUSER_ID not set; skip send."
    );
    return { ok: false, error: "no_default_chat" };
  }

  const results = [];
  for (const cid of DEFAULT_CHAT_IDS) {
    const r = await tg("sendMessage", { chat_id: cid, ...payload });
    if (!r.ok)
      console.warn("[notifyNewUser] sendMessage failed:", cid, r.error);
    results.push(r);
  }
  return { ok: results.some((r) => r.ok), results };
}

/* ============== Main: notify new user (SAFE) ============== */
/**
 * SAFE: Không throw. Luôn log warn khi lỗi. Trả boolean thành công.
 * @param {{user:Object, chatId?:string|number, debug?:boolean}} params
 * @returns {Promise<boolean>}
 */
export async function notifyNewUser({ user, chatId, debug = false }) {
  try {
    if (!user) {
      console.warn("[notifyNewUser] missing user");
      return false;
    }
    const hasAnyChat = Boolean(chatId || DEFAULT_CHAT_ID);
    if (!hasAnyChat) {
      console.warn("[notifyNewUser] No chat configured");
      return false;
    }

    const createdStr = user?.createdAt
      ? new Date(user.createdAt).toLocaleString("vi-VN")
      : new Date().toLocaleString("vi-VN");

    const header = [
      "🆕 <b>ĐĂNG KÝ NGƯỜI DÙNG MỚI</b>",
      `👤 Họ tên: <b>${htmlEscape(user?.name || "—")}</b>`,
      user?.nickname ? `🏷 Nickname: <b>${htmlEscape(user.nickname)}</b>` : "",
      user?.email ? `✉️ Email: <b>${htmlEscape(user.email)}</b>` : "",
      user?.province ? `📍 Tỉnh/TP: <b>${htmlEscape(user.province)}</b>` : "",
      `⚧ Giới tính: <b>${htmlEscape(viGender(user?.gender))}</b>`,
      `🕒 Lúc: <i>${createdStr}</i>`,
    ].filter(Boolean);

    const phone = onlyDigits(user?.phone);
    let spcBlock = "⚠️ Không có SĐT để tra SportConnect.";
    let debugLine = "";

    if (phone?.length >= 6) {
      try {
        const { status, data, proxyUrl } =
          await SportConnectService.listLevelPoint({
            searchCriterial: phone,
            sportId: SPC_SPORT_ID,
            page: 0,
            waitingInformation: "",
          });
        const arr = Array.isArray(data?.data) ? data.data : [];
        if (arr.length) {
          const it = arr[0];
          spcBlock = [
            "🧩 <b>SportConnect</b>",
            `• ID: <b>${htmlEscape(it?.ID ?? it?.MaskId ?? "—")}</b>`,
            `• Họ tên: <b>${htmlEscape(it?.HoVaTen || "—")}</b>${
              it?.NickName
                ? ` <i>(${htmlEscape(String(it.NickName).trim())})</i>`
                : ""
            }`,
            `• Điểm: <b>Single ${fmt1(it?.DiemDon)}</b> • <b>Double ${fmt1(
              it?.DiemDoi
            )}</b>`,
            it?.TenTinhThanh
              ? `• Tỉnh/TP: <b>${htmlEscape(it.TenTinhThanh)}</b>`
              : "",
            `• Môn: <b>${htmlEscape(sportNameById(it?.IDMonTheThao))}</b>`,
          ]
            .filter(Boolean)
            .join("\n");
          if (debug)
            debugLine = `\n<code>Status ${status}${
              proxyUrl ? " • " + htmlEscape(proxyUrl) : ""
            }</code>`;
        } else {
          spcBlock = "❌ Không tìm thấy dữ liệu trên SportConnect.";
          if (debug)
            debugLine = `\n<code>Status ${status}${
              proxyUrl ? " • " + htmlEscape(proxyUrl) : ""
            }</code>`;
        }
      } catch (e) {
        console.warn("[notifyNewUser] SportConnect error:", e?.message || e);
        spcBlock = "❌ Lỗi gọi SportConnect.";
        if (debug)
          debugLine = `\n<code>${htmlEscape(e?.message || "error")}</code>`;
      }
    }

    const userUrl =
      FRONTEND_URL && user?._id ? `${FRONTEND_URL}/user/${user._id}` : null;
    const reply_markup = {
      inline_keyboard: [
        [userUrl && { text: "👤 Mở hồ sơ", url: userUrl }].filter(Boolean),
      ].filter((row) => row.length),
    };

    const text = [
      ...header,
      `📞 SĐT: <b>${htmlEscape(user?.phone || "—")}</b>`,
      "",
      spcBlock,
      debugLine,
    ].join("\n");

    const sendRes = await tgSend(text, { chat_id: chatId, reply_markup });
    if (!sendRes?.ok) {
      console.warn("[notifyNewUser] tgSend failed:", sendRes?.error || sendRes);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[notifyNewUser] unexpected error:", e?.message || e);
    return false;
  }
}

/* ============== Express async handler (optional) ============== */
/**
 * Dùng để test qua route:
 * POST /_test/notify-new-user  { user: {...}, chatId?: string, debug?: boolean }
 */
export const notifyNewUserHandler = asyncHandler(async (req, res) => {
  try {
    const user = req.body?.user || null;
    const chatId = req.body?.chatId;
    const debug = !!req.body?.debug;
    const ok = await notifyNewUser({ user, chatId, debug });
    return res.json({ ok });
  } catch (e) {
    // vẫn không throw ra ngoài
    console.warn("[notifyNewUserHandler] error:", e?.message || e);
    return res.json({ ok: false, error: String(e?.message || e) });
  }
});
