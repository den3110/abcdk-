// services/facebookApi.js
import dotenv from "dotenv";
dotenv.config();

const GRAPH_VER = process.env.GRAPH_VER || "v24.0";
const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;

const base = (p) => `https://graph.facebook.com/${GRAPH_VER}${p}`;
const qs = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

// ───────────────────────────────────────────────────────────────────────────────
// Lấy toàn bộ Page (có phân trang)
export async function getAllPages(longUserToken) {
  const out = [];
  let url =
    base(`/me/accounts`) +
    `?limit=100&access_token=${encodeURIComponent(longUserToken)}`;
  while (url) {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok)
      throw new Error(
        `GET /me/accounts failed: ${r.status} ${JSON.stringify(j)}`
      );
    if (Array.isArray(j.data)) out.push(...j.data);
    url = j?.paging?.next || null;
  }
  return out; // [{id,name,access_token,tasks,category,...}]
}

// Khi /me/accounts không trả access_token cho 1 page, lấy trực tiếp theo pageId
export async function getPageViaFields(longUserToken, pageId) {
  const fields = encodeURIComponent("access_token,name,category,tasks");
  const url =
    base(`/${pageId}`) +
    `?fields=${fields}&access_token=${encodeURIComponent(longUserToken)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok)
    throw new Error(
      `GET /${pageId}?fields=... failed: ${r.status} ${JSON.stringify(j)}`
    );
  return j; // { access_token, name, category, tasks }
}

// Debug token để biết hạn dùng
export async function debugToken(token) {
  const appToken = `${FB_APP_ID}|${FB_APP_SECRET}`;
  const url =
    base(`/debug_token`) +
    `?input_token=${encodeURIComponent(token)}` +
    `&access_token=${encodeURIComponent(appToken)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok)
    throw new Error(`debug_token failed: ${r.status} ${JSON.stringify(j)}`);
  const d = j?.data || {};
  return {
    isValid: !!d.is_valid,
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null, // null => Expires: never
    scopes: d.scopes || [],
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// ✅ FB-side live checks

/**
 * Liệt kê live_videos của Page từ Graph (dùng để debug/inspect).
 * @param {string} pageId
 * @param {string} pageAccessToken
 * @param {Object} options
 * @param {string[]} [options.statuses] Default: ["LIVE","LIVE_NOW","UNPUBLISHED","SCHEDULED_UNPUBLISHED","SCHEDULED_LIVE"]
 * @param {number} [options.limit] Default: 10
 * @param {string} [options.fields] Default: "id,status,secure_stream_url,permalink_url,creation_time,start_time,title"
 * @returns {{data: any[], paging?: any, raw: any}}
 */
export async function listPageLives(
  pageId,
  pageAccessToken,
  {
    statuses = [
      "LIVE",
      "LIVE_NOW",
      "UNPUBLISHED",
      "SCHEDULED_UNPUBLISHED",
      "SCHEDULED_LIVE",
    ],
    limit = 10,
    fields = "id,status,secure_stream_url,permalink_url,creation_time,start_time,title",
  } = {}
) {
  const url =
    base(`/${pageId}/live_videos`) +
    `?` +
    qs({
      access_token: pageAccessToken,
      broadcast_status: statuses.join(","),
      fields,
      limit,
    });

  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) {
    throw new Error(
      `GET /${pageId}/live_videos failed: ${r.status} ${JSON.stringify(j)}`
    );
  }
  return {
    data: Array.isArray(j.data) ? j.data : [],
    paging: j.paging,
    raw: j,
  };
}

/**
 * Trạng thái “bận” của Page dựa trên Graph:
 * - busy = có LIVE/LIVE_NOW (đang live) hoặc có UNPUBLISHED/SCHEDULED_* (đã tạo và giữ stream key/sắp live).
 * - prepared = UNPUBLISHED hoặc SCHEDULED_UNPUBLISHED / SCHEDULED_LIVE
 * - liveNow = LIVE hoặc LIVE_NOW
 */
export async function getPageLiveState({
  pageId,
  pageAccessToken,
  statuses = [
    "LIVE",
    "LIVE_NOW",
    "UNPUBLISHED",
    "SCHEDULED_UNPUBLISHED",
    "SCHEDULED_LIVE",
  ],
} = {}) {
  const { data } = await listPageLives(pageId, pageAccessToken, { statuses });
  const up = (s) => String(s || "").toUpperCase();

  const liveNow = data.filter((v) =>
    ["LIVE", "LIVE_NOW"].includes(up(v.status))
  );
  const prepared = data.filter((v) =>
    ["UNPUBLISHED", "SCHEDULED_UNPUBLISHED", "SCHEDULED_LIVE"].includes(
      up(v.status)
    )
  );

  return {
    busy: liveNow.length > 0 || prepared.length > 0,
    liveNow,
    prepared,
    raw: data,
  };
}
