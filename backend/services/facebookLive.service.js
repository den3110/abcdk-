// services/facebookLive.service.js
// Đọc Graph version từ DB Config thay vì .env
import { getCfgStr } from "./config.service.js";

// Helper build base URL theo GRAPH_VER trong DB
const base = async (p) =>
  `https://graph.facebook.com/${await getCfgStr("GRAPH_VER", "v24.0")}${p}`;

// Helper: fetch Facebook Graph và ném lỗi có đủ thông tin
async function fbFetch(url, options) {
  const r = await fetch(url, options);
  let body = null;
  try {
    body = await r.json();
  } catch {
    // non-JSON
  }
  if (!r.ok) {
    const err = new Error(
      body?.error?.message || `Facebook API error: ${r.status} ${r.statusText}`
    );
    // đính kèm thông tin để chỗ gọi có thể hiển thị
    err.response = {
      status: r.status,
      data: body || null,
    };
    throw err;
  }
  return body;
}

/**
 * Tạo live trên Page
 * @param {Object} args
 * @param {string} args.pageId
 * @param {string} args.pageAccessToken
 * @param {string} [args.title]
 * @param {string} [args.description]
 * @param {("LIVE_NOW"|"UNPUBLISHED"|"SCHEDULED_UNPUBLISHED"|"SCHEDULED_LIVE")} [args.status]
 * @returns {Promise<any>} Graph response { id, secure_stream_url, permalink_url, ... }
 */
export async function fbCreateLiveOnPage({
  pageId,
  pageAccessToken,
  title,
  description,
  status = "LIVE_NOW",
}) {
  const params = new URLSearchParams({
    access_token: pageAccessToken,
    title: title || "",
    description: description || "",
    status,
  });

  const url = await base(`/${pageId}/live_videos`);
  const res = await fbFetch(url, {
    method: "POST",
    body: params,
  });
  return res; // { id, secure_stream_url, permalink_url, ... }
}

/**
 * Comment vào live video bằng Page token
 * @param {Object} args
 * @param {string} args.liveVideoId
 * @param {string} args.pageAccessToken
 * @param {string} args.message
 */
export async function fbPostComment({ liveVideoId, pageAccessToken, message }) {
  const params = new URLSearchParams({
    access_token: pageAccessToken,
    message,
  });

  const url = await base(`/${liveVideoId}/comments`);
  const res = await fbFetch(url, {
    method: "POST",
    body: params,
  });
  return res;
}
