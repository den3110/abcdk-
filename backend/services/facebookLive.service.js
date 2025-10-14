// services/facebookLive.service.js
import axios from "axios";

const GRAPH_VER = process.env.GRAPH_VER || "v24.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VER}`;

function toPrivacyJSON(value) {
  return JSON.stringify({ value: value || "EVERYONE" });
}

function normalizePermalink(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed === "/" || trimmed.length < 2) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://facebook.com${
    trimmed.startsWith("/") ? trimmed : "/" + trimmed
  }`;
}

export async function fbCreateLiveOnPage({
  pageId,
  pageAccessToken,
  title,
  description,
}) {
  try {
    // Tạo live
    const created = await axios
      .post(`${GRAPH}/${pageId}/live_videos`, null, {
        params: {
          access_token: pageAccessToken,
          status: "LIVE_NOW",
          title,
          description,
          privacy: toPrivacyJSON("EVERYONE"),
          is_reference_only: false, // 👈 THÊM DÒNG NÀY - QUAN TRỌNG!
        },
      })
      .then((r) => r.data);

    const liveVideoId = created?.id;
    if (!liveVideoId)
      throw new Error("Create live failed: missing liveVideoId");

    const fallback = {
      secure_stream_url: created?.secure_stream_url,
      stream_url: created?.stream_url,
    };

    // Get info chi tiết
    let info = {};
    try {
      info = await axios
        .get(`${GRAPH}/${liveVideoId}`, {
          params: {
            access_token: pageAccessToken,
            fields:
              "permalink_url,secure_stream_url,stream_url,status,privacy,embeddable,is_reference_only,video{permalink_url}",
          },
        })
        .then((r) => r.data);

      console.log("🔍 Live info:", info);

      // 👇 Nếu vẫn bị reference_only, force update lại
      if (info.is_reference_only) {
        console.log("⚠️ Fixing is_reference_only...");
        await axios.post(`${GRAPH}/${liveVideoId}`, null, {
          params: {
            access_token: pageAccessToken,
            is_reference_only: false,
          },
        });
        console.log("✅ Fixed!");
      }
    } catch (e) {
      console.warn("Get info failed:", e.message);
    }

    const result = {
      liveVideoId,
      secure_stream_url: info.secure_stream_url || fallback.secure_stream_url,
      stream_url: info.stream_url || fallback.stream_url,
      status: info.status || "LIVE_NOW",
      privacy: info.privacy || { value: "EVERYONE" },
      embeddable: info.embeddable ?? true,
      is_reference_only: false, // Force về false
      permalink_url:
        normalizePermalink(info.permalink_url) ||
        normalizePermalink(info?.video?.permalink_url) ||
        null,
    };

    console.log("✅ Live created (PUBLIC):", result);

    // Retry permalink
    if (!result.permalink_url) {
      setTimeout(async () => {
        try {
          const retry = await axios
            .get(`${GRAPH}/${liveVideoId}`, {
              params: {
                access_token: pageAccessToken,
                fields: "permalink_url,video{permalink_url}",
              },
            })
            .then((r) => r.data);

          const permalink =
            normalizePermalink(retry.permalink_url) ||
            normalizePermalink(retry?.video?.permalink_url);

          if (permalink) console.log("📍 Permalink:", permalink);
        } catch (_) {}
      }, 3000);
    }

    return result;
  } catch (error) {
    console.error("Create live error:", error.response?.data || error.message);
    throw error;
  }
}

export async function fbPostComment({ liveVideoId, pageAccessToken, message }) {
  const r = await axios.post(`${GRAPH}/${liveVideoId}/comments`, null, {
    params: { access_token: pageAccessToken, message },
  });
  return r.data;
}

export async function fbEndLive({ liveVideoId, pageAccessToken }) {
  const r = await axios.post(`${GRAPH}/${liveVideoId}`, null, {
    params: { access_token: pageAccessToken, end_live_video: true },
  });
  return r.data;
}
