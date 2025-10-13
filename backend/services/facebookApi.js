import dotenv from "dotenv";
dotenv.config();

const { FB_APP_ID, FB_APP_SECRET, GRAPH_VER } = process.env;
const FB = { base: (p) => `https://graph.facebook.com/${GRAPH_VER}${p}` };

export async function exchangeShortToLong(shortUserToken) {
  const url =
    FB.base(`/oauth/access_token`) +
    `?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(FB_APP_ID)}` +
    `&client_secret=${encodeURIComponent(FB_APP_SECRET)}` +
    `&fb_exchange_token=${encodeURIComponent(shortUserToken)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok || !j.access_token)
    throw new Error(`exchange failed: ${r.status} ${JSON.stringify(j)}`);
  return j; // { access_token, expires_in, ... }
}

export async function getPages(longUserToken) {
  const url =
    FB.base(`/me/accounts`) +
    `?access_token=${encodeURIComponent(longUserToken)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok)
    throw new Error(
      `GET /me/accounts failed: ${r.status} ${JSON.stringify(j)}`
    );
  return j;
}

export async function debugToken(inputToken) {
  const url =
    FB.base(`/debug_token`) +
    `?input_token=${encodeURIComponent(inputToken)}` +
    `&access_token=${encodeURIComponent(`${FB_APP_ID}|${FB_APP_SECRET}`)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok)
    throw new Error(`debug_token failed: ${r.status} ${JSON.stringify(j)}`);
  const d = j?.data || {};
  return {
    isValid: !!d.is_valid,
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null,
    scopes: d.scopes || [],
  };
}

export async function getPageTokenFromLongUserToken(longUserToken, pageId) {
  const js = await getPages(longUserToken);
  const item = (js.data || []).find((x) => x.id === pageId);
  if (!item?.access_token)
    throw new Error(`Page ${pageId} not found or no access_token.`);
  return item; // { id, name, access_token, ... }
}
