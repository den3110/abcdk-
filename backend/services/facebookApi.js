// services/facebookApi.js
import { getCfgStr } from "./config.service.js";

const qs = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const val = Array.isArray(v) ? JSON.stringify(v) : v;
      return `${encodeURIComponent(k)}=${encodeURIComponent(val)}`;
    })
    .join("&");

async function graphVer() {
  return await getCfgStr("GRAPH_VER", "v24.0");
}
async function fbAppId() {
  return await getCfgStr("FB_APP_ID", "");
}
async function fbAppSecret() {
  return await getCfgStr("FB_APP_SECRET", "");
}
async function fbVerbose() {
  return (await getCfgStr("FB_VERBOSE", "0")) === "1";
}

const base = async (p) => `https://graph.facebook.com/${await graphVer()}${p}`;

// List pages
export async function getAllPages(longUserToken) {
  const out = [];
  let url =
    (await base(`/me/accounts`)) +
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
  return out;
}

export async function getPageViaFields(longUserToken, pageId) {
  const fields = encodeURIComponent("access_token,name,category,tasks");
  const url =
    (await base(`/${pageId}`)) +
    `?fields=${fields}&access_token=${encodeURIComponent(longUserToken)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok)
    throw new Error(
      `GET /${pageId}?fields=... failed: ${r.status} ${JSON.stringify(j)}`
    );
  return j;
}

export async function debugToken(token) {
  const appToken = `${await fbAppId()}|${await fbAppSecret()}`;
  const url =
    (await base(`/debug_token`)) +
    `?input_token=${encodeURIComponent(
      token
    )}&access_token=${encodeURIComponent(appToken)}`;
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

export async function listPageLives(
  pageId,
  pageAccessToken,
  {
    statuses = [
      "LIVE",
      "UNPUBLISHED",
      "SCHEDULED_UNPUBLISHED",
      "SCHEDULED_LIVE",
    ],
    limit = 10,
    fields = "id,status,secure_stream_url,permalink_url,creation_time,start_time,title",
  } = {}
) {
  const url =
    (await base(`/${pageId}/live_videos`)) +
    `?` +
    qs({
      access_token: pageAccessToken,
      broadcast_status: statuses,
      fields,
      limit,
    });
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok)
    throw new Error(
      `GET /${pageId}/live_videos failed: ${r.status} ${JSON.stringify(j)}`
    );
  return {
    data: Array.isArray(j.data) ? j.data : [],
    paging: j.paging,
    raw: j,
  };
}

export async function getPageLiveState({
  pageId,
  pageAccessToken,
  statuses = ["LIVE", "UNPUBLISHED", "SCHEDULED_UNPUBLISHED", "SCHEDULED_LIVE"],
} = {}) {
  const { data } = await listPageLives(pageId, pageAccessToken, { statuses });
  const up = (s) => String(s || "").toUpperCase();
  const liveNow = data.filter((v) => up(v.status) === "LIVE");
  const prepared = data.filter((v) =>
    ["UNPUBLISHED", "SCHEDULED_UNPUBLISHED", "SCHEDULED_LIVE"].includes(
      up(v.status)
    )
  );
  if (await fbVerbose()) {
    if (liveNow.length || prepared.length) {
      const toFull = (u) =>
        u?.startsWith("http") ? u : u ? `https://facebook.com${u}` : "";
      console.info(
        `[FB][live] page=${pageId} liveNow=${liveNow.length} prepared=${prepared.length}`
      );
      liveNow.forEach((v) =>
        console.info(
          `[FB][live]  LIVE id=${v.id} url=${toFull(v.permalink_url)}`
        )
      );
      prepared.forEach((v) =>
        console.info(
          `[FB][live]  PREP id=${v.id} url=${toFull(v.permalink_url)}`
        )
      );
    }
  }
  return {
    busy: liveNow.length > 0 || prepared.length > 0,
    liveNow,
    prepared,
    raw: data,
  };
}
