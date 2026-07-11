import { Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang chi tiết giải Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
import TournamentDetailAstryx from "./astryx/TournamentDetailPage.jsx";
import TournamentOverviewV1 from "./PickleBall/TournamentOverviewPage.jsx";

const TournamentDetailScreen = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <TournamentDetailAstryx /> : <TournamentOverviewV1 />}
    </Suspense>
  );
};
export default TournamentDetailScreen;
