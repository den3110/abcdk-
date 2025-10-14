// services/facebookLive.service.js
import axios from "axios";

const GRAPH_VER = process.env.GRAPH_VER || "v24.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VER}`;

const PRIVACY_DEFAULT = "EVERYONE"; // ép public mặc định nếu admin chưa set

/**
 * Tải cấu hình admin (nếu có). Không bắt buộc.
 * - Dự kiến model: models/FbLiveConfig.js (field key="fb_live_config")
 * - Nếu không có model/DB, hàm sẽ trả null và service dùng tham số mặc định.
 */
async function getAdminLiveConfig() {
  try {
    // dynamic import để không phá bundle khi chưa có model
    const mod = await import("../models/fbLiveConfigModel.js");
    const FbLiveConfig = mod.default || mod;
    const cfg =
      (await FbLiveConfig.findOne({ key: "fb_live_config" }).lean()) || null;
    return cfg;
  } catch (_) {
    return null;
  }
}

function toPrivacyJSON(value) {
  return JSON.stringify({ value });
}

/**
 * Áp policy từ admin config lên 1 live/video cụ thể.
 * - phase = "create" | "end" (để ưu tiên privacy phù hợp)
 * - Chỉ chạm privacy / embeddable. Không chạm title/desc/token.
 */
async function applyAdminPolicies({
  liveVideoId,
  pageAccessToken,
  adminCfg,
  phase = "create",
}) {
  if (!adminCfg) return;

  const params = { access_token: pageAccessToken };
  // privacy:
  if (phase === "create" && adminCfg.privacyValueOnCreate) {
    params.privacy = toPrivacyJSON(adminCfg.privacyValueOnCreate);
  }
  if (phase === "end" && adminCfg.ensurePrivacyAfterEnd) {
    params.privacy = toPrivacyJSON(adminCfg.ensurePrivacyAfterEnd);
  }
  // embeddable:
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

  try {
    // 1) Tạo LiveVideo — CHỈ set privacy, KHÔNG set embeddable ở bước này
    const paramsCreate = {
      access_token: pageAccessToken,
      status: adminCfg?.status || status,
      title,
      description,
      privacy: toPrivacyJSON(adminCfg?.privacyValueOnCreate || "EVERYONE"),
    };

    const created = await axios
      .post(`${GRAPH}/${pageId}/live_videos`, null, { params: paramsCreate })
      .then((r) => r.data);

    const liveVideoId = created?.id;
    if (!liveVideoId)
      throw new Error("Create live failed: missing liveVideoId");

    // 🔁 Giữ lại field từ response tạo (FALLBACK nếu GET sau đó lỗi/chậm)
    // (tuỳ phiên bản/permission, create response có thể đã có các field này)
    const fallbackSecure = created?.secure_stream_url || null;
    const fallbackStream = created?.stream_url || null;

    // 2) Áp policy theo admin (nếu có) — chỉ chạm privacy/embeddable
    try {
      await applyAdminPolicies({
        liveVideoId,
        pageAccessToken,
        adminCfg,
        phase: "create",
      });
    } catch (e) {
      console.log("Apply policy warn:", e.response?.data || e.message);
    }

    // 3) GET thêm field hữu ích — có cả expand video{permalink_url}
    let info = {};
    try {
      const fields =
        "permalink_url,secure_stream_url,stream_url,status,privacy,embeddable,video{permalink_url}";
      info = await axios
        .get(`${GRAPH}/${liveVideoId}`, {
          params: { access_token: pageAccessToken, fields },
        })
        .then((r) => r.data);
    } catch (e) {
      console.log("Get info error:", e.response?.data || e.message);
    }

    // 4) Hợp nhất & chuẩn hoá — đảm bảo luôn có URL stream và permalink nếu có thể
    // stream url
    if (!info.secure_stream_url && fallbackSecure) {
      info.secure_stream_url = fallbackSecure;
    }
    if (!info.stream_url && fallbackStream) {
      info.stream_url = fallbackStream;
    }

    // permalink: ưu tiên info.permalink_url, fallback video.permalink_url
    let permalink = info.permalink_url || info?.video?.permalink_url || "";
    if (permalink && !/^https?:\/\//i.test(permalink)) {
      permalink = "https://facebook.com" + permalink; // FB đôi khi trả path tương đối
    }
    info.permalink_url = permalink || info.permalink_url;

    return { liveVideoId, ...info };
  } catch (error) {
    console.log(error.response?.data || error.message);
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

  // Hậu kỳ: đảm bảo privacy/embeddable theo config (nếu có)
  try {
    const adminCfg = await getAdminLiveConfig();
    await applyAdminPolicies({
      liveVideoId,
      pageAccessToken,
      adminCfg,
      phase: "end",
    });
  } catch (e) {
    console.log("Ensure policy after end warn:", e.response?.data || e.message);
  }

  return r.data;
}
