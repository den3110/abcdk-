import { Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang Câu lạc bộ Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
import ClubsPageAstryx from "./astryx/ClubsPage.jsx";
import ClubsListPageV1 from "./clubs/ClubsListPage.jsx";

const ClubsScreen = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <ClubsPageAstryx /> : <ClubsListPageV1 />}
    </Suspense>
  );
};
export default ClubsScreen;
