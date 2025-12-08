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
  // console.log("res", res)
  return res; // { id, secure_stream_url, permalink_url, ... }
}


/**
 * Đọc thông tin 1 live video
 */
export async function fbGetLiveVideo({
  liveVideoId,
  pageAccessToken,
  fields = "id,status,permalink_url,ingest_streams,stream_url,secure_stream_url",
}) {
  const url = await base(`/${liveVideoId}?fields=${encodeURIComponent(fields)}&access_token=${pageAccessToken}`);
  const res = await fbFetch(url, {
    method: "GET",
  });
  return res;
}

/**
 * Ép 1 live chuyển sang LIVE_NOW
 */
export async function fbGoLive({ liveVideoId, pageAccessToken, status = "LIVE_NOW" }) {
  const params = new URLSearchParams({
    access_token: pageAccessToken,
    status,
  });

  const url = await base(`/${liveVideoId}`);
  const res = await fbFetch(url, {
    method: "POST",
    body: params,
  });
  return res;
}

/**
 * Poll đợi permalink (dùng khi: tạo sớm → vài giây sau mới stream)
 */
export async function fbPollPermalink({
  liveVideoId,
  pageAccessToken,
  attempts = 6,
  intervalMs = 2000,
  autoGoLive = true,
}) {
  for (let i = 0; i < attempts; i++) {
    const info = await fbGetLiveVideo({ liveVideoId, pageAccessToken });

    const hasIngest =
      Array.isArray(info.ingest_streams) &&
      info.ingest_streams.some((s) => s.has_video);

    // nếu đã có stream mà vẫn chưa LIVE thì ép
    if (hasIngest && autoGoLive && info.status !== "LIVE" && info.status !== "LIVE_NOW") {
      await fbGoLive({ liveVideoId, pageAccessToken });
      // đọc lại ngay để lấy permalink
      const info2 = await fbGetLiveVideo({ liveVideoId, pageAccessToken });
      if (info2.permalink_url) {
        return { ok: true, url: info2.permalink_url, data: info2 };
      }
    }

    if (info.permalink_url) {
      return { ok: true, url: info.permalink_url, data: info };
    }

    // chờ thêm
    if (i < attempts - 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  return { ok: false, url: null };
}

/**
 * Comment vào live video bằng Page token
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
