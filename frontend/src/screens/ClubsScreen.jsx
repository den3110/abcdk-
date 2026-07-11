import { lazy, Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang Câu lạc bộ Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
const ClubsPageAstryx = lazy(() => import("./astryx/ClubsPage.jsx"));
const ClubsListPageV1 = lazy(() => import("./clubs/ClubsListPage.jsx"));

const ClubsScreen = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <ClubsPageAstryx /> : <ClubsListPageV1 />}
    </Suspense>
  );
};
export default ClubsScreen;
