import { Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang Giải đấu Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
import TournamentsPageAstryx from "./astryx/TournamentsPage.jsx";
import TournamentDashboardV1 from "./PickleBall/Tournament.jsx";

const TournamentsScreen = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <TournamentsPageAstryx /> : <TournamentDashboardV1 />}
    </Suspense>
  );
};
export default TournamentsScreen;
