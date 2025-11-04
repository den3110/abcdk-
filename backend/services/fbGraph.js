// services/fbGraph.js
import axios from "axios";
import { getCfgStr } from "./config.service.js";
// ⬇️ chỉnh path nếu hàm getCfgStr của bạn ở nơi khác

export const NOW_UTC = () => new Date();

let GRAPH_VER_CACHE = null; // ví dụ: "v24.0"
let GRAPH_BASE_CACHE = null; // ví dụ: "https://graph.facebook.com/v24.0"
let APP_TOKEN_CACHE = null; // app access token

async function getGraphBase() {
  if (GRAPH_BASE_CACHE) return GRAPH_BASE_CACHE;
  // lấy từ config, fallback "v24.0"
  const graphVer = await getCfgStr("GRAPH_VER", "v24.0");
  GRAPH_VER_CACHE = graphVer;
  GRAPH_BASE_CACHE = `https://graph.facebook.com/${graphVer}`;
  return GRAPH_BASE_CACHE;
}

export async function getGraphVersion() {
  if (GRAPH_VER_CACHE) return GRAPH_VER_CACHE;
  await getGraphBase();
  return GRAPH_VER_CACHE;
}

async function getAppAccessToken() {
  if (APP_TOKEN_CACHE) return APP_TOKEN_CACHE;
  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Missing FB_APP_ID/FB_APP_SECRET");

  const GRAPH = await getGraphBase();
  const { data } = await axios.get(`${GRAPH}/oauth/access_token`, {
    params: {
      client_id: appId,
      client_secret: appSecret,
      grant_type: "client_credentials",
    },
  });
  APP_TOKEN_CACHE = data.access_token;
  return APP_TOKEN_CACHE;
}

// Debug any token (user/page). Returns { is_valid, expires_at, error_subcode, scopes, ... }
export async function debugAnyToken(inputToken) {
  try {
    const appToken = await getAppAccessToken();
    const GRAPH = await getGraphBase();
    const { data } = await axios.get(`${GRAPH}/debug_token`, {
      params: { input_token: inputToken, access_token: appToken },
    });
    return data?.data || { is_valid: false, message: "Empty debug" };
  } catch (e) {
    const err = e?.response?.data?.error || {};
    return {
      is_valid: false,
      message: err.message || "debug_error",
      code: err.code,
      error_subcode: err.error_subcode,
    };
  }
}

// Simple read check with Page token
export async function testPageReadable(pageId, pageToken) {
  try {
    const GRAPH = await getGraphBase();
    await axios.get(`${GRAPH}/${pageId}`, {
      params: { fields: "id,name", access_token: pageToken },
    });
    return { ok: true };
  } catch (e) {
    const err = e?.response?.data?.error || {};
    return {
      ok: false,
      reason: err.message || "READ_DENIED",
      code: err.code,
      sub: err.error_subcode,
    };
  }
}

// Try listing live_videos (does not create anything)
export async function testPageLiveCapable(pageId, pageToken) {
  try {
    const GRAPH = await getGraphBase();
    await axios.get(`${GRAPH}/${pageId}/live_videos`, {
      params: { fields: "id", limit: 1, access_token: pageToken },
    });
    return { ok: true };
  } catch (e) {
    const err = e?.response?.data?.error || {};
    const map =
      err.code === 200
        ? "PERMISSION_ERROR"
        : err.code === 190 &&
          (err.error_subcode === 459 || err.error_subcode === 490)
        ? "CHECKPOINT"
        : err.code === 190
        ? "INVALID_OAUTH"
        : "LIVE_DENIED";
    return {
      ok: false,
      reason: map,
      code: err.code,
      sub: err.error_subcode,
      message: err.message,
    };
  }
}

export function pickUsefulDebug(d) {
  if (!d) return null;
  const { is_valid, scopes, expires_at, issued_at, error_subcode, code } = d;
  return { is_valid, scopes, expires_at, issued_at, error_subcode, code };
}
