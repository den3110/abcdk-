// services/facebookLive.service.js
import axios from "axios";

const GRAPH_VER = process.env.GRAPH_VER || "v24.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VER}`;

// Status hợp lệ (SCHEDULED đã deprecated!)
const VALID_STATUSES = ["LIVE_NOW", "UNPUBLISHED"];

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

function validateStatus(status) {
  return VALID_STATUSES.includes(status) ? status : "LIVE_NOW";
}

async function applyAdminPolicies({
  liveVideoId,
  pageAccessToken,
  adminCfg,
  phase,
}) {
  if (!adminCfg) return;

  const params = { access_token: pageAccessToken };

  if (phase === "create" && adminCfg.privacyValueOnCreate) {
    params.privacy = toPrivacyJSON(adminCfg.privacyValueOnCreate);
  }
  if (phase === "end" && adminCfg.ensurePrivacyAfterEnd) {
    params.privacy = toPrivacyJSON(adminCfg.ensurePrivacyAfterEnd);
  }
  if (typeof adminCfg.embeddable === "boolean") {
    params.embeddable = adminCfg.embeddable;
  }

  if (params.privacy || typeof params.embeddable === "boolean") {
    await axios.post(`${GRAPH}/${liveVideoId}`, null, { params });
  }
}

export async function fbCreateLiveOnPage({
  pageId,
  pageAccessToken,
  title,
  description,
  status = "LIVE_NOW",
}) {
  const adminCfg = await getAdminLiveConfig();

  // Validate status từ admin config trước
  const finalStatus = validateStatus(adminCfg?.status || status);

  if (adminCfg?.status && adminCfg.status !== finalStatus) {
    console.warn(
      `⚠️  Status "${adminCfg.status}" is deprecated, using "${finalStatus}" instead`
    );
  }

  try {
    // Tạo live
    const created = await axios
      .post(`${GRAPH}/${pageId}/live_videos`, null, {
        params: {
          access_token: pageAccessToken,
          status: finalStatus,
          title,
          description,
          privacy: toPrivacyJSON(adminCfg?.privacyValueOnCreate || "EVERYONE"),
        },
      })
      .then((r) => r.data);

    const liveVideoId = created?.id;
    if (!liveVideoId)
      throw new Error("Create live failed: missing liveVideoId");

    // Lưu fallback
    const fallback = {
      secure_stream_url: created?.secure_stream_url,
      stream_url: created?.stream_url,
    };

    // Apply policies
    try {
      await applyAdminPolicies({
        liveVideoId,
        pageAccessToken,
        adminCfg,
        phase: "create",
      });
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

    // Merge với fallback
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
    await applyAdminPolicies({
      liveVideoId,
      pageAccessToken,
      adminCfg,
      phase: "end",
    });
  } catch (e) {
    console.warn("Post-end policy failed:", e.message);
  }

  return r.data;
}
