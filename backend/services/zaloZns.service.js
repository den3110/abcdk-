// services/zaloZns.service.js
// Gửi OTP xác thực SĐT qua Zalo Notification Service (ZNS) — gọi API trực tiếp.
//   POST https://business.openapi.zalo.me/message/template
//   header: access_token
//   body:   { phone, template_id, template_data: { otp } }
//
// access_token / template_id (+ refresh_token, app_id, secret_key cho auto-refresh)
// được cấu hình trong Admin → SystemSettings.zaloZns.
import axios from "axios";
import SystemSettings from "../models/systemSettingsModel.js";
import {
  getSystemSettingsRuntime,
  invalidateSystemSettingsRuntimeCache,
} from "./systemSettingsRuntime.service.js";
import { invalidateSettingsCache } from "../middleware/settings.middleware.js";

const ZNS_SEND_URL = "https://business.openapi.zalo.me/message/template";
const ZALO_OAUTH_URL = "https://oauth.zaloapp.com/v4/oa/access_token";

// Mã lỗi Zalo cho access_token hết hạn / không hợp lệ → thử refresh rồi gửi lại.
const TOKEN_ERROR_CODES = new Set([-124, -125, -216]);

function normalizeTo84(phone = "") {
  let s = String(phone).trim().replace(/\s+/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/[^\d]/g, "");
  if (s.startsWith("0")) return "84" + s.slice(1);
  if (s.startsWith("84")) return s;
  return s;
}

async function readZnsConfig() {
  const settings = await getSystemSettingsRuntime({ ensureDocument: true });
  return settings?.zaloZns || {};
}

/**
 * Làm mới access_token qua Zalo OAuth v4 (grant_type=refresh_token).
 * Mỗi lần refresh Zalo XOAY luôn refresh_token → phải lưu lại cả hai.
 * Trả về access_token mới, hoặc throw nếu thiếu cấu hình / lỗi.
 */
export async function refreshZaloAccessToken() {
  const cfg = await readZnsConfig();
  const appId = String(cfg.appId || "").trim();
  const secretKey = String(cfg.secretKey || "").trim();
  const refreshToken = String(cfg.refreshToken || "").trim();
  if (!appId || !secretKey || !refreshToken) {
    throw new Error(
      "Thiếu cấu hình auto-refresh (app_id / secret_key / refresh_token)."
    );
  }

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    app_id: appId,
    grant_type: "refresh_token",
  }).toString();

  const resp = await axios.request({
    url: ZALO_OAUTH_URL,
    method: "POST",
    headers: {
      secret_key: secretKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    data: body,
    timeout: 15000,
    validateStatus: () => true,
  });

  const data = resp.data || {};
  const newAccess = String(data.access_token || "").trim();
  if (!newAccess) {
    const detail =
      data.error_description || data.error_name || data.error || resp.status;
    throw new Error(`Zalo refresh token thất bại: ${detail}`);
  }
  const newRefresh = String(data.refresh_token || "").trim() || refreshToken;

  await SystemSettings.findByIdAndUpdate("system", {
    $set: {
      "zaloZns.accessToken": newAccess,
      "zaloZns.refreshToken": newRefresh,
      "zaloZns.tokenRefreshedAt": new Date(),
    },
  });
  invalidateSystemSettingsRuntimeCache();
  try {
    invalidateSettingsCache();
  } catch {}

  return newAccess;
}

function canAutoRefresh(cfg) {
  return Boolean(
    String(cfg.appId || "").trim() &&
      String(cfg.secretKey || "").trim() &&
      String(cfg.refreshToken || "").trim()
  );
}

async function callZnsTemplate({ accessToken, phone84, templateId, templateData }) {
  const resp = await axios.request({
    url: ZNS_SEND_URL,
    method: "POST",
    headers: {
      access_token: accessToken,
      "Content-Type": "application/json",
    },
    data: {
      phone: phone84,
      template_id: templateId,
      template_data: templateData,
    },
    timeout: 15000,
    validateStatus: () => true,
  });
  return resp;
}

/**
 * Gửi OTP qua ZNS. Tự refresh access_token (nếu cấu hình đủ) khi token hết hạn.
 * @returns {Promise<{tranId:string, msgId:string, sentTime:string, raw:object}>}
 */
export async function sendZaloZnsOtp({ phone, otp }) {
  const cfg = await readZnsConfig();
  if (!cfg.enabled) throw new Error("Zalo ZNS chưa được bật trong cấu hình.");

  let accessToken = String(cfg.accessToken || "").trim();
  const templateId = String(cfg.templateId || "").trim();
  if (!accessToken) throw new Error("Chưa cấu hình access_token Zalo ZNS.");
  if (!templateId) throw new Error("Chưa cấu hình template_id Zalo ZNS.");

  const phone84 = normalizeTo84(phone);
  if (!phone84 || phone84.length < 10) throw new Error("SĐT không hợp lệ.");

  const templateData = { otp: String(otp) };

  const parseResult = (resp) => {
    if (resp.status < 200 || resp.status >= 300) {
      return { ok: false, code: null, message: `HTTP ${resp.status}` };
    }
    const body = resp.data || {};
    const code = Number(body.error);
    if (code === 0) {
      const d = body.data || {};
      return {
        ok: true,
        tranId: String(d.msg_id || ""),
        msgId: String(d.msg_id || ""),
        sentTime: String(d.sent_time || ""),
        raw: body,
      };
    }
    return {
      ok: false,
      code,
      message: body.message || `Zalo error ${code}`,
      raw: body,
    };
  };

  // Lần gửi 1
  let resp = await callZnsTemplate({
    accessToken,
    phone84,
    templateId,
    templateData,
  });
  let result = parseResult(resp);

  // Token hết hạn + có cấu hình auto-refresh → refresh rồi gửi lại 1 lần
  if (!result.ok && TOKEN_ERROR_CODES.has(result.code) && canAutoRefresh(cfg)) {
    accessToken = await refreshZaloAccessToken();
    resp = await callZnsTemplate({
      accessToken,
      phone84,
      templateId,
      templateData,
    });
    result = parseResult(resp);
  }

  if (!result.ok) {
    const hint =
      TOKEN_ERROR_CODES.has(result.code) && !canAutoRefresh(cfg)
        ? " (access_token có thể đã hết hạn — vào Admin cập nhật lại, hoặc điền app_id/secret_key/refresh_token để tự làm mới)"
        : "";
    throw new Error(`Gửi ZNS thất bại: ${result.message}${hint}`);
  }

  return result;
}
