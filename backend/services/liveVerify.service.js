// services/liveVerify.service.js
// FB & YT: verify chính chủ API; TikTok: optional (không official).
// Yêu cầu Node >= 18 (có global fetch). Nếu Node < 18: `npm i node-fetch` và `import fetch from "node-fetch"`

import { getCfgStr } from "./config.service.js";
import FbToken from "../models/fbTokenModel.js"; // bạn đã có FbTokenSchema

/* ─────────────────────────  COMMON UTILS  ───────────────────────── */
function ok(data = null) {
  return { ok: true, raw: data };
}
function ng(reason = "", raw = null) {
  return { ok: false, reason, raw };
}

async function fetchJSON(url, opt = {}) {
  const res = await fetch(url, opt);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text };
  }
  if (!res.ok) return Promise.reject({ status: res.status, json });
  return json;
}

/* ─────────────────────────  FACEBOOK VERIFY  ─────────────────────────
   Dùng Page Token từ FbToken (ưu tiên), fallback long-lived user tokens (CSV)
   GRAPH_VER lấy từ config (mặc định v24.0)
*/
async function pickFacebookAccessTokens() {
  const tokens = [];

  // 1) Page tokens còn hạn (hoặc Expires: never)
  const pages = await FbToken.find({
    $or: [
      { pageTokenIsNever: true },
      { pageTokenExpiresAt: { $exists: false } },
      { pageTokenExpiresAt: null },
      { pageTokenExpiresAt: { $gte: new Date() } },
    ],
    pageToken: { $exists: true, $ne: "" },
  })
    .select("pageToken pageName pageId")
    .lean();

  for (const p of pages) {
    tokens.push({
      type: "page",
      token: p.pageToken,
      pageId: p.pageId,
      pageName: p.pageName,
    });
  }

  // 2) Long-lived user tokens (CSV)
  const csv = (await getCfgStr("FB_BOOT_LONG_USER_TOKEN", "")).trim();
  if (csv) {
    for (const t of csv
      .split(/[,\r\n]+/) // tách bởi dấu phẩy hoặc xuống dòng (CR/LF)
      .map((s) => s.trim())
      .filter(Boolean)) {
      tokens.push({ type: "user", token: t });
    }
  }
  return tokens;
}

export async function verifyFacebookLiveWithBestToken({
  liveId = null,
  pageId = null,
} = {}) {
  const GRAPH_VER = (await getCfgStr("GRAPH_VER", "v24.0")) || "v24.0";
  const cands = await pickFacebookAccessTokens();
  if (cands.length === 0) return ng("no_facebook_tokens");

  // thử từng token cho tới khi có phản hồi hợp lệ
  for (const cand of cands) {
    const token = cand.token;

    try {
      if (liveId) {
        // Xác minh trực tiếp live video
        const url = `https://graph.facebook.com/${GRAPH_VER}/${encodeURIComponent(
          liveId
        )}?fields=id,status,permalink_url,from{id,name},creation_time,embed_html&access_token=${encodeURIComponent(
          token
        )}`;
        const j = await fetchJSON(url);
        const status = String(j?.live_status || "").toUpperCase();
        const live = status === "LIVE" || status === "LIVE_NOW";
        if (live) return ok(j);
        // Nếu không live → tiếp tục thử token khác (đôi khi quyền hạn khác nhau)
      }

      // // fallback: nếu không có liveId mà có pageId, xem live_videos của page
      // if (!liveId && pageId) {
      //   const url = `https://graph.facebook.com/${GRAPH_VER}/${encodeURIComponent(
      //     pageId
      //   )}/live_videos?fields=id,live_status,permalink_url,creation_time&limit=5&access_token=${encodeURIComponent(
      //     token
      //   )}`;
      //   const j = await fetchJSON(url);
      //   const liveItem = (j?.data || []).find((it) => {
      //     const s = String(it?.live_status || "").toUpperCase();
      //     return s === "LIVE" || s === "LIVE_NOW";
      //   });
      //   if (liveItem) return ok(liveItem);
      // }
    } catch (e) {
      console.log(e);
      // tiếp tục thử token kế tiếp
    }
  }

  return ng("not_live_or_no_valid_token");
}

/* ─────────────────────────  YOUTUBE VERIFY  ─────────────────────────
   Có 2 đường:
   - API key (YOUTUBE_API_KEY) → dễ nhất
   - OAuth access token (tự tạo từ YOUTUBE_REFRESH_TOKEN + GOOGLE_CLIENT_ID/SECRET)

   Ưu tiên:
   1) API key nếu có
   2) OAuth nếu có refresh token + client credentials
*/

let YT_ACCESS_CACHE = { token: null, exp: 0 };

async function ensureYouTubeAccessToken() {
  // nếu có API key thì không cần OAuth token
  const apiKey = (await getCfgStr("YOUTUBE_API_KEY", "")).trim();
  if (apiKey) return { type: "key", key: apiKey };

  // OAuth
  const refresh_token = (await getCfgStr("YOUTUBE_REFRESH_TOKEN", "")).trim();
  const client_id = (await getCfgStr("GOOGLE_CLIENT_ID", "")).trim();
  const client_secret = (await getCfgStr("GOOGLE_CLIENT_SECRET", "")).trim();
  if (!refresh_token || !client_id || !client_secret) return { type: "none" };

  const now = Date.now();
  if (YT_ACCESS_CACHE.token && now < YT_ACCESS_CACHE.exp - 60_000) {
    return { type: "oauth", token: YT_ACCESS_CACHE.token };
  }

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id,
    client_secret,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    return { type: "none" };
  }
  YT_ACCESS_CACHE = {
    token: json.access_token,
    exp: Date.now() + (json.expires_in || 3600) * 1000,
  };
  return { type: "oauth", token: json.access_token };
}

async function ytGet(path, params) {
  const auth = await ensureYouTubeAccessToken();
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);

  const headers = {};
  if (auth.type === "oauth") headers.Authorization = `Bearer ${auth.token}`;
  if (auth.type === "none") throw new Error("no_youtube_credentials");

  if (auth.type === "key") url.searchParams.set("key", auth.key);
  const j = await fetchJSON(url.toString(), { headers });
  return j;
}

export async function verifyYouTubeLive(videoId) {
  // videos.list để xem liveStreamingDetails/snippet.liveBroadcastContent
  try {
    const j = await ytGet("videos", {
      part: "snippet,liveStreamingDetails",
      id: videoId,
      maxResults: "1",
    });
    const v = (j.items || [])[0];
    if (!v) return ng("not_found");

    const snippet = v.snippet || {};
    const details = v.liveStreamingDetails || {};
    const liveFlag =
      String(snippet.liveBroadcastContent || "").toLowerCase() === "live";
    const started = !!details.actualStartTime;
    const viewers = Number(details.concurrentViewers || 0) > 0;

    if (liveFlag || started || viewers) return ok(v);
    return ng("not_live", v);
  } catch (e) {
    return ng(e?.message || "yt_error", e);
  }
}

// Tuỳ chọn: nếu chỉ có channelId muốn tìm video đang live
export async function findYouTubeLiveByChannel(channelId) {
  try {
    const j = await ytGet("search", {
      part: "id",
      channelId,
      type: "video",
      eventType: "live",
      maxResults: "1",
    });
    const it = (j.items || [])[0];
    const id = it?.id?.videoId || null;
    if (!id) return ng("not_found");
    return ok({ videoId: id });
  } catch (e) {
    return ng(e?.message || "yt_error", e);
  }
}

/* ─────────────────────────  TIKTOK VERIFY  ─────────────────────────
   Không có public REST “is live?” cho account bất kỳ.
   Tuỳ chọn 1 (khuyên dùng nếu thực sự cần): dùng thư viện websocket không chính thức:
     - npm: tiktok-live-connector (Node)
     - PyPI: TikTokLive (Python)
   Tuỳ chọn 2: nếu bạn là broadcaster và có quyền/credential, dùng API nội bộ của họ (partner).
   Ở đây mình để stub + hook để bạn cắm thư viện vào khi cần.
*/
export async function verifyTikTokLive({ username = "", roomId = "" } = {}) {
  // Stub: luôn trả false; để tránh gây “đỏ” strict.
  return ng("tiktok_no_official_public_check");
  // Gợi ý tích hợp (pseudo):
  // import { WebcastPushConnection } from 'tiktok-live-connector';
  // const conn = new WebcastPushConnection(username);
  // const info = await conn.getRoomInfo();
  // if (info?.status === 'LIVE') return ok(info);
  // return ng('not_live', info);
}

/* ─────────────────────────  HELPERS PARSE FB  ───────────────────────── */
export function parseFacebookVideoIdFromUrl(u = "") {
  try {
    const url = new URL(u);
    // /{pageId}/videos/{videoId}
    const m = url.pathname.match(/\/videos\/(\d+)/);
    if (m?.[1]) return m[1];
    // video.php?v=ID
    const v = url.searchParams.get("v");
    if (v) return v;
  } catch {}
  return null;
}

export function parseFacebookPageIdFromUrl(u = "") {
  try {
    const url = new URL(u);
    // /{pageId}/videos/{videoId}
    const m = url.pathname.match(/^\/([^/]+)\/videos\//);
    if (m?.[1]) return m[1];
  } catch {}
  return null;
}
