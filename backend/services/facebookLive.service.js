// services/facebookLive.service.js
import axios from "axios";

const GRAPH_VER = process.env.GRAPH_VER || "v24.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VER}`;

export async function fbCreateLiveOnPage({
  pageId,
  pageAccessToken,
  title,
  description,
  status = "LIVE_NOW", // hoặc SCHEDULED_UNPUBLISHED nếu muốn hẹn giờ
}) {
  try {
    // 1) Tạo LiveVideo
    let created;
    try {
      created = await axios.post(`${GRAPH}/${pageId}/live_videos`, null, {
        params: { access_token: pageAccessToken, status, title, description },
      });
    } catch (error) {
      console.log(error.response?.data || error.message);
      console.log(123);
    }
    const liveVideoId = created.data.id;

    // 2) Lấy thêm trường hữu dụng
    const fields = "permalink_url,secure_stream_url,stream_url";
    try {
      const info = await axios.get(`${GRAPH}/${liveVideoId}`, {
        params: { access_token: pageAccessToken, fields },
      });
      return { liveVideoId, ...info.data }; // có secure_stream_url + permalink_url
    } catch (error) {
      console.log(error.response?.data || error.message);
      console.log(456);
    }
  } catch (error) {
    console.log(error.response?.data || error.message);
    console.log(789);
  }
}

export async function fbPostComment({ liveVideoId, pageAccessToken, message }) {
  const r = await axios.post(`${GRAPH}/${liveVideoId}/comments`, null, {
    params: { access_token: pageAccessToken, message },
  });
  return r.data;
}

// Cách đơn giản (được dùng phổ biến) để kết thúc live:
export async function fbEndLive({ liveVideoId, pageAccessToken }) {
  const r = await axios.post(`${GRAPH}/${liveVideoId}`, null, {
    params: { access_token: pageAccessToken, end_live_video: true },
  });
  return r.data;
}
