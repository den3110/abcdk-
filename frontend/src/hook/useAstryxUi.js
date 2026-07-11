import { useSearchParams } from "react-router-dom";

import { useGetAppInitQuery } from "../slices/appInitApiSlice.js";

/**
 * Quyết định bật giao diện Astryx (bản "v2" trong cài đặt hệ thống):
 * 1) ?ui=v1 | ?ui=v2 trên URL — override thử nghiệm, thắng tất cả.
 * 2) Cài đặt hệ thống của admin (SystemSettings.frontendUi.version, trả về qua
 *    /api/app-init -> publicUi.frontendVersion): "v1" -> giao diện cũ,
 *    "v2"/"v3" -> Astryx (v3 chưa có bản riêng, tạm dùng Astryx như useFrontendUiVersion).
 * 3) Không có tín hiệu (backend cũ chưa có /app-init, endpoint lỗi): DEFAULT_WHEN_UNKNOWN.
 *    Đang để true (Astryx) vì dev chạy proxy tới prod CHƯA deploy endpoint này;
 *    muốn rollout an toàn "mặc định giữ giao diện cũ" thì đổi thành false trước khi ship.
 *
 * AppInitGate đã chặn render tới khi query xong (data hoặc error) nên gate dùng hook này
 * không bị "nháy" đổi giao diện sau khi load.
 */
const DEFAULT_WHEN_UNKNOWN = true;

export default function useAstryxUi() {
  const { data } = useGetAppInitQuery();
  const [searchParams] = useSearchParams();

  const ui = String(searchParams.get("ui") || "").trim().toLowerCase();
  if (ui === "v1") return false;
  if (ui === "v2") return true;

  const v = String(data?.publicUi?.frontendVersion || "").trim().toLowerCase();
  if (v === "v1") return false;
  if (v === "v2" || v === "v3") return true;

  return DEFAULT_WHEN_UNKNOWN;
}
