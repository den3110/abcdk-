// services/facebookLive.service.js
import axios from "axios";

const GRAPH_VER = process.env.GRAPH_VER || "v24.0";
const GRAPH_API_URL = `https://graph.facebook.com/${GRAPH_VER}`;
const PRIVACY_DEFAULT = "EVERYONE";
const PERMALINK_RETRY_DELAY = 3000; // 3 seconds
const DEBUG = process.env.FB_LIVE_DEBUG === "true";

/**
 * Logger helper - chỉ log khi DEBUG mode
 */
function log(message, data = null) {
  if (DEBUG) {
    console.log(`[FB Live Service] ${message}`, data || "");
  }
}

/**
 * Tải cấu hình admin từ database (nếu có)
 * @returns {Promise<Object|null>} Admin config hoặc null
 */
async function getAdminLiveConfig() {
  try {
    const mod = await import("../models/fbLiveConfigModel.js");
    const FbLiveConfig = mod.default || mod;
    const config = await FbLiveConfig.findOne({ key: "fb_live_config" }).lean();
    log("Admin config loaded:", config);
    return config || null;
  } catch (error) {
    log("No admin config found (this is OK):", error.message);
    return null;
  }
}

/**
 * Chuyển đổi privacy value sang JSON format của Facebook
 */
function toPrivacyJSON(value) {
  if (!value || typeof value !== "string") {
    return JSON.stringify({ value: PRIVACY_DEFAULT });
  }
  return JSON.stringify({ value: value.toUpperCase() });
}

/**
 * Validate và chuẩn hóa permalink URL
 */
function normalizePermalink(permalink) {
  if (!permalink || typeof permalink !== "string") {
    return null;
  }

  const trimmed = permalink.trim();

  // Loại bỏ các giá trị không hợp lệ
  if (trimmed === "" || trimmed === "/" || trimmed.length < 2) {
    return null;
  }

  // Nếu đã là URL đầy đủ
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Nếu là relative path, thêm domain
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `https://facebook.com${path}`;
}

/**
 * Áp dụng các policy từ admin config lên live video
 */
async function applyAdminPolicies({
  liveVideoId,
  pageAccessToken,
  adminCfg,
  phase = "create",
}) {
  if (!adminCfg) {
    log("No admin config to apply");
    return;
  }

  const params = { access_token: pageAccessToken };
  let hasChanges = false;

  // Apply privacy settings theo phase
  if (phase === "create" && adminCfg.privacyValueOnCreate) {
    params.privacy = toPrivacyJSON(adminCfg.privacyValueOnCreate);
    hasChanges = true;
    log(`Applying privacy on create: ${adminCfg.privacyValueOnCreate}`);
  }

  if (phase === "end" && adminCfg.ensurePrivacyAfterEnd) {
    params.privacy = toPrivacyJSON(adminCfg.ensurePrivacyAfterEnd);
    hasChanges = true;
    log(`Applying privacy on end: ${adminCfg.ensurePrivacyAfterEnd}`);
  }

  // Apply embeddable setting
  if (typeof adminCfg.embeddable === "boolean") {
    params.embeddable = adminCfg.embeddable;
    hasChanges = true;
    log(`Applying embeddable: ${adminCfg.embeddable}`);
  }

  // Chỉ call API nếu có thay đổi
  if (hasChanges) {
    try {
      await axios.post(`${GRAPH_API_URL}/${liveVideoId}`, null, { params });
      log("Admin policies applied successfully");
    } catch (error) {
      console.error(
        "Failed to apply admin policies:",
        error.response?.data || error.message
      );
      throw error;
    }
  }
}

/**
 * Lấy permalink từ live video với retry mechanism
 */
async function getPermalinkWithRetry(
  liveVideoId,
  pageAccessToken,
  maxRetries = 1
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        log(
          `Retrying to get permalink (attempt ${attempt + 1}/${
            maxRetries + 1
          })...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, PERMALINK_RETRY_DELAY)
        );
      }

      const response = await axios.get(`${GRAPH_API_URL}/${liveVideoId}`, {
        params: {
          access_token: pageAccessToken,
          fields: "permalink_url,video{permalink_url}",
        },
      });

      const data = response.data;
      const permalink =
        normalizePermalink(data.permalink_url) ||
        normalizePermalink(data?.video?.permalink_url);

      if (permalink) {
        log("Permalink retrieved:", permalink);
        return permalink;
      }
    } catch (error) {
      log(`Failed to get permalink (attempt ${attempt + 1}):`, error.message);
    }
  }

  log("Could not retrieve permalink after retries");
  return null;
}

/**
 * Tạo Facebook Live Video trên Page
 */
export async function fbCreateLiveOnPage({
  pageId,
  pageAccessToken,
  title,
  description,
  status = "LIVE_NOW",
}) {
  // Validate required params
  if (!pageId || !pageAccessToken) {
    throw new Error("Missing required params: pageId or pageAccessToken");
  }

  log("Creating live video...", { pageId, title, status });

  const adminCfg = await getAdminLiveConfig();

  try {
    // 1) Tạo Live Video
    const createParams = {
      access_token: pageAccessToken,
      status: adminCfg?.status || status,
      title: title || "Untitled Live",
      description: description || "",
      privacy: toPrivacyJSON(adminCfg?.privacyValueOnCreate || PRIVACY_DEFAULT),
    };

    const createResponse = await axios.post(
      `${GRAPH_API_URL}/${pageId}/live_videos`,
      null,
      { params: createParams }
    );

    const created = createResponse.data;
    const liveVideoId = created?.id;

    if (!liveVideoId) {
      throw new Error(
        "Failed to create live video: missing liveVideoId in response"
      );
    }

    log("Live video created:", { liveVideoId });

    // Lưu fallback URLs từ create response
    const fallbackData = {
      secure_stream_url: created?.secure_stream_url || null,
      stream_url: created?.stream_url || null,
      permalink_url: normalizePermalink(created?.permalink_url) || null,
    };

    // 2) Áp dụng admin policies (nếu có)
    if (adminCfg) {
      try {
        await applyAdminPolicies({
          liveVideoId,
          pageAccessToken,
          adminCfg,
          phase: "create",
        });
      } catch (error) {
        console.warn("Failed to apply admin policies:", error.message);
        // Không throw - tiếp tục với live video đã tạo
      }
    }

    // 3) GET thông tin đầy đủ từ Graph API
    let liveInfo = {};
    try {
      const fields = [
        "id",
        "permalink_url",
        "secure_stream_url",
        "stream_url",
        "status",
        "privacy",
        "embeddable",
        "title",
        "description",
        "video{id,permalink_url}",
      ].join(",");

      const infoResponse = await axios.get(`${GRAPH_API_URL}/${liveVideoId}`, {
        params: { access_token: pageAccessToken, fields },
      });

      liveInfo = infoResponse.data;
      log("Live info retrieved:", liveInfo);
    } catch (error) {
      console.warn(
        "Failed to get live info:",
        error.response?.data || error.message
      );
      // Không throw - dùng fallback data
    }

    // 4) Merge data với fallback
    const result = {
      liveVideoId,
      secure_stream_url:
        liveInfo.secure_stream_url || fallbackData.secure_stream_url,
      stream_url: liveInfo.stream_url || fallbackData.stream_url,
      status: liveInfo.status || status,
      privacy: liveInfo.privacy || {
        value: adminCfg?.privacyValueOnCreate || PRIVACY_DEFAULT,
      },
      embeddable: liveInfo.embeddable ?? adminCfg?.embeddable ?? true,
      title: liveInfo.title || title,
      description: liveInfo.description || description,
      video: liveInfo.video || null,
    };

    // 5) Xử lý permalink với retry nếu cần
    let permalink =
      normalizePermalink(liveInfo.permalink_url) ||
      normalizePermalink(liveInfo?.video?.permalink_url) ||
      fallbackData.permalink_url;

    // Nếu vẫn chưa có permalink, retry 1 lần sau 3s
    if (!permalink) {
      log("Permalink not available yet, will retry...");
      permalink = await getPermalinkWithRetry(liveVideoId, pageAccessToken, 1);
    }

    result.permalink_url = permalink;

    // 6) Log kết quả cuối cùng
    log("✅ Live video created successfully:", {
      liveVideoId: result.liveVideoId,
      permalink: result.permalink_url,
      status: result.status,
      hasStreamUrl: !!result.secure_stream_url,
    });

    // 7) Warning nếu thiếu stream URL
    if (!result.secure_stream_url && !result.stream_url) {
      console.warn(
        "⚠️  Stream URLs not available. This might cause issues with streaming."
      );
    }

    return result;
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error("❌ Failed to create live video:", errorData);
    throw new Error(
      `Facebook Live creation failed: ${
        errorData.error?.message || errorData.message || "Unknown error"
      }`
    );
  }
}

/**
 * Post comment lên live video
 */
export async function fbPostComment({ liveVideoId, pageAccessToken, message }) {
  if (!liveVideoId || !pageAccessToken || !message) {
    throw new Error(
      "Missing required params: liveVideoId, pageAccessToken, or message"
    );
  }

  log("Posting comment to live video...", { liveVideoId });

  try {
    const response = await axios.post(
      `${GRAPH_API_URL}/${liveVideoId}/comments`,
      null,
      {
        params: {
          access_token: pageAccessToken,
          message,
        },
      }
    );

    log("Comment posted successfully:", response.data);
    return response.data;
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error("Failed to post comment:", errorData);
    throw new Error(
      `Failed to post comment: ${
        errorData.error?.message || errorData.message || "Unknown error"
      }`
    );
  }
}

/**
 * Kết thúc live video
 */
export async function fbEndLive({ liveVideoId, pageAccessToken }) {
  if (!liveVideoId || !pageAccessToken) {
    throw new Error("Missing required params: liveVideoId or pageAccessToken");
  }

  log("Ending live video...", { liveVideoId });

  try {
    // 1) End live video
    const response = await axios.post(`${GRAPH_API_URL}/${liveVideoId}`, null, {
      params: {
        access_token: pageAccessToken,
        end_live_video: true,
      },
    });

    log("Live video ended:", response.data);

    // 2) Áp dụng post-end policies (nếu có)
    try {
      const adminCfg = await getAdminLiveConfig();
      if (adminCfg) {
        await applyAdminPolicies({
          liveVideoId,
          pageAccessToken,
          adminCfg,
          phase: "end",
        });
      }
    } catch (error) {
      console.warn(
        "Failed to apply post-end policies:",
        error.response?.data || error.message
      );
      // Không throw - live đã end thành công
    }

    return response.data;
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error("Failed to end live video:", errorData);
    throw new Error(
      `Failed to end live: ${
        errorData.error?.message || errorData.message || "Unknown error"
      }`
    );
  }
}

/**
 * Lấy thông tin chi tiết của live video
 */
export async function fbGetLiveInfo({ liveVideoId, pageAccessToken }) {
  if (!liveVideoId || !pageAccessToken) {
    throw new Error("Missing required params: liveVideoId or pageAccessToken");
  }

  log("Getting live video info...", { liveVideoId });

  try {
    const fields = [
      "id",
      "permalink_url",
      "secure_stream_url",
      "stream_url",
      "status",
      "privacy",
      "embeddable",
      "title",
      "description",
      "is_reference_only",
      "video{id,permalink_url}",
    ].join(",");

    const response = await axios.get(`${GRAPH_API_URL}/${liveVideoId}`, {
      params: {
        access_token: pageAccessToken,
        fields,
      },
    });

    const data = response.data;
    data.permalink_url =
      normalizePermalink(data.permalink_url) ||
      normalizePermalink(data?.video?.permalink_url) ||
      null;

    log("Live info retrieved:", data);
    return data;
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error("Failed to get live info:", errorData);
    throw new Error(
      `Failed to get live info: ${
        errorData.error?.message || errorData.message || "Unknown error"
      }`
    );
  }
}
