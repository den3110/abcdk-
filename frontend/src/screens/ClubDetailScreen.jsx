import { Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang chi tiết CLB Astryx là MẶC ĐỊNH (đồng bộ với danh sách Astryx);
// bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
import ClubDetailAstryx from "./astryx/ClubDetailPage.jsx";
import ClubDetailV1 from "../components/ClubDetailPage.jsx";

const ClubDetailScreen = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <ClubDetailAstryx /> : <ClubDetailV1 />}
    </Suspense>
  );
};
export default ClubDetailScreen;
