import { lazy, Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang chi tiết giải Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
const TournamentDetailAstryx = lazy(() => import("./astryx/TournamentDetailPage.jsx"));
const TournamentOverviewV1 = lazy(() => import("./PickleBall/TournamentOverviewPage.jsx"));

const TournamentDetailScreen = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <TournamentDetailAstryx /> : <TournamentOverviewV1 />}
    </Suspense>
  );
};
export default TournamentDetailScreen;
