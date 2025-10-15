// services/facebookLive.service.js
import axios from "axios";

const GRAPH_VER = process.env.GRAPH_VER || "v24.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VER}`;

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
  status = "LIVE_NOW", // caller vẫn truyền; nếu admin có config.status thì dùng config
}) {
  // 0) Lấy config admin (nếu có)
  const adminCfg = await getAdminLiveConfig();

  try {
    // 1) Tạo LiveVideo (ưu tiên status/privacy từ admin nếu có)
    const paramsCreate = {
      access_token: pageAccessToken,
      status: adminCfg?.status || status,
      title, // KHÔNG bị config ghi đè
      description, // KHÔNG bị config ghi đè
    };
    if (adminCfg?.privacyValueOnCreate) {
      paramsCreate.privacy = toPrivacyJSON(adminCfg.privacyValueOnCreate);
    }
    if (adminCfg?.embeddable) {
      paramsCreate.embeddable = toPrivacyJSON(adminCfg.embeddable);
    }
    const created = await axios
      .post(`${GRAPH}/${pageId}/live_videos`, null, { params: paramsCreate })
      .then((r) => r.data);

    const liveVideoId = created?.id;
    if (!liveVideoId) {
      throw new Error("Create live failed: missing liveVideoId");
    }

    // 2) Áp policy (privacy/embeddable) lần nữa cho chắc chắn
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

    // 3) Lấy thêm trường hữu dụng
    const fields = "permalink_url,secure_stream_url,stream_url";
    const info = await axios
      .get(`${GRAPH}/${liveVideoId}`, {
        params: { access_token: pageAccessToken, fields },
      })
      .then((r) => r.data)
      .catch((e) => {
        console.log("Get info error:", e.response?.data || e.message);
        return {};
      });

    return { liveVideoId, ...info }; // có secure_stream_url + permalink_url (nếu quyền đủ)
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
