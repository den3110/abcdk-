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

// 🔍 DEBUG FUNCTION
export async function fbDebugPageAndToken({
  pageId,
  pageAccessToken,
  liveVideoId,
}) {
  console.log("\n========== DEBUG START ==========");

  try {
    // 1. Check page
    const page = await axios
      .get(`${GRAPH}/${pageId}`, {
        params: {
          access_token: pageAccessToken,
          fields: "id,name,is_published,fan_count,link",
        },
      })
      .then((r) => r.data);

    console.log("📄 Page:", page);

    // 2. Check token permissions
    const perms = await axios
      .get(`${GRAPH}/me/permissions`, {
        params: { access_token: pageAccessToken },
      })
      .then((r) => r.data.data)
      .catch(() => []);

    console.log(
      "🔑 Permissions:",
      perms.filter((p) => p.status === "granted").map((p) => p.permission)
    );

    // 3. Get info của live đã tạo
    if (liveVideoId) {
      console.log("\n🔍 Checking live:", liveVideoId);
      const liveInfo = await axios
        .get(`${GRAPH}/${liveVideoId}`, {
          params: {
            access_token: pageAccessToken,
            fields:
              "id,status,privacy,is_reference_only,permalink_url,video{id,permalink_url}",
          },
        })
        .then((r) => r.data);

      console.log("📹 Live FULL INFO:");
      console.log(JSON.stringify(liveInfo, null, 2));

      // Permalink
      const permalink =
        normalizePermalink(liveInfo.permalink_url) ||
        normalizePermalink(liveInfo?.video?.permalink_url);

      console.log("\n📍 Permalink:", permalink || "❌ KHÔNG CÓ!");

      // Check is_reference_only
      if (liveInfo.is_reference_only === true) {
        console.log("\n❌❌❌ VẤN ĐỀ TÌM RA RỒI!");
        console.log("is_reference_only = TRUE");
        console.log("→ Live CHỈ hiện cho admin page, KHÔNG public!");
        console.log("→ Cần fix: Set is_reference_only = false");
      } else if (liveInfo.is_reference_only === false) {
        console.log("\n✅ is_reference_only = FALSE - Đúng rồi!");
        console.log("→ Live PHẢI hiện công khai");
        console.log("→ Nếu vẫn không thấy, có thể do:");
        console.log("  - Chưa có stream → FB ẩn");
        console.log("  - Privacy setting bị override");
        console.log("  - Page bị restrict");
      } else {
        console.log("\n⚠️ is_reference_only = undefined/null");
      }

      if (permalink) {
        console.log("\n👉 MỞ LINK NÀY BẰNG INCOGNITO/ACC KHÁC:");
        console.log(permalink);
      }
    }

    console.log("\n========== DEBUG END ==========\n");

    return {
      page,
      permissions: perms,
    };
  } catch (error) {
    console.error("❌ Debug failed:", error.response?.data || error.message);
  }
}

export async function fbCreateLiveOnPage({
  pageId,
  pageAccessToken,
  title,
  description,
}) {
  try {
    const created = await axios
      .post(`${GRAPH}/${pageId}/live_videos`, null, {
        params: {
          access_token: pageAccessToken,
          status: "LIVE_NOW",
          title,
          description,
          privacy: toPrivacyJSON("EVERYONE"),
        },
      })
      .then((r) => r.data);

    const liveVideoId = created?.id;
    if (!liveVideoId)
      throw new Error("Create live failed: missing liveVideoId");

    console.log("✅ Created live:", liveVideoId);

    const fallback = {
      secure_stream_url: created?.secure_stream_url,
      stream_url: created?.stream_url,
    };

    let info = {};
    try {
      info = await axios
        .get(`${GRAPH}/${liveVideoId}`, {
          params: {
            access_token: pageAccessToken,
            fields:
              "permalink_url,secure_stream_url,stream_url,status,privacy,embeddable,is_reference_only,video{id,permalink_url}",
          },
        })
        .then((r) => r.data);

      console.log("🔍 is_reference_only:", info.is_reference_only);
    } catch (e) {
      console.warn("Get info failed:", e.message);
    }

    const result = {
      liveVideoId,
      videoId: info.video?.id || null,
      secure_stream_url: info.secure_stream_url || fallback.secure_stream_url,
      stream_url: info.stream_url || fallback.stream_url,
      status: info.status || "LIVE_NOW",
      privacy: info.privacy || { value: "EVERYONE" },
      embeddable: info.embeddable ?? true,
      is_reference_only: info.is_reference_only,
      permalink_url:
        normalizePermalink(info.permalink_url) ||
        normalizePermalink(info?.video?.permalink_url) ||
        null,
    };

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

    // 🔥 DEBUG SAU 20S
    setTimeout(() => {
      console.log("\n⏰ Running debug after 20s...");
      fbDebugPageAndToken({
        pageId,
        pageAccessToken,
        liveVideoId,
      });
    }, 20000);

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
  try {
    await axios.post(`${GRAPH}/${liveVideoId}`, null, {
      params: { access_token: pageAccessToken, end_live_video: true },
    });

    await new Promise((r) => setTimeout(r, 3000));

    try {
      const videoInfo = await axios
        .get(`${GRAPH}/${liveVideoId}`, {
          params: {
            access_token: pageAccessToken,
            fields:
              "id,status,permalink_url,is_reference_only,video{id,permalink_url}",
          },
        })
        .then((r) => r.data);

      console.log("📹 Video after end:", {
        status: videoInfo.status,
        is_reference_only: videoInfo.is_reference_only,
        has_video: !!videoInfo.video,
      });

      return videoInfo;
    } catch (e) {
      return { success: true };
    }
  } catch (error) {
    console.error("End live error:", error.response?.data || error.message);
    throw error;
  }
}
