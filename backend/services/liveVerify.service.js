// services/liveVerify.service.js
// ✅ Verify livestream thật trên Facebook & YouTube, KHÔNG dùng ENV trực tiếp
// ✅ Lấy cấu hình qua config.service.js, tự refresh OAuth access token cho YouTube
// ✅ FbToken.pageToken theo pageId, fallback token khác còn hạn
// ⚠️ Node >= 18: có global fetch/AbortController. Node thấp hơn thì cài `node-fetch`.

import FbToken from "../models/fbTokenModel.js";
import { getCfgStr, setCfg } from "./config.service.js";

// ───────────── in-memory cache (TTL ngắn) ─────────────
const memoryCache = new Map(); // key -> { exp:number, data:any }
const DEFAULT_TTL_MS = 15_000;

function getCache(key) {
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return hit.data;
}
function setCache(key, data, ttlMs = DEFAULT_TTL_MS) {
  memoryCache.set(key, { exp: Date.now() + ttlMs, data });
}

// ───────────── helpers parse Facebook URL ─────────────
export function parseFacebookVideoIdFromUrl(u = "") {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (/facebook\.com/i.test(url.hostname)) {
      const seg = url.pathname.split("/").filter(Boolean);
      const i = seg.findIndex((s) => s === "videos");
      if (i >= 0 && seg[i + 1]) return seg[i + 1];
      const v = url.searchParams.get("v") || url.searchParams.get("video_id");
      if (v) return v;
    }
  } catch (_) {}
  const m = u.match(/\/videos\/(\d{8,})|[?&]v=(\d{8,})/i);
  return m?.[1] || m?.[2] || null;
}

export function parseFacebookPageIdFromUrl(u = "") {
  try {
    const url = new URL(u);
    const seg = url.pathname.split("/").filter(Boolean); // ["<pageId>","videos","<id>"]
    const i = seg.findIndex((x) => x === "videos");
    if (i > 0) return seg[i - 1] || null;
  } catch (_) {}
  return null;
}

// ───────────── chọn token Facebook ─────────────
export async function bestFacebookTokenForPage(pageId) {
  if (!pageId) return null;
  const doc = await FbToken.findOne({ pageId, needsReauth: { $ne: true } })
    .sort({ updatedAt: -1 })
    .lean();
  if (doc?.pageToken) {
    if (
      !doc.pageTokenExpiresAt ||
      new Date(doc.pageTokenExpiresAt) > new Date()
    )
      return doc.pageToken;
  }
  return null;
}

export async function anyValidFacebookToken() {
  const list = await FbToken.find({
    needsReauth: { $ne: true },
    pageToken: { $exists: true, $ne: "" },
    $or: [
      { pageTokenExpiresAt: null },
      { pageTokenExpiresAt: { $gt: new Date() } },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(3)
    .lean();
  return list?.map((d) => d.pageToken) ?? [];
}

// ───────────── verify Facebook (Graph) ─────────────
export async function verifyFacebookLive({
  liveId,
  pageToken,
  timeoutMs = 6000,
}) {
  if (!liveId) return { ok: false, reason: "missing_live_id" };
  if (!pageToken) return { ok: false, reason: "missing_page_token" };

  const cacheKey = `fb:${liveId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const graphVer = await getCfgStr("GRAPH_VER", "v24.0");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const url =
    `https://graph.facebook.com/${graphVer}/${encodeURIComponent(liveId)}` +
    `?fields=status,live_status,stream_status,permalink_url,` +
    `ingest_streams{status,health},from{id,name}` +
    `&access_token=${encodeURIComponent(pageToken)}`;

  try {
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!r.ok) {
      const data = { ok: false, reason: `http_${r.status}` };
      setCache(cacheKey, data);
      return data;
    }
    const j = await r.json();

    // Ưu tiên ingest_streams nếu có
    let alive = false;
    const streams = j.ingest_streams || [];
    if (Array.isArray(streams) && streams.length) {
      alive = streams.some((s) => {
        const st = String(s?.status || "").toLowerCase();
        return ["active", "connected", "streaming", "live"].includes(st);
      });
    }
    if (!alive) {
      const val = String(
        j.live_status || j.stream_status || j.status || ""
      ).toLowerCase();
      alive = ["live", "streaming", "active", "ready"].some((k) =>
        val.includes(k)
      );
    }

    const data = { ok: alive, raw: j };
    setCache(cacheKey, data);
    return data;
  } catch (e) {
    clearTimeout(t);
    return {
      ok: false,
      reason: e.name === "AbortError" ? "timeout" : e.message,
    };
  }
}

export async function verifyFacebookLiveWithBestToken({ liveId, pageId }) {
  const primary = await bestFacebookTokenForPage(pageId);
  if (primary) {
    const r = await verifyFacebookLive({ liveId, pageToken: primary });
    if (r.ok || r.reason?.startsWith?.("http_") === false) return r;
  }
  const tokens = await anyValidFacebookToken();
  for (const tk of tokens) {
    const r = await verifyFacebookLive({ liveId, pageToken: tk });
    if (r.ok) return r;
  }
  return { ok: false, reason: "no_valid_token_or_not_live" };
}

// ───────────── YouTube OAuth: lấy/refresh access token ─────────────
async function getYoutubeAccessToken() {
  // 1) dùng access token còn hạn nếu có
  const cur = await getCfgStr("YOUTUBE_ACCESS_TOKEN", "");
  const expISO = await getCfgStr("YOUTUBE_ACCESS_EXPIRES_AT", "");
  const expMs = expISO ? Date.parse(expISO) : 0;
  if (cur && expMs && expMs - Date.now() > 60 * 1000) {
    return cur;
  }

  // 2) refresh từ refresh_token + client id/secret
  const refresh = await getCfgStr("YOUTUBE_REFRESH_TOKEN", "");
  const clientId = await getCfgStr("GOOGLE_CLIENT_ID", "");
  const clientSecret = await getCfgStr("GOOGLE_CLIENT_SECRET", "");
  if (!refresh || !clientId || !clientSecret) {
    return null; // thiếu thông tin để refresh
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refresh,
    grant_type: "refresh_token",
  });

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.access_token) {
    return null;
  }

  const accessToken = json.access_token;
  const expiresIn = Number(json.expires_in || 3600);
  const exp = new Date(
    Date.now() + Math.max(0, expiresIn - 60) * 1000
  ).toISOString();

  // Lưu lại vào Config (đánh dấu secret cho access token)
  await setCfg({
    key: "YOUTUBE_ACCESS_TOKEN",
    value: accessToken,
    isSecret: true,
    updatedBy: "system",
  });
  await setCfg({
    key: "YOUTUBE_ACCESS_EXPIRES_AT",
    value: exp,
    isSecret: false,
    updatedBy: "system",
  });

  return accessToken;
}

// ───────────── verify YouTube (videos.list với Bearer token) ─────────────
export async function verifyYouTubeLive(videoId, { timeoutMs = 6000 } = {}) {
  if (!videoId) return { ok: false, reason: "missing_video_id" };

  const token = await getYoutubeAccessToken();
  if (!token) return { ok: false, reason: "missing_youtube_credentials" };

  const cacheKey = `yt:${videoId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const url =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,liveStreamingDetails&id=${encodeURIComponent(videoId)}`;

  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    });
    clearTimeout(t);

    if (r.status === 401 || r.status === 403) {
      // token có thể hết hạn ngoài dự kiến → refresh lại rồi thử 1 lần nữa
      const newToken = await getYoutubeAccessToken();
      if (!newToken) return { ok: false, reason: `http_${r.status}` };
      const r2 = await fetch(url, {
        headers: { Authorization: `Bearer ${newToken}` },
      });
      if (!r2.ok) return { ok: false, reason: `http_${r2.status}` };
      const j2 = await r2.json();
      const it2 = j2.items?.[0];
      if (!it2) return { ok: false, reason: "not_found" };
      const d2 = it2.liveStreamingDetails || {};
      const alive2 = !!d2.actualStartTime && !d2.actualEndTime;
      const data2 = { ok: alive2, raw: j2 };
      setCache(cacheKey, data2);
      return data2;
    }

    if (!r.ok) {
      const data = { ok: false, reason: `http_${r.status}` };
      setCache(cacheKey, data);
      return data;
    }

    const j = await r.json();
    const it = j.items?.[0];
    if (!it) {
      const data = { ok: false, reason: "not_found" };
      setCache(cacheKey, data);
      return data;
    }

    const d = it.liveStreamingDetails || {};
    const alive = !!d.actualStartTime && !d.actualEndTime;
    const data = { ok: alive, raw: j };
    setCache(cacheKey, data);
    return data;
  } catch (e) {
    clearTimeout(t);
    return {
      ok: false,
      reason: e.name === "AbortError" ? "timeout" : e.message,
    };
  }
}
