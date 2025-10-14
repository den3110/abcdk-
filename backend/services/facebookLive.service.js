// services/facebookLive.service.js
import axios from "axios";

const GRAPH_VER = process.env.GRAPH_VER || "v24.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VER}`;

async function getAdminLiveConfig() {
  try {
    const mod = await import("../models/fbLiveConfigModel.js");
    const FbLiveConfig = mod.default || mod;
    return (
      (await FbLiveConfig.findOne({ key: "fb_live_config" }).lean()) || null
    );
  } catch (_) {
    return null;
  }
}

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
  autoGoLiveDelay = 15000, // 👈 Tự động chuyển sang LIVE sau 15s
}) {
  const adminCfg = await getAdminLiveConfig();

  try {
    // Tạo live ở chế độ UNPUBLISHED
    const created = await axios
      .post(`${GRAPH}/${pageId}/live_videos`, null, {
        params: {
          access_token: pageAccessToken,
          status: "UNPUBLISHED",
          title,
          description,
          privacy: toPrivacyJSON(adminCfg?.privacyValueOnCreate || "EVERYONE"),
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

    // Apply policies
    try {
      const params = { access_token: pageAccessToken };

      if (adminCfg?.privacyValueOnCreate) {
        params.privacy = toPrivacyJSON(adminCfg.privacyValueOnCreate);
      }
      if (typeof adminCfg?.embeddable === "boolean") {
        params.embeddable = adminCfg.embeddable;
      }

      if (params.privacy || typeof params.embeddable === "boolean") {
        await axios.post(`${GRAPH}/${liveVideoId}`, null, { params });
      }
    } catch (e) {
      console.warn("Apply policy failed:", e.message);
    }

    // Get full info
    let info = {};
    try {
      info = await axios
        .get(`${GRAPH}/${liveVideoId}`, {
          params: {
            access_token: pageAccessToken,
            fields:
              "permalink_url,secure_stream_url,stream_url,status,privacy,embeddable,video{permalink_url}",
          },
        })
        .then((r) => r.data);
    } catch (e) {
      console.warn("Get info failed:", e.message);
    }

    const result = {
      liveVideoId,
      secure_stream_url: info.secure_stream_url || fallback.secure_stream_url,
      stream_url: info.stream_url || fallback.stream_url,
      status: info.status,
      privacy: info.privacy,
      embeddable: info.embeddable,
      permalink_url:
        normalizePermalink(info.permalink_url) ||
        normalizePermalink(info?.video?.permalink_url),
    };

    // Retry permalink nếu null
    if (!result.permalink_url) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const retry = await axios
          .get(`${GRAPH}/${liveVideoId}`, {
            params: {
              access_token: pageAccessToken,
              fields: "permalink_url,video{permalink_url}",
            },
          })
          .then((r) => r.data);
        result.permalink_url =
          normalizePermalink(retry.permalink_url) ||
          normalizePermalink(retry?.video?.permalink_url);
      } catch (_) {}
    }

    console.log(
      `✅ Live created (UNPUBLISHED). Will go LIVE in ${
        autoGoLiveDelay / 1000
      }s...`
    );

    // 🔥 Tự động chuyển sang LIVE_NOW sau delay
    setTimeout(async () => {
      try {
        await axios.post(`${GRAPH}/${liveVideoId}`, null, {
          params: {
            access_token: pageAccessToken,
            status: "LIVE_NOW",
          },
        });
        console.log("✅ Live is now PUBLIC!");
      } catch (error) {
        console.error(
          "Auto go-live failed:",
          error.response?.data || error.message
        );
      }
    }, autoGoLiveDelay);

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

  try {
    const adminCfg = await getAdminLiveConfig();
    if (adminCfg?.ensurePrivacyAfterEnd) {
      await axios.post(`${GRAPH}/${liveVideoId}`, null, {
        params: {
          access_token: pageAccessToken,
          privacy: toPrivacyJSON(adminCfg.ensurePrivacyAfterEnd),
        },
      });
    }
  } catch (e) {
    console.warn("Post-end policy failed:", e.message);
  }

  return r.data;
}
