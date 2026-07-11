import { lazy, Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang Giải đấu Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
const TournamentsPageAstryx = lazy(() => import("./astryx/TournamentsPage.jsx"));
const TournamentDashboardV1 = lazy(() => import("./PickleBall/Tournament.jsx"));

const TournamentsScreen = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <TournamentsPageAstryx /> : <TournamentDashboardV1 />}
    </Suspense>
  );
};
export default TournamentsScreen;
