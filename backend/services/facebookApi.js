import dotenv from "dotenv";
dotenv.config();

const GRAPH_VER = process.env.GRAPH_VER || "v24.0";
const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;

const base = (p) => `https://graph.facebook.com/${GRAPH_VER}${p}`;

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
