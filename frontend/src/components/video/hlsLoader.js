import Hls from "hls.js";

// Static import (hết dynamic chunk — tránh "Failed to fetch dynamically imported module"
// khi deploy đổi hash). Giữ nguyên API dạng Promise cho các nơi đang gọi.
export default function loadHlsPlayer() {
  return Promise.resolve(Hls);
}
